import "server-only";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { nextTemplate } from "@/domain/training/rotation";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  WorkoutRepository,
  WorkoutTransaction,
} from "@/application/training/workout-ports";
import { ActiveSessionConflict } from "@/domain/training/workout";
import { withUserTransaction } from "../db/user-transaction";
import { readWorkout, sessionView } from "./workout-read";
import {
  exercise,
  sessionExercise,
  templateExercise,
  workoutProgram,
  workoutSession,
  workoutTemplate,
} from "../db/schema";

function activeSessionViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: string;
    constraint?: string;
    cause?: unknown;
  };
  return (
    (value.code === "23505" &&
      value.constraint === "session_one_active_per_user") ||
    (!!value.cause && activeSessionViolation(value.cause))
  );
}
export function createWorkoutRepository(
  database: NodePgDatabase,
): WorkoutRepository {
  return {
    async forUser(userId, work) {
      try {
        return await withUserTransaction(database, userId, async (tx) => {
          const scoped: WorkoutTransaction = {
            async findNext() {
              const [program] = await tx
                .select()
                .from(workoutProgram)
                .where(
                  and(
                    eq(workoutProgram.userId, userId),
                    eq(workoutProgram.isActive, true),
                  ),
                );
              if (!program) return null;
              const templates = await tx
                .select({ id: workoutTemplate.id, name: workoutTemplate.name })
                .from(workoutTemplate)
                .where(eq(workoutTemplate.programId, program.id))
                .orderBy(asc(workoutTemplate.position));
              const [latest] = await tx
                .select({ source: workoutSession.sourceTemplateId })
                .from(workoutSession)
                .where(
                  and(
                    eq(workoutSession.userId, userId),
                    eq(workoutSession.sourceProgramId, program.id),
                    eq(workoutSession.status, "FINISHED"),
                  ),
                )
                .orderBy(desc(workoutSession.finishOrder))
                .limit(1);
              return nextTemplate(templates, latest?.source ?? null);
            },
            async findActive() {
              return readWorkout(tx, userId, { status: "ACTIVE" });
            },
            async findStartPlan(templateId) {
              const [source] = await tx
                .select({
                  sourceProgramId: workoutProgram.id,
                  sourceProgramName: workoutProgram.name,
                  sourceTemplateId: workoutTemplate.id,
                  sourceTemplateName: workoutTemplate.name,
                })
                .from(workoutTemplate)
                .innerJoin(
                  workoutProgram,
                  eq(workoutTemplate.programId, workoutProgram.id),
                )
                .where(
                  and(
                    eq(workoutTemplate.id, templateId),
                    eq(workoutProgram.userId, userId),
                    eq(workoutProgram.isActive, true),
                  ),
                );
              if (!source) return null;
              const entries = await tx
                .select({ entry: templateExercise, definition: exercise })
                .from(templateExercise)
                .innerJoin(
                  exercise,
                  eq(templateExercise.exerciseId, exercise.id),
                )
                .where(
                  and(
                    eq(templateExercise.templateId, templateId),
                    or(
                      isNull(exercise.ownerUserId),
                      eq(exercise.ownerUserId, userId),
                    ),
                  ),
                )
                .orderBy(asc(templateExercise.position));
              return {
                ...source,
                exercises: entries.map(({ entry, definition }) => ({
                  exerciseId: definition.id,
                  exerciseName: definition.name,
                  loadType: definition.loadType,
                  position: entry.position,
                  plannedWorkingSets: entry.targetWorkingSets,
                  targetRepsMin: entry.targetRepsMin,
                  targetRepsMax: entry.targetRepsMax,
                  targetLoadKg: entry.targetLoadKg,
                  targetRir: entry.targetRir,
                  targetRestSeconds: entry.targetRestSeconds,
                  notes: entry.notes,
                })),
              };
            },
            async insertSession(plan, quota) {
              const [header] = await tx
                .insert(workoutSession)
                .values({
                  userId,
                  status: "ACTIVE",
                  sourceProgramId: plan.sourceProgramId,
                  sourceTemplateId: plan.sourceTemplateId,
                  sourceProgramName: plan.sourceProgramName,
                  sourceTemplateName: plan.sourceTemplateName,
                  plannedWorkingSetQuota: quota,
                })
                .returning();
              return sessionView(header);
            },
            async insertExercise(sessionId, snapshot) {
              await tx
                .insert(sessionExercise)
                .values({ ...snapshot, sessionId, origin: "PLANNED" });
            },
          };
          return work(scoped);
        });
      } catch (error) {
        if (activeSessionViolation(error)) throw new ActiveSessionConflict();
        throw error;
      }
    },
  };
}

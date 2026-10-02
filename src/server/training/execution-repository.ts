import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  ExecutionRepository,
  ExecutionTransaction,
} from "@/application/training/execution-ports";
import { notFound, PlanningError } from "@/domain/training/planning";
import { withUserTransaction } from "../db/user-transaction";
import {
  exercise,
  sessionExercise,
  workoutSession,
  workoutSet,
} from "../db/schema";
import { readWorkout, sessionView } from "./workout-read";

export function createExecutionRepository(
  database: NodePgDatabase,
): ExecutionRepository {
  return {
    forUser(userId, work) {
      return withUserTransaction(database, userId, async (tx) => {
        const ownSessions = tx
          .select({ id: workoutSession.id })
          .from(workoutSession)
          .where(eq(workoutSession.userId, userId));
        const ownExercises = tx
          .select({ id: sessionExercise.id })
          .from(sessionExercise)
          .where(inArray(sessionExercise.sessionId, ownSessions));
        const scoped: ExecutionTransaction = {
          readSession: (id) => readWorkout(tx, userId, { id }),
          async listFinished() {
            const sessions = await tx
              .select()
              .from(workoutSession)
              .where(
                and(
                  eq(workoutSession.userId, userId),
                  eq(workoutSession.status, "FINISHED"),
                ),
              )
              .orderBy(desc(workoutSession.finishOrder));
            return sessions.map(sessionView);
          },
          async findExercise(id) {
            return (
              await tx
                .select({
                  id: sessionExercise.id,
                  sessionId: workoutSession.id,
                  status: workoutSession.status,
                  loadType: sessionExercise.loadType,
                  skipped: sessionExercise.skipped,
                })
                .from(sessionExercise)
                .innerJoin(
                  workoutSession,
                  eq(sessionExercise.sessionId, workoutSession.id),
                )
                .where(
                  and(
                    eq(sessionExercise.id, id),
                    eq(workoutSession.userId, userId),
                  ),
                )
            )[0];
          },
          async findSet(id) {
            return (
              await tx
                .select({
                  set: workoutSet,
                  status: workoutSession.status,
                  loadType: sessionExercise.loadType,
                  skipped: sessionExercise.skipped,
                })
                .from(workoutSet)
                .innerJoin(
                  sessionExercise,
                  eq(workoutSet.sessionExerciseId, sessionExercise.id),
                )
                .innerJoin(
                  workoutSession,
                  eq(sessionExercise.sessionId, workoutSession.id),
                )
                .where(
                  and(eq(workoutSet.id, id), eq(workoutSession.userId, userId)),
                )
            )[0];
          },
          async availableExercise(id) {
            return (
              await tx
                .select()
                .from(exercise)
                .where(
                  and(
                    eq(exercise.id, id),
                    eq(exercise.archived, false),
                    or(
                      isNull(exercise.ownerUserId),
                      eq(exercise.ownerUserId, userId),
                    ),
                  ),
                )
            )[0];
          },
          async addExercise(sessionId, definition) {
            const session = await scoped.readSession(sessionId);
            if (!session) return notFound();
            if (session.status !== "ACTIVE")
              throw new PlanningError("conflict");
            const position = (session.exercises.at(-1)?.position ?? -1) + 1;
            if (position > 2_147_483_647) throw new PlanningError("conflict");
            const [created] = await tx
              .insert(sessionExercise)
              .values({
                sessionId,
                exerciseId: definition.id,
                position,
                origin: "SESSION_ONLY",
                exerciseName: definition.name,
                loadType: definition.loadType,
                plannedWorkingSets: 0,
              })
              .returning();
            return created;
          },
          async skipExercise(id, skipped) {
            const [updated] = await tx
              .update(sessionExercise)
              .set({ skipped, updatedAt: new Date() })
              .where(
                and(
                  eq(sessionExercise.id, id),
                  inArray(sessionExercise.sessionId, ownSessions),
                ),
              )
              .returning({ id: sessionExercise.id });
            if (!updated) return notFound();
          },
          async createSet(exerciseId, id, values) {
            if (!(await scoped.findExercise(exerciseId))) return notFound();
            const [last] = await tx
              .select({ position: workoutSet.position })
              .from(workoutSet)
              .where(eq(workoutSet.sessionExerciseId, exerciseId))
              .orderBy(desc(workoutSet.position))
              .limit(1);
            const position = (last?.position ?? -1) + 1;
            if (position > 2_147_483_647) throw new PlanningError("conflict");
            const [created] = await tx
              .insert(workoutSet)
              .values({
                ...values,
                id,
                sessionExerciseId: exerciseId,
                position,
              })
              .onConflictDoNothing({ target: workoutSet.id })
              .returning();
            if (!created) throw new PlanningError("conflict");
            return created;
          },
          async changeSet(id, values) {
            return (
              (
                await tx
                  .update(workoutSet)
                  .set({ ...values, updatedAt: new Date() })
                  .where(
                    and(
                      eq(workoutSet.id, id),
                      inArray(workoutSet.sessionExerciseId, ownExercises),
                    ),
                  )
                  .returning()
              )[0] ?? notFound()
            );
          },
          async finish(id, context) {
            const [updated] = await tx
              .update(workoutSession)
              .set({
                ...context,
                status: "FINISHED",
                finishOrder: sql`nextval('public.workout_finish_order')`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workoutSession.id, id),
                  eq(workoutSession.userId, userId),
                  eq(workoutSession.status, "ACTIVE"),
                ),
              )
              .returning({ id: workoutSession.id });
            if (!updated) throw new PlanningError("conflict");
          },
          async cancel(id, at) {
            const [updated] = await tx
              .update(workoutSession)
              .set({
                status: "CANCELLED",
                cancelledAt: at,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workoutSession.id, id),
                  eq(workoutSession.userId, userId),
                  eq(workoutSession.status, "ACTIVE"),
                ),
              )
              .returning({ id: workoutSession.id });
            if (!updated) throw new PlanningError("conflict");
          },
        };
        return work(scoped);
      });
    },
  };
}

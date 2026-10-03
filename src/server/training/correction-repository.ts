import "server-only";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CorrectionRepository } from "@/application/training/corrections";
import { CorrectionRevisionConflict } from "@/domain/training/corrections";
import { notFound, PlanningError } from "@/domain/training/planning";
import { withUserTransaction } from "../db/user-transaction";
import {
  exercise,
  sessionExercise,
  workoutSession,
  workoutSet,
} from "../db/schema";
import { readWorkout } from "./workout-read";

export function createCorrectionRepository(
  database: NodePgDatabase,
): CorrectionRepository {
  return {
    forUser(userId, work) {
      return withUserTransaction(database, userId, async (tx) =>
        work({
          async readOwnedSession(id) {
            const [owned] = await tx
              .select({ id: workoutSession.id })
              .from(workoutSession)
              .where(
                and(
                  eq(workoutSession.id, id),
                  eq(workoutSession.userId, userId),
                ),
              )
              .for("update");
            return owned ? readWorkout(tx, userId, { id }) : null;
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
          async save(session, { command: c, definitions }) {
            const at = new Date();
            for (const id of c.exerciseDeletions) {
              await tx
                .update(workoutSet)
                .set({ deletedAt: at, updatedAt: at })
                .where(
                  and(
                    eq(workoutSet.sessionExerciseId, id),
                    isNull(workoutSet.deletedAt),
                  ),
                );
              await tx
                .update(sessionExercise)
                .set({ deletedAt: at, updatedAt: at })
                .where(
                  and(
                    eq(sessionExercise.id, id),
                    eq(sessionExercise.sessionId, session.id),
                  ),
                );
            }
            for (const id of c.setDeletions)
              await tx
                .update(workoutSet)
                .set({ deletedAt: at, updatedAt: at })
                .where(eq(workoutSet.id, id));
            for (const edit of c.exerciseEdits) {
              const d = definitions.get(edit.id);
              await tx
                .update(sessionExercise)
                .set({
                  ...(d
                    ? {
                        exerciseId: d.id,
                        exerciseName: d.name,
                        loadType: d.loadType,
                      }
                    : {}),
                  ...(edit.skipped === undefined
                    ? {}
                    : { skipped: edit.skipped }),
                  updatedAt: at,
                })
                .where(
                  and(
                    eq(sessionExercise.id, edit.id),
                    eq(sessionExercise.sessionId, session.id),
                  ),
                );
            }
            let exercisePosition =
              (
                await tx
                  .select({ position: sessionExercise.position })
                  .from(sessionExercise)
                  .where(eq(sessionExercise.sessionId, session.id))
                  .orderBy(desc(sessionExercise.position))
                  .limit(1)
              )[0]?.position ?? -1;
            for (const add of c.exerciseAdditions) {
              if (++exercisePosition > 2147483647)
                throw new PlanningError("conflict");
              const d = definitions.get(add.id)!;
              const [inserted] = await tx
                .insert(sessionExercise)
                .values({
                  id: add.id,
                  sessionId: session.id,
                  position: exercisePosition,
                  origin: "SESSION_ONLY",
                  exerciseId: d.id,
                  exerciseName: d.name,
                  loadType: d.loadType,
                  plannedWorkingSets: 0,
                })
                .onConflictDoNothing({ target: sessionExercise.id })
                .returning({ id: sessionExercise.id });
              if (!inserted) throw new PlanningError("conflict");
            }
            for (const edit of c.setEdits) {
              const { id, ...values } = edit;
              await tx
                .update(workoutSet)
                .set({ ...values, updatedAt: at })
                .where(eq(workoutSet.id, id));
            }
            for (const add of c.setAdditions) {
              const [last] = await tx
                .select({ position: workoutSet.position })
                .from(workoutSet)
                .where(eq(workoutSet.sessionExerciseId, add.sessionExerciseId))
                .orderBy(desc(workoutSet.position))
                .limit(1);
              const position = (last?.position ?? -1) + 1;
              if (position > 2147483647) throw new PlanningError("conflict");
              const [inserted] = await tx
                .insert(workoutSet)
                .values({ ...add, position, completedAt: at })
                .onConflictDoNothing({ target: workoutSet.id })
                .returning({ id: workoutSet.id });
              if (!inserted) throw new PlanningError("conflict");
            }
            const [updated] = await tx
              .update(workoutSession)
              .set({
                correctionRevision: c.expected_revision + 1,
                updatedAt: at,
              })
              .where(
                and(
                  eq(workoutSession.id, session.id),
                  eq(workoutSession.userId, userId),
                  eq(workoutSession.status, "FINISHED"),
                  eq(workoutSession.correctionRevision, c.expected_revision),
                ),
              )
              .returning({ id: workoutSession.id });
            if (!updated) throw new CorrectionRevisionConflict();
            return (
              (await readWorkout(tx, userId, { id: session.id })) ?? notFound()
            );
          },
        }),
      );
    },
  };
}

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PreviousPerformanceRepository } from "@/application/training/previous-performance";
import type { PreviousPerformance } from "@/domain/training/previous-performance";
import { withUserTransaction } from "../db/user-transaction";
import { workoutSession } from "../db/schema";

export function createPreviousPerformanceRepository(
  database: NodePgDatabase,
): PreviousPerformanceRepository {
  return {
    forActive(userId, sessionId) {
      return withUserTransaction(database, userId, async (tx) => {
        const [active] = await tx
          .select({ id: workoutSession.id })
          .from(workoutSession)
          .where(
            and(
              eq(workoutSession.id, sessionId),
              eq(workoutSession.userId, userId),
              eq(workoutSession.status, "ACTIVE"),
            ),
          );
        if (!active) return null;
        // One lateral lookup per ACTIVE occurrence, then all of its eligible Sets.
        // Finish order is frozen; correction updated_at never participates.
        const result = await tx.execute<{
          id: string;
          previous: PreviousPerformance | null;
        }>(sql`
          SELECT current.id, CASE WHEN previous.id IS NULL THEN NULL ELSE
            jsonb_build_object('sessionId', previous.session_id,
              'sessionExerciseId', previous.id, 'trainingDay', previous.training_day,
              'loadType', previous.load_type, 'sets', actual.sets) END AS previous
          FROM session_exercise current
          JOIN workout_session active ON active.id = current.session_id
          LEFT JOIN LATERAL (
            SELECT historical.id, historical.session_id, historical.load_type, finished.training_day
            FROM workout_session finished
            JOIN session_exercise historical ON historical.session_id = finished.id
            WHERE finished.user_id = ${userId} AND finished.status = 'FINISHED'
              AND historical.exercise_id = current.exercise_id
              AND historical.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM workout_set eligible
                WHERE eligible.session_exercise_id = historical.id
                  AND eligible.deleted_at IS NULL AND eligible.completed_at IS NOT NULL
                  AND eligible.type = 'WORKING')
            ORDER BY finished.finish_order DESC, historical.position DESC
            LIMIT 1
          ) previous ON true
          LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object('id', eligible.id, 'position', eligible.position,
              'loadKg', eligible.load_kg::text, 'reps', eligible.reps, 'rir', eligible.rir)
              ORDER BY eligible.position) AS sets
            FROM workout_set eligible
            WHERE eligible.session_exercise_id = previous.id
              AND eligible.deleted_at IS NULL AND eligible.completed_at IS NOT NULL
              AND eligible.type = 'WORKING'
          ) actual ON true
          WHERE active.id = ${sessionId} AND active.user_id = ${userId}
            AND active.status = 'ACTIVE' AND current.deleted_at IS NULL
          ORDER BY current.position
        `);
        return Object.fromEntries(
          result.rows.map((row) => [row.id, row.previous]),
        );
      });
    },
  };
}

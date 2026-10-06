import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ProgressRepository } from "@/application/training/progress";
import type {
  HistoricalExercise,
  Occurrence,
  ProgressOverview,
} from "@/domain/training/progress";
import { withUserTransaction } from "../db/user-transaction";

export function createProgressRepository(
  database: NodePgDatabase,
): ProgressRepository {
  return {
    read(userId, dates, exerciseId) {
      return withUserTransaction(database, userId, async (tx) => {
        const overview = await tx.execute<ProgressOverview>(sql`
        SELECT count(*)::int AS "totalFinished",
          count(*) FILTER (WHERE training_day BETWEEN ${dates.from7}::date AND ${dates.today}::date)::int AS "last7",
          count(*) FILTER (WHERE training_day BETWEEN ${dates.from30}::date AND ${dates.today}::date)::int AS "last30"
        FROM workout_session WHERE user_id = ${userId} AND status = 'FINISHED'`);
        // Same canonical eligibility as Previous Performance, independent of ACTIVE context.
        const eligible = sql`s.user_id = ${userId} AND s.status = 'FINISHED' AND se.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM workout_set ws WHERE ws.session_exercise_id = se.id
          AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL AND ws.type = 'WORKING')`;
        const exercises = await tx.execute<HistoricalExercise>(sql`
        SELECT DISTINCT e.id, e.name, e.load_type AS "loadType", e.archived
        FROM workout_session s JOIN session_exercise se ON se.session_id = s.id
        JOIN exercise e ON e.id = se.exercise_id
        WHERE ${eligible} ORDER BY e.name, e.id`);
        // Three grouped reads at most. No per-Session/Set query and no persisted analytics.
        const occurrences =
          exerciseId === undefined
            ? []
            : (
                await tx.execute<Occurrence>(sql`
        SELECT s.id AS "sessionId", se.id AS "sessionExerciseId", s.training_day::text AS "trainingDay",
          s.finish_order::text AS "finishOrder", se.position, se.load_type AS "loadType",
          jsonb_agg(jsonb_build_object('id', ws.id, 'position', ws.position, 'loadKg', ws.load_kg::text,
            'reps', ws.reps, 'rir', ws.rir) ORDER BY ws.position) AS sets
        FROM workout_session s JOIN session_exercise se ON se.session_id = s.id
        JOIN workout_set ws ON ws.session_exercise_id = se.id
        WHERE ${eligible} AND se.exercise_id = ${exerciseId}
          AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL AND ws.type = 'WORKING'
        GROUP BY s.id, se.id ORDER BY s.training_day, s.finish_order, se.position`)
              ).rows;
        return {
          overview: overview.rows[0],
          exercises: exercises.rows,
          occurrences,
        };
      });
    },
  };
}

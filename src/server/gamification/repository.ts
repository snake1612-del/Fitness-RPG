import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { GamificationRepository } from "@/application/gamification";
import type { XpSession } from "@/domain/gamification/xp";
import { withUserTransaction } from "../db/user-transaction";

export function createGamificationRepository(
  database: NodePgDatabase,
): GamificationRepository {
  return {
    finished(userId) {
      return withUserTransaction(
        database,
        userId,
        async (tx) =>
          (
            await tx.execute<XpSession>(sql`
          SELECT s.id, s.training_day::text AS "trainingDay", s.finish_order::text AS "finishOrder",
            s.planned_working_set_quota AS p, count(ws.id)::int AS w
          FROM workout_session s
          LEFT JOIN session_exercise se ON se.session_id = s.id AND se.deleted_at IS NULL
          LEFT JOIN workout_set ws ON ws.session_exercise_id = se.id
            AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL AND ws.type = 'WORKING'
          WHERE s.user_id = ${userId} AND s.status = 'FINISHED'
          GROUP BY s.id ORDER BY s.finish_order
        `)
          ).rows,
      );
    },
  };
}

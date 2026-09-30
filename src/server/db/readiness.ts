import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DatabaseReadinessPort } from "@/application/foundation/ports";

export function createDatabaseReadinessGateway(
  database: Pick<NodePgDatabase, "execute">,
): DatabaseReadinessPort {
  return {
    async check() {
      // Unnamed node-postgres queries do not create persistent prepared statements.
      await database.execute(sql`select 1`);
    },
  };
}

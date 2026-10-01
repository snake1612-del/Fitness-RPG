import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type UserTransaction = Parameters<
  Parameters<NodePgDatabase["transaction"]>[0]
>[0];

export function withUserTransaction<T>(
  database: NodePgDatabase,
  userId: string,
  work: (tx: UserTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    // Planning mutations and Start share exactly this transaction-scoped lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );
    return work(tx);
  });
}

import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DatabaseReadinessPort } from "@/application/foundation/ports";
import { getServerConfig } from "../config/server";
import { createPoolOptions } from "./pool-options";
import { createDatabaseReadinessGateway } from "./readiness";

let readinessGateway: DatabaseReadinessPort | undefined;

export function getDatabaseReadinessGateway(): DatabaseReadinessPort {
  if (!readinessGateway) {
    const pool = new Pool(createPoolOptions(getServerConfig()));
    pool.on("error", () => console.error("Database pool connection failed"));
    const database = drizzle({ client: pool });
    readinessGateway = createDatabaseReadinessGateway(database);
  }
  return readinessGateway;
}

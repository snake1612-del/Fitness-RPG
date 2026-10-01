import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DatabaseReadinessPort } from "@/application/foundation/ports";
import { getServerConfig } from "../config/server";
import { createPoolOptions } from "./pool-options";
import { createDatabaseReadinessGateway } from "./readiness";

let database: NodePgDatabase | undefined;

export function getDatabase() {
  if (!database) {
    const pool = new Pool(createPoolOptions(getServerConfig()));
    pool.on("error", () => console.error("Database pool connection failed"));
    database = drizzle({ client: pool });
  }
  return database;
}

let readinessGateway: DatabaseReadinessPort | undefined;

export function getDatabaseReadinessGateway(): DatabaseReadinessPort {
  if (!readinessGateway) {
    readinessGateway = createDatabaseReadinessGateway(getDatabase());
  }
  return readinessGateway;
}

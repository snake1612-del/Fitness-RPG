import type { PoolConfig } from "pg";
import type { ServerConfig } from "../config/parse";

export function createPoolOptions(config: ServerConfig): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 3_000,
    ssl: !config.localDev
      ? {
          rejectUnauthorized: true,
          ...(config.databaseSslCa ? { ca: config.databaseSslCa } : {}),
        }
      : false,
  };
}

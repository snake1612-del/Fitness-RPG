import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { rootCertificates } from "node:tls";
import { createDatabaseReadinessGateway } from "./readiness";
import { createPoolOptions } from "./pool-options";
import { parseServerConfig } from "../config/parse";

const environment = {
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://postgres.test:password@aws-0-test.pooler.supabase.com:6543/postgres",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
};

describe("database foundation", () => {
  it("keeps verified TLS as the default even outside production", () => {
    expect(
      createPoolOptions(
        parseServerConfig({ ...environment, NODE_ENV: "development" }),
      ).ssl,
    ).toEqual({ rejectUnauthorized: true });
  });
  it("disables TLS only for explicit loopback development", () => {
    expect(
      createPoolOptions(
        parseServerConfig({
          ...environment,
          NODE_ENV: "development",
          LOCAL_DEV: "true",
          DATABASE_URL: "postgresql://u:p@127.0.0.1:55322/postgres",
          SUPABASE_URL: "http://127.0.0.1:55321",
        }),
      ).ssl,
    ).toBe(false);
  });
  it("uses a one-connection pool with verified TLS in production", () => {
    expect(createPoolOptions(parseServerConfig(environment))).toMatchObject({
      max: 1,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    });
  });

  it("passes a supplied trusted root to TLS without disabling validation", () => {
    const options = createPoolOptions(
      parseServerConfig({
        ...environment,
        DATABASE_SSL_CA: rootCertificates[0],
      }),
    );
    expect(options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: rootCertificates[0].trim(),
    });
  });

  it("runs readiness through Drizzle using an unnamed driver query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const database = drizzle({ client: { query } as unknown as Pool });
    await createDatabaseReadinessGateway(database).check();
    expect(query).toHaveBeenCalledOnce();
    const queryConfig = query.mock.calls[0][0];
    expect(queryConfig.name).toBeUndefined();
    expect(queryConfig.text).toBe("select 1");
  });

  it("propagates database failure to the readiness boundary", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection failed"));
    const database = drizzle({ client: { query } as unknown as Pool });
    await expect(
      createDatabaseReadinessGateway(database).check(),
    ).rejects.toThrow();
  });
});

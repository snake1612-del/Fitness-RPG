import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { cleanEnvironment, validateLocalStatus } from "../../scripts/local.mjs";
import { createPlanningApplication } from "@/application/training/planning";
import { createPlanningRepository } from "@/server/training/repository";

// Explicit opt-in only. Creates a disposable DATABASE in existing Supabase LOCAL;
// never resets normal data, replaces substrate, or reads hosted credentials.
export async function localAuthDatabase() {
  const cli = resolve(
    "node_modules/supabase/bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const { stdout } = await promisify(execFile)(cli, ["status", "-o", "json"], {
    env: { ...cleanEnvironment(), NODE_ENV: "test" },
    encoding: "utf8",
  });
  const local = validateLocalStatus(JSON.parse(stdout));
  const admin = new Pool({
    connectionString: local.DB_URL,
    ssl: false,
    max: 1,
  });
  const name = "m1_acceptance_" + randomBytes(8).toString("hex");
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(local.DB_URL);
    url.pathname = "/" + name;
    pool = new Pool({ connectionString: url.toString(), ssl: false, max: 1 });
    const database = drizzle(pool);
    await migrate(database, { migrationsFolder: "drizzle" });
    const expected = readMigrationFiles({ migrationsFolder: "drizzle" });
    const rows = (
      await pool.query(
        "select hash,created_at from drizzle.__drizzle_migrations order by id",
      )
    ).rows;
    if (
      rows.length !== 9 ||
      rows.some(
        (r, i) =>
          r.hash !== expected[i].hash ||
          String(r.created_at) !== String(expected[i].folderMillis),
      )
    )
      throw new Error("Fresh LOCAL migration verification failed");
    return {
      database,
      postgres: pool,
      app: createPlanningApplication(createPlanningRepository(database)),
      async close() {
        await pool!.end();
        await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
      },
    };
  } catch (error) {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    throw error;
  }
}

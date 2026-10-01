import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryConfig } from "pg";
import { createPlanningApplication } from "@/application/training/planning";
import { createPlanningRepository } from "@/server/training/repository";

export async function planningDatabase() {
  const postgres = await PGlite.create();
  // Simulate old Supabase default grants; migrations must revoke browser access.
  await postgres.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated;",
  );
  for (const migration of readMigrationFiles({ migrationsFolder: "drizzle" })) {
    for (const statement of migration.sql) await postgres.exec(statement);
  }
  const pool = new Pool({ max: 1 });
  let tail = Promise.resolve();
  Object.defineProperty(pool, "connect", {
    value: async () => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return {
        release,
        async query(
          input: string | (QueryConfig & { rowMode?: string }),
          values: unknown[] = [],
        ) {
          const config = typeof input === "string" ? { text: input } : input;
          if (config.name)
            throw new Error(
              "Named prepared query is incompatible with this test boundary",
            );
          // Drizzle expects node-postgres timestamp strings and NUMERIC strings.
          return postgres.query(config.text, values, {
            rowMode: config.rowMode === "array" ? "array" : "object",
            parsers: {
              1700: (value) => value,
              1184: (value) => value,
              1114: (value) => value,
            },
          });
        },
      };
    },
  });
  const database = drizzle({ client: pool });
  const app = createPlanningApplication(createPlanningRepository(database));
  return {
    postgres,
    app,
    async reset() {
      await postgres.exec(
        "TRUNCATE template_exercise, workout_template, workout_program, exercise;",
      );
    },
    async close() {
      await pool.end();
      await postgres.close();
    },
  };
}

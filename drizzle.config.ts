import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  ...(process.env.MIGRATION_DATABASE_URL
    ? { dbCredentials: { url: process.env.MIGRATION_DATABASE_URL } }
    : {}),
});

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
// Generation only; no connection/migration and no runtime secret is needed.
export const auth = betterAuth({
  database: drizzleAdapter(drizzle({ connection: { host: "127.0.0.1" } }), {
    provider: "pg",
    schemaName: "better_auth",
  }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true },
  baseURL: "http://localhost:3000",
  logger: { disabled: true },
});

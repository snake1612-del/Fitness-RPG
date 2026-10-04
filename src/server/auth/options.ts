import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ServerConfig } from "../config/parse";
import * as schema from "./schema";
export function createAuth(
  database: NodePgDatabase,
  config: ServerConfig,
  plugins: BetterAuthPlugin[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schemaName: "better_auth",
      schema,
    }),
    plugins,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    trustedOrigins: [config.betterAuthUrl],
    emailAndPassword: { enabled: true },
    disabledPaths: config.localDev ? [] : ["/sign-up/email"],
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: "uuid" },
      useSecureCookies: config.nodeEnv === "production",
    },
    session: { cookieCache: { enabled: false } },
    logger: { disabled: true },
  });
}

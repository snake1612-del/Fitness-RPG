import { X509Certificate } from "node:crypto";
export type ServerConfig = {
  nodeEnv: "development" | "production" | "test";
  databaseUrl: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  databaseSslCa?: string;
  localDev: boolean;
};
export class ServerConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid server configuration: ${issues.join(", ")}`);
    this.name = "ServerConfigError";
  }
}
type Environment = Record<string, string | undefined>;
const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(host);
export function parseServerConfig(env: Environment): ServerConfig {
  const issues: string[] = [];
  function required(name: string) {
    const value = env[name]?.trim() ?? "";
    if (!value) issues.push(`${name} is required`);
    return value;
  }
  const nodeEnv = (env.NODE_ENV ?? "development") as ServerConfig["nodeEnv"];
  if (!["development", "production", "test"].includes(nodeEnv))
    issues.push("NODE_ENV must be development, production, or test");
  const localDev = env.LOCAL_DEV === "true";
  if (env.LOCAL_DEV !== undefined && !["true", "false"].includes(env.LOCAL_DEV))
    issues.push("LOCAL_DEV must be true or false");
  if (localDev && nodeEnv !== "development")
    issues.push("LOCAL_DEV is allowed only with NODE_ENV=development");
  let databaseUrl = required("DATABASE_URL");
  const betterAuthUrl = required("BETTER_AUTH_URL"),
    betterAuthSecret = required("BETTER_AUTH_SECRET");
  if (
    betterAuthSecret &&
    (betterAuthSecret.length < 32 || /replace[-_]me/i.test(betterAuthSecret))
  )
    issues.push(
      "BETTER_AUTH_SECRET must be a non-placeholder secret of at least 32 characters",
    );
  const databaseSslCa = env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
  if (databaseSslCa) {
    try {
      new X509Certificate(databaseSslCa);
    } catch {
      issues.push("DATABASE_SSL_CA must be a valid PEM certificate");
    }
  }
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol))
        issues.push("DATABASE_URL must use a PostgreSQL scheme");
      if (
        !url.hostname ||
        !url.username ||
        !url.password ||
        !url.pathname ||
        url.pathname === "/"
      )
        issues.push("DATABASE_URL must include host, credentials and database");
      if (localDev && !loopback(url.hostname))
        issues.push("LOCAL_DEV requires a loopback DATABASE_URL");
      if (nodeEnv === "production" && loopback(url.hostname))
        issues.push("Production DATABASE_URL must not use loopback");
      // Accept Neon-style TLS intent, then remove it so pg cannot replace our
      // verified ssl object. Every other driver override remains forbidden.
      const parameters = [...url.searchParams];
      if (
        url.hash ||
        parameters.some(
          ([key, value]) =>
            key !== "sslmode" ||
            localDev ||
            !["require", "verify-full"].includes(value),
        ) ||
        parameters.length > 1
      )
        issues.push(
          "DATABASE_URL must leave TLS settings and driver options to the server pool",
        );
      url.search = "";
      databaseUrl = url.toString();
    } catch {
      issues.push("DATABASE_URL must be a valid URL");
    }
  }
  if (betterAuthUrl) {
    try {
      const url = new URL(betterAuthUrl);
      if (url.origin !== betterAuthUrl || url.username || url.password)
        issues.push(
          "BETTER_AUTH_URL must be an exact origin without path, credentials or query",
        );
      if (
        localDev
          ? url.protocol !== "http:" || !loopback(url.hostname)
          : url.protocol !== "https:"
      )
        issues.push(
          "BETTER_AUTH_URL must use HTTPS outside explicit loopback LOCAL_DEV",
        );
    } catch {
      issues.push("BETTER_AUTH_URL must be a valid URL");
    }
  }
  if (issues.length) throw new ServerConfigError(issues);
  return {
    nodeEnv,
    localDev,
    databaseUrl,
    betterAuthUrl,
    betterAuthSecret,
    ...(databaseSslCa ? { databaseSslCa } : {}),
  };
}

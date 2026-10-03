import { X509Certificate } from "node:crypto";

export type ServerConfig = {
  nodeEnv: "development" | "production" | "test";
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
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

function required(env: Environment, name: string, issues: string[]): string {
  const value = env[name]?.trim();
  if (!value) {
    issues.push(`${name} is required`);
    return "";
  }
  return value;
}

export function parseServerConfig(env: Environment): ServerConfig {
  const issues: string[] = [];
  const rawMode = env.NODE_ENV ?? "development";
  if (!["development", "production", "test"].includes(rawMode)) {
    issues.push("NODE_ENV must be development, production, or test");
  }
  const nodeEnv = rawMode as ServerConfig["nodeEnv"];
  const localDev = env.LOCAL_DEV === "true";
  if (
    env.LOCAL_DEV !== undefined &&
    !["true", "false"].includes(env.LOCAL_DEV)
  ) {
    issues.push("LOCAL_DEV must be true or false");
  }
  if (localDev && nodeEnv !== "development") {
    issues.push("LOCAL_DEV is allowed only with NODE_ENV=development");
  }
  const databaseUrl = required(env, "DATABASE_URL", issues);
  const supabaseUrl = required(env, "SUPABASE_URL", issues);
  const supabasePublishableKey = required(
    env,
    "SUPABASE_PUBLISHABLE_KEY",
    issues,
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
      const parsed = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        issues.push("DATABASE_URL must use a PostgreSQL scheme");
      }
      if (!parsed.hostname || !parsed.username || !parsed.password) {
        issues.push("DATABASE_URL must include host and credentials");
      }
      if (
        localDev &&
        !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      ) {
        issues.push("LOCAL_DEV requires a loopback DATABASE_URL");
      }
      if (nodeEnv === "production") {
        const sharedPooler = parsed.hostname.endsWith(".pooler.supabase.com");
        const dedicatedPooler = /^db\.[a-z0-9-]+\.supabase\.co$/.test(
          parsed.hostname,
        );
        if ((!sharedPooler && !dedicatedPooler) || parsed.port !== "6543") {
          issues.push("DATABASE_URL must use the Supabase transaction pooler");
        }
      }
      if (
        ["sslmode", "sslcert", "sslkey", "sslrootcert"].some((key) =>
          parsed.searchParams.has(key),
        )
      ) {
        issues.push("DATABASE_URL must leave TLS settings to the server pool");
      }
    } catch {
      issues.push("DATABASE_URL must be a valid URL");
    }
  }

  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      if (
        localDev
          ? parsed.protocol !== "http:" ||
            !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
          : parsed.protocol !== "https:" || !parsed.hostname
      ) {
        issues.push("SUPABASE_URL must be an HTTPS URL");
      }
    } catch {
      issues.push("SUPABASE_URL must be a valid URL");
    }
  }

  if (
    supabasePublishableKey &&
    (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey) ||
      /replace[_-]me/i.test(supabasePublishableKey))
  ) {
    issues.push("SUPABASE_PUBLISHABLE_KEY is malformed");
  }

  if (issues.length > 0) {
    throw new ServerConfigError(issues);
  }

  return {
    nodeEnv,
    databaseUrl,
    supabaseUrl,
    supabasePublishableKey,
    localDev,
    ...(databaseSslCa ? { databaseSslCa } : {}),
  };
}

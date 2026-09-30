import { describe, expect, it } from "vitest";
import { rootCertificates } from "node:tls";
import { parseServerConfig, ServerConfigError } from "./parse";

export const validEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://postgres.test:private-password@aws-0-test.pooler.supabase.com:6543/postgres",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
};

describe("server configuration", () => {
  it("accepts a production transaction-pooler configuration", () => {
    expect(parseServerConfig(validEnvironment)).toMatchObject({
      nodeEnv: "production",
      databaseUrl: validEnvironment.DATABASE_URL,
    });
  });

  it.each(["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"])(
    "reports missing %s without exposing values",
    (key) => {
      const env = { ...validEnvironment, [key]: undefined };
      expect(() => parseServerConfig(env)).toThrow(`${key} is required`);
      try {
        parseServerConfig(env);
      } catch (error) {
        expect(error).toBeInstanceOf(ServerConfigError);
        expect(String(error)).not.toContain("private-password");
      }
    },
  );

  it.each([
    { DATABASE_URL: "not-a-url" },
    { DATABASE_URL: "https://example.com" },
    { SUPABASE_URL: "http://test.supabase.co" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_privileged" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_replace_me" },
    { NODE_ENV: "unknown" },
    { DATABASE_SSL_CA: "invalid certificate" },
  ])("rejects malformed configuration: %j", (override) => {
    expect(() =>
      parseServerConfig({ ...validEnvironment, ...override }),
    ).toThrow(ServerConfigError);
  });

  it("rejects direct or session-mode production connections", () => {
    for (const url of [
      "postgresql://user:password@db.test.supabase.co:5432/postgres",
      validEnvironment.DATABASE_URL.replace(":6543", ":5432"),
    ]) {
      expect(() =>
        parseServerConfig({ ...validEnvironment, DATABASE_URL: url }),
      ).toThrow("transaction pooler");
    }
  });

  it("prevents connection-string TLS options from overriding the pool", () => {
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        DATABASE_URL: `${validEnvironment.DATABASE_URL}?sslmode=disable`,
      }),
    ).toThrow("TLS settings");
  });

  it("allows local PostgreSQL for development tooling", () => {
    expect(
      parseServerConfig({
        ...validEnvironment,
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:password@localhost:5432/postgres",
      }).nodeEnv,
    ).toBe("development");
  });

  it("accepts a dedicated transaction pooler on port 6543", () => {
    expect(
      parseServerConfig({
        ...validEnvironment,
        DATABASE_URL:
          "postgresql://postgres:password@db.test.supabase.co:6543/postgres",
      }).databaseUrl,
    ).toContain(":6543");
  });

  it("accepts and normalizes a supplied root certificate", () => {
    expect(
      parseServerConfig({
        ...validEnvironment,
        DATABASE_SSL_CA: rootCertificates[0].replace(/\n/g, "\\n"),
      }).databaseSslCa,
    ).toBe(rootCertificates[0].trim());
  });
});

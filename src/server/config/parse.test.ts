import { describe, expect, it } from "vitest";
import { parseServerConfig, ServerConfigError } from "./parse";
import { createPoolOptions } from "../db/pool-options";
export const validEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://owner:private-password@ep-pilot-pooler.eu-west-1.aws.neon.tech:5432/neondb",
  BETTER_AUTH_URL: "https://fitness.test",
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
};
const local = {
  ...validEnvironment,
  NODE_ENV: "development",
  LOCAL_DEV: "true",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:55322/postgres",
  BETTER_AUTH_URL: "http://localhost:3001",
};
describe("provider-neutral server configuration", () => {
  it("accepts Neon pooled URL and preserves verified TLS", () => {
    const config = parseServerConfig(validEnvironment);
    expect(createPoolOptions(config).ssl).toEqual({ rejectUnauthorized: true });
    expect(config).not.toHaveProperty("supabaseUrl");
  });
  it("allows explicit local loopback and actual alternate port", () => {
    const config = parseServerConfig(local);
    expect(config.betterAuthUrl).toBe("http://localhost:3001");
    expect(createPoolOptions(config).ssl).toBe(false);
  });
  it.each(["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET"])(
    "requires %s safely",
    (key) => {
      expect(() =>
        parseServerConfig({ ...validEnvironment, [key]: undefined }),
      ).toThrow(key);
    },
  );
  it.each([
    { DATABASE_URL: "not-a-url" },
    { DATABASE_URL: "https://example.com" },
    { DATABASE_URL: "postgresql://u@host/db" },
    { DATABASE_URL: "postgresql://u:p@host/" },
    { DATABASE_URL: validEnvironment.DATABASE_URL + "?sslmode=disable" },
    { DATABASE_URL: validEnvironment.DATABASE_URL + "?host=evil" },
    { DATABASE_URL: "postgresql://u:p@localhost/db" },
    { BETTER_AUTH_URL: "http://fitness.test" },
    { BETTER_AUTH_URL: "https://fitness.test/path" },
    { BETTER_AUTH_URL: "https://u:p@fitness.test" },
    { BETTER_AUTH_URL: "https://fitness.test?x=y" },
    { BETTER_AUTH_SECRET: "short" },
    { NODE_ENV: "unknown" },
    { LOCAL_DEV: "true" },
    { DATABASE_SSL_CA: "invalid" },
  ])("rejects unsafe production config %j", (override) =>
    expect(() =>
      parseServerConfig({ ...validEnvironment, ...override }),
    ).toThrow(ServerConfigError),
  );
  it.each([
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { LOCAL_DEV: "1" },
    { LOCAL_DEV: undefined },
    { DATABASE_URL: validEnvironment.DATABASE_URL },
    { BETTER_AUTH_URL: "http://evil.test" },
  ])("rejects unsafe local config %j", (override) =>
    expect(() => parseServerConfig({ ...local, ...override })).toThrow(),
  );
});

it("normalizes Neon TLS intent without weakening verified pool TLS", () => {
  const config = parseServerConfig({
    ...validEnvironment,
    DATABASE_URL: validEnvironment.DATABASE_URL + "?sslmode=require",
  });
  const options = createPoolOptions(config);
  expect(options.connectionString).not.toContain("sslmode");
  expect(options.ssl).toEqual({ rejectUnauthorized: true });
});

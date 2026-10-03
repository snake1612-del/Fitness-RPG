import { describe, expect, it } from "vitest";
import { cleanEnvironment, validateLocalStatus } from "../../scripts/local.mjs";
const local = {
  DB_URL: "postgresql://postgres:local-test-only@127.0.0.1:55322/postgres",
  API_URL: "http://127.0.0.1:55321",
  PUBLISHABLE_KEY: "sb_publishable_local_test",
};
describe("local tooling isolation", () => {
  it("drops inherited hosted credentials and runtime configuration", () => {
    expect(
      cleanEnvironment({
        PATH: "tools",
        DATABASE_URL: "hosted",
        MIGRATION_DATABASE_URL: "hosted",
        SUPABASE_ACCESS_TOKEN: "secret",
        SUPABASE_URL: "hosted",
        DATABASE_SSL_CA: "ca",
        PILOT_PASSWORD: "secret",
        VERCEL_TOKEN: "secret",
        LOCAL_DEV: "false",
        PGHOST: "hosted",
        DOCKER_HOST: "tcp://remote:2376",
        DOCKER_CONTEXT: "remote",
        DOCKER_TLS_VERIFY: "1",
        DOCKER_CERT_PATH: "remote-certs",
      }),
    ).toEqual({ PATH: "tools" });
  });
  it("accepts only this stack exact loopback DB/Auth endpoints", () => {
    expect(validateLocalStatus(local)).toBe(local);
  });
  it.each([
    {
      DB_URL: "postgresql://postgres:p@host.pooler.supabase.com:6543/postgres",
    },
    { DB_URL: "postgresql://postgres:p@127.0.0.1:54322/postgres" },
    { DB_URL: "postgresql://postgres:p@127.0.0.1:55322/other" },
    { DB_URL: local.DB_URL + "?host=hosted" },
    { API_URL: "https://host.supabase.co" },
    { API_URL: "http://127.0.0.1:54321" },
    { PUBLISHABLE_KEY: "sb_secret_never_allowed" },
  ])("refuses unsafe target %j", (override) =>
    expect(() => validateLocalStatus({ ...local, ...override })).toThrow(),
  );
});

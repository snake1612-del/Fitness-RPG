import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  cleanEnvironment,
  assertLocalMode,
  localSettings,
  validateDockerEndpoint,
  validateLocalDatabaseUrl,
  validateComposeConfiguration,
  validateLocalContainer,
  composeArguments,
  verifyMigrationHistory,
  environment,
} from "../../scripts/local.mjs";
const local = {
  DB_URL:
    "postgresql://fitness_rpg:local-test-only@127.0.0.1:55432/fitness_rpg",
};
const compose = () => ({
  name: localSettings.project,
  services: {
    postgres: {
      image: localSettings.image,
      container_name: localSettings.container,
      restart: "unless-stopped",
      environment: {
        POSTGRES_USER: "fitness_rpg",
        POSTGRES_DB: "fitness_rpg",
        POSTGRES_PASSWORD: "local-test-only",
      },
      ports: [{ host_ip: "127.0.0.1", published: "55432", target: 5432 }],
      volumes: [
        {
          type: "volume",
          source: "postgres-data",
          target: "/var/lib/postgresql/data",
        },
      ],
      healthcheck: {
        test: [
          "CMD-SHELL",
          "pg_isready -h 127.0.0.1 -U fitness_rpg -d fitness_rpg",
        ],
      },
    },
  },
  volumes: { "postgres-data": { name: localSettings.volume } },
});
const container = () => ({
  Name: "/" + localSettings.container,
  Config: {
    Image: localSettings.image,
    Labels: {
      "com.docker.compose.project": localSettings.project,
      "com.docker.compose.service": "postgres",
    },
  },
  HostConfig: {
    PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] },
  },
  NetworkSettings: {
    Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] },
  },
  Mounts: [
    {
      Type: "volume",
      Name: localSettings.volume,
      Destination: "/var/lib/postgresql/data",
    },
  ],
  State: { Running: true, Health: { Status: "healthy" } },
});
describe("plain LOCAL PostgreSQL safety", () => {
  it("strips hosted credentials and Docker/Compose/PG overrides", () => {
    expect(
      cleanEnvironment({
        PATH: "tools",
        BETTER_AUTH_SECRET: "hosted",
        BETTER_AUTH_URL: "https://hosted.test",
        DATABASE_URL: "hosted",
        MIGRATION_DATABASE_URL: "hosted",
        DATABASE_SSL_CA: "ca",
        SUPABASE_ACCESS_TOKEN: "secret",
        SUPABASE_URL: "hosted",
        PILOT_PASSWORD: "secret",
        VERCEL_TOKEN: "secret",
        LOCAL_DEV: "false",
        PGHOST: "hosted",
        PGSSLMODE: "disable",
        POSTGRES_PASSWORD: "hosted",
        COMPOSE_FILE: "remote.yaml",
        COMPOSE_PROJECT_NAME: "other",
        DOCKER_HOST: "tcp://remote:2376",
        DOCKER_CONTEXT: "remote",
        DOCKER_TLS_VERIFY: "1",
        DOCKER_CERT_PATH: "remote-certs",
      }),
    ).toEqual({ PATH: "tools" });
  });
  it("requires intended local URL without any Supabase variables", () => {
    expect(validateLocalDatabaseUrl(local.DB_URL)).toBe(local.DB_URL);
    expect(() => assertLocalMode({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertLocalMode({ NODE_ENV: "production" })).toThrow();
  });
  it.each([
    "postgresql://fitness_rpg:p@host.pooler.supabase.com:6543/fitness_rpg",
    "postgresql://fitness_rpg:p@ep-test-pooler.neon.tech:5432/fitness_rpg",
    "postgresql://fitness_rpg:p@192.168.1.1:55432/fitness_rpg",
    "postgresql://fitness_rpg:p@127.0.0.1:55322/fitness_rpg",
    "postgresql://fitness_rpg:p@127.0.0.1:55432/other",
    "postgresql://other:p@127.0.0.1:55432/fitness_rpg",
    "postgresql://fitness_rpg@127.0.0.1:55432/fitness_rpg",
    "https://fitness_rpg:p@127.0.0.1:55432/fitness_rpg",
    local.DB_URL + "?sslmode=require",
    local.DB_URL + "?host=hosted",
    local.DB_URL + "#override",
  ])("rejects unintended migration target %s", (url) =>
    expect(() => validateLocalDatabaseUrl(url)).toThrow(),
  );
  it.each([
    "npipe:////./pipe/dockerDesktopLinuxEngine",
    "unix:///var/run/docker.sock",
  ])("accepts local Docker transport %s", (endpoint) =>
    expect(() => validateDockerEndpoint(endpoint)).not.toThrow(),
  );
  it.each([
    "tcp://127.0.0.1:2375",
    "tcp://remote:2376",
    "ssh://remote",
    "unix://remote/docker.sock",
    "npipe:////remote/pipe/docker_engine",
  ])("rejects remote/network Docker transport %s", (endpoint) =>
    expect(() => validateDockerEndpoint(endpoint)).toThrow(),
  );
  it("validates one pinned PG17 service, named volume, health and loopback exposure", async () => {
    expect(() => validateComposeConfiguration(compose())).not.toThrow();
    expect(() => validateLocalContainer(container())).not.toThrow();
    const file = await readFile("compose.local.yaml", "utf8");
    expect(file).toContain(localSettings.image);
    expect(file).toContain('"127.0.0.1:55432:5432"');
    expect(file).toContain("name: " + localSettings.volume);
    const unsafe = compose();
    unsafe.services.postgres.ports[0].host_ip = "0.0.0.0";
    expect(() => validateComposeConfiguration(unsafe)).toThrow();
    const exposed = container();
    exposed.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0";
    expect(() => validateLocalContainer(exposed)).toThrow();
    const ephemeral = container();
    ephemeral.Mounts[0].Name = "other";
    expect(() => validateLocalContainer(ephemeral)).toThrow();
    const unhealthy = container();
    unhealthy.State.Health.Status = "unhealthy";
    expect(() => validateLocalContainer(unhealthy)).toThrow();
  });
  it("normal stop retains volume and scopes only this project PostgreSQL service", () => {
    const args = composeArguments("stop");
    expect(args).toContain(localSettings.project);
    expect(args.slice(-2)).toEqual(["stop", "postgres"]);
    expect(args).not.toContain("down");
    expect(args).not.toContain("-v");
    expect(composeArguments("start")).toContain("--wait");
  });
  it("refuses changed, reordered, extra or incomplete canonical migration history", () => {
    const expected = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(expected).toHaveLength(9);
    const rows = expected.map((r) => ({
      hash: r.hash,
      created_at: r.folderMillis,
    }));
    expect(() => verifyMigrationHistory(rows, expected, true)).not.toThrow();
    expect(() =>
      verifyMigrationHistory(rows.slice(0, 8), expected),
    ).not.toThrow();
    expect(() =>
      verifyMigrationHistory(rows.slice(0, 8), expected, true),
    ).toThrow();
    expect(() =>
      verifyMigrationHistory([...rows].reverse(), expected),
    ).toThrow();
    expect(() =>
      verifyMigrationHistory(
        [{ ...rows[0], hash: "changed" }, ...rows.slice(1)],
        expected,
      ),
    ).toThrow();
    expect(() =>
      verifyMigrationHistory([...rows, rows[0]], expected),
    ).toThrow();
  });
});
it("keeps the M1 secret across DB cutover/restart/alternate ports; never overwrites unmanaged or broken state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fitness-local-"));
  try {
    const target = join(directory, ".env.local");
    const first = await environment(local, target, "3001");
    const again = await environment(local, target, "3002");
    expect(again.BETTER_AUTH_SECRET).toBe(first.BETTER_AUTH_SECRET);
    expect(first.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(again.BETTER_AUTH_URL).toBe("http://localhost:3002");
    expect(again.DATABASE_URL).toBe(local.DB_URL);
    expect(await readFile(target, "utf8")).not.toContain("SUPABASE_");
    await expect(environment(local, target, "80")).rejects.toThrow();
    const unmanaged = "BETTER_AUTH_SECRET=do-not-overwrite\n";
    await writeFile(target, unmanaged);
    await expect(environment(local, target)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(unmanaged);
    const missing = "# Fitness RPG generated LOCAL ONLY\n";
    await writeFile(target, missing);
    await expect(environment(local, target)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(missing);
    const oldDb =
      "postgresql://postgres:old-local-only@127.0.0.1:55322/postgres";
    await writeFile(
      target,
      `# Fitness RPG generated LOCAL ONLY\nDATABASE_URL=${JSON.stringify(oldDb)}\nBETTER_AUTH_SECRET=${JSON.stringify(first.BETTER_AUTH_SECRET)}\n`,
    );
    expect((await environment(local, target)).BETTER_AUTH_SECRET).toBe(
      first.BETTER_AUTH_SECRET,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const marker = "# Fitness RPG generated LOCAL ONLY";
const credentialsMarker = "# Fitness RPG plain PostgreSQL LOCAL ONLY";
export const localSettings = Object.freeze({
  project: "fitness-rpg-postgres-local",
  container: "fitness-rpg-postgres-local-db",
  volume: "fitness-rpg-postgres-local-data",
  image:
    "postgres:17.11-trixie@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f",
  port: "55432",
  user: "fitness_rpg",
  database: "fitness_rpg",
});
const credentialsFile = resolve(root, ".local/postgres.env");
export function cleanEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/^(BETTER_AUTH_|SUPABASE_|DATABASE_|MIGRATION_|PILOT_|VERCEL_|COMPOSE_|POSTGRES_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$|LOCAL_DEV$|PG[A-Z_]+$)/i.test(
          key,
        ),
    ),
  );
}
export function assertLocalMode(source = process.env) {
  if (source.NODE_ENV && !["development", "test"].includes(source.NODE_ENV))
    throw new Error("Refusing production environment in LOCAL tooling.");
}
export function validateDockerEndpoint(endpoint) {
  if (
    !/^unix:\/\/\//.test(endpoint) &&
    !/^npipe:\/\/\/\/\.\/pipe\//.test(endpoint)
  )
    throw new Error("Refusing non-local Docker endpoint.");
}
export function validateLocalDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Refusing invalid local database target.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.port !== localSettings.port ||
    url.pathname !== "/" + localSettings.database ||
    url.username !== localSettings.user ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Refusing unexpected local database target.");
  return value;
}
export function validateComposeConfiguration(config) {
  const db = config.services?.postgres;
  if (
    config.name !== localSettings.project ||
    Object.keys(config.services ?? {}).length !== 1 ||
    db?.image !== localSettings.image ||
    db.container_name !== localSettings.container ||
    db.restart !== "unless-stopped" ||
    db.environment?.POSTGRES_USER !== localSettings.user ||
    db.environment?.POSTGRES_DB !== localSettings.database ||
    !db.environment?.POSTGRES_PASSWORD ||
    db.ports?.length !== 1 ||
    db.ports[0].host_ip !== "127.0.0.1" ||
    String(db.ports[0].published) !== localSettings.port ||
    db.ports[0].target !== 5432 ||
    db.volumes?.length !== 1 ||
    db.volumes[0].type !== "volume" ||
    db.volumes[0].source !== "postgres-data" ||
    db.volumes[0].target !== "/var/lib/postgresql/data" ||
    config.volumes?.["postgres-data"]?.name !== localSettings.volume ||
    !db.healthcheck?.test?.includes(
      "pg_isready -h 127.0.0.1 -U fitness_rpg -d fitness_rpg",
    )
  )
    throw new Error("Refusing unexpected local Compose configuration.");
}
export function validateLocalContainer(info, healthy = true) {
  const labels = info.Config?.Labels;
  const bindings = info.HostConfig?.PortBindings?.["5432/tcp"];
  const mounts = info.Mounts ?? [];
  const actual = info.NetworkSettings?.Ports?.["5432/tcp"];
  if (
    info.Name !== "/" + localSettings.container ||
    info.Config?.Image !== localSettings.image ||
    labels?.["com.docker.compose.project"] !== localSettings.project ||
    labels?.["com.docker.compose.service"] !== "postgres" ||
    Object.keys(info.HostConfig?.PortBindings ?? {}).length !== 1 ||
    bindings?.length !== 1 ||
    bindings[0].HostIp !== "127.0.0.1" ||
    bindings[0].HostPort !== localSettings.port ||
    mounts.length !== 1 ||
    mounts[0].Type !== "volume" ||
    mounts[0].Name !== localSettings.volume ||
    mounts[0].Destination !== "/var/lib/postgresql/data" ||
    (healthy &&
      (!info.State?.Running ||
        info.State?.Health?.Status !== "healthy" ||
        actual?.length !== 1 ||
        actual[0].HostIp !== "127.0.0.1" ||
        actual[0].HostPort !== localSettings.port))
  )
    throw new Error(
      "Refusing unexpected or unhealthy local PostgreSQL container.",
    );
}
export function verifyMigrationHistory(rows, expected, complete = false) {
  if (
    (complete && rows.length !== expected.length) ||
    rows.length > expected.length ||
    rows.some(
      (r, i) =>
        r.hash !== expected[i].hash ||
        String(r.created_at) !== String(expected[i].folderMillis),
    )
  )
    throw new Error(
      "Local migration history differs from canonical drizzle history.",
    );
}
async function docker(args) {
  return (
    await run("docker", args, {
      cwd: root,
      env: cleanEnvironment(),
      maxBuffer: 20 * 1024 * 1024,
    })
  ).stdout;
}
async function assertLocalDocker() {
  assertLocalMode();
  const context = (await docker(["context", "show"])).trim();
  const info = JSON.parse(await docker(["context", "inspect", context]))[0];
  validateDockerEndpoint(info.Endpoints.docker.Host);
  await docker(["info", "--format", "{{.ServerVersion}}"]);
}
async function credentials(create = false) {
  let content;
  try {
    content = await readFile(credentialsFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    const password = randomBytes(32).toString("base64url");
    content = `${credentialsMarker}\nPOSTGRES_USER=${localSettings.user}\nPOSTGRES_DB=${localSettings.database}\nPOSTGRES_PASSWORD=${password}\n`;
    await mkdir(dirname(credentialsFile), { recursive: true });
    await writeFile(credentialsFile, content, { mode: 0o600, flag: "wx" });
  }
  const expected = new RegExp(
    `^${credentialsMarker}\r?\nPOSTGRES_USER=${localSettings.user}\r?\nPOSTGRES_DB=${localSettings.database}\r?\nPOSTGRES_PASSWORD=([A-Za-z0-9_-]{43})\r?\n$`,
  );
  const match = content.match(expected);
  if (!match)
    throw new Error(
      "Local database credentials are unmanaged or invalid; refusing overwrite.",
    );
  const url = new URL(
    `postgresql://${localSettings.user}@127.0.0.1:${localSettings.port}/${localSettings.database}`,
  );
  url.password = match[1];
  return { DB_URL: validateLocalDatabaseUrl(url.toString()) };
}
export function composeArguments(command) {
  const commands = {
    start: ["up", "--detach", "--wait", "--wait-timeout", "90", "postgres"],
    stop: ["stop", "postgres"],
    config: ["config", "--format", "json"],
  };
  if (!commands[command])
    throw new Error("Refusing unsupported local Compose command.");
  return [
    "compose",
    "--project-name",
    localSettings.project,
    "--file",
    resolve(root, "compose.local.yaml"),
    "--env-file",
    credentialsFile,
    ...commands[command],
  ];
}
async function composeConfig() {
  validateComposeConfiguration(
    JSON.parse(await docker(composeArguments("config"))),
  );
}
async function inspect(healthy = true) {
  validateLocalContainer(
    JSON.parse(await docker(["inspect", localSettings.container]))[0],
    healthy,
  );
}
async function connectionSmoke(local) {
  const pool = new pg.Pool({
    connectionString: validateLocalDatabaseUrl(local.DB_URL),
    ssl: false,
    max: 1,
  });
  try {
    const {
      rows: [identity],
    } = await pool.query(
      "SELECT current_user AS username, current_database() AS database, current_setting('server_version_num')::int AS version",
    );
    if (
      identity.username !== localSettings.user ||
      identity.database !== localSettings.database ||
      identity.version < 170000 ||
      identity.version >= 180000
    )
      throw new Error(
        "Refusing unexpected PostgreSQL database identity/version.",
      );
  } finally {
    await pool.end();
  }
}
export async function localDatabase() {
  await assertLocalDocker();
  const local = await credentials();
  await composeConfig();
  await inspect();
  await connectionSmoke(local);
  return local;
}
export async function environment(
  local,
  target = resolve(root, ".env.local"),
  port = process.env.LOCAL_DEV_PORT ?? "3000",
) {
  validateLocalDatabaseUrl(local.DB_URL);
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error("Local development port must be 1024–65535.");
  let existing;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing !== undefined && !existing.startsWith(marker))
    throw new Error(
      "Existing .env.local is not managed LOCAL configuration. Move it aside manually; it will not be overwritten.",
    );
  const saved = existing?.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1];
  if (existing !== undefined && !saved)
    throw new Error("Local auth secret is missing; refusing rotation.");
  const secret = saved
    ? JSON.parse(saved)
    : randomBytes(32).toString("base64url");
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("Local auth secret is invalid; refusing rotation.");
  const vars = {
    BETTER_AUTH_URL: "http://localhost:" + port,
    BETTER_AUTH_SECRET: secret,
    LOCAL_DEV: "true",
    DATABASE_URL: local.DB_URL,
    MIGRATION_DATABASE_URL: local.DB_URL,
  };
  await writeFile(
    target,
    marker +
      "\n" +
      Object.entries(vars)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  return vars;
}
async function migration(local) {
  await connectionSmoke(local);
  const pool = new pg.Pool({
    connectionString: validateLocalDatabaseUrl(local.DB_URL),
    ssl: false,
    max: 1,
  });
  try {
    const expected = readMigrationFiles({
      migrationsFolder: resolve(root, "drizzle"),
    });
    const exists = (
      await pool.query(
        "SELECT to_regclass('drizzle.__drizzle_migrations') AS history",
      )
    ).rows[0].history;
    if (exists)
      verifyMigrationHistory(
        (
          await pool.query(
            "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
          )
        ).rows,
        expected,
      );
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(root, "drizzle"),
    });
    verifyMigrationHistory(
      (
        await pool.query(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
        )
      ).rows,
      expected,
      true,
    );
    await pool.query('SELECT id FROM better_auth."user" LIMIT 1');
    await pool.query(
      "SELECT correction_revision,finish_order FROM public.workout_session LIMIT 1",
    );
    await pool.query(
      "SELECT skipped,deleted_at FROM public.session_exercise LIMIT 1",
    );
    console.log(
      "Drizzle migrations 0000–0008: applied; hashes/order verified. Schema smoke PASS.",
    );
  } finally {
    await pool.end();
  }
}
async function main(command) {
  await assertLocalDocker();
  if (command === "start") {
    await credentials(true);
    await composeConfig();
    console.log("Starting Fitness RPG plain PostgreSQL 17…");
    await docker(composeArguments("start"));
    const local = await localDatabase();
    await environment(local);
    await migration(local);
    console.log(
      `LOCAL PostgreSQL ready: 127.0.0.1:${localSettings.port}. Credentials hidden.`,
    );
  } else if (command === "stop") {
    await credentials();
    await composeConfig();
    await inspect(false);
    await docker(composeArguments("stop"));
    console.log(
      "Fitness RPG LOCAL PostgreSQL stopped; named volume/data retained.",
    );
  } else if (command === "status") {
    await localDatabase();
    console.log(
      `Fitness RPG LOCAL PostgreSQL 17: healthy/reachable, 127.0.0.1:${localSettings.port}. Credentials hidden.`,
    );
  } else if (command === "migrate") await migration(await localDatabase());
  else if (command === "dev") {
    const vars = await environment(await localDatabase());
    const port = process.env.LOCAL_DEV_PORT ?? "3000";
    console.log(
      `Open http://localhost:${port} (Auth requires the localhost origin).`,
    );
    const child = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        port,
      ],
      {
        cwd: root,
        env: { ...cleanEnvironment(), ...vars, NODE_ENV: "development" },
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  } else
    throw new Error(
      "Refusing unsupported local command. Use start, status, stop, migrate or dev.",
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv[2]).catch((error) => {
    // CLI/driver errors can embed credentials. Only emit our safe validation messages.
    console.error(
      error.message?.startsWith("Refusing ") ||
        error.message?.startsWith("Existing .env.local") ||
        error.message?.startsWith("Local ")
        ? error.message
        : "Local command failed. Check Docker Desktop and the project PostgreSQL container. No hosted command was run.",
    );
    process.exitCode = 1;
  });

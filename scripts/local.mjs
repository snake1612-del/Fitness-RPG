import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(
  root,
  "node_modules/supabase/bin",
  process.platform === "win32" ? "supabase.exe" : "supabase",
);
const run = promisify(execFile);
const marker = "# Fitness RPG generated LOCAL ONLY";
const project = "fitness-rpg-local",
  network = "fitness-rpg-local-loopback";
export function cleanEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/^(SUPABASE_|DATABASE_|MIGRATION_|PILOT_|VERCEL_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$|LOCAL_DEV$|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|PGSERVICE$|PGSSLMODE$)/i.test(
          key,
        ),
    ),
  );
}
export function validateLocalStatus(status) {
  const db = new URL(status.DB_URL),
    api = new URL(status.API_URL);
  if (
    db.hostname !== "127.0.0.1" ||
    db.port !== "55322" ||
    db.pathname !== "/postgres" ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    db.username !== "postgres" ||
    !db.password ||
    db.search
  )
    throw new Error("Refusing non-local migration/database target.");
  if (api.origin !== "http://127.0.0.1:55321" || api.pathname !== "/")
    throw new Error("Refusing non-local Auth/API target.");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(status.PUBLISHABLE_KEY ?? ""))
    throw new Error("Local CLI did not supply a publishable key.");
  return status;
}
async function supabase(args) {
  // Only a fixed command allowlist calls the local CLI. Never link/login/push/reset.
  return (
    await run(cli, args, {
      cwd: root,
      env: cleanEnvironment(),
      maxBuffer: 20 * 1024 * 1024,
    })
  ).stdout;
}
async function assertLocalDocker() {
  const options = { env: cleanEnvironment() };
  const context = (
    await run("docker", ["context", "show"], options)
  ).stdout.trim();
  const info = JSON.parse(
    (await run("docker", ["context", "inspect", context], options)).stdout,
  )[0];
  if (!/^(npipe:|unix:)/.test(info.Endpoints.docker.Host))
    throw new Error("Refusing non-local Docker endpoint.");
  await run("docker", ["info", "--format", "{{.ServerVersion}}"], options);
}
async function status() {
  return validateLocalStatus(
    JSON.parse(await supabase(["status", "-o", "json"])),
  );
}
async function environment(local) {
  const target = resolve(root, ".env.local");
  let existing;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing && !existing.startsWith(marker))
    throw new Error(
      "Existing .env.local is not managed LOCAL configuration. Move it aside manually; it will not be overwritten.",
    );
  const vars = {
    LOCAL_DEV: "true",
    SUPABASE_URL: local.API_URL,
    SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
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
  const pool = new pg.Pool({
    connectionString: local.DB_URL,
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
    if (exists) {
      const rows = (
        await pool.query(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
        )
      ).rows;
      if (
        rows.some(
          (r, i) =>
            r.hash !== expected[i]?.hash ||
            String(r.created_at) !== String(expected[i]?.folderMillis),
        )
      )
        throw new Error(
          "Local migration history differs from canonical drizzle history.",
        );
    }
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(root, "drizzle"),
    });
    const rows = (
      await pool.query(
        "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    if (
      rows.length !== expected.length ||
      rows.some(
        (r, i) =>
          r.hash !== expected[i].hash ||
          String(r.created_at) !== String(expected[i].folderMillis),
      )
    )
      throw new Error("Local migration verification failed.");
    await pool.query(
      "SELECT correction_revision FROM public.workout_session LIMIT 1",
    );
    await pool.query(
      "SELECT skipped,deleted_at FROM public.session_exercise LIMIT 1",
    );
    console.log(
      `Drizzle migrations 0000–${String(expected.length - 1).padStart(4, "0")}: applied; hashes/order verified. Schema smoke PASS.`,
    );
  } finally {
    await pool.end();
  }
}
async function main(command) {
  await assertLocalDocker();
  if (command === "start") {
    let details;
    try {
      details = JSON.parse(
        (
          await run("docker", ["network", "inspect", network], {
            env: cleanEnvironment(),
          })
        ).stdout,
      )[0];
    } catch {
      await run(
        "docker",
        [
          "network",
          "create",
          "-o",
          "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
          network,
        ],
        { env: cleanEnvironment() },
      );
      details = JSON.parse(
        (
          await run("docker", ["network", "inspect", network], {
            env: cleanEnvironment(),
          })
        ).stdout,
      )[0];
    }
    if (
      details.Options?.["com.docker.network.bridge.host_binding_ipv4"] !==
      "127.0.0.1"
    )
      throw new Error("Local Docker network must bind to loopback.");
    console.log(
      "Starting Fitness RPG local Supabase (first start downloads Docker images)…",
    );
    await supabase(["start", "--network-id", network]);
    const local = await status();
    await environment(local);
    await migration(local);
    console.log(
      "Local services ready. API: http://127.0.0.1:55321 · Studio: http://127.0.0.1:55323 · PostgreSQL: 127.0.0.1:55322",
    );
  } else if (command === "status") {
    await status();
    console.log(
      "Fitness RPG LOCAL: running. API :55321 · PostgreSQL :55322 · Studio :55323. Credentials hidden.",
    );
  } else if (command === "stop") {
    await supabase(["stop", "--project-id", project]);
    console.log(
      "Fitness RPG local services stopped; local data volumes retained.",
    );
  } else if (command === "migrate") await migration(await status());
  else if (command === "dev") {
    const local = await status(),
      vars = await environment(local);
    const port = process.env.LOCAL_DEV_PORT ?? "3000";
    if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
      throw new Error("Local development port must be 1024–65535.");
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
  } else throw new Error("Use start, status, stop, migrate or dev.");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv[2]).catch((error) => {
    // CLI/driver errors can embed credentials. Print only our own safe messages.
    console.error(
      error.message?.startsWith("Refusing ") ||
        error.message?.startsWith("Existing .env.local") ||
        error.message?.startsWith("Local ")
        ? error.message
        : "Local command failed. Check Docker Desktop and local container health. No hosted command was run.",
    );
    process.exitCode = 1;
  });

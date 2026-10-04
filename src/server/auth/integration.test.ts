vi.mock("server-only", () => ({}));
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { localAuthDatabase } from "@/test/local-auth-database";
import { planningDatabase } from "@/test/planning-database";
import { createAuth } from "./options";
import { parseServerConfig } from "../config/parse";
import { createIdentityProvider } from "./identity";
import { authAction } from "../http/auth";
type AuthDatabase = {
  database: Awaited<ReturnType<typeof planningDatabase>>["database"];
  app: Awaited<ReturnType<typeof planningDatabase>>["app"];
  postgres: {
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>;
  };
  close(): Promise<void>;
};
let db: AuthDatabase;
let auth: ReturnType<typeof createAuth>;
const origin = "https://fitness.test";
const password = "integration-only-password";
let id: string, cookie: string;
const headers = () =>
  new Headers({ origin, "Content-Type": "application/json", cookie });
const request = (path: string, body?: unknown) =>
  new Request(origin + path, {
    method: "POST",
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  db =
    process.env.REAL_LOCAL_AUTH === "true"
      ? await localAuthDatabase()
      : await planningDatabase();
  auth = createAuth(
    db.database,
    parseServerConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@host/db",
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "integration-only-secret-at-least-32-characters",
    }),
  );
  const result = await auth.api.signUpEmail({
    body: { name: "Auth integration", email: "auth@example.test", password },
    headers: new Headers({ origin }),
    asResponse: true,
  });
  expect(result.status).toBe(200);
  id = (await result.json()).user.id;
  cookie = result.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => await db?.close());
it("official Better Auth creates UUID user/session in private namespace", async () => {
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  const rows = await db.postgres.query<{ user_id: string }>(
    "select user_id from better_auth.session",
  );
  expect(rows.rows[0].user_id).toBe(id);
  const access = await db.postgres.query<{ allowed: boolean }>(
    "select has_schema_privilege('anon','better_auth','USAGE') or has_table_privilege('authenticated','better_auth.account','SELECT') as allowed",
  );
  expect(access.rows[0].allowed).toBe(false);
  const fk = await db.postgres.query(
    "select 1 from pg_constraint c join pg_class t on c.conrelid=t.oid join pg_namespace n on t.relnamespace=n.oid where c.contype='f' and n.nspname='public' and c.confrelid='better_auth.\"user\"'::regclass",
  );
  expect(fk.rows).toHaveLength(0);
});
it("session validates across reads with no Supabase claims or browser user authority", async () => {
  const provider = createIdentityProvider(() =>
    auth.api.getSession({
      headers: headers(),
      query: { disableCookieCache: true },
    }),
  );
  expect(await provider.currentIdentity()).toEqual({ id });
  expect(await provider.currentIdentity()).toEqual({ id });
  expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
});
it("UUID ownership isolates Training records", async () => {
  const exercise = await db.app.createExercise(id, {
    name: "Better Auth owned",
    loadType: "WEIGHTED",
  });
  const foreign = "00000000-0000-4000-8000-000000000999";
  expect(await db.app.listExercises(foreign)).not.toContainEqual(
    expect.objectContaining({ id: exercise.id }),
  );
  expect(
    (
      await db.postgres.query<{ owner_user_id: string }>(
        "select owner_user_id from exercise where id=$1",
        [exercise.id],
      )
    ).rows[0].owner_user_id,
  ).toBe(id);
});
it("login error, origin protections, session cookies and actual logout revocation", async () => {
  const invalid = await authAction(
    request("/api/auth/login", {
      email: "auth@example.test",
      password: "invalid-password",
    }),
    () => auth,
    "login",
  );
  expect(invalid.status).toBe(401);
  const login = await authAction(
    request("/api/auth/login", { email: "auth@example.test", password }),
    () => auth,
    "login",
  );
  expect(login.status).toBe(200);
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("SameSite=Lax");
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const forbidden = await auth.handler(
    new Request(origin + "/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "auth@example.test", password }),
    }),
  );
  expect(forbidden.status).toBe(403);
  const result = await authAction(
    request("/api/auth/logout"),
    () => auth,
    "logout",
  );
  expect(result.status).toBe(200);
  expect(
    await auth.api.getSession({
      headers: headers(),
      query: { disableCookieCache: true },
    }),
  ).toBeNull();
  const again = await authAction(
    request("/api/auth/login", { email: "auth@example.test", password }),
    () => auth,
    "login",
  );
  expect(again.status).toBe(200);
});

it("fresh Auth UUID can own a Program and canonical workout through real repositories", async () => {
  const { createWorkoutApplication } =
    await import("@/application/training/workout");
  const { createWorkoutRepository } =
    await import("@/server/training/workout-repository");
  const { createExecutionApplication } =
    await import("@/application/training/execution");
  const { createExecutionRepository } =
    await import("@/server/training/execution-repository");
  const exercise = await db.app.createExercise(id, {
    name: "Fresh migration press",
    loadType: "WEIGHTED",
  });
  const program = await db.app.createProgram(id, {
    name: "Fresh Auth Program",
    initialTemplate: {
      name: "A",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 1,
          targetRepsMin: 8,
          targetRepsMax: 12,
        },
      ],
    },
  });
  const workouts = createWorkoutApplication(
    createWorkoutRepository(db.database),
  );
  const execution = createExecutionApplication(
    createExecutionRepository(db.database),
  );
  const { session } = await workouts.start(id, {
    templateId: program.templates[0].id,
  });
  const set = await execution.createSet(id, session.exercises[0].id, {
    id: crypto.randomUUID(),
    loadKg: "20.125",
    reps: 8,
    rir: 2,
  });
  await execution.completeSet(id, set.id);
  await execution.finish(id, session.id, { timeZone: "Europe/Moscow" });
  const saved = await execution.historyDetail(id, session.id);
  expect(saved.exercises[0].sets[0].loadKg).toBe("20.125");
  expect(
    (
      await db.postgres.query(
        "select user_id from workout_session where id=$1",
        [session.id],
      )
    ).rows[0].user_id,
  ).toBe(id);
});

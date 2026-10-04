import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/better-auth", () => ({
  getIdentityProvider: async () => ({
    currentIdentity: async () => (identity ? { id: identity } : null),
  }),
}));
vi.mock("@/server/training/execution-application", () => ({
  getExecutionApplication: () => db.execution,
}));
import { planningDatabase } from "@/test/planning-database";
import { POST as create } from "@/app/api/session-exercises/[id]/sets/route";
import { PATCH as update, DELETE as remove } from "@/app/api/sets/[id]/route";
import { POST as complete } from "@/app/api/sets/[id]/complete/route";
import { POST as uncomplete } from "@/app/api/sets/[id]/uncomplete/route";
import { POST as finish } from "@/app/api/sessions/[id]/finish/route";
import { POST as cancel } from "@/app/api/sessions/[id]/cancel/route";
import { GET as history } from "@/app/api/sessions/route";
import { GET as detail } from "@/app/api/sessions/[id]/route";

const alice = "00000000-0000-0000-0000-000000000001",
  bob = "00000000-0000-0000-0000-000000000002";
let identity: string | null = alice;
let db: Awaited<ReturnType<typeof planningDatabase>>;
beforeAll(async () => {
  db = await planningDatabase();
}, 30000);
beforeEach(async () => {
  await db.reset();
  identity = alice;
});
afterAll(async () => {
  await db?.close();
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("https://example.test/api", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function source() {
  const exercise = await db.app.createExercise(alice, {
    name: "Press",
    loadType: "WEIGHTED",
  });
  const program = await db.app.createProgram(alice, {
    name: "Plan",
    initialTemplate: {
      name: "A",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
        },
      ],
    },
  });
  return (
    await db.workouts.start(alice, { templateId: program.templates[0].id })
  ).session;
}
it("actual route exports compose create/update/complete/uncomplete/delete and Finish/History", async () => {
  const session = await source(),
    setId = randomUUID();
  const created = await create(
    request("POST", {
      id: setId,
      loadKg: "72.500000000000000000000001",
      reps: 8,
    }),
    context(session.exercises[0].id),
  );
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({
    id: setId,
    completedAt: null,
    loadKg: "72.500000000000000000000001",
  });
  expect(
    (await update(request("PATCH", { rir: 10 }), context(setId))).status,
  ).toBe(200);
  const completed = await complete(request("POST"), context(setId));
  expect(completed.status).toBe(200);
  expect((await completed.json()).completedAt).not.toBeNull();
  expect((await uncomplete(request("POST"), context(setId))).status).toBe(200);
  expect((await complete(request("POST"), context(setId))).status).toBe(200);
  const deleted = randomUUID();
  await create(
    request("POST", { id: deleted }),
    context(session.exercises[0].id),
  );
  const removed = await remove(request("DELETE"), context(deleted));
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe("");
  const result = await finish(
    request("POST", { timeZone: "UTC" }),
    context(session.id),
  );
  expect(result.status).toBe(200);
  const saved = await result.json();
  expect(saved.status).toBe("FINISHED");
  expect(typeof saved.finishOrder).toBe("string");
  expect(saved.exercises[0].sets).toHaveLength(1);
  expect((await history()).headers.get("Cache-Control")).toBe("no-store");
  expect(
    (await (await history()).json()).map((value: { id: string }) => value.id),
  ).toEqual([session.id]);
  expect(
    await (await detail(request("GET"), context(session.id))).json(),
  ).toEqual(saved);
  expect(
    await (
      await finish(
        request("POST", { timeZone: "Asia/Tokyo" }),
        context(session.id),
      )
    ).json(),
  ).toEqual(saved);
});
it("cancel route does not expose attempt as completed History", async () => {
  const session = await source();
  const response = await cancel(request("POST"), context(session.id));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("CANCELLED");
  expect(await (await history()).json()).toEqual([]);
  expect((await detail(request("GET"), context(session.id))).status).toBe(404);
});
it("all route actions reject unauthenticated requests", async () => {
  identity = null;
  const ctx = context(alice);
  for (const response of await Promise.all([
    create(request("POST", {}), ctx),
    update(request("PATCH", {}), ctx),
    remove(request("DELETE"), ctx),
    complete(request("POST"), ctx),
    uncomplete(request("POST"), ctx),
    finish(request("POST", {}), ctx),
    cancel(request("POST"), ctx),
    history(),
    detail(request("GET"), ctx),
  ])) {
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  }
});
it("route input parsing rejects malformed JSON/UUID and ownership/completion injection", async () => {
  const session = await source(),
    ctx = context(session.exercises[0].id);
  for (const body of [
    { id: "bad" },
    { id: randomUUID(), userId: bob },
    { id: randomUUID(), completedAt: "2026-10-01" },
    { id: randomUUID(), position: 0 },
  ]) {
    expect((await create(request("POST", body), ctx)).status).toBe(400);
  }
  expect(
    (
      await create(
        new Request("https://example.test", { method: "POST", body: "{" }),
        ctx,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await finish(
        request("POST", { timeZone: "Invalid/Zone" }),
        context(session.id),
      )
    ).status,
  ).toBe(400);
});
it("route detail and mutations conceal foreign resource IDs", async () => {
  const session = await source(),
    set = await db.execution.createSet(alice, session.exercises[0].id, {
      id: randomUUID(),
    });
  await db.execution.finish(alice, session.id, { timeZone: "UTC" });
  identity = bob;
  for (const response of await Promise.all([
    detail(request("GET"), context(session.id)),
    finish(request("POST", { timeZone: "UTC" }), context(session.id)),
    cancel(request("POST"), context(session.id)),
    update(request("PATCH", { reps: 9 }), context(set.id)),
    complete(request("POST"), context(set.id)),
    remove(request("DELETE"), context(set.id)),
  ]))
    expect(response.status).toBe(404);
});

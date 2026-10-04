import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planningDatabase } from "@/test/planning-database";
import { previousPerformanceResponse } from "@/server/http/previous-performance";
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "./execution-repository";

const alice = "00000000-0000-0000-0000-000000000001",
  bob = "00000000-0000-0000-0000-000000000002";
let db: Awaited<ReturnType<typeof planningDatabase>>;
beforeAll(async () => {
  db = await planningDatabase();
}, 30000);
beforeEach(async () => {
  await db.reset();
});
afterAll(async () => {
  await db?.close();
});
const values = {
  type: "WORKING",
  reps: 8,
  loadKg: "20.12500000000000000001",
  rir: 2,
};
async function source(user = alice, loadType = "WEIGHTED") {
  const exercise = await db.app.createExercise(user, {
    name: "Same display name",
    loadType,
  });
  const program = await db.app.createProgram(user, {
    name: "Plan",
    initialTemplate: {
      name: "A",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 2,
          targetRepsMin: 8,
          targetRepsMax: 12,
        },
      ],
    },
  });
  await db.app.activateProgram(user, program.id);
  return { exercise, program, templateId: program.templates[0].id };
}
const start = (templateId: string, user = alice) =>
  db.workouts.start(user, { templateId }).then((r) => r.session);
async function actual(
  entryId: string,
  patch: Record<string, unknown> = {},
  complete = true,
  user = alice,
) {
  const set = await db.execution.createSet(user, entryId, {
    id: randomUUID(),
    ...values,
    ...patch,
  });
  if (complete) await db.execution.completeSet(user, set.id);
  return set;
}
const finish = (sessionId: string, user = alice) =>
  db.execution.finish(user, sessionId, { timeZone: "Europe/Moscow" });
const lookup = (sessionId: string, user = alice) =>
  db.previous.forActive(user, sessionId);

it("canonical prior Finish remains eligible when app finished_at exceeds DB ACTIVE started_at", async () => {
  const p = await source();
  const historical = await start(p.templateId);
  const set = await actual(historical.exercises[0].id);
  // Inject the existing application clock; no timers or waiting for real skew.
  const appFinish = new Date(historical.startedAt.getTime() + 60_000);
  const execution = createExecutionApplication(
    createExecutionRepository(db.database),
    () => appFinish,
  );
  const saved = await execution.finish(alice, historical.id, {
    timeZone: "Europe/Moscow",
  });
  // Start occurs only after the canonical Finish transaction has committed.
  const current = await start(p.templateId);
  const dbStart = new Date(appFinish.getTime() - 2_000);
  // Control only the ACTIVE fixture's timestamp; preserve terminal Finish facts.
  await db.postgres.query(
    "UPDATE workout_session SET started_at=$1 WHERE id=$2 AND status='ACTIVE'",
    [dbStart.toISOString(), current.id],
  );
  const active = (await db.workouts.active(alice))!;
  expect(saved.status).toBe("FINISHED");
  expect(saved.finishOrder).not.toBeNull();
  expect(active.status).toBe("ACTIVE");
  expect(saved.finishedAt!.getTime() - active.startedAt.getTime()).toBe(2_000);
  expect((await lookup(current.id))[current.exercises[0].id]).toMatchObject({
    sessionId: historical.id,
    sets: [{ id: set.id, reps: 8, loadKg: values.loadKg, rir: 2 }],
  });
});

it("empty history and current ACTIVE actuals never supply previous", async () => {
  const p = await source();
  const current = await start(p.templateId);
  expect(await lookup(current.id)).toEqual({ [current.exercises[0].id]: null });
  await actual(current.exercises[0].id);
  expect(await lookup(current.id)).toEqual({ [current.exercises[0].id]: null });
});
it("all live completed WORKING Sets, exact numeric/RIR and frozen training day", async () => {
  const p = await source();
  const historical = await start(p.templateId);
  const a = await actual(historical.exercises[0].id);
  const b = await actual(historical.exercises[0].id, { reps: 7, rir: null });
  await actual(historical.exercises[0].id, { type: "WARM_UP" });
  await actual(historical.exercises[0].id, {}, false);
  const saved = await finish(historical.id);
  const current = await start(p.templateId);
  expect((await lookup(current.id))[current.exercises[0].id]).toMatchObject({
    sessionId: historical.id,
    trainingDay: saved.trainingDay,
    loadType: "WEIGHTED",
    sets: [
      { id: a.id, position: 0, loadKg: values.loadKg, reps: 8, rir: 2 },
      { id: b.id, position: 1, reps: 7, rir: null },
    ],
  });
});
it.each(["warm-up", "draft", "tombstone", "skipped", "zero", "cancelled"])(
  "newer %s occurrence falls back to earlier eligible FINISHED",
  async (kind) => {
    const p = await source();
    const older = await start(p.templateId);
    await actual(older.exercises[0].id);
    await finish(older.id);
    const later = await start(p.templateId);
    const entry = later.exercises[0];
    if (kind === "warm-up") await actual(entry.id, { type: "WARM_UP" });
    if (kind === "draft") await actual(entry.id, {}, false);
    if (kind === "tombstone") {
      const set = await actual(entry.id);
      await db.execution.deleteSet(alice, set.id);
    }
    if (kind === "skipped")
      await db.execution.skipExercise(alice, entry.id, { skipped: true });
    if (kind === "cancelled") {
      await actual(entry.id);
      await db.execution.cancel(alice, later.id);
    } else await finish(later.id);
    const current = await start(p.templateId);
    expect((await lookup(current.id))[current.exercises[0].id]?.sessionId).toBe(
      older.id,
    );
  },
);
it("latest eligible wins across Templates; planning/display name are irrelevant", async () => {
  const p = await source();
  const first = await start(p.templateId);
  await actual(first.exercises[0].id);
  await finish(first.id);
  const t = await db.app.createTemplate(alice, p.program.id, { name: "B" });
  await db.app.createEntry(alice, t.id, {
    exerciseId: p.exercise.id,
    targetWorkingSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 2,
  });
  const newer = await start(t.id);
  await actual(newer.exercises[0].id, { reps: 11 });
  await finish(newer.id);
  const current = await start(p.templateId);
  expect((await lookup(current.id))[current.exercises[0].id]).toMatchObject({
    sessionId: newer.id,
    sets: [{ reps: 11 }],
  });
  const added = await db.execution.addExercise(alice, current.id, {
    exerciseId: p.exercise.id,
  });
  expect((await lookup(current.id))[added.id]?.sessionId).toBe(newer.id);
});
it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
  "corrected %s values derive immediately without changing original recency",
  async (loadType) => {
    const p = await source(alice, loadType);
    const older = await start(p.templateId);
    const oldSet = await actual(older.exercises[0].id, {
      loadKg: loadType === "BODYWEIGHT" ? null : "10",
    });
    await finish(older.id);
    const latest = await start(p.templateId);
    const set = await actual(latest.exercises[0].id, {
      loadKg: loadType === "BODYWEIGHT" ? null : "12",
    });
    await finish(latest.id);
    const current = await start(p.templateId);
    await db.corrections.correct(alice, older.id, {
      expected_revision: 0,
      setEdits: [
        {
          id: oldSet.id,
          ...values,
          loadKg: loadType === "BODYWEIGHT" ? null : "99",
          reps: 99,
        },
      ],
    });
    expect((await lookup(current.id))[current.exercises[0].id]?.sessionId).toBe(
      latest.id,
    );
    await db.corrections.correct(alice, latest.id, {
      expected_revision: 0,
      setEdits: [
        {
          id: set.id,
          ...values,
          loadKg: loadType === "BODYWEIGHT" ? null : "15.75000000000000001",
          reps: 10,
          rir: null,
        },
      ],
    });
    expect((await lookup(current.id))[current.exercises[0].id]).toMatchObject({
      sessionId: latest.id,
      loadType,
      sets: [
        {
          reps: 10,
          rir: null,
          loadKg: loadType === "BODYWEIGHT" ? null : "15.75000000000000001",
        },
      ],
    });
  },
);
it.each(["warm-up", "delete"])(
  "correction %s of last eligible Set removes occurrence",
  async (change) => {
    const p = await source();
    const old = await start(p.templateId);
    await actual(old.exercises[0].id);
    await finish(old.id);
    const later = await start(p.templateId);
    const set = await actual(later.exercises[0].id);
    await finish(later.id);
    const current = await start(p.templateId);
    await db.corrections.correct(alice, later.id, {
      expected_revision: 0,
      ...(change === "delete"
        ? { setDeletions: [set.id] }
        : { setEdits: [{ id: set.id, ...values, type: "WARM_UP" }] }),
    });
    expect((await lookup(current.id))[current.exercises[0].id]?.sessionId).toBe(
      old.id,
    );
  },
);
it("PLANNED and SESSION_ONLY share identity; correction A→B reassigns historical occurrence", async () => {
  const p = await source();
  const other = await db.app.createExercise(alice, {
    name: p.exercise.name,
    loadType: "WEIGHTED",
  });
  const history = await start(p.templateId);
  const extra = await db.execution.addExercise(alice, history.id, {
    exerciseId: other.id,
  });
  await actual(extra.id);
  await finish(history.id);
  const current = await start(p.templateId);
  const added = await db.execution.addExercise(alice, current.id, {
    exerciseId: other.id,
  });
  expect((await lookup(current.id))[added.id]?.sessionExerciseId).toBe(
    extra.id,
  );
  expect((await lookup(current.id))[current.exercises[0].id]).toBeNull();
  await db.corrections.correct(alice, history.id, {
    expected_revision: 0,
    exerciseEdits: [{ id: extra.id, exerciseId: p.exercise.id }],
  });
  const derived = await lookup(current.id);
  expect(derived[added.id]).toBeNull();
  expect(derived[current.exercises[0].id]?.sessionExerciseId).toBe(extra.id);
});
it("tombstoned SESSION_ONLY Exercise and its children cannot supply history", async () => {
  const p = await source();
  const h = await start(p.templateId);
  const e = await db.execution.addExercise(alice, h.id, {
    exerciseId: p.exercise.id,
  });
  await actual(e.id);
  await finish(h.id);
  const c = await start(p.templateId);
  await db.corrections.correct(alice, h.id, {
    expected_revision: 0,
    exerciseDeletions: [e.id],
  });
  expect((await lookup(c.id))[c.exercises[0].id]).toBeNull();
});
it("foreign Session/Exercise ids cannot select or leak another user's history", async () => {
  const a = await source(),
    b = await source(bob);
  const h = await start(b.templateId, bob);
  await actual(h.exercises[0].id, {}, true, bob);
  await finish(h.id, bob);
  const own = await start(a.templateId),
    foreign = await start(b.templateId, bob);
  expect((await lookup(own.id))[own.exercises[0].id]).toBeNull();
  for (const crafted of [foreign.id, h.id, b.exercise.id, h.exercises[0].id])
    await expect(lookup(crafted)).rejects.toMatchObject({ code: "not_found" });
  await expect(lookup("bad-id")).rejects.toMatchObject({
    code: "invalid_input",
  });
});
it("authenticated no-store endpoint denies unauthenticated before accessing repository", async () => {
  const app = vi.fn();
  const denied = await previousPerformanceResponse(
    async () => ({ currentIdentity: async () => null }),
    app,
    randomUUID(),
  );
  expect(denied.status).toBe(401);
  expect(app).not.toHaveBeenCalled();
  const p = await source();
  const current = await start(p.templateId);
  const response = await previousPerformanceResponse(
    async () => ({ currentIdentity: async () => ({ id: alice }) }),
    () => db.previous,
    current.id,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const foreign = await previousPerformanceResponse(
    async () => ({ currentIdentity: async () => ({ id: bob }) }),
    () => db.previous,
    current.id,
  );
  expect(foreign.status).toBe(404);
});

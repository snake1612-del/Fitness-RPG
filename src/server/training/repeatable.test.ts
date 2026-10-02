import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planningDatabase } from "@/test/planning-database";

const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";
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
const finish = (id: string) =>
  db.execution.finish(alice, id, { timeZone: "Europe/Moscow" });
async function source() {
  const exercise = await db.app.createExercise(alice, {
    name: "Press",
    loadType: "WEIGHTED",
  });
  const program = await db.app.createProgram(alice, {
    name: "Rotation",
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
  const a = program.templates[0];
  const b = await db.app.createTemplate(alice, program.id, { name: "B" });
  const c = await db.app.createTemplate(alice, program.id, { name: "C" });
  return { exercise, program, a, b, c };
}
async function next() {
  const result = await db.workouts.next(alice);
  if (result.kind !== "NEXT") throw new Error("Expected Next");
  return result.template;
}

it("derives cyclic Next from Finished only, with Resume priority and user/program isolation", async () => {
  expect(await next()).toBeNull();
  const { a, b, c } = await source();
  expect(await next()).toEqual({ id: a.id, name: "A" });
  const first = (await db.workouts.start(alice, { templateId: a.id })).session;
  expect(await db.workouts.next(alice)).toMatchObject({
    kind: "RESUME",
    session: { id: first.id },
  });
  await finish(first.id);
  // Idempotent Finish cannot advance twice.
  await finish(first.id);
  expect((await next())?.id).toBe(b.id);
  const cancelled = (await db.workouts.start(alice, { templateId: b.id }))
    .session;
  await db.execution.cancel(alice, cancelled.id);
  expect((await next())?.id).toBe(b.id);
  for (const [template, expected] of [
    [b, c],
    [c, a],
  ]) {
    await finish(
      (await db.workouts.start(alice, { templateId: template.id })).session.id,
    );
    expect((await next())?.id).toBe(expected.id);
  }
  expect(await db.workouts.next(bob)).toEqual({ kind: "NEXT", template: null });
  const another = await db.app.createProgram(alice, {
    name: "Other",
    initialTemplate: { name: "Other A" },
  });
  await db.app.activateProgram(alice, another.id);
  expect((await next())?.id).toBe(another.templates[0].id);
});

it("uses current order after planning edits and first Template after historical source deletion", async () => {
  const { program, a, b, c } = await source();
  const first = (await db.workouts.start(alice, { templateId: a.id })).session;
  await finish(first.id);
  await db.app.renameTemplate(alice, c.id, { name: "C edited" });
  await db.app.changeEntry(alice, program.templates[0].exercises[0].id, {
    targetWorkingSets: 7,
  });
  await db.app.reorderTemplates(alice, program.id, { ids: [a.id, c.id, b.id] });
  expect(await next()).toEqual({ id: c.id, name: "C edited" });
  expect(await db.execution.historyDetail(alice, first.id)).toMatchObject({
    plannedWorkingSetQuota: 3,
    exercises: [{ plannedWorkingSets: 3 }],
  });
  await db.postgres.query(
    "DELETE FROM template_exercise WHERE template_id=$1",
    [a.id],
  );
  await db.postgres.query("DELETE FROM workout_template WHERE id=$1", [a.id]);
  expect((await next())?.id).toBe(c.id);
});

it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
  "session-only %s snapshots survive Resume and History without changing P or Template",
  async (loadType) => {
    const { a, program } = await source();
    const before = await db.app.readProgram(alice, program.id);
    const session = (await db.workouts.start(alice, { templateId: a.id }))
      .session;
    const definition = await db.app.createExercise(alice, {
      name: "Extra",
      loadType,
    });
    const added = await db.execution.addExercise(alice, session.id, {
      exerciseId: definition.id,
    });
    expect(added).toMatchObject({
      origin: "SESSION_ONLY",
      plannedWorkingSets: 0,
      exerciseName: "Extra",
      loadType,
      targetRepsMin: null,
      targetRepsMax: null,
    });
    const set = await db.execution.createSet(alice, added.id, {
      id: randomUUID(),
      reps: 8,
      loadKg: loadType === "BODYWEIGHT" ? null : "12.75000000000000001",
    });
    await db.execution.completeSet(alice, set.id);
    await db.app.changeExercise(alice, definition.id, {
      name: "Renamed",
      archived: true,
    });
    const resumed = await db.workouts.active(alice);
    expect(resumed?.plannedWorkingSetQuota).toBe(3);
    expect(resumed?.exercises[1]).toMatchObject({
      exerciseName: "Extra",
      loadType,
      sets: [{ id: set.id, reps: 8 }],
    });
    expect(await db.app.readProgram(alice, program.id)).toEqual(before);
    await finish(session.id);
    const history = await db.execution.historyDetail(alice, session.id);
    expect(history.exercises[1]).toMatchObject({
      origin: "SESSION_ONLY",
      exerciseName: "Extra",
      plannedWorkingSets: 0,
      sets: [{ id: set.id }],
    });
    await expect(
      db.execution.addExercise(alice, session.id, {
        exerciseId: definition.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  },
);

it("rejects foreign/archived definitions and foreign Session/Skip; accepts built-in definitions", async () => {
  const { a } = await source();
  const session = (await db.workouts.start(alice, { templateId: a.id }))
    .session;
  const foreign = await db.app.createExercise(bob, {
    name: "Private",
    loadType: "BODYWEIGHT",
  });
  const archived = await db.app.createExercise(alice, {
    name: "Old",
    loadType: "BODYWEIGHT",
  });
  await db.app.changeExercise(alice, archived.id, { archived: true });
  for (const exerciseId of [foreign.id, archived.id])
    await expect(
      db.execution.addExercise(alice, session.id, { exerciseId }),
    ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    db.execution.addExercise(bob, session.id, { exerciseId: foreign.id }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    db.execution.skipExercise(bob, session.exercises[0].id, { skipped: true }),
  ).rejects.toMatchObject({ code: "not_found" });
  const builtin = randomUUID();
  await db.postgres.query(
    "INSERT INTO exercise(id,name,load_type) VALUES($1,'Built-in','BODYWEIGHT')",
    [builtin],
  );
  expect(
    await db.execution.addExercise(alice, session.id, { exerciseId: builtin }),
  ).toMatchObject({ exerciseId: builtin });
});

it("Skip persists without fake Sets, blocks completion, supports undo and rejects completed-Set contradiction in both app and SQL", async () => {
  const { a } = await source();
  const session = (await db.workouts.start(alice, { templateId: a.id }))
    .session;
  const parent = session.exercises[0].id;
  await db.execution.skipExercise(alice, parent, { skipped: true });
  expect((await db.workouts.active(alice))?.exercises[0]).toMatchObject({
    skipped: true,
    sets: [],
  });
  await expect(
    db.execution.createSet(alice, parent, { id: randomUUID() }),
  ).rejects.toMatchObject({ code: "conflict" });
  await db.execution.skipExercise(alice, parent, { skipped: false });
  const set = await db.execution.createSet(alice, parent, {
    id: randomUUID(),
    reps: 8,
    loadKg: "20",
  });
  await db.execution.skipExercise(alice, parent, { skipped: true });
  await expect(db.execution.completeSet(alice, set.id)).rejects.toMatchObject({
    code: "conflict",
  });
  await expect(
    db.postgres.query("UPDATE workout_set SET completed_at=now() WHERE id=$1", [
      set.id,
    ]),
  ).rejects.toThrow();
  await db.execution.skipExercise(alice, parent, { skipped: false });
  await db.execution.completeSet(alice, set.id);
  await expect(
    db.execution.skipExercise(alice, parent, { skipped: true }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    db.postgres.query("UPDATE session_exercise SET skipped=true WHERE id=$1", [
      parent,
    ]),
  ).rejects.toThrow();
  await db.execution.uncompleteSet(alice, set.id);
  await db.execution.skipExercise(alice, parent, { skipped: true });
  await finish(session.id);
  expect(await db.execution.historyDetail(alice, session.id)).toMatchObject({
    plannedWorkingSetQuota: 3,
    exercises: [{ skipped: true, sets: [{ completedAt: null }] }],
  });
  await expect(
    db.execution.skipExercise(alice, parent, { skipped: false }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    db.postgres.query("UPDATE session_exercise SET skipped=false WHERE id=$1", [
      parent,
    ]),
  ).rejects.toThrow();
});

it("new guards keep browser roles denied and helpers non-executable", async () => {
  for (const role of ["anon", "authenticated"]) {
    const result = await db.postgres.query<{
      table_access: boolean;
      helper_access: boolean;
    }>(
      "SELECT has_table_privilege($1,'public.session_exercise','INSERT,UPDATE') AS table_access, has_function_privilege($1,'public.repeatable_exercise_integrity()','EXECUTE') OR has_function_privilege($1,'public.repeatable_set_integrity()','EXECUTE') OR has_function_privilege($1,'public.repeatable_snapshot_quota()','EXECUTE') AS helper_access",
      [role],
    );
    expect(result.rows[0]).toEqual({
      table_access: false,
      helper_access: false,
    });
  }
});

it.each([true, false])(
  "Skip/completion serialize without contradictory state on the single-pool bridge (skip first=%s)",
  async (skipFirst) => {
    const { a } = await source();
    const session = (await db.workouts.start(alice, { templateId: a.id }))
      .session;
    const parent = session.exercises[0].id;
    const set = await db.execution.createSet(alice, parent, {
      id: randomUUID(),
      reps: 8,
      loadKg: "20",
    });
    const actions = skipFirst
      ? [
          db.execution.skipExercise(alice, parent, { skipped: true }),
          db.execution.completeSet(alice, set.id),
        ]
      : [
          db.execution.completeSet(alice, set.id),
          db.execution.skipExercise(alice, parent, { skipped: true }),
        ];
    const results = await Promise.allSettled(actions);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const saved = (await db.workouts.active(alice))!.exercises[0];
    expect(saved.skipped).toBe(skipFirst);
    expect(saved.sets[0].completedAt !== null).toBe(!skipFirst);
  },
);

it("SQL rejects extra planned rows that change P, invalid session-only targets and duplicate snapshot order", async () => {
  const { a } = await source();
  const session = (await db.workouts.start(alice, { templateId: a.id }))
    .session;
  const insert =
    "INSERT INTO session_exercise(session_id,position,origin,exercise_name,load_type,planned_working_sets,target_reps_min,target_reps_max) VALUES($1,$2,$3,'Extra','WEIGHTED',$4,$5,$6)";
  await expect(
    db.postgres.query(insert, [session.id, 1, "PLANNED", 1, 8, 12]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.postgres.query(insert, [session.id, 1, "SESSION_ONLY", 0, 8, 12]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.postgres.query(insert, [session.id, 0, "SESSION_ONLY", 0, null, null]),
  ).rejects.toMatchObject({ code: "23505" });
  expect((await db.workouts.active(alice))!.plannedWorkingSetQuota).toBe(3);
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planningDatabase } from "@/test/planning-database";
import { withCorrection } from "@/server/http/corrections";
import { correctionInput } from "@/domain/training/corrections";
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
  loadKg: "22.75000000000000001",
  reps: 8,
  rir: 2,
};
async function source(loadType = "WEIGHTED", user = alice) {
  const exercise = await db.app.createExercise(user, {
    name: "Press",
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
  const { session } = await db.workouts.start(user, {
    templateId: program.templates[0].id,
  });
  const entry = session.exercises[0];
  const set = await db.execution.createSet(user, entry.id, {
    id: randomUUID(),
    ...values,
    loadKg: loadType === "BODYWEIGHT" ? null : values.loadKg,
  });
  await db.execution.completeSet(user, set.id);
  const draft = await db.execution.createSet(user, entry.id, {
    id: randomUUID(),
  });
  return { exercise, program, session, entry, set, draft };
}
const finish = (id: string) =>
  db.execution.finish(alice, id, { timeZone: "Europe/Moscow" });
const correct = (
  id: string,
  patch: Record<string, unknown> = {},
  revision = 0,
) =>
  db.corrections.correct(alice, id, { expected_revision: revision, ...patch });
it("preserves original FINISHED metadata, snapshot, rotation and untouched drafts; increments revision", async () => {
  const p = await source();
  const saved = await finish(p.session.id);
  const next = await db.workouts.next(alice);
  const result = await correct(saved.id, {
    setEdits: [
      {
        id: p.set.id,
        ...values,
        type: "WARM_UP",
        reps: 9,
        rir: null,
        loadKg: "24.25000000000000001",
      },
    ],
  });
  expect(result).toMatchObject({
    ...saved,
    correctionRevision: 1,
    updatedAt: expect.any(Date),
    exercises: [{ ...saved.exercises[0], sets: expect.any(Array) }],
  });
  expect(result.exercises[0].sets[0]).toMatchObject({
    id: p.set.id,
    position: 0,
    type: "WARM_UP",
    rir: null,
    reps: 9,
    loadKg: "24.25000000000000001",
    completedAt: saved.exercises[0].sets[0].completedAt,
  });
  expect(result.exercises[0].sets[1]).toEqual(saved.exercises[0].sets[1]);
  expect(await db.workouts.next(alice)).toEqual(next);
  expect(
    await db.execution.finish(alice, saved.id, { timeZone: "UTC" }),
  ).toEqual(result);
});
it.each(["ACTIVE", "CANCELLED"])("rejects correction for %s", async (state) => {
  const p = await source();
  if (state === "CANCELLED") await db.execution.cancel(alice, p.session.id);
  await expect(correct(p.session.id)).rejects.toMatchObject({
    code: "conflict",
  });
});
it("revision serializes competing edits/deletion, stale retry returns exact 409 and no duplicate additions", async () => {
  const p = await source();
  await finish(p.session.id);
  const id = randomUUID();
  const results = await Promise.allSettled([
    correct(p.session.id, {
      setAdditions: [{ id, sessionExerciseId: p.entry.id, ...values }],
    }),
    correct(p.session.id, { setDeletions: [p.set.id] }),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const response = await withCorrection(
    async () => ({ currentIdentity: async () => ({ id: alice }) }),
    () => db.corrections,
    (app, user) =>
      app.correct(user, p.session.id, {
        expected_revision: 0,
        setAdditions: [{ id, sessionExerciseId: p.entry.id, ...values }],
      }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "CORRECTION_REVISION_CONFLICT",
  });
  const saved = await db.execution.historyDetail(alice, p.session.id);
  expect(saved.correctionRevision).toBe(1);
  expect(saved.exercises[0].sets.filter((s) => s.id === id)).toHaveLength(1);
});
it("tombstones draft and actual; appends after all historical positions deterministically, can reach zero Sets", async () => {
  const p = await source();
  await finish(p.session.id);
  const ids = [randomUUID(), randomUUID()];
  const saved = await correct(p.session.id, {
    setDeletions: [p.set.id, p.draft.id],
    setAdditions: ids.map((id) => ({
      id,
      sessionExerciseId: p.entry.id,
      ...values,
    })),
  });
  expect(saved.exercises[0].sets.map((s) => [s.id, s.position])).toEqual([
    [ids[0], 2],
    [ids[1], 3],
  ]);
  const old = await db.postgres.query<{ deleted_at: string | null }>(
    "SELECT deleted_at FROM workout_set WHERE id=ANY($1::uuid[])",
    [[p.set.id, p.draft.id]],
  );
  expect(old.rows.every((s) => s.deleted_at)).toBe(true);
  const empty = await correct(p.session.id, { setDeletions: ids }, 1);
  expect(empty.exercises[0].sets).toEqual([]);
  expect(empty.status).toBe("FINISHED");
  await expect(
    correct(
      p.session.id,
      {
        setAdditions: [
          { id: ids[0], sessionExerciseId: p.entry.id, ...values },
        ],
      },
      2,
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(
    (await db.execution.historyDetail(alice, p.session.id)).correctionRevision,
  ).toBe(2);
});
it("forgotten completed Set has new identity; surviving draft is not completed", async () => {
  const p = await source();
  await finish(p.session.id);
  const id = randomUUID();
  const s = await correct(p.session.id, {
    setAdditions: [{ id, sessionExerciseId: p.entry.id, ...values }],
  });
  expect(s.exercises[0].sets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id,
        position: 2,
        completedAt: expect.any(Date),
      }),
      expect.objectContaining({ id: p.draft.id, completedAt: null }),
    ]),
  );
});
it.each(["type", "loadKg", "reps", "rir"])(
  "rejects ordinary draft edit %s in application and DB",
  async (field) => {
    const p = await source();
    await finish(p.session.id);
    await expect(
      correct(p.session.id, { setEdits: [{ id: p.draft.id, ...values }] }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const value = { type: "WARM_UP", loadKg: "20", reps: 6, rir: 1 }[field];
    const column = {
      type: "type",
      loadKg: "load_kg",
      reps: "reps",
      rir: "rir",
    }[field];
    await expect(
      db.postgres.query(`UPDATE workout_set SET ${column}=$1 WHERE id=$2`, [
        value,
        p.draft.id,
      ]),
    ).rejects.toThrow();
  },
);
it("DB rejects draft completion, actual uncompletion, new draft, non-append Set and physical delete", async () => {
  const p = await source();
  await finish(p.session.id);
  for (const [query, args] of [
    ["UPDATE workout_set SET completed_at=now() WHERE id=$1", [p.draft.id]],
    ["UPDATE workout_set SET completed_at=NULL WHERE id=$1", [p.set.id]],
    [
      "INSERT INTO workout_set(id,session_exercise_id,position) VALUES($1,$2,2)",
      [randomUUID(), p.entry.id],
    ],
    [
      "INSERT INTO workout_set(id,session_exercise_id,position,reps,load_kg,completed_at) VALUES($1,$2,5,8,20,now())",
      [randomUUID(), p.entry.id],
    ],
    ["DELETE FROM workout_set WHERE id=$1", [p.set.id]],
  ] as [string, unknown[]][])
    await expect(db.postgres.query(query, args)).rejects.toThrow();
  await expect(
    db.execution.completeSet(alice, p.draft.id),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    db.execution.updateSet(alice, p.set.id, { reps: 9 }),
  ).rejects.toMatchObject({ code: "conflict" });
});
it("skip + draft valid; actual deletion + skip atomic; invalid skip rolls back", async () => {
  const p = await source();
  await finish(p.session.id);
  const before = await db.execution.historyDetail(alice, p.session.id);
  await expect(
    correct(p.session.id, {
      exerciseEdits: [{ id: p.entry.id, skipped: true }],
      setEdits: [{ id: p.set.id, ...values, reps: 10 }],
    }),
  ).rejects.toThrow();
  expect(await db.execution.historyDetail(alice, p.session.id)).toEqual(before);
  const saved = await correct(p.session.id, {
    exerciseEdits: [{ id: p.entry.id, skipped: true }],
    setDeletions: [p.set.id],
  });
  expect(saved.exercises[0]).toMatchObject({
    skipped: true,
    sets: [{ id: p.draft.id, completedAt: null }],
  });
});
it("planned identity/delete forbidden; immutable metadata and snapshot protected by DB", async () => {
  const p = await source();
  await finish(p.session.id);
  await expect(
    correct(p.session.id, { exerciseDeletions: [p.entry.id] }),
  ).rejects.toThrow();
  await expect(
    correct(p.session.id, {
      exerciseEdits: [{ id: p.entry.id, exerciseId: p.exercise.id }],
    }),
  ).rejects.toThrow();
  for (const q of [
    "UPDATE session_exercise SET exercise_name='other' WHERE id=$1",
    "UPDATE session_exercise SET position=9 WHERE id=$1",
    "UPDATE session_exercise SET planned_working_sets=3 WHERE id=$1",
    "UPDATE session_exercise SET deleted_at=now() WHERE id=$1",
  ])
    await expect(db.postgres.query(q, [p.entry.id])).rejects.toThrow();
  for (const q of [
    "UPDATE workout_session SET status='ACTIVE' WHERE id=$1",
    "UPDATE workout_session SET status='CANCELLED' WHERE id=$1",
    "UPDATE workout_session SET finished_at=now() WHERE id=$1",
    "UPDATE workout_session SET finish_timezone='UTC' WHERE id=$1",
    "UPDATE workout_session SET finish_utc_offset_seconds=0 WHERE id=$1",
    "UPDATE workout_session SET training_day='2020-01-01' WHERE id=$1",
    "UPDATE workout_session SET finish_order=99 WHERE id=$1",
    "UPDATE workout_session SET planned_working_set_quota=99 WHERE id=$1",
    "UPDATE workout_session SET source_program_name='other' WHERE id=$1",
    "UPDATE workout_session SET source_template_id=NULL WHERE id=$1",
  ])
    await expect(db.postgres.query(q, [p.session.id])).rejects.toThrow();
});
it("post-Finish SESSION_ONLY add requires actual, snapshot derived, quota/template unchanged; identity/load correction atomic", async () => {
  const p = await source();
  await finish(p.session.id);
  const body = await db.app.createExercise(alice, {
    name: "Squat",
    loadType: "BODYWEIGHT",
  });
  const eid = randomUUID(),
    sid = randomUUID();
  await expect(
    correct(p.session.id, {
      exerciseAdditions: [{ id: eid, exerciseId: body.id }],
    }),
  ).rejects.toThrow();
  let saved = await correct(p.session.id, {
    exerciseAdditions: [{ id: eid, exerciseId: p.exercise.id }],
    setAdditions: [{ id: sid, sessionExerciseId: eid, ...values }],
  });
  expect(saved.exercises[1]).toMatchObject({
    id: eid,
    origin: "SESSION_ONLY",
    plannedWorkingSets: 0,
    position: 1,
    exerciseName: "Press",
  });
  expect(saved.plannedWorkingSetQuota).toBe(2);
  await expect(
    correct(
      p.session.id,
      { exerciseEdits: [{ id: eid, exerciseId: body.id }] },
      1,
    ),
  ).rejects.toThrow();
  saved = await correct(
    p.session.id,
    {
      exerciseEdits: [{ id: eid, exerciseId: body.id }],
      setEdits: [{ id: sid, ...values, loadKg: null, rir: 0 }],
    },
    1,
  );
  expect(saved.exercises[1]).toMatchObject({
    id: eid,
    origin: "SESSION_ONLY",
    position: 1,
    loadType: "BODYWEIGHT",
    exerciseName: "Squat",
    sets: [{ id: sid, loadKg: null, rir: 0 }],
  });
  expect(
    (await db.app.activeProgram(alice))?.templates[0].exercises,
  ).toHaveLength(1);
});
it("SESSION_ONLY deletion tombstones completed and draft children and exercise; positions not reused", async () => {
  const p = await source();
  const e = await db.execution.addExercise(alice, p.session.id, {
    exerciseId: p.exercise.id,
  });
  const s = await db.execution.createSet(alice, e.id, {
    id: randomUUID(),
    ...values,
  });
  await db.execution.completeSet(alice, s.id);
  const d = await db.execution.createSet(alice, e.id, { id: randomUUID() });
  await finish(p.session.id);
  const eid = randomUUID();
  const result = await correct(p.session.id, {
    exerciseDeletions: [e.id],
    exerciseAdditions: [{ id: eid, exerciseId: p.exercise.id }],
    setAdditions: [{ id: randomUUID(), sessionExerciseId: eid, ...values }],
  });
  expect(result.exercises.map((e) => e.id)).toEqual([p.entry.id, eid]);
  expect(result.exercises[1].position).toBe(2);
  const rows = await db.postgres.query<{ deleted_at: string }>(
    "SELECT deleted_at FROM workout_set WHERE id=ANY($1::uuid[])",
    [[s.id, d.id]],
  );
  expect(rows.rows.every((r) => r.deleted_at)).toBe(true);
  expect(
    (
      await db.postgres.query<{ deleted_at: string }>(
        "SELECT deleted_at FROM session_exercise WHERE id=$1",
        [e.id],
      )
    ).rows[0].deleted_at,
  ).toBeTruthy();
});
it("mid-write failure rolls back all child changes and revision", async () => {
  const p = await source();
  const before = await finish(p.session.id);
  db.setQueryHook(async (text) => {
    if (text.startsWith('insert into "workout_set"'))
      throw new Error("forced write failure");
  });
  await expect(
    correct(p.session.id, {
      setDeletions: [p.draft.id],
      setEdits: [{ id: p.set.id, ...values, reps: 10 }],
      setAdditions: [
        { id: randomUUID(), sessionExerciseId: p.entry.id, ...values },
      ],
    }),
  ).rejects.toThrow();
  db.setQueryHook();
  expect(await db.execution.historyDetail(alice, p.session.id)).toEqual(before);
});
it("foreign session, nested Set/Exercise, archived Exercise and other-session Set denied without existence leak", async () => {
  const p = await source();
  await finish(p.session.id);
  const foreign = await source("WEIGHTED", bob);
  const own = await source();
  await finish(own.session.id);
  for (const [session, patch] of [
    [foreign.session.id, {}],
    [randomUUID(), {}],
    [p.session.id, { setDeletions: [foreign.set.id] }],
    [p.session.id, { setEdits: [{ id: own.set.id, ...values }] }],
    [
      p.session.id,
      { exerciseEdits: [{ id: foreign.entry.id, skipped: true }] },
    ],
    [
      p.session.id,
      {
        exerciseAdditions: [
          { id: randomUUID(), exerciseId: foreign.exercise.id },
        ],
      },
    ],
  ] as [string, Record<string, unknown>][])
    await expect(correct(session, patch)).rejects.toMatchObject({
      code: "not_found",
    });
  await db.app.changeExercise(alice, p.exercise.id, { archived: true });
  await expect(
    correct(p.session.id, {
      exerciseAdditions: [{ id: randomUUID(), exerciseId: p.exercise.id }],
    }),
  ).rejects.toMatchObject({ code: "not_found" });
});
it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
  "corrects %s actual values, RIR and both Set types",
  async (type) => {
    const p = await source(type);
    await finish(p.session.id);
    const loadKg = type === "BODYWEIGHT" ? null : "10.25000000000000001";
    let s = await correct(p.session.id, {
      setEdits: [{ id: p.set.id, ...values, loadKg, type: "WARM_UP", rir: 10 }],
    });
    expect(s.exercises[0].sets[0]).toMatchObject({
      loadKg,
      type: "WARM_UP",
      rir: 10,
    });
    s = await correct(
      p.session.id,
      {
        setEdits: [
          { id: p.set.id, ...values, loadKg, type: "WORKING", rir: null },
        ],
      },
      1,
    );
    expect(s.exercises[0].sets[0]).toMatchObject({
      type: "WORKING",
      rir: null,
    });
  },
);
it("strict command rejects arbitrary snapshots, completion/position, duplicate targets and missing revision", () => {
  for (const input of [
    {},
    { expected_revision: 0, sourceProgramName: "x" },
    { expected_revision: 0, setEdits: [{ id: randomUUID(), position: 0 }] },
    {
      expected_revision: 0,
      setAdditions: [{ id: randomUUID(), completedAt: null }],
    },
    {
      expected_revision: 0,
      exerciseEdits: [{ id: randomUUID(), name: "fake" }],
    },
    { expected_revision: 0, setDeletions: [alice, alice] },
  ])
    expect(() => correctionInput(input)).toThrow();
});
it("unauthenticated correction does not construct repository", async () => {
  const get = vi.fn();
  const response = await withCorrection(
    async () => ({ currentIdentity: async () => null }),
    get,
    async () => null,
  );
  expect(response.status).toBe(401);
  expect(get).not.toHaveBeenCalled();
});
it("browser roles remain denied table and integrity helper access", async () => {
  for (const role of ["anon", "authenticated"]) {
    const rows = await db.postgres.query<{ allowed: boolean }>(
      `SELECT has_table_privilege($1,'public.workout_set','INSERT') OR has_table_privilege($1,'public.session_exercise','UPDATE') OR has_function_privilege($1,'public.correction_final_exercise()','EXECUTE') OR has_function_privilege($1,'public.correction_parent_finished(uuid)','EXECUTE') AS allowed`,
      [role],
    );
    expect(rows.rows[0].allowed).toBe(false);
  }
});
it("deferred SQL guards reject invalid skipped/load/empty/deleted-child final states and accept atomic replacement", async () => {
  const p = await source();
  await finish(p.session.id);
  await expect(
    db.postgres.query("UPDATE session_exercise SET skipped=true WHERE id=$1", [
      p.entry.id,
    ]),
  ).rejects.toThrow();
  await expect(
    db.postgres.query("UPDATE workout_set SET load_kg=NULL WHERE id=$1", [
      p.set.id,
    ]),
  ).rejects.toThrow();
  const eid = randomUUID();
  await expect(
    db.postgres.query(
      "INSERT INTO session_exercise(id,session_id,exercise_id,position,origin,exercise_name,load_type,planned_working_sets) VALUES($1,$2,$3,1,'SESSION_ONLY','Press','WEIGHTED',0)",
      [eid, p.session.id, p.exercise.id],
    ),
  ).rejects.toThrow();
  const id = randomUUID();
  await correct(p.session.id, {
    exerciseAdditions: [{ id: eid, exerciseId: p.exercise.id }],
    setAdditions: [{ id, sessionExerciseId: eid, ...values }],
  });
  await expect(
    db.postgres.query(
      "UPDATE session_exercise SET deleted_at=now() WHERE id=$1",
      [eid],
    ),
  ).rejects.toThrow();
  const body = await db.app.createExercise(alice, {
    name: "Squat",
    loadType: "BODYWEIGHT",
  });
  await expect(
    db.postgres.query(
      "UPDATE session_exercise SET exercise_id=$1,exercise_name='Squat',load_type='BODYWEIGHT' WHERE id=$2",
      [body.id, eid],
    ),
  ).rejects.toThrow();
  await db.postgres.exec("BEGIN");
  await db.postgres.query(
    "UPDATE session_exercise SET exercise_id=$1,exercise_name='Squat',load_type='BODYWEIGHT' WHERE id=$2",
    [body.id, eid],
  );
  await db.postgres.query("UPDATE workout_set SET load_kg=NULL WHERE id=$1", [
    id,
  ]);
  await db.postgres.exec("COMMIT");
  expect(
    (await db.execution.historyDetail(alice, p.session.id)).exercises[1],
  ).toMatchObject({ loadType: "BODYWEIGHT", sets: [{ loadKg: null }] });
});

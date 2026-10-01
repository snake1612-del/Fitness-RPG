import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("server-only", () => ({}));
import { planningDatabase } from "@/test/planning-database";
import { createWorkoutApplication } from "@/application/training/workout";
import { createWorkoutRepository } from "./workout-repository";
import { workoutResponse } from "@/server/http/workout";

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
async function source(userId = alice) {
  const exercise = await db.app.createExercise(userId, {
    name: "Press",
    loadType: "WEIGHTED",
  });
  const program = await db.app.createProgram(userId, {
    name: "Strength",
    initialTemplate: {
      name: "Upper",
      exercises: [
        {
          exerciseId: exercise.id,
          targetWorkingSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetLoadKg: "72.5",
          targetRir: 0,
          targetRestSeconds: 90,
          notes: "First",
        },
        {
          exerciseId: exercise.id,
          targetWorkingSets: 2,
          targetRepsMin: 5,
          targetRepsMax: 7,
          targetLoadKg: "72.500000000000000000000001",
          targetRir: 10,
          notes: "Second",
        },
      ],
    },
  });
  return { exercise, program, template: program.templates[0] };
}
async function counts() {
  return (
    await db.postgres.query<{ sessions: number; exercises: number }>(
      "SELECT (SELECT count(*)::integer FROM workout_session) AS sessions, (SELECT count(*)::integer FROM session_exercise) AS exercises",
    )
  ).rows[0];
}

describe("Start and Resume relational persistence", () => {
  it("creates an ACTIVE relational snapshot with exact targets and frozen quota", async () => {
    const plan = await source();
    const result = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    expect(result.resumed).toBe(false);
    expect(result.session).toMatchObject({
      userId: alice,
      status: "ACTIVE",
      sourceProgramId: plan.program.id,
      sourceTemplateId: plan.template.id,
      sourceProgramName: "Strength",
      sourceTemplateName: "Upper",
      plannedWorkingSetQuota: 5,
    });
    expect(result.session.startedAt).toBeInstanceOf(Date);
    expect(
      result.session.exercises.map((item) => [
        item.position,
        item.origin,
        item.plannedWorkingSets,
      ]),
    ).toEqual([
      [0, "PLANNED", 3],
      [1, "PLANNED", 2],
    ]);
    expect(result.session.exercises[0]).toMatchObject({
      exerciseId: plan.exercise.id,
      exerciseName: "Press",
      loadType: "WEIGHTED",
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetLoadKg: "72.5",
      targetRir: 0,
      targetRestSeconds: 90,
      notes: "First",
    });
    expect(result.session.exercises[1]).toMatchObject({
      targetLoadKg: "72.500000000000000000000001",
      targetRir: 10,
      targetRestSeconds: null,
    });
    expect(await counts()).toEqual({ sessions: 1, exercises: 2 });
  });
  it("returns null with no ACTIVE Session", async () =>
    expect(await db.workouts.active(alice)).toBeNull());
  it("resumes the same Session across reads and new application instances", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    expect(await db.workouts.active(alice)).toEqual(first.session);
    const restarted = createWorkoutApplication(
      createWorkoutRepository(db.database),
    );
    expect(await restarted.active(alice)).toEqual(first.session);
  });
  it("repeated Start and a different Template always return existing ACTIVE", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    const other = await db.app.createTemplate(alice, plan.program.id, {
      name: "Lower",
    });
    for (const templateId of [plan.template.id, other.id, bob]) {
      const result = await db.workouts.start(alice, { templateId });
      expect(result).toEqual({ session: first.session, resumed: true });
    }
    expect(await counts()).toEqual({ sessions: 1, exercises: 2 });
  });
  it("Start retries still resume after changing Active Program", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    const other = await db.app.createProgram(alice, {
      name: "Other",
      initialTemplate: { name: "B" },
    });
    await db.app.activateProgram(alice, other.id);
    expect(
      await db.workouts.start(alice, { templateId: other.templates[0].id }),
    ).toEqual({ session: first.session, resumed: true });
  });
  it("concurrent starts leave one ACTIVE Session through the single-pool test bridge", async () => {
    const plan = await source();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.workouts.start(alice, { templateId: plan.template.id }),
      ),
    );
    expect(new Set(results.map((item) => item.session.id)).size).toBe(1);
    expect(results.filter((item) => !item.resumed)).toHaveLength(1);
    expect(await counts()).toEqual({ sessions: 1, exercises: 2 });
  });
  it("rejects a second ACTIVE Session at the database level", async () => {
    const plan = await source();
    await db.workouts.start(alice, { templateId: plan.template.id });
    await expect(
      db.postgres.query(
        "INSERT INTO workout_session(user_id,source_program_name,source_template_name,planned_working_set_quota) VALUES ($1,'A','B',0)",
        [alice],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "session_one_active_per_user",
    });
  });
  it("converts a stale active observation/unique race into canonical Resume", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    let stale = true;
    db.setQueryHook(async (text) => {
      if (
        stale &&
        text.startsWith("select") &&
        text.includes('from "workout_session"')
      ) {
        stale = false;
        return { rows: [] };
      }
    });
    const result = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    db.setQueryHook();
    expect(result).toEqual({ session: first.session, resumed: true });
    expect(await counts()).toEqual({ sessions: 1, exercises: 2 });
  });
  it("snapshot survives all planning edits, reorder and Exercise archive", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    await db.app.renameProgram(alice, plan.program.id, {
      name: "Changed Program",
    });
    await db.app.renameTemplate(alice, plan.template.id, {
      name: "Changed Template",
    });
    await db.app.changeExercise(alice, plan.exercise.id, {
      name: "Changed Exercise",
    });
    await db.app.changeEntry(alice, plan.template.exercises[0].id, {
      targetWorkingSets: 7,
      targetRepsMin: 1,
      targetRepsMax: 2,
      targetLoadKg: "100.125",
      targetRir: null,
      targetRestSeconds: 0,
      notes: "Changed",
    });
    await db.app.reorderEntries(alice, plan.template.id, {
      ids: plan.template.exercises.map((item) => item.id).reverse(),
    });
    await db.app.changeExercise(alice, plan.exercise.id, { archived: true });
    db.setQueryHook(async (text) => {
      if (
        /from "(exercise|workout_template|workout_program|template_exercise)"/.test(
          text,
        )
      )
        throw new Error("Resume cannot read live planning");
    });
    expect(await db.workouts.active(alice)).toEqual(first.session);
    expect(
      await db.workouts.start(alice, { templateId: plan.template.id }),
    ).toEqual({ session: first.session, resumed: true });
    db.setQueryHook();
  });
  it("planning target mutation and Start do not produce a mixed target snapshot", async () => {
    const plan = await source();
    const [result] = await Promise.all([
      db.workouts.start(alice, { templateId: plan.template.id }),
      db.app.changeEntry(alice, plan.template.exercises[0].id, {
        targetWorkingSets: 7,
        targetLoadKg: "100.125",
        targetRir: 5,
      }),
    ]);
    expect(result.session.exercises[0]).toMatchObject({
      plannedWorkingSets: 3,
      targetLoadKg: "72.5",
      targetRir: 0,
    });
    expect(result.session.plannedWorkingSetQuota).toBe(5);
  });
  it("foreign and inactive-program Templates cannot start a Session", async () => {
    const foreign = await source(bob);
    await expect(
      db.workouts.start(alice, { templateId: foreign.template.id }),
    ).rejects.toThrow("not_found");
    const own = await source(alice);
    const inactive = await db.app.createProgram(alice, {
      name: "Inactive",
      initialTemplate: { name: "B" },
    });
    await expect(
      db.workouts.start(alice, { templateId: inactive.templates[0].id }),
    ).rejects.toThrow("not_found");
    await db.postgres.query(
      "UPDATE workout_program SET is_active=false WHERE id=$1",
      [own.program.id],
    );
    await expect(
      db.workouts.start(alice, { templateId: own.template.id }),
    ).rejects.toThrow("not_found");
    expect(await counts()).toEqual({ sessions: 0, exercises: 0 });
  });
  it("another user's active snapshot is inaccessible", async () => {
    const own = await source();
    await db.workouts.start(alice, { templateId: own.template.id });
    expect(await db.workouts.active(bob)).toBeNull();
    await expect(
      db.workouts.start(bob, { templateId: own.template.id }),
    ).rejects.toThrow("not_found");
  });
  it("rolls back header and already inserted rows if a later snapshot insert fails", async () => {
    const plan = await source();
    let inserts = 0;
    db.setQueryHook(async (text) => {
      if (text.startsWith('insert into "session_exercise"') && ++inserts === 2)
        throw new Error("forced snapshot insert failure");
    });
    await expect(
      db.workouts.start(alice, { templateId: plan.template.id }),
    ).rejects.toThrow();
    db.setQueryHook();
    expect(inserts).toBe(2);
    expect(await counts()).toEqual({ sessions: 0, exercises: 0 });
    expect(await db.workouts.active(alice)).toBeNull();
  });
  it("P is protected from direct updates and incomplete aggregate commits", async () => {
    const plan = await source();
    const first = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    await expect(
      db.postgres.query(
        "UPDATE workout_session SET planned_working_set_quota=999 WHERE id=$1",
        [first.session.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.postgres.query(
        "INSERT INTO workout_session(user_id,source_program_name,source_template_name,planned_working_set_quota) VALUES ($1,'A','B',3)",
        [bob],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await db.workouts.active(alice))?.plannedWorkingSetQuota).toBe(5);
    expect(await counts()).toEqual({ sessions: 1, exercises: 2 });
  });
  it("supports an empty Template without creating any planned Set placeholders", async () => {
    const program = await db.app.createProgram(alice, {
      name: "Empty Template Plan",
      initialTemplate: { name: "A" },
    });
    const result = await db.workouts.start(alice, {
      templateId: program.templates[0].id,
    });
    expect(result.session.exercises).toEqual([]);
    expect(result.session.plannedWorkingSetQuota).toBe(0);
    const names = await db.postgres.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    expect(names.rows.map((row) => row.tablename)).toEqual([
      "exercise",
      "session_exercise",
      "template_exercise",
      "workout_program",
      "workout_session",
      "workout_set",
      "workout_template",
    ]);
  });
  it("preserves nullable RIR, bodyweight and assisted snapshot semantics", async () => {
    const body = await db.app.createExercise(alice, {
      name: "Push-up",
      loadType: "BODYWEIGHT",
    });
    const assisted = await db.app.createExercise(alice, {
      name: "Assisted",
      loadType: "ASSISTED_BODYWEIGHT",
    });
    const program = await db.app.createProgram(alice, {
      name: "B",
      initialTemplate: {
        name: "A",
        exercises: [
          {
            exerciseId: body.id,
            targetWorkingSets: 1,
            targetRepsMin: 5,
            targetRepsMax: 10,
            targetRir: null,
          },
          {
            exerciseId: assisted.id,
            targetWorkingSets: 2,
            targetRepsMin: 3,
            targetRepsMax: 6,
            targetLoadKg: "30.125",
            targetRir: 10,
          },
        ],
      },
    });
    const result = await db.workouts.start(alice, {
      templateId: program.templates[0].id,
    });
    expect(result.session.exercises[0]).toMatchObject({
      loadType: "BODYWEIGHT",
      targetLoadKg: null,
      targetRir: null,
    });
    expect(result.session.exercises[1]).toMatchObject({
      loadType: "ASSISTED_BODYWEIGHT",
      targetLoadKg: "30.125",
      targetRir: 10,
    });
  });
  it("validates snapshot constraints and unique positions independently of planning", async () => {
    const plan = await source();
    const { session } = await db.workouts.start(alice, {
      templateId: plan.template.id,
    });
    const first = session.exercises[0],
      second = session.exercises[1];
    for (const [column, value] of [
      ["planned_working_sets", 0],
      ["target_reps_min", 0],
      ["target_reps_max", 1],
      ["target_rir", -1],
      ["target_rir", 11],
      ["target_rest_seconds", -1],
      ["target_load_kg", "NaN"],
      ["target_load_kg", "-1"],
      ["position", -1],
    ] as const)
      await expect(
        db.postgres.query(
          'UPDATE session_exercise SET "' + column + '"=$1 WHERE id=$2',
          [value, first.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.postgres.query(
        "UPDATE session_exercise SET target_rir=$1 WHERE id=$2",
        ["1.5", first.id],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      db.postgres.query("UPDATE session_exercise SET position=0 WHERE id=$1", [
        second.id,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("new helpers are not executable by browser roles even with inherited defaults", async () => {
    for (const role of ["anon", "authenticated"])
      for (const name of [
        "workout_quota_immutable",
        "workout_start_snapshot_quota",
      ]) {
        const result = await db.postgres.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
          [role, "public." + name + "()"],
        );
        expect(result.rows[0].allowed).toBe(false);
      }
  });
});

describe("Start and Resume HTTP adapters", () => {
  const auth = async () => ({ currentIdentity: async () => ({ id: alice }) });
  const request = (body: unknown) =>
    new Request("https://example.test/api/sessions/start", {
      method: "POST",
      body: JSON.stringify(body),
    });
  it("rejects unauthenticated Start/Resume before touching the database", async () => {
    const getApp = vi.fn();
    const anonymous = async () => ({ currentIdentity: async () => null });
    for (const value of [undefined, request({ templateId: alice })]) {
      const response = await workoutResponse(anonymous, getApp, value);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(getApp).not.toHaveBeenCalled();
  });
  it("returns 201 for new Start, 200 for resumed Start and the same Resume payload", async () => {
    const plan = await source();
    const first = await workoutResponse(
      auth,
      () => db.workouts,
      request({ templateId: plan.template.id }),
    );
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(firstBody.resumed).toBe(false);
    const retry = await workoutResponse(
      auth,
      () => db.workouts,
      request({ templateId: plan.template.id }),
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      session: firstBody.session,
      resumed: true,
    });
    const resume = await workoutResponse(auth, () => db.workouts);
    expect(resume.status).toBe(200);
    expect(await resume.json()).toEqual(firstBody.session);
    expect(resume.headers.get("Cache-Control")).toBe("no-store");
  });
  it("returns explicit null when no ACTIVE Session exists", async () => {
    const response = await workoutResponse(auth, () => db.workouts);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
  it.each([
    { templateId: "bad" },
    { templateId: alice, userId: bob },
    {},
    { templateId: alice, sessionId: bob },
  ])("rejects malformed IDs and spoofed ownership %j", async (body) => {
    const response = await workoutResponse(
      auth,
      () => db.workouts,
      request(body),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });
  it("maps malformed JSON to a controlled bad request", async () => {
    const response = await workoutResponse(
      auth,
      () => db.workouts,
      new Request("https://example.test/api/sessions/start", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });
  it("conceals nonexistent and foreign Templates", async () => {
    const plan = await source(bob);
    for (const templateId of [plan.template.id, alice]) {
      const response = await workoutResponse(
        auth,
        () => db.workouts,
        request({ templateId }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });
  it("hides SQL, credentials and internal failures", async () => {
    const response = await workoutResponse(auth, () => {
      throw new Error("postgresql://user:secret@host; trigger failure");
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});

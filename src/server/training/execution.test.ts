import { randomUUID } from "node:crypto";
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
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "./execution-repository";
import { withExecution } from "@/server/http/execution";

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
async function source(loadType = "WEIGHTED", userId = alice) {
  const exercise = await db.app.createExercise(userId, {
    name: "Press",
    loadType,
  });
  const program = await db.app.createProgram(userId, {
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
        {
          exerciseId: exercise.id,
          targetWorkingSets: 2,
          targetRepsMin: 5,
          targetRepsMax: 7,
        },
      ],
    },
  });
  const { session } = await db.workouts.start(userId, {
    templateId: program.templates[0].id,
  });
  return { exercise, program, session, entry: session.exercises[0] };
}
async function create(
  parent: string,
  values: Record<string, unknown> = {},
  userId = alice,
) {
  return db.execution.createSet(userId, parent, {
    id: randomUUID(),
    ...values,
  });
}
const finish = (sessionId: string, userId = alice) =>
  db.execution.finish(userId, sessionId, { timeZone: "Europe/Moscow" });
async function setCount() {
  return (
    await db.postgres.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM workout_set",
    )
  ).rows[0].count;
}

describe("Workout Execution and Lifecycle relational persistence", () => {
  it.each([true, false])(
    "Set completion and Finish serialize coherently (completion first=%s) on the single-pool bridge",
    async (completionFirst) => {
      const plan = await source(),
        set = await create(plan.entry.id, { reps: 8, loadKg: "72.5" });
      const results = await Promise.allSettled(
        completionFirst
          ? [db.execution.completeSet(alice, set.id), finish(plan.session.id)]
          : [finish(plan.session.id), db.execution.completeSet(alice, set.id)],
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(completionFirst ? 2 : 1);
      const saved = await db.execution.historyDetail(alice, plan.session.id);
      expect(saved.exercises[0].sets[0].completedAt !== null).toBe(
        completionFirst,
      );
    },
  );
  it.each([-1, 11, 1.5, "1"])(
    "rejects actual RIR %s before writing",
    async (rir) => {
      const plan = await source();
      await expect(create(plan.entry.id, { rir })).rejects.toThrow(
        "invalid_input",
      );
      expect(await setCount()).toBe(0);
    },
  );
  it("Set validation/completion never reads live Exercise definitions", async () => {
    const plan = await source("ASSISTED_BODYWEIGHT");
    await db.app.changeExercise(alice, plan.exercise.id, {
      name: "Renamed",
      archived: true,
    });
    db.setQueryHook(async (text) => {
      if (
        /from "(exercise|workout_template|template_exercise|workout_program)"/.test(
          text,
        )
      )
        throw new Error("Live planning read forbidden");
    });
    const set = await create(plan.entry.id, { reps: 8, loadKg: "30.125" });
    expect((await db.execution.completeSet(alice, set.id)).loadKg).toBe(
      "30.125",
    );
  });
  it.each(["BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
    "DB enforces %s load semantics from the snapshot",
    async (loadType) => {
      const plan = await source(loadType),
        set = await create(plan.entry.id, { reps: 8 });
      await expect(
        db.postgres.query("UPDATE workout_set SET load_kg=$1 WHERE id=$2", [
          loadType === "BODYWEIGHT" ? "1" : "0",
          set.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );
  it("Start creates no actual Sets; only explicit creation persists a draft", async () => {
    const plan = await source();
    expect(await setCount()).toBe(0);
    const set = await create(plan.entry.id);
    expect(set).toMatchObject({
      type: "WORKING",
      position: 0,
      reps: null,
      loadKg: null,
      rir: null,
      completedAt: null,
      deletedAt: null,
    });
    expect((await db.workouts.active(alice))?.exercises[0].sets).toEqual([set]);
    expect((await db.workouts.active(alice))?.plannedWorkingSetQuota).toBe(5);
    await expect(db.execution.completeSet(alice, set.id)).rejects.toThrow(
      "invalid_input",
    );
  });
  it("preserves exact decimals and values do not complete a Set", async () => {
    const plan = await source();
    const set = await create(plan.entry.id, {
      loadKg: "72.500000000000000000000001",
      reps: 8,
      rir: 0,
    });
    expect(set.completedAt).toBeNull();
    const updated = await db.execution.updateSet(alice, set.id, {
      loadKg: "80.125",
      rir: 10,
    });
    expect(updated).toMatchObject({
      loadKg: "80.125",
      reps: 8,
      rir: 10,
      completedAt: null,
    });
    const completed = await db.execution.completeSet(alice, set.id);
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(await db.execution.completeSet(alice, set.id)).toEqual(completed);
    const corrected = await db.execution.updateSet(alice, set.id, {
      rir: null,
      reps: 9,
    });
    expect(corrected.completedAt).toEqual(completed.completedAt);
    await expect(
      db.execution.updateSet(alice, set.id, { loadKg: null }),
    ).rejects.toThrow("invalid_input");
    await db.execution.uncompleteSet(alice, set.id);
    expect(
      (await db.execution.updateSet(alice, set.id, { loadKg: null }))
        .completedAt,
    ).toBeNull();
    const draft = await db.execution.uncompleteSet(alice, set.id);
    expect(await db.execution.uncompleteSet(alice, set.id)).toEqual(draft);
  });
  it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
    "uses %s snapshot semantics for drafts/completion",
    async (loadType) => {
      const plan = await source(loadType);
      const set = await create(plan.entry.id, { reps: 8, type: "WARM_UP" });
      if (loadType === "BODYWEIGHT") {
        await expect(
          db.execution.updateSet(alice, set.id, { loadKg: "0" }),
        ).rejects.toThrow("invalid_input");
      } else {
        await expect(db.execution.completeSet(alice, set.id)).rejects.toThrow(
          "invalid_input",
        );
        if (loadType === "ASSISTED_BODYWEIGHT")
          await expect(
            db.execution.updateSet(alice, set.id, { loadKg: "0" }),
          ).rejects.toThrow("invalid_input");
        await db.execution.updateSet(alice, set.id, {
          loadKg: loadType === "WEIGHTED" ? "0" : "30.125",
        });
      }
      const completed = await db.execution.completeSet(alice, set.id);
      expect(completed).toMatchObject({ type: "WARM_UP", reps: 8, rir: null });
      expect(completed.completedAt).toBeInstanceOf(Date);
    },
  );
  it("same creation UUID resumes current Set without overwriting corrections", async () => {
    const plan = await source(),
      input = { id: randomUUID(), reps: 8, loadKg: "72.5" };
    const initial = await db.execution.createSet(alice, plan.entry.id, input);
    expect(await db.execution.createSet(alice, plan.entry.id, input)).toEqual(
      initial,
    );
    const corrected = await db.execution.updateSet(alice, initial.id, {
      reps: 9,
    });
    expect(await db.execution.createSet(alice, plan.entry.id, input)).toEqual(
      corrected,
    );
    await expect(
      db.execution.createSet(alice, plan.session.exercises[1].id, input),
    ).rejects.toThrow("conflict");
    expect(await setCount()).toBe(1);
  });
  it("parallel retry/different Set requests preserve identities and unique order on the single-pool bridge", async () => {
    const plan = await source(),
      input = { id: randomUUID(), reps: 8, loadKg: "72.5" };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.execution.createSet(alice, plan.entry.id, input),
      ),
    );
    expect(new Set(results.map((set) => set.id)).size).toBe(1);
    await Promise.all(Array.from({ length: 3 }, () => create(plan.entry.id)));
    expect(
      (await db.workouts.active(alice))?.exercises[0].sets.map(
        (set) => set.position,
      ),
    ).toEqual([0, 1, 2, 3]);
    const completions = await Promise.all(
      Array.from({ length: 3 }, () =>
        db.execution.completeSet(alice, input.id),
      ),
    );
    expect(
      completions.every(
        (set) =>
          set.completedAt?.getTime() === completions[0].completedAt?.getTime(),
      ),
    ).toBe(true);
  });
  it("deletes actual Set with a retained retry UUID, without resurrection or position reuse", async () => {
    const plan = await source(),
      set = await create(plan.entry.id);
    await db.execution.deleteSet(alice, set.id);
    await db.execution.deleteSet(alice, set.id);
    expect((await db.workouts.active(alice))?.exercises[0].sets).toEqual([]);
    await expect(
      db.execution.createSet(alice, plan.entry.id, { id: set.id }),
    ).rejects.toThrow("conflict");
    await expect(
      db.execution.updateSet(alice, set.id, { reps: 1 }),
    ).rejects.toThrow("not_found");
    await expect(db.execution.completeSet(alice, set.id)).rejects.toThrow(
      "not_found",
    );
    expect((await create(plan.entry.id)).position).toBe(1);
    expect(await setCount()).toBe(2);
  });
  it("partial Finish preserves completed/draft facts and freezes original context once", async () => {
    const plan = await source();
    const working = await create(plan.entry.id, {
      reps: 8,
      loadKg: "72.500000000000000000000001",
    });
    await db.execution.completeSet(alice, working.id);
    const draft = await create(plan.entry.id, {
      reps: 6,
      loadKg: "70",
      type: "WARM_UP",
    });
    const removed = await create(plan.entry.id);
    await db.execution.deleteSet(alice, removed.id);
    const clock = createExecutionApplication(
      createExecutionRepository(db.database),
      () => new Date("2026-10-01T22:30:00.123Z"),
    );
    const result = await clock.finish(alice, plan.session.id, {
      timeZone: "Europe/Moscow",
    });
    expect(result).toMatchObject({
      status: "FINISHED",
      plannedWorkingSetQuota: 5,
      finishedAt: new Date("2026-10-01T22:30:00.123Z"),
      finishTimezone: "Europe/Moscow",
      trainingDay: "2026-10-02",
      finishUtcOffsetSeconds: 10800,
      cancelledAt: null,
    });
    expect(result.finishOrder).toMatch(/^\d+$/);
    expect(result.exercises[0].sets).toHaveLength(2);
    expect(
      result.exercises[0].sets.find((set) => set.id === draft.id)?.completedAt,
    ).toBeNull();
    expect(result.exercises[0].sets[0].loadKg).toBe(
      "72.500000000000000000000001",
    );
    const later = createExecutionApplication(
      createExecutionRepository(db.database),
      () => new Date("2027-01-01T00:00:00Z"),
    );
    expect(
      await later.finish(alice, plan.session.id, {
        timeZone: "America/New_York",
      }),
    ).toEqual(result);
    expect(await db.workouts.active(alice)).toBeNull();
    expect(await db.execution.historyDetail(alice, plan.session.id)).toEqual(
      result,
    );
  });
  it("allows Finish with no completed work without manufacturing Sets", async () => {
    const plan = await source();
    const result = await finish(plan.session.id);
    expect(result.exercises.every((entry) => entry.sets.length === 0)).toBe(
      true,
    );
    expect(await setCount()).toBe(0);
  });
  it("Cancel preserves attempts, releases ACTIVE slot and never appears as Finished history", async () => {
    const plan = await source(),
      set = await create(plan.entry.id, { reps: 1, loadKg: "1" });
    const cancelled = await db.execution.cancel(alice, plan.session.id);
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      finishedAt: null,
      finishOrder: null,
    });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.exercises[0].sets[0].completedAt).toBeNull();
    expect(await db.execution.cancel(alice, plan.session.id)).toEqual(
      cancelled,
    );
    expect(await db.execution.history(alice)).toEqual([]);
    await expect(
      db.execution.historyDetail(alice, plan.session.id),
    ).rejects.toThrow("not_found");
    await expect(finish(plan.session.id)).rejects.toThrow("conflict");
    await expect(db.execution.completeSet(alice, set.id)).rejects.toThrow(
      "conflict",
    );
    const next = await db.workouts.start(alice, {
      templateId: plan.program.templates[0].id,
    });
    expect(next.session.id).not.toBe(plan.session.id);
  });
  it.each(["FINISHED", "CANCELLED"])(
    "rejects all Set mutations for %s Session",
    async (status) => {
      const plan = await source(),
        set = await create(plan.entry.id, { reps: 8, loadKg: "1" });
      if (status === "FINISHED") await finish(plan.session.id);
      else await db.execution.cancel(alice, plan.session.id);
      for (const action of [
        () => create(plan.entry.id),
        () => db.execution.createSet(alice, plan.entry.id, { id: set.id }),
        () => db.execution.updateSet(alice, set.id, { reps: 9 }),
        () => db.execution.completeSet(alice, set.id),
        () => db.execution.uncompleteSet(alice, set.id),
        () => db.execution.deleteSet(alice, set.id),
      ])
        await expect(action()).rejects.toThrow("conflict");
      await expect(
        db.postgres.query("UPDATE workout_set SET reps=9 WHERE id=$1", [
          set.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.postgres.query(
          "UPDATE workout_session SET status='ACTIVE' WHERE id=$1",
          [plan.session.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );
  it("isolates Set and lifecycle actions/History by authenticated owner", async () => {
    const plan = await source(),
      set = await create(plan.entry.id, { reps: 8, loadKg: "1" });
    for (const action of [
      () => create(plan.entry.id, {}, bob),
      () => db.execution.updateSet(bob, set.id, { reps: 9 }),
      () => db.execution.completeSet(bob, set.id),
      () => db.execution.uncompleteSet(bob, set.id),
      () => db.execution.deleteSet(bob, set.id),
      () => finish(plan.session.id, bob),
      () => db.execution.cancel(bob, plan.session.id),
    ])
      await expect(action()).rejects.toThrow("not_found");
    const ownBob = await source("WEIGHTED", bob);
    await expect(
      db.execution.createSet(bob, ownBob.entry.id, { id: set.id }),
    ).rejects.toThrow("conflict");
    await finish(plan.session.id);
    expect(await db.execution.history(bob)).toEqual([]);
    await expect(
      db.execution.historyDetail(bob, plan.session.id),
    ).rejects.toThrow("not_found");
  });
  it("History lists only Finished Sessions in original order and uses snapshots after planning changes", async () => {
    const plan = await source(),
      set = await create(plan.entry.id, { reps: 8, loadKg: "72.5" });
    await db.execution.completeSet(alice, set.id);
    const saved = await finish(plan.session.id);
    await db.app.renameProgram(alice, plan.program.id, { name: "Changed" });
    await db.app.renameTemplate(alice, plan.program.templates[0].id, {
      name: "Changed",
    });
    await db.app.changeExercise(alice, plan.exercise.id, {
      name: "Changed",
      archived: true,
    });
    await db.app.changeEntry(alice, plan.program.templates[0].exercises[0].id, {
      targetWorkingSets: 7,
    });
    await db.app.reorderEntries(alice, plan.program.templates[0].id, {
      ids: plan.program.templates[0].exercises
        .map((entry) => entry.id)
        .reverse(),
    });
    const next = await db.workouts.start(alice, {
      templateId: plan.program.templates[0].id,
    });
    const second = await finish(next.session.id);
    db.setQueryHook(async (text) => {
      if (
        /from "(exercise|workout_program|workout_template|template_exercise)"/.test(
          text,
        )
      )
        throw new Error("History must not read live planning");
    });
    expect(await db.execution.historyDetail(alice, saved.id)).toEqual(saved);
    expect(
      (await db.execution.history(alice)).map((session) => session.id),
    ).toEqual([second.id, saved.id]);
    expect(BigInt(second.finishOrder!)).toBeGreaterThan(
      BigInt(saved.finishOrder!),
    );
  });
  it("keeps historical names/Sets when source planning is deleted", async () => {
    const plan = await source(),
      saved = await finish(plan.session.id);
    await db.postgres.exec("BEGIN");
    await db.postgres.query(
      "DELETE FROM template_exercise WHERE template_id=$1",
      [plan.program.templates[0].id],
    );
    await db.postgres.query(
      "DELETE FROM workout_template WHERE program_id=$1",
      [plan.program.id],
    );
    await db.postgres.query("DELETE FROM workout_program WHERE id=$1", [
      plan.program.id,
    ]);
    await db.postgres.exec("COMMIT");
    expect(await db.execution.historyDetail(alice, saved.id)).toMatchObject({
      sourceProgramId: null,
      sourceTemplateId: null,
      sourceProgramName: "Plan",
      sourceTemplateName: "A",
      plannedWorkingSetQuota: 5,
      exercises: saved.exercises,
    });
  });
  it("parallel Finish and Cancel choose one terminal state on the single-pool bridge", async () => {
    const plan = await source();
    const results = await Promise.allSettled([
      finish(plan.session.id),
      db.execution.cancel(alice, plan.session.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
  it.each(["create", "finish"])(
    "rolls back %s facts when commit fails",
    async (action) => {
      const plan = await source();
      let fail = true;
      db.setQueryHook(async (text) => {
        if (text.toLowerCase() === "commit" && fail) {
          fail = false;
          throw new Error("forced commit failure");
        }
      });
      await expect(
        action === "create" ? create(plan.entry.id) : finish(plan.session.id),
      ).rejects.toThrow();
      db.setQueryHook();
      expect(await setCount()).toBe(0);
      const session = await db.workouts.active(alice);
      expect(session).toMatchObject({
        id: plan.session.id,
        status: "ACTIVE",
        finishedAt: null,
        finishOrder: null,
        trainingDay: null,
        plannedWorkingSetQuota: 5,
      });
    },
  );
  it("DB protects completed values, load semantics, Set identity and lifecycle metadata", async () => {
    const plan = await source(),
      set = await create(plan.entry.id);
    for (const [column, value] of [
      ["reps", 0],
      ["rir", 11],
      ["load_kg", "NaN"],
      ["load_kg", "-1"],
    ] as const) {
      await expect(
        db.postgres.query(
          'UPDATE workout_set SET "' + column + '"=$1 WHERE id=$2',
          [value, set.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      db.postgres.query("UPDATE workout_set SET rir=$1 WHERE id=$2", [
        "1.5",
        set.id,
      ]),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      db.postgres.query(
        "UPDATE workout_set SET completed_at=now() WHERE id=$1",
        [set.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.postgres.query("UPDATE workout_set SET position=1 WHERE id=$1", [
        set.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.postgres.query(
        "UPDATE workout_session SET status='FINISHED' WHERE id=$1",
        [plan.session.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const saved = await finish(plan.session.id);
    for (const column of ["finished_at", "training_day", "finish_order"]) {
      await expect(
        db.postgres.query(
          'UPDATE workout_session SET "' + column + '"=NULL WHERE id=$1',
          [saved.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(db.execution.cancel(alice, saved.id)).rejects.toThrow(
      "conflict",
    );
  });
  it("finish order remains exact beyond the JS safe integer range", async () => {
    await db.postgres.exec(
      "SELECT setval('public.workout_finish_order',9007199254740992,true)",
    );
    const plan = await source();
    expect((await finish(plan.session.id)).finishOrder).toBe(
      "9007199254740993",
    );
  });
  it("new internal helpers/sequence and Set table revoke browser privileges", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const helper of [
        "workout_lifecycle_integrity",
        "workout_set_integrity",
      ]) {
        expect(
          (
            await db.postgres.query<{ allowed: boolean }>(
              "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
              [role, "public." + helper + "()"],
            )
          ).rows[0].allowed,
        ).toBe(false);
      }
      expect(
        (
          await db.postgres.query<{ allowed: boolean }>(
            "SELECT has_sequence_privilege($1,'public.workout_finish_order','USAGE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
  });
});

describe("Execution HTTP outcomes", () => {
  const auth = async () => ({ currentIdentity: async () => ({ id: alice }) });
  it("rejects anonymous requests before constructing persistence", async () => {
    const getApp = vi.fn();
    const response = await withExecution(
      async () => ({ currentIdentity: async () => null }),
      getApp,
      (app, user) => app.history(user),
    );
    expect(response.status).toBe(401);
    expect(getApp).not.toHaveBeenCalled();
  });
  it("returns safe validation/ownership/conflict failures", async () => {
    const plan = await source();
    const actions = [
      {
        status: 400,
        action: () =>
          db.execution.createSet(alice, plan.entry.id, {
            id: randomUUID(),
            userId: bob,
          }),
      },
      {
        status: 404,
        action: () => db.execution.completeSet(bob, randomUUID()),
      },
    ];
    for (const { status, action } of actions)
      expect(
        (await withExecution(auth, () => db.execution, action)).status,
      ).toBe(status);
    await finish(plan.session.id);
    expect(
      (
        await withExecution(
          auth,
          () => db.execution,
          (app) => app.cancel(alice, plan.session.id),
        )
      ).status,
    ).toBe(409);
  });
  it("never exposes SQL/credentials in unexpected failures", async () => {
    const response = await withExecution(
      auth,
      () => {
        throw new Error("postgresql://user:secret@host; SQL trigger failure");
      },
      (app, user) => app.history(user),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});

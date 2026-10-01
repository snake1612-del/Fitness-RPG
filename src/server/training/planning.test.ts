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
import { readPlanningJson, withPlanning } from "@/server/http/planning";

const alice = "00000000-0000-0000-0000-000000000001",
  bob = "00000000-0000-0000-0000-000000000002";
const required = { targetWorkingSets: 3, targetRepsMin: 8, targetRepsMax: 12 };
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
async function program(userId = alice, name = "Plan") {
  return db.app.createProgram(userId, {
    name,
    initialTemplate: { name: "Day A" },
  });
}
async function custom(userId = alice, loadType = "WEIGHTED") {
  return db.app.createExercise(userId, { name: "Press", loadType });
}

describe("planning persistence on an isolated PostgreSQL engine", () => {
  it("migrates exactly four tables with RLS and no client grants", async () => {
    const tables = await db.postgres.query<{
      tablename: string;
      rowsecurity: boolean;
    }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "exercise",
      "template_exercise",
      "workout_program",
      "workout_template",
    ]);
    expect(tables.rows.every((row) => row.rowsecurity)).toBe(true);
    const grants = await db.postgres.query(
      "SELECT * FROM information_schema.role_table_grants WHERE grantee IN ('anon', 'authenticated') AND table_schema = 'public'",
    );
    expect(grants.rows).toEqual([]);
  });
  it("creates, reads, renames and archives custom exercises", async () => {
    const value = await custom();
    expect(value.ownerUserId).toBe(alice);
    expect(await db.app.readExercise(alice, value.id)).toMatchObject({
      name: "Press",
      loadType: "WEIGHTED",
    });
    expect(
      await db.app.changeExercise(alice, value.id, { name: "Bench Press" }),
    ).toMatchObject({ name: "Bench Press" });
    await db.app.changeExercise(alice, value.id, { archived: true });
    expect(await db.app.listExercises(alice)).toEqual([]);
    await expect(db.app.readExercise(alice, value.id)).rejects.toThrow(
      "not_found",
    );
  });
  it("lists only non-archived built-ins and own custom exercises", async () => {
    await db.postgres.exec(
      "INSERT INTO exercise(name,load_type) VALUES ('Built in','BODYWEIGHT'); INSERT INTO exercise(name,load_type,archived) VALUES ('Archived','BODYWEIGHT',true)",
    );
    await custom(alice);
    await custom(bob);
    const list = await db.app.listExercises(alice);
    expect(list).toHaveLength(2);
    expect(list.map((item) => item.ownerUserId)).toEqual([null, alice]);
    const builtin = list.find((item) => item.ownerUserId === null)!;
    await expect(
      db.app.changeExercise(alice, builtin.id, { name: "New" }),
    ).rejects.toThrow("not_found");
    await expect(
      db.app.changeExercise(alice, builtin.id, { archived: true }),
    ).rejects.toThrow("not_found");
  });
  it("rejects another user's custom exercise read, mutation and reference", async () => {
    const other = await custom(bob);
    const current = await program();
    await expect(db.app.readExercise(alice, other.id)).rejects.toThrow(
      "not_found",
    );
    await expect(
      db.app.changeExercise(alice, other.id, { archived: true }),
    ).rejects.toThrow("not_found");
    await expect(
      db.app.createEntry(alice, current.templates[0].id, {
        exerciseId: other.id,
        ...required,
      }),
    ).rejects.toThrow("not_found");
  });
  it("rejects load type changes at both application and DB boundaries", async () => {
    const value = await custom();
    expect(() =>
      db.app.changeExercise(alice, value.id, { loadType: "BODYWEIGHT" }),
    ).toThrow("invalid_input");
    await expect(
      db.postgres.query(
        "UPDATE exercise SET load_type='BODYWEIGHT' WHERE id=$1",
        [value.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("creates the first Program active with its initial Template", async () => {
    const first = await program();
    const second = await program(alice, "Second");
    expect(first.isActive).toBe(true);
    expect(first.templates).toHaveLength(1);
    expect(first.templates[0].position).toBe(0);
    expect(second.isActive).toBe(false);
    expect(
      (await db.app.listPrograms(alice)).filter((item) => item.isActive),
    ).toHaveLength(1);
  });
  it("rejects empty Programs and rolls back invalid nested targets", async () => {
    expect(() => db.app.createProgram(alice, { name: "Empty" })).toThrow(
      "invalid_input",
    );
    const value = await custom();
    await expect(
      db.app.createProgram(alice, {
        name: "Invalid",
        initialTemplate: {
          name: "A",
          exercises: [
            { exerciseId: value.id, ...required, targetWorkingSets: 0 },
          ],
        },
      }),
    ).rejects.toThrow("invalid_input");
    expect(await db.app.listPrograms(alice)).toEqual([]);
    await expect(
      db.postgres.query(
        "INSERT INTO workout_program(user_id,name) VALUES ($1,'Empty')",
        [alice],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("atomically activates selected Program and DB rejects a second active row", async () => {
    const first = await program();
    const second = await program(alice, "Second");
    await db.app.activateProgram(alice, second.id);
    expect((await db.app.activeProgram(alice))?.id).toBe(second.id);
    await expect(
      db.postgres.query(
        "UPDATE workout_program SET is_active=true WHERE id=$1",
        [first.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect(
      (await db.app.listPrograms(alice)).filter((item) => item.isActive),
    ).toHaveLength(1);
  });
  it("handles concurrent create/activate requests through the one-connection pool", async () => {
    const created = await Promise.all([
      program(alice, "A"),
      program(alice, "B"),
      program(alice, "C"),
    ]);
    expect(created.filter((item) => item.isActive)).toHaveLength(1);
    await Promise.all(
      created.map((item) => db.app.activateProgram(alice, item.id)),
    );
    expect(
      (await db.app.listPrograms(alice)).filter((item) => item.isActive),
    ).toHaveLength(1);
  });
  it("isolates every Program/Template/entry mutation by owner", async () => {
    const other = await program(bob);
    const value = await custom(bob);
    const entry = await db.app.createEntry(bob, other.templates[0].id, {
      exerciseId: value.id,
      ...required,
    });
    expect(await db.app.listPrograms(alice)).toEqual([]);
    for (const operation of [
      () => db.app.readProgram(alice, other.id),
      () => db.app.activateProgram(alice, other.id),
      () => db.app.renameProgram(alice, other.id, { name: "X" }),
      () => db.app.createTemplate(alice, other.id, { name: "X" }),
      () => db.app.renameTemplate(alice, other.templates[0].id, { name: "X" }),
      () =>
        db.app.reorderTemplates(alice, other.id, {
          ids: [other.templates[0].id],
        }),
      () =>
        db.app.createEntry(alice, other.templates[0].id, {
          exerciseId: value.id,
          ...required,
        }),
      () => db.app.changeEntry(alice, entry.id, { notes: "X" }),
      () =>
        db.app.reorderEntries(alice, other.templates[0].id, {
          ids: [entry.id],
        }),
    ])
      await expect(operation()).rejects.toThrow("not_found");
  });
  it("reorders Templates deterministically without duplicate positions", async () => {
    const current = await program();
    const a = current.templates[0];
    const b = await db.app.createTemplate(alice, current.id, { name: "B" });
    const c = await db.app.createTemplate(alice, current.id, { name: "C" });
    const result = await db.app.reorderTemplates(alice, current.id, {
      ids: [c.id, a.id, b.id],
    });
    expect(result.map((item) => [item.name, item.position])).toEqual([
      ["C", 0],
      ["Day A", 1],
      ["B", 2],
    ]);
    await expect(
      db.app.reorderTemplates(alice, current.id, { ids: [a.id, a.id, b.id] }),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.app.reorderTemplates(alice, current.id, { ids: [a.id] }),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.postgres.query("UPDATE workout_template SET position=0 WHERE id=$1", [
        b.id,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("preserves exact numeric targets and complete ordered Active Program read model", async () => {
    const value = await custom();
    const current = await program();
    const templateId = current.templates[0].id;
    const a = await db.app.createEntry(alice, templateId, {
      exerciseId: value.id,
      ...required,
      targetLoadKg: "72.5",
      targetRir: 0,
      targetRestSeconds: 90,
      notes: "Plan",
    });
    const b = await db.app.createEntry(alice, templateId, {
      exerciseId: value.id,
      ...required,
      targetLoadKg: "72.500000000000000000000001",
      targetRir: 10,
    });
    await db.app.reorderEntries(alice, templateId, { ids: [b.id, a.id] });
    const read = await db.app.activeProgram(alice);
    expect(read?.templates[0].exercises.map((item) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(read?.templates[0].exercises[0]).toMatchObject({
      position: 0,
      targetLoadKg: "72.500000000000000000000001",
      targetRir: 10,
      exercise: { id: value.id, name: "Press", loadType: "WEIGHTED" },
    });
    expect(read?.templates[0].exercises[1]).toMatchObject({
      targetLoadKg: "72.5",
      targetRir: 0,
      targetRestSeconds: 90,
      notes: "Plan",
    });
    expect(
      await db.app.changeEntry(alice, a.id, {
        targetRir: null,
        targetLoadKg: "80.125",
      }),
    ).toMatchObject({ targetLoadKg: "80.125", targetRir: null });
    await db.app.changeExercise(alice, value.id, { archived: true });
    expect(
      (await db.app.activeProgram(alice))?.templates[0].exercises[0].exercise
        .archived,
    ).toBe(true);
    await expect(
      db.app.createEntry(alice, templateId, {
        exerciseId: value.id,
        ...required,
      }),
    ).rejects.toThrow("not_found");
  });
  it("returns explicit null when no Active Program exists", async () =>
    expect(await db.app.activeProgram(alice)).toBeNull());
  it("renames owned Programs/Templates and rejects client-assigned positions", async () => {
    const current = await program();
    expect(
      await db.app.renameProgram(alice, current.id, { name: "Renamed" }),
    ).toMatchObject({ name: "Renamed" });
    expect(
      await db.app.renameTemplate(alice, current.templates[0].id, {
        name: "Upper",
      }),
    ).toMatchObject({ name: "Upper" });
    await expect(
      db.app.createTemplate(alice, current.id, { name: "B", position: 0 }),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.postgres.query("UPDATE workout_template SET position=-1 WHERE id=$1", [
        current.templates[0].id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("enforces entry ordering and foreign keys in PostgreSQL", async () => {
    const current = await program();
    const value = await custom();
    const entry = await db.app.createEntry(alice, current.templates[0].id, {
      exerciseId: value.id,
      ...required,
    });
    await expect(
      db.postgres.query(
        "INSERT INTO template_exercise(template_id,exercise_id,position,target_working_sets,target_reps_min,target_reps_max) VALUES ($1,$2,0,3,8,12)",
        [entry.templateId, value.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.postgres.query(
        "UPDATE template_exercise SET position=-1 WHERE id=$1",
        [entry.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.postgres.query(
        "INSERT INTO workout_template(program_id,name,position) VALUES ($1,'Missing',0)",
        [bob],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.app.reorderEntries(alice, entry.templateId, { ids: [] }),
    ).rejects.toThrow("invalid_input");
  });
  it("database enforces target, ownership, load and parent integrity", async () => {
    const weighted = await custom();
    const body = await custom(alice, "BODYWEIGHT"),
      assisted = await custom(alice, "ASSISTED_BODYWEIGHT"),
      foreign = await custom(bob);
    const current = await program();
    const templateId = current.templates[0].id;
    const insert = (
      exerciseId: string,
      sets: number,
      min: number,
      max: number,
      load: string | null,
      rir: number | null,
      rest: number | null = null,
    ) =>
      db.postgres.query(
        "INSERT INTO template_exercise(template_id,exercise_id,position,target_working_sets,target_reps_min,target_reps_max,target_load_kg,target_rir,target_rest_seconds) VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8)",
        [templateId, exerciseId, sets, min, max, load, rir, rest],
      );
    for (const args of [
      [weighted.id, 0, 8, 12, null, null],
      [weighted.id, 3, 0, 12, null, null],
      [weighted.id, 3, 8, 7, null, null],
      [weighted.id, 3, 8, 12, null, -1],
      [weighted.id, 3, 8, 12, null, 11],
      [weighted.id, 3, 8, 12, "-1", null],
      [weighted.id, 3, 8, 12, "NaN", null],
      [weighted.id, 3, 8, 12, "Infinity", null],
      [body.id, 3, 8, 12, "1", null],
      [assisted.id, 3, 8, 12, "0", null],
      [foreign.id, 3, 8, 12, null, null],
      [weighted.id, 3, 8, 12, null, null, -1],
    ] as Parameters<typeof insert>[])
      await expect(insert(...args)).rejects.toMatchObject({ code: "23514" });
    const accepted = await db.app.createEntry(alice, templateId, {
      exerciseId: assisted.id,
      ...required,
      targetLoadKg: "30.25",
    });
    expect(accepted.targetLoadKg).toBe("30.25");
    await expect(
      db.postgres.query("DELETE FROM workout_template WHERE id=$1", [
        templateId,
      ]),
    ).rejects.toMatchObject({ code: "23001" });
  });
  it("prevents deleting the last Template even without entries", async () => {
    const current = await program();
    await expect(
      db.postgres.query("DELETE FROM workout_template WHERE id=$1", [
        current.templates[0].id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (await db.app.readProgram(alice, current.id)).templates,
    ).toHaveLength(1);
  });
});

describe("authenticated planning HTTP boundary", () => {
  const auth = async () => ({ currentIdentity: async () => ({ id: alice }) });
  it("rejects unauthenticated requests before creating a database application", async () => {
    const getApp = vi.fn();
    const response = await withPlanning(
      async () => ({ currentIdentity: async () => null }),
      getApp,
      (app) => app.listExercises(alice),
    );
    expect(response.status).toBe(401);
    expect(getApp).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
  it("creates valid custom Exercise with server-derived ownership", async () => {
    const response = await withPlanning(
      auth,
      () => db.app,
      (app, userId) =>
        app.createExercise(userId, { name: "Press", loadType: "WEIGHTED" }),
      201,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ownerUserId: alice,
      name: "Press",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects invalid targets and spoofed ownership fields", async () => {
    for (const input of [
      { name: "Press", loadType: "OTHER" },
      { name: "Press", loadType: "WEIGHTED", userId: bob },
    ]) {
      const response = await withPlanning(
        auth,
        () => db.app,
        (app, userId) => app.createExercise(userId, input),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
  });
  it("maps malformed JSON to a safe validation response", async () => {
    const response = await withPlanning(
      auth,
      () => db.app,
      async (app, userId) =>
        app.createExercise(
          userId,
          await readPlanningJson(
            new Request("https://example.test/api/exercises", {
              method: "POST",
              body: "{",
            }),
          ),
        ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });
  it("conceals another user's Program behind not-found", async () => {
    const other = await program(bob);
    const response = await withPlanning(
      auth,
      () => db.app,
      (app, userId) => app.readProgram(userId, other.id),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
  it("hides internal database configuration and stacks", async () => {
    const response = await withPlanning(
      auth,
      () => {
        throw new Error("postgresql://user:secret@internal-host/db");
      },
      (app) => app.listExercises(alice),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});

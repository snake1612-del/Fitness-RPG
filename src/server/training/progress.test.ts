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
import { localAuthDatabase } from "@/test/local-auth-database";
import { createProgressApplication } from "@/application/training/progress";
import { createProgressRepository } from "./progress-repository";
import { createWorkoutApplication } from "@/application/training/workout";
import { createWorkoutRepository } from "./workout-repository";
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "./execution-repository";
import { createCorrectionApplication } from "@/application/training/corrections";
import { createCorrectionRepository } from "./correction-repository";
import { progressResponse } from "@/server/http/progress";
import type { LoadType } from "@/domain/training/planning";
const alice = "00000000-0000-0000-0000-000000000001",
  bob = "00000000-0000-0000-0000-000000000002";
for (const real of [
  false,
  ...(process.env.REAL_LOCAL_AUTH === "true" ? [true] : []),
])
  describe(real ? "Progress real PostgreSQL 17" : "Progress relational", () => {
    let db:
      | Awaited<ReturnType<typeof planningDatabase>>
      | Awaited<ReturnType<typeof localAuthDatabase>>;
    let clock = new Date("2026-10-06T21:30:00Z");
    const workouts = () =>
      createWorkoutApplication(createWorkoutRepository(db.database));
    const execution = () =>
      createExecutionApplication(
        createExecutionRepository(db.database),
        () => clock,
      );
    const corrections = () =>
      createCorrectionApplication(createCorrectionRepository(db.database));
    const progress = () =>
      createProgressApplication(
        createProgressRepository(db.database),
        () => new Date("2026-10-06T21:30:00Z"),
      );
    const read = (exerciseId?: string, user = alice, zone = "Europe/Moscow") =>
      progress().read(user, zone, exerciseId);
    beforeAll(async () => {
      db = real ? await localAuthDatabase() : await planningDatabase();
    }, 30000);
    beforeEach(async () => {
      if ("reset" in db) await db.reset();
      else
        await db.postgres.query(
          "TRUNCATE workout_set, session_exercise, workout_session, template_exercise, workout_template, workout_program, exercise",
        );
      clock = new Date("2026-10-06T21:30:00Z");
    });
    afterAll(async () => {
      await db?.close();
    });
    async function plan(type: LoadType = "WEIGHTED", user = alice) {
      const exercise = await db.app.createExercise(user, {
        name: "Same name",
        loadType: type,
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
      return { exercise, templateId: program.templates[0].id, user };
    }
    async function session(
      p: Awaited<ReturnType<typeof plan>>,
      day = "2026-10-06",
      load = "20.12500000000000000001",
      reps = 8,
      kind = "working",
    ) {
      const s = (await workouts().start(p.user, { templateId: p.templateId }))
        .session;
      let setId: string | null = null;
      if (kind !== "zero") {
        const set = await execution().createSet(p.user, s.exercises[0].id, {
          id: randomUUID(),
          type: kind === "warmup" ? "WARM_UP" : "WORKING",
          loadKg: p.exercise.loadType === "BODYWEIGHT" ? null : load,
          reps,
          rir: 2,
        });
        setId = set.id;
        if (kind !== "draft") await execution().completeSet(p.user, set.id);
        if (kind === "deleted") await execution().deleteSet(p.user, set.id);
      }
      clock = new Date(day + "T12:00:00Z");
      if (kind === "cancelled") await execution().cancel(p.user, s.id);
      else if (kind !== "active")
        await execution().finish(p.user, s.id, { timeZone: "UTC" });
      return { session: s, setId };
    }
    it("calendar windows inclusive D-6/D-29, exclude D-7/D-30/future; zero-set Finished counts", async () => {
      const p = await plan();
      for (const day of [
        "2026-10-07",
        "2026-10-01",
        "2026-09-30",
        "2026-09-08",
        "2026-09-07",
        "2026-10-08",
      ])
        await session(p, day, "20", 8, "zero");
      await session(p, "2026-10-07", "20", 8, "cancelled");
      expect((await read()).overview).toEqual({
        totalFinished: 6,
        last7: 2,
        last30: 4,
      });
      expect((await read(undefined, alice, "Europe/London")).today).toBe(
        "2026-10-06",
      );
      expect((await read()).exercises).toEqual([]);
    });
    it.each(["warmup", "draft", "deleted", "cancelled", "active"])(
      "excludes %s from eligible history",
      async (kind) => {
        const p = await plan();
        await session(p, "2026-10-06", "20", 8, kind);
        expect((await read(p.exercise.id)).selected).toBeNull();
        expect((await read()).exercises).toEqual([]);
      },
    );
    it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"] as const)(
      "%s inverted training days preserve SQL Finish order, Latest and earliest PR ties",
      async (type) => {
        const p = await plan(type);
        const old = await session(p, "2026-10-07", "20", 8);
        const latest = await session(p, "2026-10-06", "20", 8);
        const raw = await createProgressRepository(db.database).read(
          alice,
          { today: "2026-10-07", from7: "2026-10-01", from30: "2026-09-08" },
          p.exercise.id,
        );
        expect(raw.occurrences.map((r) => r.sessionId)).toEqual([
          old.session.id,
          latest.session.id,
        ]);
        expect(BigInt(raw.occurrences[0].finishOrder)).toBeLessThan(
          BigInt(raw.occurrences[1].finishOrder),
        );
        await corrections().correct(alice, latest.session.id, {
          expected_revision: 0,
          setAdditions: [
            {
              id: randomUUID(),
              sessionExerciseId: latest.session.exercises[0].id,
              type: "WORKING",
              loadKg: type === "BODYWEIGHT" ? null : "20",
              reps: 7,
              rir: null,
            },
          ],
        });
        await db.app.changeExercise(alice, p.exercise.id, { archived: true });
        const result = await read(p.exercise.id),
          selected = result.selected!;
        expect(result.exercises[0]).toMatchObject({
          id: p.exercise.id,
          archived: true,
        });
        expect(selected.latest.sets).toHaveLength(2);
        expect(selected.latest.sessionId).toBe(latest.session.id);
        expect(selected.recent.map((r) => r.occurrence.sessionId)).toEqual([
          latest.session.id,
          old.session.id,
        ]);
        const record =
          type === "WEIGHTED"
            ? selected.highestLoad
            : type === "BODYWEIGHT"
              ? selected.maxReps
              : selected.lowestAssistance;
        expect(record!.source.sessionId).toBe(old.session.id);
        if (type === "WEIGHTED") {
          expect(selected.bestE1rm!.source.sessionId).toBe(old.session.id);
          expect(selected.recent[0].volume).toBe("300");
        } else expect(selected.recent[0].volume).toBeNull();
      },
    );
    it("corrections recompute load/reps/type/tombstone/addition without moving Session or changing overview", async () => {
      const p = await plan();
      const s = await session(p);
      let revision = 0;
      const change = (patch: Record<string, unknown>) =>
        corrections().correct(alice, s.session.id, {
          expected_revision: revision++,
          ...patch,
        });
      const edit = (loadKg: string, reps: number, type = "WORKING") =>
        change({ setEdits: [{ id: s.setId, loadKg, reps, type, rir: null }] });
      const overview = (await read()).overview;
      await edit("30.05", 6);
      let projected = (await read(p.exercise.id)).selected!;
      expect(projected.highestLoad!.value).toBe("30.05");
      expect(projected.bestE1rm!.value).toBe("36.1");
      expect(projected.recent[0].volume).toBe("180.3");
      await edit("30.05", 10);
      expect((await read(p.exercise.id)).selected!.bestE1rm!.value).toBe(
        "40.1",
      );
      await edit("30.05", 10, "WARM_UP");
      expect((await read(p.exercise.id)).selected).toBeNull();
      await edit("30.05", 10);
      expect((await read(p.exercise.id)).selected).not.toBeNull();
      await change({ setDeletions: [s.setId] });
      expect((await read(p.exercise.id)).selected).toBeNull();
      await change({
        setAdditions: [
          {
            id: randomUUID(),
            sessionExerciseId: s.session.exercises[0].id,
            type: "WORKING",
            loadKg: "99",
            reps: 1,
            rir: 0,
          },
        ],
      });
      projected = (await read(p.exercise.id)).selected!;
      expect(projected.bestE1rm!.value).toBe("99.0");
      expect(projected.latest.trainingDay).toBe("2026-10-06");
      expect((await read()).overview).toEqual(overview);
    });
    it("SESSION_ONLY shares stable identity; A→B correction reassigns; delete removes occurrence, no name matching", async () => {
      const p = await plan(),
        other = await db.app.createExercise(alice, {
          name: p.exercise.name,
          loadType: "WEIGHTED",
        });
      const active = (
        await workouts().start(alice, { templateId: p.templateId })
      ).session;
      const extra = await execution().addExercise(alice, active.id, {
        exerciseId: p.exercise.id,
      });
      const set = await execution().createSet(alice, extra.id, {
        id: randomUUID(),
        type: "WORKING",
        loadKg: "80",
        reps: 8,
      });
      await execution().completeSet(alice, set.id);
      await execution().finish(alice, active.id, { timeZone: "UTC" });
      expect(
        (await read(p.exercise.id)).selected!.latest.sessionExerciseId,
      ).toBe(extra.id);
      expect((await read(other.id)).selected).toBeNull();
      await corrections().correct(alice, active.id, {
        expected_revision: 0,
        exerciseEdits: [{ id: extra.id, exerciseId: other.id }],
      });
      expect((await read(p.exercise.id)).selected).toBeNull();
      expect((await read(other.id)).selected!.latest.sessionExerciseId).toBe(
        extra.id,
      );
      expect((await read()).exercises.map((x) => x.id)).toEqual([other.id]);
      await corrections().correct(alice, active.id, {
        expected_revision: 1,
        exerciseDeletions: [extra.id],
      });
      expect((await read(other.id)).selected).toBeNull();
    });
    it("last eight selection reflows after corrected ineligible/newly eligible history at original position", async () => {
      const p = await plan();
      const rows = [];
      for (let i = 1; i <= 10; i++)
        rows.push(
          await session(
            p,
            i % 2 === 0 ? "2026-10-06" : "2026-10-07",
            "20",
            8,
            i === 2 ? "warmup" : "working",
          ),
        );
      let latest = (await read(p.exercise.id)).selected!;
      const raw = await createProgressRepository(db.database).read(
        alice,
        { today: "2026-10-07", from7: "2026-10-01", from30: "2026-09-08" },
        p.exercise.id,
      );
      expect(raw.occurrences.map((r) => r.sessionId)).toEqual(
        rows.filter((_, i) => i !== 1).map((r) => r.session.id),
      );
      expect(latest.recent.map((r) => r.occurrence.sessionId)).toEqual(
        rows
          .slice(2)
          .reverse()
          .map((r) => r.session.id),
      );
      await corrections().correct(alice, rows[9].session.id, {
        expected_revision: 0,
        setDeletions: [rows[9].setId],
      });
      latest = (await read(p.exercise.id)).selected!;
      expect(latest.recent.at(-1)!.occurrence.sessionId).toBe(
        rows[0].session.id,
      );
      await corrections().correct(alice, rows[1].session.id, {
        expected_revision: 0,
        setEdits: [
          {
            id: rows[1].setId,
            type: "WORKING",
            loadKg: "100",
            reps: 8,
            rir: 2,
          },
        ],
      });
      latest = (await read(p.exercise.id)).selected!;
      expect(latest.recent.at(-1)!.occurrence.sessionId).toBe(
        rows[1].session.id,
      );
      expect(latest.latest.sessionId).toBe(rows[8].session.id);
    });
    it("foreign Exercise never reveals performance; API derives owner and validates timezone/UUID/no-store", async () => {
      const a = await plan(),
        b = await plan("WEIGHTED", bob);
      await session(a);
      await session(b, "2026-10-06", "999");
      expect((await read(b.exercise.id)).selected).toBeNull();
      expect((await read()).exercises.map((x) => x.id)).toEqual([
        a.exercise.id,
      ]);
      const request = (query: string) =>
        new Request("http://localhost/api/progress" + query);
      const auth = async () => ({
        currentIdentity: async () => ({ id: alice }),
      });
      const response = await progressResponse(
        auth,
        progress,
        request(
          `?timeZone=Europe%2FMoscow&exerciseId=${b.exercise.id}&userId=${bob}`,
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).selected).toBeNull();
      for (const query of [
        "",
        "?timeZone=Invalid%2FZone",
        "?timeZone=UTC&exerciseId=bad",
      ])
        expect(
          (await progressResponse(auth, progress, request(query))).status,
        ).toBe(400);
      expect(
        (
          await progressResponse(
            async () => ({ currentIdentity: async () => null }),
            progress,
            request("?timeZone=UTC"),
          )
        ).status,
      ).toBe(401);
    });
  });

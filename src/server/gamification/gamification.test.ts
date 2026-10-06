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
import { createGamificationApplication } from "@/application/gamification";
import { createGamificationRepository } from "./repository";
import { createWorkoutApplication } from "@/application/training/workout";
import { createWorkoutRepository } from "@/server/training/workout-repository";
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "@/server/training/execution-repository";
import { createCorrectionApplication } from "@/application/training/corrections";
import { createCorrectionRepository } from "@/server/training/correction-repository";
import { gamificationResponse } from "@/server/http/gamification";
const alice = "00000000-0000-0000-0000-000000000001",
  bob = "00000000-0000-0000-0000-000000000002";
for (const real of [
  false,
  ...(process.env.REAL_LOCAL_AUTH === "true" ? [true] : []),
])
  describe(
    real ? "Gamification real PostgreSQL 17" : "Gamification relational",
    () => {
      let db:
        | Awaited<ReturnType<typeof planningDatabase>>
        | Awaited<ReturnType<typeof localAuthDatabase>>;
      let clock = new Date("2026-10-06T12:00:00Z");
      const workouts = () =>
        createWorkoutApplication(createWorkoutRepository(db.database));
      const execution = () =>
        createExecutionApplication(
          createExecutionRepository(db.database),
          () => clock,
        );
      const corrections = () =>
        createCorrectionApplication(createCorrectionRepository(db.database));
      const repository = () => createGamificationRepository(db.database);
      const app = () => createGamificationApplication(repository());
      beforeAll(async () => {
        db = real ? await localAuthDatabase() : await planningDatabase();
      }, 30000);
      beforeEach(async () => {
        if ("reset" in db) await db.reset();
        else
          await db.postgres.query(
            "TRUNCATE workout_set, session_exercise, workout_session, template_exercise, workout_template, workout_program, exercise",
          );
        clock = new Date("2026-10-06T12:00:00Z");
      });
      afterAll(async () => {
        await db?.close();
      });
      async function plan(quotas = [4], user = alice) {
        const exercise = await db.app.createExercise(user, {
          name: "XP neutral",
          loadType: "WEIGHTED",
        });
        const program = await db.app.createProgram(user, {
          name: "XP plan",
          initialTemplate: {
            name: "A",
            exercises: quotas.map((targetWorkingSets) => ({
              exerciseId: exercise.id,
              targetWorkingSets,
              targetRepsMin: 1,
              targetRepsMax: 10,
            })),
          },
        });
        await db.app.activateProgram(user, program.id);
        return { exercise, program, templateId: program.templates[0].id, user };
      }
      async function set(entryId: string, kind = "working", user = alice) {
        const row = await execution().createSet(user, entryId, {
          id: randomUUID(),
          type: kind === "warmup" ? "WARM_UP" : "WORKING",
          loadKg: "20.12500000000000000001",
          reps: 8,
          rir: 2,
        });
        if (kind !== "draft") await execution().completeSet(user, row.id);
        if (kind === "deleted") await execution().deleteSet(user, row.id);
        return row;
      }
      async function session(
        p: Awaited<ReturnType<typeof plan>>,
        w = 2,
        day = "2026-10-06",
        status = "FINISHED",
      ) {
        await db.app.activateProgram(p.user, p.program.id);
        const row = (
          await workouts().start(p.user, { templateId: p.templateId })
        ).session;
        const sets = [];
        for (let i = 0; i < w; i++)
          sets.push(await set(row.exercises[0].id, "working", p.user));
        clock = new Date(day + "T12:00:00Z");
        if (status === "FINISHED")
          await execution().finish(p.user, row.id, { timeZone: "UTC" });
        if (status === "CANCELLED") await execution().cancel(p.user, row.id);
        return { row, sets };
      }
      it("frozen multi-Exercise P is not join-inflated, reduced by Skip or changed by current Planning; extra/session-only count W", async () => {
        const p = await plan([3, 2]);
        const row = (
          await workouts().start(alice, { templateId: p.templateId })
        ).session;
        await execution().skipExercise(alice, row.exercises[1].id, {
          skipped: true,
        });
        await db.app.changeEntry(
          alice,
          p.program.templates[0].exercises[0].id,
          { targetWorkingSets: 10 },
        );
        for (let i = 0; i < 5; i++) await set(row.exercises[0].id);
        const extra = await execution().addExercise(alice, row.id, {
          exerciseId: p.exercise.id,
        });
        await set(extra.id);
        await set(extra.id);
        await set(row.exercises[0].id, "warmup");
        const draft = await set(row.exercises[0].id, "draft");
        await set(row.exercises[0].id, "deleted");
        await execution().finish(alice, row.id, { timeZone: "UTC" });
        expect((await app().read(alice)).awards[0]).toMatchObject({
          p: 5,
          w: 7,
          c: 5,
          candidateXp: 100,
          awardedXp: 100,
        });
        const detail = await execution().historyDetail(alice, row.id);
        expect(
          detail.exercises[0].sets.find((s) => s.id === draft.id)?.completedAt,
        ).toBeNull();
        expect(detail.plannedWorkingSetQuota).toBe(5);
      });
      it.each(["ACTIVE", "CANCELLED"])(
        "%s cannot consume XP or daily cap",
        async (status) => {
          const p = await plan();
          await session(p, 4, "2026-10-06", status);
          expect((await app().read(alice)).awards).toEqual([]);
          expect((await app().read(alice)).summary.totalXp).toBe(0);
        },
      );
      it("Finished P<2/C<2/zero/draft-only stay valid with zero candidate and no cap consumed", async () => {
        const p = await plan([1]);
        const one = await session(p, 5);
        const q = await plan([4]);
        const zero = await session(q, 0);
        const partial = await session(q, 1);
        const draft = (
          await workouts().start(alice, { templateId: q.templateId })
        ).session;
        await set(draft.exercises[0].id, "draft");
        await execution().finish(alice, draft.id, { timeZone: "UTC" });
        const data = await app().read(alice);
        expect(data.awards.map((s) => s.id)).toEqual([
          one.row.id,
          zero.row.id,
          partial.row.id,
          draft.id,
        ]);
        expect(data.awards.map((s) => [s.candidateXp, s.awardedXp])).toEqual([
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]);
        expect(data.summary.level).toBe(1);
      });
      it("70+80+100 allocates 70/30/0; another stable day resets cap; earlier correction reallocates without moving history", async () => {
        const p = await plan([10]),
          q = await plan([5]),
          r = await plan([4]);
        const a = await session(p, 7),
          b = await session(q, 4),
          c = await session(r, 4),
          d = await session(r, 4, "2026-10-05");
        const before = await app().read(alice);
        expect(
          before.awards.map((s) => [s.id, s.candidateXp, s.awardedXp]),
        ).toEqual([
          [a.row.id, 70, 70],
          [b.row.id, 80, 30],
          [c.row.id, 100, 0],
          [d.row.id, 100, 100],
        ]);
        expect(before.summary.totalXp).toBe(200);
        await corrections().correct(alice, a.row.id, {
          expected_revision: 0,
          setDeletions: a.sets.slice(0, 2).map((s) => s.id),
        });
        const after = await app().read(alice);
        expect(after.awards.map((s) => s.awardedXp)).toEqual([50, 50, 0, 100]);
        expect(
          after.awards.map((s) => [s.id, s.trainingDay, s.finishOrder]),
        ).toEqual(
          before.awards.map((s) => [s.id, s.trainingDay, s.finishOrder]),
        );
        expect(await app().read(alice)).toEqual(after);
      });
      it("forgotten Set/tombstone/Working↔Warm-up recompute W; weight/reps/RIR-only edits are XP neutral", async () => {
        const p = await plan();
        const s = await session(p);
        let revision = 0;
        const correct = (patch: Record<string, unknown>) =>
          corrections().correct(alice, s.row.id, {
            expected_revision: revision++,
            ...patch,
          });
        const award = async () => (await app().read(alice)).awards[0];
        expect((await award()).candidateXp).toBe(50);
        const addition = randomUUID();
        await correct({
          setAdditions: [
            {
              id: addition,
              sessionExerciseId: s.row.exercises[0].id,
              type: "WORKING",
              loadKg: "1",
              reps: 1,
              rir: null,
            },
          ],
        });
        expect((await award()).candidateXp).toBe(75);
        await correct({ setDeletions: [addition] });
        expect((await award()).candidateXp).toBe(50);
        const edit = async (
          type: string,
          loadKg: string,
          reps: number,
          rir: number | null,
        ) =>
          correct({
            setEdits: [{ id: s.sets[0].id, type, loadKg, reps, rir }],
          });
        await edit("WARM_UP", "20", 8, 2);
        expect((await award()).w).toBe(1);
        expect((await award()).candidateXp).toBe(0);
        await edit("WORKING", "20", 8, 2);
        expect((await award()).candidateXp).toBe(50);
        const baseline = await app().read(alice);
        await edit("WORKING", "99999.05", 8, 2);
        expect(await app().read(alice)).toEqual(baseline);
        await edit("WORKING", "99999.05", 1, 2);
        expect(await app().read(alice)).toEqual(baseline);
        await edit("WORKING", "99999.05", 1, 10);
        expect(await app().read(alice)).toEqual(baseline);
      });
      it("SESSION_ONLY deletion removes live W but preserves P; corrected Total XP/Level can decrease", async () => {
        const p = await plan([2]);
        const row = (
          await workouts().start(alice, { templateId: p.templateId })
        ).session;
        const extra = await execution().addExercise(alice, row.id, {
          exerciseId: p.exercise.id,
        });
        await set(extra.id);
        await set(extra.id);
        await execution().finish(alice, row.id, { timeZone: "UTC" });
        const before = await app().read(alice);
        expect(before.awards[0]).toMatchObject({ p: 2, w: 2, c: 2 });
        expect(before.summary).toMatchObject({
          totalXp: 100,
          level: 2,
          xpIntoLevel: 0,
          xpRemaining: 125,
        });
        await corrections().correct(alice, row.id, {
          expected_revision: 0,
          exerciseDeletions: [extra.id],
        });
        const after = await app().read(alice);
        expect(after.awards[0]).toMatchObject({
          p: 2,
          w: 0,
          c: 0,
          awardedXp: 0,
        });
        expect(after.summary).toMatchObject({
          totalXp: 0,
          level: 1,
          xpRemaining: 100,
        });
      });
      it("authenticated summary is owner-scoped, bounded and no-store; unauthenticated and failures controlled", async () => {
        const p = await plan(),
          q = await plan([2], bob);
        await session(p, 2);
        await session(q, 2);
        expect((await app().read(alice)).summary.totalXp).toBe(50);
        expect((await app().read(bob)).summary.totalXp).toBe(100);
        const auth = async () => ({
          currentIdentity: async () => ({ id: alice }),
        });
        const response = await gamificationResponse(auth, app);
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          totalXp: 50,
          level: 1,
          xpIntoLevel: 50,
          xpForNextLevel: 100,
          xpRemaining: 50,
        });
        const unauth = await gamificationResponse(
          async () => ({ currentIdentity: async () => null }),
          () => {
            throw Error("Must not read without auth");
          },
        );
        expect(unauth.status).toBe(401);
        expect(unauth.headers.get("Cache-Control")).toBe("no-store");
        const failure = await gamificationResponse(auth, () => {
          throw Error("private error");
        });
        expect(failure.status).toBe(503);
        expect(await failure.json()).toEqual({ error: "service_unavailable" });
        expect(failure.headers.get("Cache-Control")).toBe("no-store");
      });
    },
  );

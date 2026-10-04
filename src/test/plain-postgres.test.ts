import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { localAuthDatabase } from "./local-auth-database";
import { createWorkoutApplication } from "@/application/training/workout";
import { createWorkoutRepository } from "@/server/training/workout-repository";
import { createExecutionApplication } from "@/application/training/execution";
import { createExecutionRepository } from "@/server/training/execution-repository";
import { createCorrectionApplication } from "@/application/training/corrections";
import { createCorrectionRepository } from "@/server/training/correction-repository";
import { createPreviousPerformanceApplication } from "@/application/training/previous-performance";
import { createPreviousPerformanceRepository } from "@/server/training/previous-performance-repository";

describe.runIf(process.env.REAL_LOCAL_AUTH === "true")(
  "fresh plain PostgreSQL 17 compatibility",
  () => {
    let db: Awaited<ReturnType<typeof localAuthDatabase>>;
    let finishedId: string;
    beforeAll(async () => {
      db = await localAuthDatabase();
    }, 30000);
    afterAll(async () => {
      await db?.close();
    });
    it("applies canonical schema without Supabase roles/extensions and retains RLS, enums, triggers and sequence", async () => {
      const sql = db.postgres;
      expect(
        (
          await sql.query(
            "select rolname from pg_roles where rolname in ('anon','authenticated','authenticator')",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await sql.query(
            "select nspname from pg_namespace where nspname='auth'",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await sql.query(
            "select extname from pg_extension where extname <> 'plpgsql'",
          )
        ).rows,
      ).toHaveLength(0);
      const tables = (
        await sql.query(
          "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
        )
      ).rows;
      expect(tables.length).toBeGreaterThanOrEqual(7);
      expect(tables.every((t) => t.relrowsecurity)).toBe(true);
      expect(
        (
          await sql.query(
            "select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'",
          )
        ).rows.length,
      ).toBeGreaterThan(0);
      expect(
        (
          await sql.query(
            "select 1 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and i.indpred is not null",
          )
        ).rows.length,
      ).toBeGreaterThan(0);
      expect(
        (
          await sql.query(
            "select 1 from pg_trigger where tgconstraint <> 0 and not tgisinternal",
          )
        ).rows.length,
      ).toBeGreaterThan(0);
      expect(
        (
          await sql.query(
            "select 1 from pg_sequences where schemaname='public'",
          )
        ).rows.length,
      ).toBeGreaterThan(0);
    });
    it("preserves exact decimals, corrections and canonical Previous Performance under clock skew", async () => {
      const owner = randomUUID();
      const exercise = await db.app.createExercise(owner, {
        name: "Plain PG press",
        loadType: "WEIGHTED",
      });
      const program = await db.app.createProgram(owner, {
        name: "Plain PG plan",
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
      const workouts = createWorkoutApplication(
        createWorkoutRepository(db.database),
      );
      const execution = createExecutionApplication(
        createExecutionRepository(db.database),
      );
      const corrections = createCorrectionApplication(
        createCorrectionRepository(db.database),
      );
      const previous = createPreviousPerformanceApplication(
        createPreviousPerformanceRepository(db.database),
      );
      const { session } = await workouts.start(owner, {
        templateId: program.templates[0].id,
      });
      const set = await execution.createSet(owner, session.exercises[0].id, {
        id: randomUUID(),
        loadKg: "20.12500000000000000001",
        reps: 8,
        rir: 2,
      });
      await execution.completeSet(owner, set.id);
      const saved = await execution.finish(owner, session.id, {
        timeZone: "Europe/Moscow",
      });
      finishedId = saved.id;
      expect(saved.finishOrder).not.toBeNull();
      expect(saved.exercises[0].sets[0].loadKg).toBe("20.12500000000000000001");
      await corrections.correct(owner, saved.id, {
        expected_revision: 0,
        setEdits: [
          {
            id: set.id,
            type: "WORKING",
            loadKg: "21.12500000000000000001",
            reps: 9,
            rir: 2,
          },
        ],
      });
      const corrected = await execution.historyDetail(owner, saved.id);
      expect(corrected.correctionRevision).toBe(1);
      expect(corrected.finishOrder).toBe(saved.finishOrder);
      const { session: active } = await workouts.start(owner, {
        templateId: program.templates[0].id,
      });
      // Deterministic clock skew fixture, never modifies normal user's database.
      await db.postgres.query(
        "UPDATE workout_session SET started_at=$1 WHERE id=$2",
        [new Date(saved.finishedAt!.getTime() - 2000), active.id],
      );
      expect(
        (await previous.forActive(owner, active.id))[active.exercises[0].id],
      ).toMatchObject({
        sessionId: saved.id,
        sets: [{ id: set.id, loadKg: "21.12500000000000000001", reps: 9 }],
      });
      await expect(
        execution.historyDetail(randomUUID(), saved.id),
      ).rejects.toMatchObject({ code: "not_found" });
      await execution.cancel(owner, active.id);
    });
    it("real independent PostgreSQL connections enforce transaction advisory locks and row locks", async () => {
      const first = await db.postgres.connect();
      const second = await db.postgres.connect();
      try {
        await first.query("BEGIN");
        await second.query("BEGIN");
        await first.query("SELECT pg_advisory_xact_lock(92736401)");
        expect(
          (
            await second.query(
              "SELECT pg_try_advisory_xact_lock(92736401) AS acquired",
            )
          ).rows[0].acquired,
        ).toBe(false);
        await first.query("ROLLBACK");
        expect(
          (
            await second.query(
              "SELECT pg_try_advisory_xact_lock(92736401) AS acquired",
            )
          ).rows[0].acquired,
        ).toBe(true);
        await second.query("ROLLBACK");
        await first.query("BEGIN");
        await second.query("BEGIN");
        await first.query(
          "SELECT id FROM workout_session WHERE id=$1 FOR UPDATE",
          [finishedId],
        );
        await expect(
          second.query(
            "SELECT id FROM workout_session WHERE id=$1 FOR UPDATE NOWAIT",
            [finishedId],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await first.query("ROLLBACK");
        await second.query("ROLLBACK");
        first.release();
        second.release();
      }
    });
  },
);

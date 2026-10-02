import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const exerciseLoadType = pgEnum("exercise_load_type", [
  "WEIGHTED",
  "BODYWEIGHT",
  "ASSISTED_BODYWEIGHT",
]);
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const exercise = pgTable(
  "exercise",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id"),
    name: text("name").notNull(),
    loadType: exerciseLoadType("load_type").notNull(),
    archived: boolean("archived").default(false).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("exercise_owner_idx").on(table.ownerUserId),
    check("exercise_name_valid", sql`length(btrim(${table.name})) > 0`),
  ],
).enableRLS();

export const workoutProgram = pgTable(
  "workout_program",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("program_user_idx").on(table.userId),
    uniqueIndex("program_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.isActive} = true`),
    check("program_name_valid", sql`length(btrim(${table.name})) > 0`),
  ],
).enableRLS();
export const workoutTemplate = pgTable(
  "workout_template",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references(() => workoutProgram.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("template_program_position_unique").on(
      table.programId,
      table.position,
    ),
    check("template_position_valid", sql`${table.position} >= 0`),
    check("template_name_valid", sql`length(btrim(${table.name})) > 0`),
  ],
).enableRLS();
export const templateExercise = pgTable(
  "template_exercise",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workoutTemplate.id, { onDelete: "restrict" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercise.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    targetWorkingSets: integer("target_working_sets").notNull(),
    targetRepsMin: integer("target_reps_min").notNull(),
    targetRepsMax: integer("target_reps_max").notNull(),
    targetLoadKg: numeric("target_load_kg"),
    targetRir: integer("target_rir"),
    targetRestSeconds: integer("target_rest_seconds"),
    notes: text("notes"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("entry_template_position_unique").on(
      table.templateId,
      table.position,
    ),
    index("entry_exercise_idx").on(table.exerciseId),
    check("entry_position_valid", sql`${table.position} >= 0`),
    check("entry_working_sets_valid", sql`${table.targetWorkingSets} >= 1`),
    check(
      "entry_reps_valid",
      sql`${table.targetRepsMin} >= 1 AND ${table.targetRepsMax} >= ${table.targetRepsMin}`,
    ),
    check("entry_rir_valid", sql`${table.targetRir} BETWEEN 0 AND 10`),
    check("entry_rest_valid", sql`${table.targetRestSeconds} >= 0`),
    check(
      "entry_load_valid",
      sql`${table.targetLoadKg} >= 0 AND ${table.targetLoadKg} < 'Infinity'::numeric`,
    ),
  ],
).enableRLS();

export const workoutSessionStatus = pgEnum("workout_session_status", [
  "ACTIVE",
  "FINISHED",
  "CANCELLED",
]);
export const sessionExerciseOrigin = pgEnum("session_exercise_origin", [
  "PLANNED",
  "SESSION_ONLY",
]);
export const workoutSession = pgTable(
  "workout_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    sourceProgramId: uuid("source_program_id").references(
      () => workoutProgram.id,
      { onDelete: "set null" },
    ),
    sourceTemplateId: uuid("source_template_id").references(
      () => workoutTemplate.id,
      { onDelete: "set null" },
    ),
    sourceProgramName: text("source_program_name").notNull(),
    sourceTemplateName: text("source_template_name").notNull(),
    status: workoutSessionStatus("status").default("ACTIVE").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    plannedWorkingSetQuota: integer("planned_working_set_quota").notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    finishTimezone: text("finish_timezone"),
    finishUtcOffsetSeconds: integer("finish_utc_offset_seconds"),
    trainingDay: date("training_day", { mode: "string" }),
    finishOrder: bigint("finish_order", { mode: "bigint" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("session_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("session_user_idx").on(table.userId),
    index("session_source_program_idx").on(table.sourceProgramId),
    index("session_source_template_idx").on(table.sourceTemplateId),
    index("session_finished_history_idx")
      .on(table.userId, table.finishOrder)
      .where(sql`${table.status} = 'FINISHED'`),
    uniqueIndex("session_finish_order_unique").on(table.finishOrder),
    check("session_finish_order_valid", sql`${table.finishOrder} > 0`),
    check(
      "session_finish_timezone_valid",
      sql`length(btrim(${table.finishTimezone})) > 0`,
    ),
    check(
      "session_finish_offset_valid",
      sql`${table.finishUtcOffsetSeconds} BETWEEN -86400 AND 86400`,
    ),
    check(
      "session_lifecycle_valid",
      sql`
      (${table.status} = 'ACTIVE' AND ${table.finishedAt} IS NULL AND ${table.cancelledAt} IS NULL
       AND ${table.finishTimezone} IS NULL AND ${table.finishUtcOffsetSeconds} IS NULL AND ${table.trainingDay} IS NULL AND ${table.finishOrder} IS NULL)
      OR (${table.status} = 'FINISHED' AND ${table.finishedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL
       AND ${table.finishTimezone} IS NOT NULL AND ${table.finishUtcOffsetSeconds} IS NOT NULL AND ${table.trainingDay} IS NOT NULL AND ${table.finishOrder} IS NOT NULL)
      OR (${table.status} = 'CANCELLED' AND ${table.finishedAt} IS NULL AND ${table.cancelledAt} IS NOT NULL
       AND ${table.finishTimezone} IS NULL AND ${table.finishUtcOffsetSeconds} IS NULL AND ${table.trainingDay} IS NULL AND ${table.finishOrder} IS NULL)
    `,
    ),
    check("session_quota_valid", sql`${table.plannedWorkingSetQuota} >= 0`),
    check(
      "session_source_names_valid",
      sql`length(btrim(${table.sourceProgramName})) > 0 AND length(btrim(${table.sourceTemplateName})) > 0`,
    ),
  ],
).enableRLS();

export const workoutSetType = pgEnum("workout_set_type", [
  "WORKING",
  "WARM_UP",
]);
export const workoutSet = pgTable(
  "workout_set",
  {
    // Client-generated UUID is the retry identity, never a planned slot identity.
    id: uuid("id").primaryKey(),
    sessionExerciseId: uuid("session_exercise_id")
      .notNull()
      .references(() => sessionExercise.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    type: workoutSetType("type").default("WORKING").notNull(),
    loadKg: numeric("load_kg"),
    reps: integer("reps"),
    rir: integer("rir"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Retain UUID after deletion so a late create retry cannot resurrect a Set.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("set_exercise_position_unique").on(
      table.sessionExerciseId,
      table.position,
    ),
    check("set_position_valid", sql`${table.position} >= 0`),
    check("set_reps_valid", sql`${table.reps} >= 1`),
    check("set_rir_valid", sql`${table.rir} BETWEEN 0 AND 10`),
    check(
      "set_load_valid",
      sql`${table.loadKg} >= 0 AND ${table.loadKg} < 'Infinity'::numeric`,
    ),
    check(
      "set_completed_reps_valid",
      sql`${table.completedAt} IS NULL OR ${table.reps} IS NOT NULL`,
    ),
  ],
).enableRLS();

export const sessionExercise = pgTable(
  "session_exercise",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workoutSession.id, { onDelete: "restrict" }),
    exerciseId: uuid("exercise_id").references(() => exercise.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull(),
    origin: sessionExerciseOrigin("origin").default("PLANNED").notNull(),
    skipped: boolean("skipped").default(false).notNull(),
    exerciseName: text("exercise_name").notNull(),
    loadType: exerciseLoadType("load_type").notNull(),
    plannedWorkingSets: integer("planned_working_sets").notNull(),
    targetRepsMin: integer("target_reps_min"),
    targetRepsMax: integer("target_reps_max"),
    targetLoadKg: numeric("target_load_kg"),
    targetRir: integer("target_rir"),
    targetRestSeconds: integer("target_rest_seconds"),
    notes: text("notes"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("snapshot_session_position_unique").on(
      table.sessionId,
      table.position,
    ),
    index("snapshot_exercise_idx").on(table.exerciseId),
    check("snapshot_position_valid", sql`${table.position} >= 0`),
    check(
      "snapshot_planned_valid",
      sql`(${table.origin} = 'PLANNED' AND ${table.plannedWorkingSets} >= 1) OR (${table.origin} = 'SESSION_ONLY' AND ${table.plannedWorkingSets} = 0 AND ${table.targetRepsMin} IS NULL AND ${table.targetRepsMax} IS NULL AND ${table.targetLoadKg} IS NULL AND ${table.targetRir} IS NULL AND ${table.targetRestSeconds} IS NULL AND ${table.notes} IS NULL)`,
    ),
    check("snapshot_name_valid", sql`length(btrim(${table.exerciseName})) > 0`),
    check(
      "snapshot_reps_valid",
      sql`${table.origin} = 'SESSION_ONLY' OR (${table.targetRepsMin} IS NOT NULL AND ${table.targetRepsMax} IS NOT NULL AND ${table.targetRepsMin} >= 1 AND ${table.targetRepsMax} >= ${table.targetRepsMin})`,
    ),
    check("snapshot_rir_valid", sql`${table.targetRir} BETWEEN 0 AND 10`),
    check("snapshot_rest_valid", sql`${table.targetRestSeconds} >= 0`),
    check(
      "snapshot_load_finite",
      sql`${table.targetLoadKg} >= 0 AND ${table.targetLoadKg} < 'Infinity'::numeric`,
    ),
    check(
      "snapshot_load_semantics",
      sql`(${table.loadType} <> 'BODYWEIGHT' OR ${table.targetLoadKg} IS NULL) AND (${table.loadType} <> 'ASSISTED_BODYWEIGHT' OR ${table.targetLoadKg} > 0)`,
    ),
  ],
).enableRLS();

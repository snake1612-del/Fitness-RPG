import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

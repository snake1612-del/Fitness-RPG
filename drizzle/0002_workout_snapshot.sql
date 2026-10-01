CREATE TYPE "public"."session_exercise_origin" AS ENUM('PLANNED', 'SESSION_ONLY');--> statement-breakpoint
CREATE TYPE "public"."workout_session_status" AS ENUM('ACTIVE', 'FINISHED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "session_exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid,
	"position" integer NOT NULL,
	"origin" "session_exercise_origin" DEFAULT 'PLANNED' NOT NULL,
	"exercise_name" text NOT NULL,
	"load_type" "exercise_load_type" NOT NULL,
	"planned_working_sets" integer NOT NULL,
	"target_reps_min" integer NOT NULL,
	"target_reps_max" integer NOT NULL,
	"target_load_kg" numeric,
	"target_rir" integer,
	"target_rest_seconds" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_position_valid" CHECK ("session_exercise"."position" >= 0),
	CONSTRAINT "snapshot_planned_valid" CHECK ("session_exercise"."origin" = 'PLANNED' AND "session_exercise"."planned_working_sets" >= 1),
	CONSTRAINT "snapshot_name_valid" CHECK (length(btrim("session_exercise"."exercise_name")) > 0),
	CONSTRAINT "snapshot_reps_valid" CHECK ("session_exercise"."target_reps_min" >= 1 AND "session_exercise"."target_reps_max" >= "session_exercise"."target_reps_min"),
	CONSTRAINT "snapshot_rir_valid" CHECK ("session_exercise"."target_rir" BETWEEN 0 AND 10),
	CONSTRAINT "snapshot_rest_valid" CHECK ("session_exercise"."target_rest_seconds" >= 0),
	CONSTRAINT "snapshot_load_finite" CHECK ("session_exercise"."target_load_kg" >= 0 AND "session_exercise"."target_load_kg" < 'Infinity'::numeric),
	CONSTRAINT "snapshot_load_semantics" CHECK (("session_exercise"."load_type" <> 'BODYWEIGHT' OR "session_exercise"."target_load_kg" IS NULL) AND ("session_exercise"."load_type" <> 'ASSISTED_BODYWEIGHT' OR "session_exercise"."target_load_kg" > 0))
);
--> statement-breakpoint
ALTER TABLE "session_exercise" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_program_id" uuid,
	"source_template_id" uuid,
	"source_program_name" text NOT NULL,
	"source_template_name" text NOT NULL,
	"status" "workout_session_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planned_working_set_quota" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_quota_valid" CHECK ("workout_session"."planned_working_set_quota" >= 0),
	CONSTRAINT "session_source_names_valid" CHECK (length(btrim("workout_session"."source_program_name")) > 0 AND length(btrim("workout_session"."source_template_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_exercise" ADD CONSTRAINT "session_exercise_session_id_workout_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercise" ADD CONSTRAINT "session_exercise_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "workout_session_source_program_id_workout_program_id_fk" FOREIGN KEY ("source_program_id") REFERENCES "public"."workout_program"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "workout_session_source_template_id_workout_template_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."workout_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_session_position_unique" ON "session_exercise" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "snapshot_exercise_idx" ON "session_exercise" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_one_active_per_user" ON "workout_session" USING btree ("user_id") WHERE "workout_session"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "workout_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_source_program_idx" ON "workout_session" USING btree ("source_program_id");--> statement-breakpoint
CREATE INDEX "session_source_template_idx" ON "workout_session" USING btree ("source_template_id");
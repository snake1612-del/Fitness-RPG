CREATE TYPE "public"."exercise_load_type" AS ENUM('WEIGHTED', 'BODYWEIGHT', 'ASSISTED_BODYWEIGHT');--> statement-breakpoint
CREATE TABLE "exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"load_type" "exercise_load_type" NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_name_valid" CHECK (length(btrim("exercise"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "exercise" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "template_exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"target_working_sets" integer NOT NULL,
	"target_reps_min" integer NOT NULL,
	"target_reps_max" integer NOT NULL,
	"target_load_kg" numeric,
	"target_rir" integer,
	"target_rest_seconds" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_position_valid" CHECK ("template_exercise"."position" >= 0),
	CONSTRAINT "entry_working_sets_valid" CHECK ("template_exercise"."target_working_sets" >= 1),
	CONSTRAINT "entry_reps_valid" CHECK ("template_exercise"."target_reps_min" >= 1 AND "template_exercise"."target_reps_max" >= "template_exercise"."target_reps_min"),
	CONSTRAINT "entry_rir_valid" CHECK ("template_exercise"."target_rir" BETWEEN 0 AND 10),
	CONSTRAINT "entry_rest_valid" CHECK ("template_exercise"."target_rest_seconds" >= 0),
	CONSTRAINT "entry_load_valid" CHECK ("template_exercise"."target_load_kg" >= 0 AND "template_exercise"."target_load_kg" < 'Infinity'::numeric)
);
--> statement-breakpoint
ALTER TABLE "template_exercise" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_name_valid" CHECK (length(btrim("workout_program"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_program" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_position_valid" CHECK ("workout_template"."position" >= 0),
	CONSTRAINT "template_name_valid" CHECK (length(btrim("workout_template"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_exercise" ADD CONSTRAINT "template_exercise_template_id_workout_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workout_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_exercise" ADD CONSTRAINT "template_exercise_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_template" ADD CONSTRAINT "workout_template_program_id_workout_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."workout_program"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_owner_idx" ON "exercise" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_template_position_unique" ON "template_exercise" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "entry_exercise_idx" ON "template_exercise" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "program_user_idx" ON "workout_program" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_one_active_per_user" ON "workout_program" USING btree ("user_id") WHERE "workout_program"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "template_program_position_unique" ON "workout_template" USING btree ("program_id","position");
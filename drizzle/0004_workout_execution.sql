CREATE TYPE "public"."workout_set_type" AS ENUM('WORKING', 'WARM_UP');--> statement-breakpoint
CREATE TABLE "workout_set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "workout_set_type" DEFAULT 'WORKING' NOT NULL,
	"load_kg" numeric,
	"reps" integer,
	"rir" integer,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_position_valid" CHECK ("workout_set"."position" >= 0),
	CONSTRAINT "set_reps_valid" CHECK ("workout_set"."reps" >= 1),
	CONSTRAINT "set_rir_valid" CHECK ("workout_set"."rir" BETWEEN 0 AND 10),
	CONSTRAINT "set_load_valid" CHECK ("workout_set"."load_kg" >= 0 AND "workout_set"."load_kg" < 'Infinity'::numeric),
	CONSTRAINT "set_completed_reps_valid" CHECK ("workout_set"."completed_at" IS NULL OR "workout_set"."reps" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "workout_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "finish_timezone" text;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "finish_utc_offset_seconds" integer;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "training_day" date;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "finish_order" bigint;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workout_set" ADD CONSTRAINT "workout_set_session_exercise_id_session_exercise_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercise"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "set_exercise_position_unique" ON "workout_set" USING btree ("session_exercise_id","position");--> statement-breakpoint
CREATE INDEX "session_finished_history_idx" ON "workout_session" USING btree ("user_id","finish_order") WHERE "workout_session"."status" = 'FINISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "session_finish_order_unique" ON "workout_session" USING btree ("finish_order");--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "session_finish_order_valid" CHECK ("workout_session"."finish_order" > 0);--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "session_finish_timezone_valid" CHECK (length(btrim("workout_session"."finish_timezone")) > 0);--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "session_finish_offset_valid" CHECK ("workout_session"."finish_utc_offset_seconds" BETWEEN -86400 AND 86400);--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "session_lifecycle_valid" CHECK (
      ("workout_session"."status" = 'ACTIVE' AND "workout_session"."finished_at" IS NULL AND "workout_session"."cancelled_at" IS NULL
       AND "workout_session"."finish_timezone" IS NULL AND "workout_session"."finish_utc_offset_seconds" IS NULL AND "workout_session"."training_day" IS NULL AND "workout_session"."finish_order" IS NULL)
      OR ("workout_session"."status" = 'FINISHED' AND "workout_session"."finished_at" IS NOT NULL AND "workout_session"."cancelled_at" IS NULL
       AND "workout_session"."finish_timezone" IS NOT NULL AND "workout_session"."finish_utc_offset_seconds" IS NOT NULL AND "workout_session"."training_day" IS NOT NULL AND "workout_session"."finish_order" IS NOT NULL)
      OR ("workout_session"."status" = 'CANCELLED' AND "workout_session"."finished_at" IS NULL AND "workout_session"."cancelled_at" IS NOT NULL
       AND "workout_session"."finish_timezone" IS NULL AND "workout_session"."finish_utc_offset_seconds" IS NULL AND "workout_session"."training_day" IS NULL AND "workout_session"."finish_order" IS NULL)
    );
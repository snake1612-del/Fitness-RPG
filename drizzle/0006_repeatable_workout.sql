ALTER TABLE "session_exercise" DROP CONSTRAINT "snapshot_planned_valid";--> statement-breakpoint
ALTER TABLE "session_exercise" DROP CONSTRAINT "snapshot_reps_valid";--> statement-breakpoint
ALTER TABLE "session_exercise" ALTER COLUMN "target_reps_min" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_exercise" ALTER COLUMN "target_reps_max" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_exercise" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_exercise" ADD CONSTRAINT "snapshot_planned_valid" CHECK (("session_exercise"."origin" = 'PLANNED' AND "session_exercise"."planned_working_sets" >= 1) OR ("session_exercise"."origin" = 'SESSION_ONLY' AND "session_exercise"."planned_working_sets" = 0 AND "session_exercise"."target_reps_min" IS NULL AND "session_exercise"."target_reps_max" IS NULL AND "session_exercise"."target_load_kg" IS NULL AND "session_exercise"."target_rir" IS NULL AND "session_exercise"."target_rest_seconds" IS NULL AND "session_exercise"."notes" IS NULL));--> statement-breakpoint
ALTER TABLE "session_exercise" ADD CONSTRAINT "snapshot_reps_valid" CHECK ("session_exercise"."origin" = 'SESSION_ONLY' OR ("session_exercise"."target_reps_min" IS NOT NULL AND "session_exercise"."target_reps_max" IS NOT NULL AND "session_exercise"."target_reps_min" >= 1 AND "session_exercise"."target_reps_max" >= "session_exercise"."target_reps_min"));
--> statement-breakpoint
CREATE FUNCTION public.repeatable_exercise_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent_status public.workout_session_status; parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Session snapshot cannot be deleted' USING ERRCODE = '23514';
  END IF;
  parent_id := NEW.session_id;
  SELECT status INTO parent_status FROM public.workout_session WHERE id = parent_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.session_id, NEW.position, NEW.origin, NEW.exercise_name, NEW.load_type, NEW.planned_working_sets, NEW.target_reps_min, NEW.target_reps_max, NEW.target_load_kg, NEW.target_rir, NEW.target_rest_seconds, NEW.notes)
       IS DISTINCT FROM ROW(OLD.id, OLD.session_id, OLD.position, OLD.origin, OLD.exercise_name, OLD.load_type, OLD.planned_working_sets, OLD.target_reps_min, OLD.target_reps_max, OLD.target_load_kg, OLD.target_rir, OLD.target_rest_seconds, OLD.notes) THEN
      RAISE EXCEPTION 'Session snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    -- FK cleanup may remove a source reference without changing its snapshot.
    IF NEW.exercise_id IS DISTINCT FROM OLD.exercise_id AND NEW.exercise_id IS NOT NULL THEN
      RAISE EXCEPTION 'Exercise reference is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.skipped IS NOT DISTINCT FROM OLD.skipped THEN RETURN NEW; END IF;
  END IF;
  IF parent_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Exercise mutation requires ACTIVE Session' USING ERRCODE = '23514';
  END IF;
  IF NEW.skipped AND EXISTS (SELECT 1 FROM public.workout_set WHERE session_exercise_id = NEW.id AND completed_at IS NOT NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Completed exercise cannot be skipped' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER repeatable_exercise_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.session_exercise
FOR EACH ROW EXECUTE FUNCTION public.repeatable_exercise_integrity();
--> statement-breakpoint
CREATE FUNCTION public.repeatable_set_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE is_skipped boolean;
BEGIN
  -- Same Session lock as Finish/Cancel and Skip; re-read skip after acquiring it.
  PERFORM s.id FROM public.workout_session s JOIN public.session_exercise e ON e.session_id = s.id
    WHERE e.id = NEW.session_exercise_id FOR UPDATE OF s;
  SELECT skipped INTO is_skipped FROM public.session_exercise WHERE id = NEW.session_exercise_id;
  IF is_skipped AND NEW.completed_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Skipped exercise cannot have completed Sets' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER repeatable_set_integrity BEFORE INSERT OR UPDATE ON public.workout_set
FOR EACH ROW EXECUTE FUNCTION public.repeatable_set_integrity();
--> statement-breakpoint
CREATE FUNCTION public.repeatable_snapshot_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE stored_quota integer; snapshot_quota bigint;
BEGIN
  SELECT planned_working_set_quota INTO stored_quota FROM public.workout_session WHERE id = NEW.session_id;
  SELECT coalesce(sum(planned_working_sets), 0) INTO snapshot_quota FROM public.session_exercise
    WHERE session_id = NEW.session_id AND origin = 'PLANNED';
  IF stored_quota IS DISTINCT FROM snapshot_quota THEN
    RAISE EXCEPTION 'Snapshot quota mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER repeatable_snapshot_quota AFTER INSERT ON public.session_exercise
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.repeatable_snapshot_quota();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.repeatable_exercise_integrity(), public.repeatable_set_integrity(), public.repeatable_snapshot_quota() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.repeatable_exercise_integrity(), public.repeatable_set_integrity(), public.repeatable_snapshot_quota() FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

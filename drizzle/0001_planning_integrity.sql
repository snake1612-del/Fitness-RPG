-- Browser access is denied; planning is accessed through the trusted server role.
-- RLS is enabled in 0000. No Data API policies are intentionally granted.
REVOKE ALL ON TABLE public.exercise, public.workout_program, public.workout_template, public.template_exercise FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.exercise, public.workout_program, public.workout_template, public.template_exercise FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.planning_exercise_load_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.load_type IS DISTINCT FROM OLD.load_type THEN
    RAISE EXCEPTION 'Exercise load type is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exercise_load_immutable BEFORE UPDATE ON public.exercise
FOR EACH ROW EXECUTE FUNCTION public.planning_exercise_load_immutable();
--> statement-breakpoint
CREATE FUNCTION public.planning_entry_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE definition public.exercise%ROWTYPE; owner_id uuid;
BEGIN
  SELECT * INTO definition FROM public.exercise WHERE id = NEW.exercise_id;
  SELECT p.user_id INTO owner_id FROM public.workout_template t
  JOIN public.workout_program p ON p.id = t.program_id WHERE t.id = NEW.template_id;
  IF definition.id IS NULL OR owner_id IS NULL THEN
    RAISE EXCEPTION 'Planning reference missing' USING ERRCODE = '23503';
  END IF;
  IF definition.owner_user_id IS NOT NULL AND definition.owner_user_id <> owner_id THEN
    RAISE EXCEPTION 'Exercise ownership mismatch' USING ERRCODE = '23514';
  END IF;
  IF definition.archived AND (TG_OP = 'INSERT' OR NEW.exercise_id IS DISTINCT FROM OLD.exercise_id) THEN
    RAISE EXCEPTION 'Exercise unavailable' USING ERRCODE = '23514';
  END IF;
  IF definition.load_type = 'BODYWEIGHT' AND NEW.target_load_kg IS NOT NULL THEN
    RAISE EXCEPTION 'Bodyweight load must be absent' USING ERRCODE = '23514';
  END IF;
  IF definition.load_type = 'ASSISTED_BODYWEIGHT' AND NEW.target_load_kg IS NOT NULL AND NEW.target_load_kg <= 0 THEN
    RAISE EXCEPTION 'Assistance must be positive' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entry_integrity BEFORE INSERT OR UPDATE ON public.template_exercise
FOR EACH ROW EXECUTE FUNCTION public.planning_entry_integrity();
--> statement-breakpoint
-- Deferred validation allows Program + first Template to be inserted atomically.
CREATE FUNCTION public.planning_program_has_template() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE program_id_to_check uuid;
BEGIN
  IF TG_TABLE_NAME = 'workout_program' THEN
    program_id_to_check := NEW.id;
  ELSE
    program_id_to_check := OLD.program_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.workout_program WHERE id = program_id_to_check)
     AND NOT EXISTS (SELECT 1 FROM public.workout_template WHERE program_id = program_id_to_check) THEN
    RAISE EXCEPTION 'Program requires at least one Template' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER program_has_template AFTER INSERT ON public.workout_program
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.planning_program_has_template();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER program_retains_template AFTER DELETE OR UPDATE ON public.workout_template
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.planning_program_has_template();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.planning_exercise_load_immutable(), public.planning_entry_integrity(), public.planning_program_has_template() FROM PUBLIC;

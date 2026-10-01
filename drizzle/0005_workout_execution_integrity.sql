CREATE SEQUENCE public.workout_finish_order AS bigint;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workout_set FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.workout_finish_order FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.workout_set FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.workout_finish_order FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.workout_lifecycle_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Terminal Session cannot transition' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.finished_at, NEW.finish_timezone, NEW.finish_utc_offset_seconds, NEW.training_day, NEW.finish_order, NEW.cancelled_at)
       IS DISTINCT FROM ROW(OLD.finished_at, OLD.finish_timezone, OLD.finish_utc_offset_seconds, OLD.training_day, OLD.finish_order, OLD.cancelled_at) THEN
      RAISE EXCEPTION 'Terminal identity is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER workout_lifecycle_integrity BEFORE UPDATE ON public.workout_session
FOR EACH ROW EXECUTE FUNCTION public.workout_lifecycle_integrity();
--> statement-breakpoint
CREATE FUNCTION public.workout_set_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent_status public.workout_session_status; snapshot_load_type public.exercise_load_type; parent_exercise uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN parent_exercise := OLD.session_exercise_id;
  ELSE parent_exercise := NEW.session_exercise_id;
  END IF;
  -- Row locking also prevents a direct trusted Set write from racing Finish.
  SELECT s.status, e.load_type INTO parent_status, snapshot_load_type
    FROM public.session_exercise e JOIN public.workout_session s ON s.id = e.session_id
    WHERE e.id = parent_exercise FOR UPDATE OF s;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'Set parent missing' USING ERRCODE = '23503';
  END IF;
  IF parent_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Set requires ACTIVE Session' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.session_exercise_id IS DISTINCT FROM OLD.session_exercise_id OR NEW.position IS DISTINCT FROM OLD.position THEN
      RAISE EXCEPTION 'Set identity/order is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Deleted Set is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF snapshot_load_type = 'BODYWEIGHT' AND NEW.load_kg IS NOT NULL THEN
    RAISE EXCEPTION 'Bodyweight load must be absent' USING ERRCODE = '23514';
  END IF;
  IF snapshot_load_type = 'ASSISTED_BODYWEIGHT' AND NEW.load_kg IS NOT NULL AND NEW.load_kg <= 0 THEN
    RAISE EXCEPTION 'Assistance must be positive' USING ERRCODE = '23514';
  END IF;
  IF NEW.completed_at IS NOT NULL AND (NEW.reps IS NULL OR (snapshot_load_type <> 'BODYWEIGHT' AND NEW.load_kg IS NULL)) THEN
    RAISE EXCEPTION 'Completed Set values missing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER workout_set_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.workout_set
FOR EACH ROW EXECUTE FUNCTION public.workout_set_integrity();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.workout_lifecycle_integrity(), public.workout_set_integrity() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.workout_lifecycle_integrity(), public.workout_set_integrity() FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.workout_session, public.session_exercise FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.workout_session, public.session_exercise FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.workout_quota_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.planned_working_set_quota IS DISTINCT FROM OLD.planned_working_set_quota THEN
    RAISE EXCEPTION 'Planned quota is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER workout_quota_immutable BEFORE UPDATE ON public.workout_session
FOR EACH ROW EXECUTE FUNCTION public.workout_quota_immutable();
--> statement-breakpoint
-- Validate new aggregate at commit, after all relational snapshot rows exist.
CREATE FUNCTION public.workout_start_snapshot_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE stored_quota integer; snapshot_quota bigint;
BEGIN
  SELECT planned_working_set_quota INTO stored_quota FROM public.workout_session WHERE id = NEW.id;
  SELECT coalesce(sum(planned_working_sets), 0) INTO snapshot_quota
    FROM public.session_exercise WHERE session_id = NEW.id AND origin = 'PLANNED';
  IF stored_quota IS DISTINCT FROM snapshot_quota THEN
    RAISE EXCEPTION 'Snapshot quota mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workout_start_snapshot_quota AFTER INSERT ON public.workout_session
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.workout_start_snapshot_quota();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.workout_quota_immutable(), public.workout_start_snapshot_quota() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.workout_quota_immutable(), public.workout_start_snapshot_quota() FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "session_exercise" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workout_session" ADD COLUMN "correction_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "session_revision_valid" CHECK ("workout_session"."correction_revision" >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.workout_lifecycle_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' THEN
    IF ROW(NEW.id,NEW.user_id,NEW.status,NEW.started_at,NEW.created_at,NEW.source_program_name,NEW.source_template_name,NEW.finished_at,NEW.finish_timezone,NEW.finish_utc_offset_seconds,NEW.training_day,NEW.finish_order,NEW.cancelled_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.status,OLD.started_at,OLD.created_at,OLD.source_program_name,OLD.source_template_name,OLD.finished_at,OLD.finish_timezone,OLD.finish_utc_offset_seconds,OLD.training_day,OLD.finish_order,OLD.cancelled_at) THEN
      RAISE EXCEPTION 'Terminal identity is immutable' USING ERRCODE='23514';
    END IF;
    -- Preserve existing FK source cleanup; a correction cannot replace provenance.
    IF (NEW.source_program_id IS DISTINCT FROM OLD.source_program_id AND (NEW.source_program_id IS NOT NULL OR pg_trigger_depth() = 1)) OR
       (NEW.source_template_id IS DISTINCT FROM OLD.source_template_id AND (NEW.source_template_id IS NOT NULL OR pg_trigger_depth() = 1)) THEN
      RAISE EXCEPTION 'Terminal provenance is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.correction_revision IS DISTINCT FROM OLD.correction_revision AND
     (OLD.status <> 'FINISHED' OR NEW.correction_revision <> OLD.correction_revision + 1) THEN
    RAISE EXCEPTION 'Correction revision requires FINISHED and one increment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.repeatable_exercise_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE s public.workout_session; d public.exercise;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Session snapshot cannot be deleted' USING ERRCODE='23514'; END IF;
  SELECT * INTO s FROM public.workout_session WHERE id=NEW.session_id FOR UPDATE;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.session_id,NEW.position,NEW.origin,NEW.planned_working_sets,NEW.target_reps_min,NEW.target_reps_max,NEW.target_load_kg,NEW.target_rir,NEW.target_rest_seconds,NEW.notes,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.session_id,OLD.position,OLD.origin,OLD.planned_working_sets,OLD.target_reps_min,OLD.target_reps_max,OLD.target_load_kg,OLD.target_rir,OLD.target_rest_seconds,OLD.notes,OLD.created_at) THEN
      RAISE EXCEPTION 'Snapshot identity and prescription are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deleted exercise is immutable' USING ERRCODE='23514'; END IF;
    IF ROW(NEW.exercise_id,NEW.exercise_name,NEW.load_type) IS DISTINCT FROM ROW(OLD.exercise_id,OLD.exercise_name,OLD.load_type) THEN
      IF NEW.exercise_id IS NULL AND NEW.exercise_name=OLD.exercise_name AND NEW.load_type=OLD.load_type AND pg_trigger_depth()>1 THEN RETURN NEW; END IF;
      IF s.status <> 'FINISHED' OR OLD.origin <> 'SESSION_ONLY' THEN RAISE EXCEPTION 'Snapshot identity is immutable' USING ERRCODE='23514'; END IF;
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND (s.status <> 'FINISHED' OR OLD.origin <> 'SESSION_ONLY' OR NEW.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Only FINISHED SESSION_ONLY may be tombstoned' USING ERRCODE='23514';
    END IF;
  END IF;
  IF s.status='CANCELLED' THEN RAISE EXCEPTION 'Cancelled exercise is immutable' USING ERRCODE='23514'; END IF;
  IF s.status='ACTIVE' THEN
    IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE exercise cannot be tombstoned' USING ERRCODE='23514'; END IF;
    IF NEW.skipped AND EXISTS(SELECT 1 FROM public.workout_set WHERE session_exercise_id=NEW.id AND completed_at IS NOT NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Completed exercise cannot be skipped' USING ERRCODE='23514'; END IF;
  ELSIF s.status='FINISHED' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.origin <> 'SESSION_ONLY' OR NEW.deleted_at IS NOT NULL OR NEW.position <> (SELECT coalesce(max(position),-1)+1 FROM public.session_exercise WHERE session_id=NEW.session_id) THEN
        RAISE EXCEPTION 'New historical exercise must append SESSION_ONLY' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='INSERT' OR ROW(NEW.exercise_id,NEW.exercise_name,NEW.load_type) IS DISTINCT FROM ROW(OLD.exercise_id,OLD.exercise_name,OLD.load_type) THEN
      SELECT * INTO d FROM public.exercise WHERE id=NEW.exercise_id AND NOT archived AND (owner_user_id IS NULL OR owner_user_id=s.user_id);
      IF d.id IS NULL OR NEW.exercise_name IS DISTINCT FROM d.name OR NEW.load_type IS DISTINCT FROM d.load_type THEN RAISE EXCEPTION 'Historical identity requires permitted server snapshot' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE RAISE EXCEPTION 'Session missing' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.workout_set_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE s public.workout_session; e public.session_exercise; parent uuid;
BEGIN
  IF TG_OP='DELETE' THEN parent:=OLD.session_exercise_id; ELSE parent:=NEW.session_exercise_id; END IF;
  SELECT ws.* INTO s FROM public.workout_session ws JOIN public.session_exercise se ON se.session_id=ws.id WHERE se.id=parent FOR UPDATE OF ws;
  SELECT * INTO e FROM public.session_exercise WHERE id=parent;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Set parent missing' USING ERRCODE='23503'; END IF;
  IF s.status='CANCELLED' THEN RAISE EXCEPTION 'Cancelled Set is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF s.status<>'ACTIVE' THEN RAISE EXCEPTION 'Historical deletion requires tombstone' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deleted exercise cannot receive Sets' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.session_exercise_id,NEW.position,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.session_exercise_id,OLD.position,OLD.created_at) THEN RAISE EXCEPTION 'Set identity/order is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deleted Set is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF s.status='FINISHED' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.completed_at IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.position<>(SELECT coalesce(max(position),-1)+1 FROM public.workout_set WHERE session_exercise_id=parent) THEN RAISE EXCEPTION 'Historical Set must append completed actual' USING ERRCODE='23514'; END IF;
    ELSE
      IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'Historical completion is frozen' USING ERRCODE='23514'; END IF;
      IF OLD.completed_at IS NULL AND (NEW.deleted_at IS NULL OR ROW(NEW.type,NEW.load_kg,NEW.reps,NEW.rir) IS DISTINCT FROM ROW(OLD.type,OLD.load_kg,OLD.reps,OLD.rir)) THEN RAISE EXCEPTION 'Historical draft may only be tombstoned' USING ERRCODE='23514'; END IF;
    END IF;
    -- Final load validation is deferred, allowing identity + value correction
    -- together; tombstones do not need to match a replacement identity.
    RETURN NEW;
  END IF;
  IF e.load_type='BODYWEIGHT' AND NEW.load_kg IS NOT NULL THEN RAISE EXCEPTION 'Bodyweight load must be absent' USING ERRCODE='23514'; END IF;
  IF e.load_type='ASSISTED_BODYWEIGHT' AND NEW.load_kg IS NOT NULL AND NEW.load_kg<=0 THEN RAISE EXCEPTION 'Assistance must be positive' USING ERRCODE='23514'; END IF;
  IF NEW.completed_at IS NOT NULL AND (NEW.reps IS NULL OR (e.load_type<>'BODYWEIGHT' AND NEW.load_kg IS NULL)) THEN RAISE EXCEPTION 'Completed Set values missing' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.repeatable_set_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE state public.workout_session_status; is_skipped boolean;
BEGIN
  SELECT s.status INTO state FROM public.workout_session s JOIN public.session_exercise e ON e.session_id=s.id WHERE e.id=NEW.session_exercise_id FOR UPDATE OF s;
  SELECT skipped INTO is_skipped FROM public.session_exercise WHERE id=NEW.session_exercise_id;
  IF state='ACTIVE' AND is_skipped AND NEW.completed_at IS NOT NULL AND NEW.deleted_at IS NULL THEN RAISE EXCEPTION 'Skipped exercise cannot have completed Sets' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.correction_final_exercise() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE e public.session_exercise; parent uuid;
BEGIN
  IF TG_TABLE_NAME='workout_set' THEN parent:=NEW.session_exercise_id; ELSE parent:=NEW.id; END IF;
  SELECT * INTO e FROM public.session_exercise WHERE id=parent;
  IF NOT EXISTS(SELECT 1 FROM public.workout_session WHERE id=e.session_id AND status='FINISHED') THEN RETURN NULL; END IF;
  IF e.deleted_at IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.workout_set WHERE session_exercise_id=e.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Deleted exercise has live children' USING ERRCODE='23514'; END IF;
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM public.workout_set w WHERE w.session_exercise_id=e.id AND w.deleted_at IS NULL AND (
    (e.skipped AND w.completed_at IS NOT NULL) OR
    (e.load_type='BODYWEIGHT' AND w.load_kg IS NOT NULL) OR
    (e.load_type='ASSISTED_BODYWEIGHT' AND w.load_kg IS NOT NULL AND w.load_kg<=0) OR
    (w.completed_at IS NOT NULL AND (w.reps IS NULL OR (e.load_type<>'BODYWEIGHT' AND w.load_kg IS NULL)))
  )) THEN RAISE EXCEPTION 'Historical final Set state is invalid' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER correction_final_exercise AFTER INSERT OR UPDATE ON public.session_exercise DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.correction_final_exercise();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER correction_final_set AFTER INSERT OR UPDATE ON public.workout_set DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.correction_final_exercise();
--> statement-breakpoint
-- WHEN is evaluated at insertion, not commit: pre-Finish empty session-only
-- snapshots retain ACTIVE semantics even when Finish occurs in that transaction.
CREATE FUNCTION public.correction_parent_finished(parent uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT 1 FROM public.workout_session WHERE id=parent AND status='FINISHED') $$;
--> statement-breakpoint
CREATE FUNCTION public.correction_new_exercise_actual() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.workout_set WHERE session_exercise_id=NEW.id AND completed_at IS NOT NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'New historical exercise requires completed actual Set' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER correction_new_exercise_actual AFTER INSERT ON public.session_exercise DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(public.correction_parent_finished(NEW.session_id)) EXECUTE FUNCTION public.correction_new_exercise_actual();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.correction_final_exercise(), public.correction_parent_finished(uuid), public.correction_new_exercise_actual() FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE client_role text; BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.correction_final_exercise(), public.correction_parent_finished(uuid), public.correction_new_exercise_actual() FROM %I',client_role);
    END IF;
  END LOOP;
END $$;

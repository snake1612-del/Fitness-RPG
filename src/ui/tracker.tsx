"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Exercise,
  Program,
  ProgramPlan,
} from "@/domain/training/planning";
import type { WorkoutDetail, WorkoutSession } from "@/domain/training/workout";
import { api, ApiError, draftIdentity, type JsonDates } from "./api";
import { Planning } from "./planning";
import { SetEditor, loadLabel } from "./set-editor";
import { CorrectionEditor } from "./correction-editor";
import { PreviousPerformanceView } from "./previous-performance";
import type { PreviousPerformances } from "@/domain/training/previous-performance";
import { ProgressScreen } from "./progress";
import { CharacterScreen } from "./character";

export type Screen =
  "home" | "login" | "setup" | "workout" | "history" | "progress" | "character";
type Detail = JsonDates<WorkoutDetail>;
type Data = {
  userId: string;
  plan: ProgramPlan | null;
  programs: Program[];
  exercises: Exercise[];
  active: Detail | null;
  previous: PreviousPerformances | null;
  history: JsonDates<WorkoutSession>[];
  detail: Detail | null;
  next:
    | { kind: "NEXT"; template: { id: string; name: string } | null }
    | { kind: "RESUME"; session: Detail }
    | null;
};
export function Tracker({
  screen,
  sessionId,
}: {
  screen: Screen;
  sessionId?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<"finish" | "cancel" | null>(
    null,
  );
  const load = useCallback(async () => {
    const identity = await api<{ userId: string }>("/api/foundation/me");
    if (screen === "login") {
      router.replace("/");
      return;
    }
    const [plan, active, programs, exercises, history, detail, next] =
      await Promise.all([
        screen === "progress" || screen === "character"
          ? Promise.resolve(null)
          : api<ProgramPlan | null>("/api/programs/active"),
        screen === "progress" || screen === "character"
          ? Promise.resolve(null)
          : api<Detail | null>("/api/sessions/active"),
        screen === "setup"
          ? api<Program[]>("/api/programs")
          : Promise.resolve([]),
        screen === "setup" || screen === "workout" || !!sessionId
          ? api<Exercise[]>("/api/exercises")
          : Promise.resolve([]),
        screen === "history"
          ? api<JsonDates<WorkoutSession>[]>("/api/sessions")
          : Promise.resolve([]),
        sessionId
          ? api<Detail>(`/api/sessions/${sessionId}`)
          : Promise.resolve(null),
        screen === "home"
          ? api<Data["next"]>("/api/sessions/next")
          : Promise.resolve(null),
      ]);
    const previous =
      screen === "workout" && active
        ? await api<PreviousPerformances>(
            `/api/sessions/${active.id}/previous-performance`,
          ).catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 401) throw error;
            return null;
          })
        : {};
    if (mounted.current)
      setData({
        userId: identity.userId,
        plan,
        active,
        previous,
        programs,
        exercises,
        history,
        detail,
        next,
      });
  }, [router, screen, sessionId]);
  const handleError = useCallback(
    (value: unknown) => {
      if (!mounted.current) return;
      if (value instanceof ApiError && value.status === 401) {
        setData(null);
        router.replace("/login");
        if (screen !== "login") setError("Please sign in again.");
      } else
        setError(
          value instanceof Error ? value.message : "Something went wrong.",
        );
    },
    [router, screen],
  );
  useEffect(() => {
    mounted.current = true;
    void load()
      .catch(handleError)
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [load, handleError]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      return true;
    } catch (value) {
      handleError(value);
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const mutate = (path: string, method = "GET", body?: unknown) =>
    run(async () => {
      await api(path, method, body);
      if (method === "DELETE" && data?.active) {
        for (const exercise of data.active.exercises) {
          const key = `fitness-rpg:draft:${data.userId}:${data.active.id}:${exercise.id}`;
          if (path === `/api/sets/${sessionStorage.getItem(key)}`)
            sessionStorage.removeItem(key);
        }
      }
      await load();
      setNotice("Saved.");
    });
  async function addDraft(exerciseId: string) {
    if (!data?.active) return;
    await run(async () => {
      const pending = draftIdentity(data.userId, data.active!.id, exerciseId);
      const known = data
        .active!.exercises.find((exercise) => exercise.id === exerciseId)
        ?.sets.some((set) => set.id === pending.id);
      if (!known)
        await api(`/api/session-exercises/${exerciseId}/sets`, "POST", {
          id: pending.id,
        });
      await load();
      sessionStorage.removeItem(pending.key);
      setNotice(
        known ? "The previous draft was already saved." : "Draft saved.",
      );
    });
  }
  async function endWorkout(action: "finish" | "cancel") {
    if (!data?.active) return;
    const id = data.active.id;
    await run(async () => {
      let saved: Detail;
      try {
        saved = await api<Detail>(
          `/api/sessions/${id}/${action}`,
          "POST",
          action === "finish"
            ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
            : undefined,
        );
      } catch (value) {
        if (
          action !== "finish" ||
          !(value instanceof ApiError) ||
          value.status !== 0
        )
          throw value;
        try {
          saved = await api<Detail>(`/api/sessions/${id}`);
        } catch {
          throw value;
        }
      }
      setConfirmation(null);
      if (saved.status === "FINISHED") router.push(`/history/${id}`);
      else {
        await load();
        setNotice("Workout cancelled. This attempt is not completed History.");
      }
    });
  }
  const active =
    data?.next?.kind === "RESUME" ? data.next.session : data?.active;
  const plan = data?.plan;
  const nextTemplate = data?.next?.kind === "NEXT" ? data.next.template : null;
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="brand">
          FITNESS <span>RPG</span>
        </Link>
        {data && (
          <button
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("/api/auth/logout", "POST");
                sessionStorage.clear();
                setData(null);
                router.replace("/login");
              })
            }
          >
            Log out
          </button>
        )}
      </header>
      <main id="main">
        {error && (
          <div className="feedback error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="feedback success" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <p role="status" className="save-status">
            Saving…
          </p>
        )}
        {loading ? (
          <p role="status">Loading your saved state…</p>
        ) : screen === "login" ? (
          <section className="login card">
            <p className="eyebrow">YOUR TRAINING, SAVED</p>
            <h1>Welcome back.</h1>
            <p className="lede">Sign in to your training space.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const fields = new FormData(form);
                void run(async () => {
                  try {
                    await api("/api/auth/login", "POST", {
                      email: fields.get("email"),
                      password: fields.get("password"),
                    });
                  } catch (value) {
                    if (value instanceof ApiError && value.status === 401)
                      throw new ApiError(
                        400,
                        "Email or password was not accepted.",
                      );
                    throw value;
                  }
                  form.reset();
                  router.replace("/");
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button>Sign in</button>
              </fieldset>
            </form>
            <p className="hint">
              Use your pilot account. Account registration and password recovery
              are managed by the pilot administrator.
            </p>
          </section>
        ) : !data ? (
          <section className="card">
            <h1>Could not load your training</h1>
            <button disabled={busy} onClick={() => void run(load)}>
              Try again
            </button>
          </section>
        ) : (
          <>
            {screen !== "progress" && screen !== "character" && (
              <div className="page-tools">
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await load();
                      setNotice("Saved state refreshed.");
                    })
                  }
                >
                  Refresh saved state
                </button>
              </div>
            )}
            {screen === "home" && (
              <>
                <p className="eyebrow">READY WHEN YOU ARE</p>
                <h1>Make this set count.</h1>
                <p className="lede">A focused space for your next workout.</p>
                <section className="card hero">
                  <span className="badge">
                    {active ? "In progress" : "Your training"}
                  </span>
                  <h2>
                    {active?.sourceTemplateName ??
                      plan?.name ??
                      "Your first workout starts here"}
                  </h2>
                  {active ? (
                    <>
                      <p>Your saved workout is ready to resume.</p>
                      <Link className="button" href="/workout">
                        Resume Workout
                      </Link>
                    </>
                  ) : plan ? (
                    <>
                      <p>
                        Active Program: <strong>{plan.name}</strong>
                      </p>
                      <h3>
                        Next Workout: {nextTemplate?.name ?? "No templates yet"}
                      </h3>
                      <button
                        disabled={busy || !nextTemplate}
                        onClick={() =>
                          void run(async () => {
                            await api("/api/sessions/start", "POST", {
                              templateId: nextTemplate?.id,
                            });
                            router.push("/workout");
                          })
                        }
                      >
                        Start Workout
                      </button>
                      <Link href="/setup">Manage program & exercises</Link>
                    </>
                  ) : (
                    <>
                      <p>
                        Create your exercises and first template. No workout
                        data is generated until you start.
                      </p>
                      <Link className="button" href="/setup">
                        Set up first workout
                      </Link>
                    </>
                  )}
                </section>
                <Link className="card history-link" href="/history">
                  <strong>Saved History</strong>
                  <span>Your finished workouts →</span>
                </Link>
              </>
            )}
            {screen === "setup" && (
              <Planning
                exercises={data.exercises}
                programs={data.programs}
                plan={data.plan}
                busy={busy}
                mutate={mutate}
              />
            )}
            {screen === "workout" &&
              (active ? (
                <>
                  <p className="eyebrow">ACTIVE WORKOUT</p>
                  <h1>{active.sourceTemplateName}</h1>
                  <p className="lede">
                    {active.sourceProgramName} · Started{" "}
                    {new Date(active.startedAt).toLocaleString()}
                  </p>
                  {active.exercises.map((exercise) => (
                    <section className="card exercise" key={exercise.id}>
                      <h2>{exercise.exerciseName}</h2>
                      {exercise.origin === "SESSION_ONLY" && (
                        <p className="badge">
                          Session-only · no planned targets
                        </p>
                      )}
                      {exercise.skipped && <p className="badge">Skipped</p>}
                      {exercise.origin === "PLANNED" && (
                        <div className="planned">
                          <strong>Planned targets</strong>
                          <p>
                            {exercise.plannedWorkingSets} working sets ·{" "}
                            {exercise.targetRepsMin}–{exercise.targetRepsMax}{" "}
                            reps
                          </p>
                          {exercise.targetLoadKg !== null && (
                            <p>
                              {loadLabel(exercise.loadType)}:{" "}
                              {exercise.targetLoadKg}
                            </p>
                          )}
                          {exercise.targetRir !== null && (
                            <p>Target RIR: {exercise.targetRir}</p>
                          )}
                          {exercise.targetRestSeconds !== null && (
                            <p>Rest: {exercise.targetRestSeconds}s</p>
                          )}
                          {exercise.notes && <p>{exercise.notes}</p>}
                        </div>
                      )}
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          (!exercise.skipped &&
                            exercise.sets.some((set) => set.completedAt))
                        }
                        onClick={() =>
                          void mutate(
                            `/api/session-exercises/${exercise.id}/skip`,
                            "PATCH",
                            { skipped: !exercise.skipped },
                          )
                        }
                      >
                        {exercise.skipped ? "Undo skip" : "Skip exercise"}
                      </button>
                      {!exercise.skipped &&
                        exercise.sets.some((set) => set.completedAt) && (
                          <p className="hint">
                            An exercise with completed sets cannot be skipped.
                          </p>
                        )}
                      <PreviousPerformanceView
                        previous={data.previous?.[exercise.id] ?? null}
                        unavailable={data.previous === null}
                      />
                      <h3>Actual sets</h3>
                      {exercise.sets.map((set) => (
                        <SetEditor
                          key={`${set.id}:${set.updatedAt}`}
                          set={set}
                          loadType={exercise.loadType}
                          busy={busy}
                          skipped={exercise.skipped}
                          mutate={mutate}
                        />
                      ))}
                      {!exercise.sets.length && (
                        <p className="hint">No actual sets yet.</p>
                      )}
                      <button
                        className="secondary full"
                        disabled={busy || exercise.skipped}
                        onClick={() => void addDraft(exercise.id)}
                      >
                        Add draft set
                      </button>
                    </section>
                  ))}
                  <section className="card">
                    <h2>Add exercise to this workout</h2>
                    <p className="hint">
                      Session-only. Your Program and planned targets stay saved
                      separately.
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        void mutate(
                          `/api/sessions/${active.id}/exercises`,
                          "POST",
                          { exerciseId: fields.get("exerciseId") },
                        );
                      }}
                    >
                      <fieldset
                        disabled={
                          busy ||
                          !data.exercises.some((exercise) => !exercise.archived)
                        }
                      >
                        <label>
                          Session-only exercise
                          <select
                            name="exerciseId"
                            aria-label="Session-only exercise"
                          >
                            {data.exercises
                              .filter((exercise) => !exercise.archived)
                              .map((exercise) => (
                                <option key={exercise.id} value={exercise.id}>
                                  {exercise.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button>Add exercise</button>
                      </fieldset>
                    </form>
                  </section>
                  {!active.exercises.length && (
                    <p className="card">
                      This snapshot has no planned exercises. You may finish a
                      partial workout or cancel this attempt.
                    </p>
                  )}
                  <section className="card">
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() => setConfirmation("finish")}
                      >
                        Finish Workout
                      </button>
                      <button
                        disabled={busy}
                        className="quiet danger"
                        onClick={() => setConfirmation("cancel")}
                      >
                        Cancel Workout
                      </button>
                    </div>
                  </section>
                  {confirmation && (
                    <section
                      className="card confirmation"
                      role="alertdialog"
                      aria-label={
                        confirmation === "finish"
                          ? "Finish workout"
                          : "Cancel workout"
                      }
                    >
                      <h2>
                        {confirmation === "finish"
                          ? "Finish this workout?"
                          : "Cancel this attempt?"}
                      </h2>
                      <p>
                        {confirmation === "finish"
                          ? "Partial workouts are valid. Only saved values will be kept. Unsaved edits will be discarded and drafts will remain incomplete."
                          : "This attempt will not appear in completed History."}
                      </p>
                      <div className="actions">
                        <button
                          disabled={busy}
                          className={confirmation === "cancel" ? "danger" : ""}
                          onClick={() => void endWorkout(confirmation)}
                        >
                          Confirm {confirmation}
                        </button>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => setConfirmation(null)}
                        >
                          Keep training
                        </button>
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <section className="card">
                  <h1>No active workout</h1>
                  <p>
                    Start a workout from Home or open a finished result in
                    History.
                  </p>
                  <Link className="button" href="/">
                    Go to Home
                  </Link>
                  <Link href="/history">Open History</Link>
                </section>
              ))}
            {screen === "history" &&
              (data.detail ? (
                editing ? (
                  <CorrectionEditor
                    key={`${data.detail.id}:${data.detail.correctionRevision}`}
                    session={data.detail}
                    exercises={data.exercises}
                    onCancel={() => setEditing(false)}
                    onSaved={(detail) => {
                      setData({ ...data, detail });
                      setEditing(false);
                      setNotice("Corrections saved.");
                    }}
                  />
                ) : (
                  <>
                    <SavedWorkout session={data.detail} />
                    <button onClick={() => setEditing(true)}>Edit</button>
                  </>
                )
              ) : (
                <>
                  <p className="eyebrow">SAVED TRAINING</p>
                  <h1>History</h1>
                  <p className="lede">Finished workouts, exactly as saved.</p>
                  {!data.history.length && (
                    <section className="card">
                      No finished workouts yet.
                    </section>
                  )}
                  <div className="stack">
                    {data.history.map((session) => (
                      <Link
                        key={session.id}
                        className="card history-link"
                        href={`/history/${session.id}`}
                      >
                        <strong>{session.sourceTemplateName}</strong>
                        <span>
                          {session.sourceProgramName} · {session.trainingDay}
                        </span>
                        <span className="badge">Finished</span>
                      </Link>
                    ))}
                  </div>
                </>
              ))}
          </>
        )}
        {data && screen === "progress" && <ProgressScreen />}
        {data && screen === "character" && <CharacterScreen />}
      </main>
      {data && (
        <nav className="bottom-nav" aria-label="Main navigation">
          <Link href="/" aria-current={screen === "home" ? "page" : undefined}>
            Home
          </Link>
          <Link
            href="/setup"
            aria-current={screen === "setup" ? "page" : undefined}
          >
            Program
          </Link>
          <Link
            href="/workout"
            aria-current={screen === "workout" ? "page" : undefined}
          >
            Workout
          </Link>
          <Link
            href="/history"
            aria-current={screen === "history" ? "page" : undefined}
          >
            History
          </Link>
          <Link
            href="/progress"
            aria-current={screen === "progress" ? "page" : undefined}
          >
            Progress
          </Link>
          <Link
            href="/character"
            aria-current={screen === "character" ? "page" : undefined}
          >
            Character
          </Link>
        </nav>
      )}
    </div>
  );
}
function SavedWorkout({ session }: { session: Detail }) {
  return (
    <>
      <p className="eyebrow">SAVED RESULT · FINISHED</p>
      <h1>{session.sourceTemplateName}</h1>
      <p className="lede">
        {session.sourceProgramName} · {session.trainingDay} ·{" "}
        {session.finishTimezone}
      </p>
      <p className="feedback success">
        Workout saved. This result is available after reload.
      </p>
      {session.exercises.map((exercise) => (
        <section className="card" key={exercise.id}>
          <h2>{exercise.exerciseName}</h2>
          {exercise.skipped && <p className="badge">Skipped</p>}
          {exercise.origin === "SESSION_ONLY" ? (
            <p className="badge">Session-only · no planned targets</p>
          ) : (
            <p className="planned">
              Planned: {exercise.plannedWorkingSets} working sets ·{" "}
              {exercise.targetRepsMin}–{exercise.targetRepsMax} reps
            </p>
          )}
          <h3>Actual sets</h3>
          {!exercise.sets.length && <p>No actual sets recorded.</p>}
          {exercise.sets.map((set) => (
            <div
              className={set.completedAt ? "set completed" : "set draft"}
              key={set.id}
            >
              <div className="section-heading">
                <strong>
                  Set {set.position + 1} ·{" "}
                  {set.type === "WORKING" ? "Working" : "Warm-up"}
                </strong>
                <span className="badge">
                  {set.completedAt ? "Completed" : "Draft — incomplete"}
                </span>
              </div>
              <p>
                {exercise.loadType !== "BODYWEIGHT" && (
                  <>
                    {loadLabel(exercise.loadType)}: {set.loadKg ?? "—"} ·{" "}
                  </>
                )}
                Reps: {set.reps ?? "—"} · RIR: {set.rir ?? "—"}
              </p>
            </div>
          ))}
        </section>
      ))}
      <Link className="button secondary" href="/history">
        All History
      </Link>
    </>
  );
}

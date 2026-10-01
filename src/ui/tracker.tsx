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

export type Screen = "home" | "login" | "setup" | "workout" | "history";
type Detail = JsonDates<WorkoutDetail>;
type Data = {
  userId: string;
  plan: ProgramPlan | null;
  programs: Program[];
  exercises: Exercise[];
  active: Detail | null;
  history: JsonDates<WorkoutSession>[];
  detail: Detail | null;
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
  const [template, setTemplate] = useState("");
  const [confirmation, setConfirmation] = useState<"finish" | "cancel" | null>(
    null,
  );
  const load = useCallback(async () => {
    const identity = await api<{ userId: string }>("/api/foundation/me");
    if (screen === "login") {
      router.replace("/");
      return;
    }
    const [plan, active, programs, exercises, history, detail] =
      await Promise.all([
        api<ProgramPlan | null>("/api/programs/active"),
        api<Detail | null>("/api/sessions/active"),
        screen === "setup"
          ? api<Program[]>("/api/programs")
          : Promise.resolve([]),
        screen === "setup"
          ? api<Exercise[]>("/api/exercises")
          : Promise.resolve([]),
        screen === "history"
          ? api<JsonDates<WorkoutSession>[]>("/api/sessions")
          : Promise.resolve([]),
        sessionId
          ? api<Detail>(`/api/sessions/${sessionId}`)
          : Promise.resolve(null),
      ]);
    if (mounted.current)
      setData({
        userId: identity.userId,
        plan,
        active,
        programs,
        exercises,
        history,
        detail,
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
  const active = data?.active;
  const plan = data?.plan;
  const selectedTemplate =
    plan?.templates.find((value) => value.id === template)?.id ??
    plan?.templates[0]?.id;
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
                      <label>
                        Workout template
                        <select
                          aria-label="Workout template"
                          disabled={busy}
                          value={selectedTemplate ?? ""}
                          onChange={(event) => setTemplate(event.target.value)}
                        >
                          {plan.templates.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={busy || !selectedTemplate}
                        onClick={() =>
                          void run(async () => {
                            await api("/api/sessions/start", "POST", {
                              templateId: selectedTemplate,
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
                      <div className="planned">
                        <strong>Planned targets</strong>
                        <p>
                          {exercise.plannedWorkingSets} working sets ·{" "}
                          {exercise.targetRepsMin}–{exercise.targetRepsMax} reps
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
                      <h3>Actual sets</h3>
                      {exercise.sets.map((set) => (
                        <SetEditor
                          key={`${set.id}:${set.updatedAt}`}
                          set={set}
                          loadType={exercise.loadType}
                          busy={busy}
                          mutate={mutate}
                        />
                      ))}
                      {!exercise.sets.length && (
                        <p className="hint">No actual sets yet.</p>
                      )}
                      <button
                        className="secondary full"
                        disabled={busy}
                        onClick={() => void addDraft(exercise.id)}
                      >
                        Add draft set
                      </button>
                    </section>
                  ))}
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
                <SavedWorkout session={data.detail} />
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
          <p className="planned">
            Planned: {exercise.plannedWorkingSets} working sets ·{" "}
            {exercise.targetRepsMin}–{exercise.targetRepsMax} reps
          </p>
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

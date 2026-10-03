"use client";
import { useEffect, useRef, useState } from "react";
import type { Exercise } from "@/domain/training/planning";
import type { WorkoutDetail } from "@/domain/training/workout";
import type { CorrectionCommand } from "@/domain/training/corrections";
import type { SetType } from "@/domain/training/sets";
import { api, type JsonDates } from "./api";
import { loadLabel } from "./set-editor";

type Detail = JsonDates<WorkoutDetail>;
type LocalSet = {
  id: string;
  position: number;
  type: SetType;
  load: string;
  reps: string;
  rir: string;
  draft: boolean;
  deleted: boolean;
  added: boolean;
};
type LocalExercise = {
  id: string;
  exerciseId: string | null;
  name: string;
  loadType: Exercise["loadType"];
  origin: "PLANNED" | "SESSION_ONLY";
  skipped: boolean;
  added: boolean;
  deleted: boolean;
  sets: LocalSet[];
};
function initial(session: Detail): LocalExercise[] {
  return session.exercises.map((e) => ({
    id: e.id,
    exerciseId: e.exerciseId,
    name: e.exerciseName,
    loadType: e.loadType,
    origin: e.origin,
    skipped: e.skipped,
    added: false,
    deleted: false,
    sets: e.sets.map((s) => ({
      id: s.id,
      position: s.position,
      type: s.type,
      load: s.loadKg ?? "",
      reps: s.reps?.toString() ?? "",
      rir: s.rir?.toString() ?? "",
      draft: !s.completedAt,
      deleted: false,
      added: false,
    })),
  }));
}
export function CorrectionEditor({
  session,
  exercises,
  onSaved,
  onCancel,
}: {
  session: Detail;
  exercises: Exercise[];
  onSaved: (detail: Detail) => void;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState(() => initial(session));
  const baseline = useRef(JSON.stringify(initial(session)));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(exercises[0]?.id ?? "");
  const locked = useRef(false);
  const dirty = JSON.stringify(entries) !== baseline.current;
  useEffect(() => {
    if (!dirty) return;
    // A same-URL history entry makes Back reach the guard before Next can
    // unmount this editor. Forward after a declined discard is ignored once.
    const token = crypto.randomUUID();
    window.history.pushState(
      { ...window.history.state, fitnessCorrection: token },
      "",
      window.location.href,
    );
    let traversing = false;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const navigation =
        target.closest("a") ||
        target
          .closest("button")
          ?.textContent?.match(/^(Log out|Refresh saved state)$/);
      if (
        navigation &&
        !window.confirm("Discard unsaved workout corrections?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const back = () => {
      if (traversing) {
        traversing = false;
        return;
      }
      traversing = true;
      if (window.confirm("Discard unsaved workout corrections?"))
        window.history.back();
      else window.history.forward();
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", back);
      if (window.history.state?.fitnessCorrection === token)
        window.history.back();
    };
  }, [dirty]);
  const change = (id: string, work: (entry: LocalExercise) => void) =>
    setEntries((current) => {
      const copy = structuredClone(current);
      work(copy.find((e) => e.id === id)!);
      return copy;
    });
  function values(e: LocalExercise, s: LocalSet) {
    return {
      type: s.type,
      loadKg: e.loadType === "BODYWEIGHT" || s.load === "" ? null : s.load,
      reps: s.reps === "" ? null : Number(s.reps),
      rir: s.rir === "" ? null : Number(s.rir),
    };
  }
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const c: CorrectionCommand = {
        expected_revision: session.correctionRevision,
        setEdits: [],
        setDeletions: [],
        setAdditions: [],
        exerciseEdits: [],
        exerciseDeletions: [],
        exerciseAdditions: [],
      };
      for (const e of entries) {
        const old = session.exercises.find((x) => x.id === e.id);
        if (e.deleted) {
          if (!e.added) c.exerciseDeletions.push(e.id);
          continue;
        }
        if (e.added)
          c.exerciseAdditions.push({ id: e.id, exerciseId: e.exerciseId! });
        else if (
          old &&
          (e.exerciseId !== old.exerciseId || e.skipped !== old.skipped)
        )
          c.exerciseEdits.push({
            id: e.id,
            ...(e.exerciseId !== old.exerciseId
              ? { exerciseId: e.exerciseId! }
              : {}),
            ...(e.skipped !== old.skipped ? { skipped: e.skipped } : {}),
          });
        for (const s of e.sets) {
          if (s.deleted) {
            if (!s.added) c.setDeletions.push(s.id);
            continue;
          }
          if (s.draft) continue;
          const v = values(e, s);
          if (s.added)
            c.setAdditions.push({ id: s.id, sessionExerciseId: e.id, ...v });
          else {
            const original = old!.sets.find((x) => x.id === s.id)!;
            if (
              JSON.stringify(v) !==
              JSON.stringify({
                type: original.type,
                loadKg: original.loadKg,
                reps: original.reps,
                rir: original.rir,
              })
            )
              c.setEdits.push({ id: s.id, ...v });
          }
        }
      }
      const detail = await api<Detail>(
        `/api/sessions/${session.id}/correct`,
        "POST",
        c,
      );
      baseline.current = JSON.stringify(entries);
      onSaved(detail);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save corrections.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section>
      <p className="eyebrow">Edit Finished Workout</p>
      <h1>{session.sourceTemplateName}</h1>
      <p>Changes stay here until Save. The workout remains Finished.</p>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          {entries
            .filter((e) => !e.deleted)
            .map((e) => (
              <section className="card exercise" key={e.id}>
                <h2>{e.name}</h2>
                {e.origin === "PLANNED" ? (
                  <p>Planned snapshot stays unchanged.</p>
                ) : (
                  <label>
                    Exercise identity
                    <select
                      aria-label="Exercise identity"
                      value={e.exerciseId ?? ""}
                      onChange={(event) =>
                        change(e.id, (x) => {
                          const d = exercises.find(
                            (d) => d.id === event.target.value,
                          )!;
                          x.exerciseId = d.id;
                          x.name = d.name;
                          x.loadType = d.loadType;
                        })
                      }
                    >
                      <option value={e.exerciseId ?? ""}>
                        {e.name} (saved)
                      </option>
                      {exercises
                        .filter((d) => d.id !== e.exerciseId)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  <input
                    type="checkbox"
                    disabled={e.added}
                    checked={e.skipped}
                    onChange={(event) =>
                      change(e.id, (x) => {
                        x.skipped = event.target.checked;
                      })
                    }
                  />
                  Skipped
                </label>
                <p className="hint">
                  Skipped exercises must have no completed actual Sets. Remove
                  those Sets in this Save first.
                </p>
                {e.sets
                  .filter((s) => !s.deleted)
                  .map((s) => (
                    <article
                      className="set"
                      aria-label={`Set ${s.position + 1}`}
                      key={s.id}
                    >
                      <strong>
                        {s.added
                          ? "New completed Set"
                          : `Set ${s.position + 1}`}
                      </strong>
                      {s.draft ? (
                        <p>
                          Draft — incomplete. Frozen before Finish; remove it or
                          add a new completed Set.
                        </p>
                      ) : (
                        <div className="set-inputs">
                          <label>
                            Set type
                            <select
                              aria-label="Set type"
                              value={s.type}
                              onChange={(event) =>
                                change(e.id, (x) => {
                                  x.sets.find((x) => x.id === s.id)!.type =
                                    event.target.value as SetType;
                                })
                              }
                            >
                              <option value="WORKING">Working</option>
                              <option value="WARM_UP">Warm-up</option>
                            </select>
                          </label>
                          {e.loadType !== "BODYWEIGHT" && (
                            <label>
                              {loadLabel(e.loadType)}
                              <input
                                inputMode="decimal"
                                required
                                pattern="[0-9]+([.][0-9]+)?"
                                maxLength={1000}
                                value={s.load}
                                onChange={(event) =>
                                  change(e.id, (x) => {
                                    x.sets.find((x) => x.id === s.id)!.load =
                                      event.target.value;
                                  })
                                }
                              />
                            </label>
                          )}
                          <label>
                            Reps
                            <input
                              type="number"
                              required
                              min={1}
                              max={2147483647}
                              step={1}
                              value={s.reps}
                              onChange={(event) =>
                                change(e.id, (x) => {
                                  x.sets.find((x) => x.id === s.id)!.reps =
                                    event.target.value;
                                })
                              }
                            />
                          </label>
                          <label>
                            RIR (optional)
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={1}
                              value={s.rir}
                              onChange={(event) =>
                                change(e.id, (x) => {
                                  x.sets.find((x) => x.id === s.id)!.rir =
                                    event.target.value;
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <button
                        type="button"
                        className="quiet danger"
                        onClick={() =>
                          change(e.id, (x) => {
                            x.sets.find((x) => x.id === s.id)!.deleted = true;
                          })
                        }
                      >
                        Delete Set
                      </button>
                    </article>
                  ))}
                <button
                  type="button"
                  onClick={() =>
                    change(e.id, (x) => {
                      x.sets.push({
                        id: crypto.randomUUID(),
                        position:
                          Math.max(-1, ...x.sets.map((s) => s.position)) + 1,
                        type: "WORKING",
                        load: "",
                        reps: "",
                        rir: "",
                        draft: false,
                        deleted: false,
                        added: true,
                      });
                    })
                  }
                >
                  Add Set
                </button>
                {e.origin === "SESSION_ONLY" && (
                  <button
                    type="button"
                    className="quiet danger"
                    onClick={() => {
                      if (
                        !e.sets.some((s) => !s.deleted) ||
                        window.confirm(
                          "Remove this session-only exercise and all its Sets?",
                        )
                      )
                        change(e.id, (x) => {
                          x.deleted = true;
                        });
                    }}
                  >
                    Delete Exercise
                  </button>
                )}
              </section>
            ))}
          <section className="card">
            <h2>Add forgotten Exercise</h2>
            <label>
              Exercise
              <select
                aria-label="Forgotten Exercise"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {exercises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                const d = exercises.find((e) => e.id === selected)!;
                setEntries((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    exerciseId: d.id,
                    name: d.name,
                    loadType: d.loadType,
                    origin: "SESSION_ONLY",
                    skipped: false,
                    added: true,
                    deleted: false,
                    sets: [],
                  },
                ]);
              }}
            >
              Add Exercise
            </button>
            <p>
              New session-only exercises need at least one completed Set before
              Save.
            </p>
          </section>
          <button type="submit" disabled={!dirty}>
            {busy ? "Saving…" : "Save corrections"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Discard unsaved workout corrections?")
              )
                onCancel();
            }}
          >
            Cancel editing
          </button>
        </fieldset>
      </form>
    </section>
  );
}

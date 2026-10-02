"use client";
import { useState } from "react";
import type {
  Exercise,
  Program,
  ProgramPlan,
  LoadType,
  Targets,
} from "@/domain/training/planning";
import { loadLabel } from "./set-editor";

type Props = {
  exercises: Exercise[];
  programs: Program[];
  plan: ProgramPlan | null;
  busy: boolean;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
};
export function Planning({ exercises, programs, plan, busy, mutate }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedExercise, setSelectedExercise] = useState("");
  const [loadType, setLoadType] = useState<LoadType>("WEIGHTED");
  const available = exercises.filter((value) => !value.archived);
  const exercise =
    available.find((value) => value.id === selectedExercise) ?? available[0];
  const templateId =
    plan?.templates.find((value) => value.id === selectedTemplate)?.id ??
    plan?.templates[0]?.id;
  return (
    <>
      <h1>Prepare your workout</h1>
      <p className="lede">
        Manage your Program, templates and targets between workouts.
      </p>
      <section className="card">
        <h2>1. Exercises</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            if (
              await mutate("/api/exercises", "POST", {
                name: data.get("name"),
                loadType,
              })
            ) {
              form.reset();
              setLoadType("WEIGHTED");
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Exercise name
              <input name="name" required placeholder="e.g. Bench press" />
            </label>
            <label>
              Load type
              <select
                aria-label="Load type"
                value={loadType}
                onChange={(event) =>
                  setLoadType(event.target.value as LoadType)
                }
              >
                <option value="WEIGHTED">Weighted — external load</option>
                <option value="BODYWEIGHT">Bodyweight — reps only</option>
                <option value="ASSISTED_BODYWEIGHT">
                  Assisted bodyweight — assistance
                </option>
              </select>
            </label>
            <button>Create exercise</button>
          </fieldset>
        </form>
        <ul className="compact-list">
          {available.map((value) => (
            <li key={value.id}>
              {value.name}
              <span>
                {value.loadType === "BODYWEIGHT"
                  ? "Reps only"
                  : loadLabel(value.loadType)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>2. Program & templates</h2>
        {plan && (
          <p>
            Active Program: <strong>{plan.name}</strong>
          </p>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            if (
              await mutate("/api/programs", "POST", {
                name: data.get("programName"),
                initialTemplate: { name: data.get("templateName") },
              })
            )
              form.reset();
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Program name
              <input
                name="programName"
                required
                placeholder="e.g. My training"
              />
            </label>
            <label>
              First template name
              <input
                name="templateName"
                required
                placeholder="e.g. Workout A"
              />
            </label>
            <button>Create program</button>
          </fieldset>
        </form>
        {programs.length > 0 && (
          <div className="stack">
            {programs.map((value) => (
              <div key={value.id} className="section-heading">
                <span>
                  {value.name}{" "}
                  {value.isActive && <span className="badge">Active</span>}
                </span>
                {!value.isActive && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() =>
                      void mutate(`/api/programs/${value.id}/activate`, "POST")
                    }
                  >
                    Activate {value.name}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {plan && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              if (
                await mutate(`/api/programs/${plan.id}/templates`, "POST", {
                  name: data.get("name"),
                })
              )
                form.reset();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Additional template name
                <input name="name" required />
              </label>
              <button className="secondary">Add template</button>
            </fieldset>
          </form>
        )}
      </section>
      {plan && (
        <section className="card">
          <h2>3. Planned targets</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!exercise || !templateId) return;
              const form = event.currentTarget;
              const data = new FormData(form);
              const optional = (key: string) =>
                data.get(key) === "" || data.get(key) === null
                  ? null
                  : Number(data.get(key));
              await mutate(`/api/templates/${templateId}/exercises`, "POST", {
                exerciseId: exercise.id,
                targetWorkingSets: Number(data.get("sets")),
                targetRepsMin: Number(data.get("min")),
                targetRepsMax: Number(data.get("max")),
                targetLoadKg:
                  exercise.loadType === "BODYWEIGHT" || !data.get("load")
                    ? null
                    : data.get("load"),
                targetRir: optional("rir"),
                targetRestSeconds: optional("rest"),
                notes: data.get("notes") || null,
              });
            }}
          >
            <fieldset disabled={busy || !exercise}>
              <label>
                Template
                <select
                  aria-label="Template"
                  value={templateId ?? ""}
                  onChange={(event) => setSelectedTemplate(event.target.value)}
                >
                  {plan.templates.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exercise
                <select
                  aria-label="Exercise"
                  value={exercise?.id ?? ""}
                  onChange={(event) => setSelectedExercise(event.target.value)}
                >
                  {available.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="input-grid">
                <label>
                  Working sets
                  <input
                    name="sets"
                    type="number"
                    min={1}
                    max={2147483647}
                    required
                    defaultValue={3}
                  />
                </label>
                <label>
                  Min reps
                  <input
                    name="min"
                    type="number"
                    min={1}
                    max={2147483647}
                    required
                    defaultValue={8}
                  />
                </label>
                <label>
                  Max reps
                  <input
                    name="max"
                    type="number"
                    min={1}
                    max={2147483647}
                    required
                    defaultValue={12}
                  />
                </label>
                {exercise?.loadType !== "BODYWEIGHT" && (
                  <label>
                    {loadLabel(exercise?.loadType ?? "WEIGHTED")} (optional)
                    <input
                      key={exercise?.id}
                      name="load"
                      inputMode="decimal"
                      pattern="[0-9]+([.][0-9]+)?"
                    />
                  </label>
                )}
                <label>
                  Target RIR (optional)
                  <input name="rir" type="number" min={0} max={10} />
                </label>
                <label>
                  Rest seconds (optional)
                  <input name="rest" type="number" min={0} max={2147483647} />
                </label>
              </div>
              <label>
                Notes (optional)
                <input name="notes" />
              </label>
              <button>Add to template</button>
            </fieldset>
          </form>
          {!exercise && <p>Create your first exercise above.</p>}
          {plan.templates.map((template, templateIndex) => (
            <div key={template.id} className="plan-preview">
              <h3>{template.name}</h3>
              <form
                key={`${template.id}:${template.name}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(`/api/templates/${template.id}`, "PATCH", {
                    name: new FormData(event.currentTarget).get("name"),
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <label>
                    Template name
                    <input name="name" defaultValue={template.name} required />
                  </label>
                  <button className="secondary">Save template name</button>
                </fieldset>
              </form>
              <OrderButtons
                label={template.name}
                index={templateIndex}
                items={plan.templates}
                busy={busy}
                save={(ids) =>
                  mutate(`/api/programs/${plan.id}/templates/reorder`, "POST", {
                    ids,
                  })
                }
              />
              <ol>
                {template.exercises.map((entry, entryIndex) => (
                  <li key={entry.id}>
                    <strong>{entry.exercise.name}</strong> ·{" "}
                    {entry.targetWorkingSets} working sets ·{" "}
                    {entry.targetRepsMin}–{entry.targetRepsMax} reps
                    <OrderButtons
                      label={entry.exercise.name}
                      index={entryIndex}
                      items={template.exercises}
                      busy={busy}
                      save={(ids) =>
                        mutate(
                          `/api/templates/${template.id}/exercises/reorder`,
                          "POST",
                          { ids },
                        )
                      }
                    />
                    <details>
                      <summary>Edit targets for {entry.exercise.name}</summary>
                      <TargetEditor
                        key={JSON.stringify(entry)}
                        targets={entry}
                        loadType={entry.exercise.loadType}
                        busy={busy}
                        save={(targets) =>
                          mutate(
                            `/api/template-exercises/${entry.id}`,
                            "PATCH",
                            targets,
                          )
                        }
                      />
                    </details>
                  </li>
                ))}
              </ol>
              {!template.exercises.length && <p>No exercises yet.</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function OrderButtons({
  label,
  index,
  items,
  busy,
  save,
}: {
  label: string;
  index: number;
  items: { id: string }[];
  busy: boolean;
  save: (ids: string[]) => Promise<boolean>;
}) {
  const move = (delta: number) => {
    const ids = items.map((item) => item.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void save(ids);
  };
  return (
    <div className="actions">
      <button
        type="button"
        className="quiet"
        disabled={busy || index === 0}
        aria-label={`Move ${label} up`}
        onClick={() => move(-1)}
      >
        Move up
      </button>
      <button
        type="button"
        className="quiet"
        disabled={busy || index === items.length - 1}
        aria-label={`Move ${label} down`}
        onClick={() => move(1)}
      >
        Move down
      </button>
    </div>
  );
}

function TargetEditor({
  targets,
  loadType,
  busy,
  save,
}: {
  targets: Targets;
  loadType: LoadType;
  busy: boolean;
  save: (targets: Targets) => Promise<boolean>;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const optional = (key: string) =>
          fields.get(key) === "" ? null : Number(fields.get(key));
        void save({
          targetWorkingSets: Number(fields.get("sets")),
          targetRepsMin: Number(fields.get("min")),
          targetRepsMax: Number(fields.get("max")),
          targetLoadKg:
            loadType === "BODYWEIGHT" || !fields.get("load")
              ? null
              : String(fields.get("load")),
          targetRir: optional("rir"),
          targetRestSeconds: optional("rest"),
          notes: String(fields.get("notes") || "") || null,
        });
      }}
    >
      <fieldset disabled={busy}>
        <div className="input-grid">
          <label>
            Working sets
            <input
              name="sets"
              type="number"
              required
              min={1}
              max={2147483647}
              defaultValue={targets.targetWorkingSets}
            />
          </label>
          <label>
            Min reps
            <input
              name="min"
              type="number"
              required
              min={1}
              max={2147483647}
              defaultValue={targets.targetRepsMin}
            />
          </label>
          <label>
            Max reps
            <input
              name="max"
              type="number"
              required
              min={1}
              max={2147483647}
              defaultValue={targets.targetRepsMax}
            />
          </label>
          {loadType !== "BODYWEIGHT" && (
            <label>
              {loadLabel(loadType)} (optional)
              <input
                name="load"
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]+)?"
                defaultValue={targets.targetLoadKg ?? ""}
              />
            </label>
          )}
          <label>
            Target RIR (optional)
            <input
              name="rir"
              type="number"
              min={0}
              max={10}
              defaultValue={targets.targetRir ?? ""}
            />
          </label>
          <label>
            Rest seconds (optional)
            <input
              name="rest"
              type="number"
              min={0}
              max={2147483647}
              defaultValue={targets.targetRestSeconds ?? ""}
            />
          </label>
        </div>
        <label>
          Notes (optional)
          <input name="notes" defaultValue={targets.notes ?? ""} />
        </label>
        <button>Save targets</button>
      </fieldset>
    </form>
  );
}

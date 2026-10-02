"use client";
import { useState } from "react";
import type { LoadType } from "@/domain/training/planning";
import type { WorkoutSet, SetType } from "@/domain/training/sets";
import type { JsonDates } from "./api";

export const loadLabel = (type: LoadType) =>
  type === "ASSISTED_BODYWEIGHT" ? "Assistance (kg)" : "External load (kg)";
type Props = {
  set: JsonDates<WorkoutSet>;
  loadType: LoadType;
  busy: boolean;
  skipped?: boolean;
  mutate: (path: string, method?: string, body?: unknown) => Promise<boolean>;
};
export function SetEditor({
  set,
  loadType,
  busy,
  skipped = false,
  mutate,
}: Props) {
  const [type, setType] = useState<SetType>(set.type);
  const [load, setLoad] = useState(set.loadKg ?? "");
  const [reps, setReps] = useState(set.reps?.toString() ?? "");
  const [rir, setRir] = useState(set.rir?.toString() ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changed =
    type !== set.type ||
    load !== (set.loadKg ?? "") ||
    reps !== (set.reps?.toString() ?? "") ||
    rir !== (set.rir?.toString() ?? "");
  return (
    <article
      className={set.completedAt ? "set completed" : "set draft"}
      aria-label={`Set ${set.position + 1}`}
    >
      <div className="section-heading">
        <strong>Set {set.position + 1}</strong>
        <span className="badge">{set.completedAt ? "Completed" : "Draft"}</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(`/api/sets/${set.id}`, "PATCH", {
            type,
            loadKg: loadType === "BODYWEIGHT" || load === "" ? null : load,
            reps: reps === "" ? null : Number(reps),
            rir: rir === "" ? null : Number(rir),
          });
        }}
      >
        <fieldset disabled={busy}>
          <div className="set-inputs">
            <label>
              Set type
              <select
                aria-label="Set type"
                value={type}
                onChange={(event) => setType(event.target.value as SetType)}
              >
                <option value="WORKING">Working</option>
                <option value="WARM_UP">Warm-up</option>
              </select>
            </label>
            {loadType !== "BODYWEIGHT" && (
              <label>
                {loadLabel(loadType)}
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]+)?"
                  maxLength={1000}
                  value={load}
                  onChange={(event) => setLoad(event.target.value)}
                  placeholder="—"
                />
              </label>
            )}
            <label>
              Reps
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={2147483647}
                step={1}
                value={reps}
                onChange={(event) => setReps(event.target.value)}
                placeholder="—"
              />
            </label>
            <label>
              RIR (optional)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={10}
                step={1}
                value={rir}
                onChange={(event) => setRir(event.target.value)}
                placeholder="—"
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="secondary" disabled={!changed}>
              Save values
            </button>
            <button
              type="button"
              disabled={changed || skipped}
              onClick={() =>
                void mutate(
                  `/api/sets/${set.id}/${set.completedAt ? "uncomplete" : "complete"}`,
                  "POST",
                )
              }
            >
              {set.completedAt ? "Uncomplete" : "Complete"}
            </button>
            <button
              type="button"
              className="quiet danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          </div>
          {changed && (
            <p className="hint">
              Unsaved changes. Save values before changing completion.
            </p>
          )}
          {!changed && !set.completedAt && (
            <p className="hint">
              Saved draft. Complete explicitly when the set is done.
            </p>
          )}
        </fieldset>
      </form>
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-label="Delete set"
          className="confirmation"
        >
          <p>Delete this erroneous set?</p>
          <div className="actions">
            <button
              disabled={busy}
              className="danger"
              onClick={() => void mutate(`/api/sets/${set.id}`, "DELETE")}
            >
              Confirm delete
            </button>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Keep set
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

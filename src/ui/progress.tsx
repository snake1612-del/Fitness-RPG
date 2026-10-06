"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  ExerciseProgress,
  ProgressRead,
  ProgressRecord,
  ProgressSet,
} from "@/domain/training/progress";
import { api, ApiError } from "./api";

function SetLine({
  set,
  type,
}: {
  set: ProgressSet;
  type: ExerciseProgress["latest"]["loadType"];
}) {
  return (
    <>
      {type === "BODYWEIGHT"
        ? "BW"
        : type === "ASSISTED_BODYWEIGHT"
          ? `Assist ${set.loadKg} kg`
          : `${set.loadKg} kg`}{" "}
      × {set.reps}
      {set.rir === null ? "" : ` · RIR ${set.rir}`}
    </>
  );
}
function RecordCard({
  label,
  record,
  unit,
}: {
  label: string;
  record: ProgressRecord | null;
  unit: string;
}) {
  return (
    <article className="card">
      <h3>{label}</h3>
      {record ? (
        <>
          <strong>
            {record.value}
            {unit}
          </strong>
          <p>
            <Link href={`/history/${record.source.sessionId}`}>
              First achieved {record.source.trainingDay}
            </Link>
          </p>
        </>
      ) : (
        <p>No eligible data</p>
      )}
    </article>
  );
}
export function ExerciseProgressView({
  progress,
}: {
  progress: ExerciseProgress;
}) {
  const type = progress.latest.loadType;
  return (
    <>
      <div className="stack">
        {type === "WEIGHTED" ? (
          <>
            <RecordCard
              label="Highest Load"
              record={progress.highestLoad}
              unit=" kg"
            />
            <RecordCard
              label="Best e1RM"
              record={progress.bestE1rm}
              unit=" kg"
            />
          </>
        ) : type === "BODYWEIGHT" ? (
          <RecordCard label="Max Reps" record={progress.maxReps} unit=" reps" />
        ) : (
          <RecordCard
            label="Lowest Assistance"
            record={progress.lowestAssistance}
            unit=" kg"
          />
        )}
      </div>
      <article className="card">
        <h3>Latest Performance</h3>
        <Link href={`/history/${progress.latest.sessionId}`}>
          {progress.latest.trainingDay}
        </Link>
        <ul className="compact-list">
          {progress.latest.sets.map((set) => (
            <li key={set.id}>
              <SetLine set={set} type={type} />
            </li>
          ))}
        </ul>
        {type === "WEIGHTED" && (
          <ul className="compact-list" aria-label="Reps at exact load">
            {progress.latestRepsAtLoad.map((value) => (
              <li key={value.loadKg}>
                Best at {value.loadKg} kg: {value.maxReps} reps
              </li>
            ))}
          </ul>
        )}
        {type !== "WEIGHTED" && <p>Working Volume: N/A</p>}
      </article>
      <article className="card">
        <h3>Recent Trend</h3>
        <p>Last {progress.recent.length} eligible occurrences · latest first</p>
        <ul className="compact-list">
          {progress.recent.map((row) => (
            <li key={row.occurrence.sessionExerciseId}>
              <Link href={`/history/${row.occurrence.sessionId}`}>
                {row.occurrence.trainingDay}
              </Link>
              <span>
                {type === "WEIGHTED"
                  ? `Best e1RM: ${row.bestE1rm === null ? "No eligible 1–10 rep Set" : `${row.bestE1rm} kg`} · Working Volume: ${row.volume} kg·reps`
                  : type === "BODYWEIGHT"
                    ? `Best Working reps: ${row.bestReps}`
                    : row.representative && (
                        <SetLine set={row.representative} type={type} />
                      )}
              </span>
            </li>
          ))}
        </ul>
      </article>
    </>
  );
}
export function ProgressScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<ProgressRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    async function read() {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timeZone)
        throw new Error(
          "Could not determine your timezone. Progress is unavailable.",
        );
      const query = new URLSearchParams({ timeZone });
      if (selected) query.set("exerciseId", selected);
      const result = await api<ProgressRead>(`/api/progress?${query}`);
      if (current) setData(result);
    }
    void read()
      .catch((value: unknown) => {
        if (!current) return;
        setData(null);
        if (value instanceof ApiError && value.status === 401)
          router.replace("/login");
        setError(
          value instanceof Error ? value.message : "Could not load Progress.",
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, refresh, router]);
  return (
    <>
      <h1>Progress</h1>
      <p>Derived from your saved Finished workouts.</p>
      <button
        disabled={loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        Refresh Progress
      </button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading Progress…</p>
      ) : (
        data && (
          <>
            <section className="card">
              <h2>Training Overview</h2>
              <p>Today: {data.today}</p>
              <dl>
                <dt>Total Finished</dt>
                <dd>{data.overview.totalFinished}</dd>
                <dt>Last 7 days</dt>
                <dd>{data.overview.last7}</dd>
                <dt>Last 30 days</dt>
                <dd>{data.overview.last30}</dd>
              </dl>
              {data.overview.totalFinished === 0 && (
                <p>No Finished workouts yet.</p>
              )}
            </section>
            <section>
              <h2>Exercise Progress</h2>
              <label>
                Search historical Exercises
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  type="search"
                />
              </label>
              <label>
                Exercise
                <select
                  aria-label="Exercise"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  <option value="">Choose an Exercise</option>
                  {selected &&
                    !data.exercises.some((e) => e.id === selected) && (
                      <option value={selected}>
                        No eligible historical data
                      </option>
                    )}
                  {data.exercises
                    .filter(
                      (e) =>
                        e.id === selected ||
                        e.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.loadType}
                        {e.archived ? " · archived" : ""}
                      </option>
                    ))}
                </select>
              </label>
              {!data.exercises.length && data.overview.totalFinished > 0 && (
                <p>
                  No eligible Exercise occurrences. Only completed Working Sets
                  contribute.
                </p>
              )}
              {!selected ? (
                <p>Select an Exercise to see its Progress.</p>
              ) : data.selected ? (
                <ExerciseProgressView progress={data.selected} />
              ) : (
                <p>
                  No eligible data for this Exercise. A Finished correction may
                  have removed or reassigned its performance.
                </p>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}

import type { PreviousPerformance } from "@/domain/training/previous-performance";

export function PreviousPerformanceView({
  previous,
  unavailable,
}: {
  previous: PreviousPerformance | null;
  unavailable: boolean;
}) {
  return (
    <aside className="previous-performance" aria-label="Previous performance">
      {unavailable ? (
        <p>Previous performance unavailable. You can keep logging.</p>
      ) : !previous ? (
        <p>No previous performance</p>
      ) : (
        <>
          <p>
            <strong>
              Previous ·{" "}
              {new Intl.DateTimeFormat("en", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(previous.trainingDay + "T00:00:00Z"))}
            </strong>
          </p>
          <ul>
            {previous.sets.map((set) => (
              <li key={set.id}>
                {previous.loadType === "BODYWEIGHT"
                  ? "BW"
                  : previous.loadType === "ASSISTED_BODYWEIGHT"
                    ? `Assist ${set.loadKg} kg`
                    : `${set.loadKg} kg`}{" "}
                × {set.reps}
                {set.rir !== null ? ` · RIR ${set.rir}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

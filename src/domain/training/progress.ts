import { decimalKg, invalid, type LoadType } from "./planning";
import { finishContext, finishTimezone } from "./sets";

export type ProgressSet = {
  id: string;
  position: number;
  loadKg: string | null;
  reps: number;
  rir: number | null;
};
export type Occurrence = {
  sessionId: string;
  sessionExerciseId: string;
  trainingDay: string;
  finishOrder: string;
  position: number;
  loadType: LoadType;
  sets: ProgressSet[];
};
export type ProgressSource = {
  sessionId: string;
  sessionExerciseId: string;
  trainingDay: string;
  setId: string;
};
export type ProgressRecord = { value: string; source: ProgressSource };
export type ExerciseProgress = {
  latest: Occurrence;
  highestLoad: ProgressRecord | null;
  bestE1rm: ProgressRecord | null;
  maxReps: ProgressRecord | null;
  lowestAssistance: ProgressRecord | null;
  latestRepsAtLoad: { loadKg: string; maxReps: number }[];
  recent: {
    occurrence: Occurrence;
    bestE1rm: string | null;
    volume: string | null;
    bestReps: number;
    representative: ProgressSet | null;
  }[];
};
export type ProgressOverview = {
  totalFinished: number;
  last7: number;
  last30: number;
};
export type HistoricalExercise = {
  id: string;
  name: string;
  loadType: LoadType;
  archived: boolean;
};
export type ProgressRead = {
  today: string;
  overview: ProgressOverview;
  exercises: HistoricalExercise[];
  selected: ExerciseProgress | null;
};

export function progressDates(timeZone: unknown, now: Date) {
  // Some Intl implementations accept numeric offsets; Progress requires an IANA zone.
  if (
    typeof timeZone !== "string" ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)
  )
    return invalid();
  const zone = finishTimezone({ timeZone });
  const today = finishContext(zone, now).trainingDay;
  const minusDays = (days: number) => {
    // UTC is used only as a calendar arithmetic container after resolving the user's date.
    const calendar = new Date(today + "T00:00:00Z");
    calendar.setUTCDate(calendar.getUTCDate() - days);
    return calendar.toISOString().slice(0, 10);
  };
  return { today, from7: minusDays(6), from30: minusDays(29) };
}
type Decimal = { units: bigint; scale: number };
function decimal(value: string): Decimal {
  const normalized = decimalKg(value)!;
  const [whole, fraction = ""] = normalized.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}
function compare(a: Decimal, b: Decimal) {
  const scale = Math.max(a.scale, b.scale);
  const difference =
    a.units * BigInt(10) ** BigInt(scale - a.scale) -
    b.units * BigInt(10) ** BigInt(scale - b.scale);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}
function print(value: Decimal) {
  const digits = value.units.toString().padStart(value.scale + 1, "0");
  return decimalKg(
    value.scale
      ? digits.slice(0, -value.scale) + "." + digits.slice(-value.scale)
      : digits,
  )!;
}
export function e1rm(load: string, reps: number): string | null {
  if (reps < 1 || reps > 10) return null;
  const value = decimal(load);
  const numerator =
    value.units * BigInt(reps === 1 ? 30 : 30 + reps) * BigInt(10);
  const denominator = BigInt(30) * BigInt(10) ** BigInt(value.scale);
  // Positive loads: exact half-up division, compared at product precision (tenths).
  const tenths =
    (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}
export function workingVolume(sets: ProgressSet[]): string {
  let total: Decimal = { units: BigInt(0), scale: 0 };
  for (const set of sets) {
    const load = decimal(set.loadKg!);
    const scale = Math.max(total.scale, load.scale);
    total = {
      scale,
      units:
        total.units * BigInt(10) ** BigInt(scale - total.scale) +
        load.units *
          BigInt(set.reps) *
          BigInt(10) ** BigInt(scale - load.scale),
    };
  }
  return print(total);
}
export function projectExercise(input: Occurrence[]): ExerciseProgress | null {
  if (!input.length) return null;
  const history = [...input].sort((a, b) =>
    BigInt(a.finishOrder) < BigInt(b.finishOrder)
      ? -1
      : BigInt(a.finishOrder) > BigInt(b.finishOrder)
        ? 1
        : a.position - b.position,
  );
  let highestLoad: ProgressRecord | null = null,
    bestE1rm: ProgressRecord | null = null,
    maxReps: ProgressRecord | null = null,
    lowestAssistance: ProgressRecord | null = null;
  const repsAtLoad = new Map<string, number>();
  const improve = (
    previous: ProgressRecord | null,
    value: string,
    source: ProgressSource,
    lower = false,
  ) =>
    !previous ||
    compare(decimal(value), decimal(previous.value)) * (lower ? -1 : 1) > 0
      ? { value, source }
      : previous;
  for (const occurrence of history)
    for (const set of occurrence.sets) {
      const source = {
        sessionId: occurrence.sessionId,
        sessionExerciseId: occurrence.sessionExerciseId,
        trainingDay: occurrence.trainingDay,
        setId: set.id,
      };
      if (occurrence.loadType === "WEIGHTED") {
        highestLoad = improve(highestLoad, set.loadKg!, source);
        const estimated = e1rm(set.loadKg!, set.reps);
        if (estimated !== null) bestE1rm = improve(bestE1rm, estimated, source);
        const key = decimalKg(set.loadKg)!;
        repsAtLoad.set(key, Math.max(repsAtLoad.get(key) ?? 0, set.reps));
      } else if (occurrence.loadType === "BODYWEIGHT")
        maxReps = improve(maxReps, String(set.reps), source);
      else
        lowestAssistance = improve(lowestAssistance, set.loadKg!, source, true);
    }
  const latest = history.at(-1)!;
  const latestLoads = new Set(
    latest.loadType === "WEIGHTED"
      ? latest.sets.map((s) => decimalKg(s.loadKg)!)
      : [],
  );
  return {
    latest,
    highestLoad,
    bestE1rm,
    maxReps,
    lowestAssistance,
    latestRepsAtLoad: [...latestLoads].map((loadKg) => ({
      loadKg,
      maxReps: repsAtLoad.get(loadKg)!,
    })),
    recent: history
      .slice(-8)
      .reverse()
      .map((occurrence) => {
        let best: string | null = null,
          representative: ProgressSet | null = null;
        for (const set of occurrence.sets) {
          if (occurrence.loadType === "WEIGHTED") {
            const value = e1rm(set.loadKg!, set.reps);
            if (
              value !== null &&
              (best === null || compare(decimal(value), decimal(best)) > 0)
            )
              best = value;
          }
          if (
            occurrence.loadType === "ASSISTED_BODYWEIGHT" &&
            (!representative ||
              compare(decimal(set.loadKg!), decimal(representative.loadKg!)) <
                0 ||
              (compare(
                decimal(set.loadKg!),
                decimal(representative.loadKg!),
              ) === 0 &&
                set.reps > representative.reps))
          )
            representative = set;
        }
        return {
          occurrence,
          bestE1rm: best,
          volume:
            occurrence.loadType === "WEIGHTED"
              ? workingVolume(occurrence.sets)
              : null,
          bestReps: occurrence.sets.reduce(
            (best, set) => Math.max(best, set.reps),
            0,
          ),
          representative,
        };
      }),
  };
}

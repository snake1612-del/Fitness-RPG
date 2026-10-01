import { decimalKg, id, invalid, object, type LoadType } from "./planning";

export type SetType = "WORKING" | "WARM_UP";
export type SetValues = {
  type: SetType;
  loadKg: string | null;
  reps: number | null;
  rir: number | null;
};
export type WorkoutSet = SetValues & {
  id: string;
  sessionExerciseId: string;
  position: number;
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
const keys = ["type", "loadKg", "reps", "rir"] as const;
function integer(value: unknown, min: number, max: number): number | null {
  if (value == null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return invalid();
  return value;
}
function values(value: Record<string, unknown>, loadType: LoadType): SetValues {
  const type = value.type === undefined ? "WORKING" : value.type;
  if (type !== "WORKING" && type !== "WARM_UP") return invalid();
  const loadKg = decimalKg(value.loadKg);
  if (loadType === "BODYWEIGHT" && loadKg !== null) return invalid();
  if (loadType === "ASSISTED_BODYWEIGHT" && loadKg === "0") return invalid();
  return {
    type,
    loadKg,
    reps: integer(value.reps, 1, 2_147_483_647),
    rir: integer(value.rir, 0, 10),
  };
}
export function createSetInput(input: unknown) {
  const value = object(input, ["id", ...keys]);
  return { setId: id(value.id), value };
}
export function draftValues(
  input: Record<string, unknown>,
  loadType: LoadType,
) {
  return values(input, loadType);
}
export function changeSetInput(
  input: unknown,
  current: SetValues,
  loadType: LoadType,
): SetValues {
  const patch = object(input, keys);
  if (!Object.keys(patch).length || patch.type === null) return invalid();
  return values({ ...current, ...patch }, loadType);
}
export function requireCompleted(value: SetValues, loadType: LoadType): void {
  if (
    value.reps === null ||
    (loadType !== "BODYWEIGHT" && value.loadKg === null)
  )
    return invalid();
}
export function finishTimezone(input: unknown): string {
  const value = object(input, ["timeZone"]);
  if (
    typeof value.timeZone !== "string" ||
    !value.timeZone ||
    value.timeZone.length > 100
  )
    return invalid();
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: value.timeZone,
    }).resolvedOptions().timeZone;
  } catch {
    return invalid();
  }
}
export type FinishContext = {
  finishedAt: Date;
  finishTimezone: string;
  finishUtcOffsetSeconds: number;
  trainingDay: string;
};
export function finishContext(timezone: string, now: Date): FinishContext {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  const localAsUtc = Date.UTC(
    +part("year"),
    +part("month") - 1,
    +part("day"),
    +part("hour"),
    +part("minute"),
    +part("second"),
  );
  return {
    finishedAt: now,
    finishTimezone: timezone,
    finishUtcOffsetSeconds:
      (localAsUtc - Math.floor(now.getTime() / 1000) * 1000) / 1000,
    trainingDay: `${part("year")}-${part("month")}-${part("day")}`,
  };
}

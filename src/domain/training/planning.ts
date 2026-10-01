export const loadTypes = [
  "WEIGHTED",
  "BODYWEIGHT",
  "ASSISTED_BODYWEIGHT",
] as const;
export type LoadType = (typeof loadTypes)[number];
export class PlanningError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict") {
    super(code);
    this.name = "PlanningError";
  }
}
export function invalid(): never {
  throw new PlanningError("invalid_input");
}
export function notFound(): never {
  throw new PlanningError("not_found");
}
export function object(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  return value;
}
export function id(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input,
    )
  )
    return invalid();
  return input.toLowerCase();
}
export function name(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) return invalid();
  return input.trim();
}
export function loadType(input: unknown): LoadType {
  if (!loadTypes.includes(input as LoadType)) return invalid();
  return input as LoadType;
}
function integer(input: unknown, min: number, max = 2_147_483_647): number {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < min ||
    input > max
  )
    return invalid();
  return input;
}
export function decimalKg(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (
    typeof input !== "string" ||
    input.length > 1000 ||
    !/^\d+(\.\d+)?$/.test(input)
  )
    return invalid();
  const [whole, fraction = ""] = input.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedWhole + (normalizedFraction ? "." + normalizedFraction : "");
}
export type Targets = {
  targetWorkingSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetLoadKg: string | null;
  targetRir: number | null;
  targetRestSeconds: number | null;
  notes: string | null;
};
export const targetKeys = [
  "targetWorkingSets",
  "targetRepsMin",
  "targetRepsMax",
  "targetLoadKg",
  "targetRir",
  "targetRestSeconds",
  "notes",
] as const;
export function targets(
  input: Record<string, unknown>,
  type: LoadType,
): Targets {
  const targetWorkingSets = integer(input.targetWorkingSets, 1);
  const targetRepsMin = integer(input.targetRepsMin, 1);
  const targetRepsMax = integer(input.targetRepsMax, targetRepsMin);
  const targetLoadKg = decimalKg(input.targetLoadKg);
  if (type === "BODYWEIGHT" && targetLoadKg !== null) return invalid();
  if (type === "ASSISTED_BODYWEIGHT" && targetLoadKg === "0") return invalid();
  if (
    input.notes !== undefined &&
    input.notes !== null &&
    typeof input.notes !== "string"
  )
    return invalid();
  return {
    targetWorkingSets,
    targetRepsMin,
    targetRepsMax,
    targetLoadKg,
    targetRir: input.targetRir == null ? null : integer(input.targetRir, 0, 10),
    targetRestSeconds:
      input.targetRestSeconds == null
        ? null
        : integer(input.targetRestSeconds, 0),
    notes: input.notes == null ? null : (input.notes as string),
  };
}
export function reorder(input: unknown, currentIds: string[]): string[] {
  const value = object(input, ["ids"]);
  if (!Array.isArray(value.ids)) return invalid();
  const ids = value.ids.map(id);
  if (
    ids.length !== currentIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((value) => !currentIds.includes(value))
  )
    return invalid();
  return ids;
}
export type Exercise = {
  id: string;
  ownerUserId: string | null;
  name: string;
  loadType: LoadType;
  archived: boolean;
};
export type Program = {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
};
export type Template = {
  id: string;
  programId: string;
  name: string;
  position: number;
};
export type Entry = Targets & {
  id: string;
  templateId: string;
  exerciseId: string;
  position: number;
};
export type ProgramPlan = Program & {
  templates: (Template & {
    exercises: (Entry & {
      exercise: Pick<Exercise, "id" | "name" | "loadType" | "archived">;
    })[];
  })[];
};

import { id, invalid, object, type Exercise } from "./planning";
import { draftValues, requireCompleted, type SetValues } from "./sets";
import type { WorkoutDetail } from "./workout";

export class CorrectionRevisionConflict extends Error {
  constructor() {
    super("CORRECTION_REVISION_CONFLICT");
  }
}
export type CorrectionCommand = {
  expected_revision: number;
  setEdits: ({ id: string } & SetValues)[];
  setDeletions: string[];
  setAdditions: ({ id: string; sessionExerciseId: string } & SetValues)[];
  exerciseEdits: { id: string; exerciseId?: string; skipped?: boolean }[];
  exerciseDeletions: string[];
  exerciseAdditions: { id: string; exerciseId: string }[];
};
export type CorrectionPlan = {
  command: CorrectionCommand;
  definitions: Map<string, Exercise>;
};
const valueKeys = ["type", "loadKg", "reps", "rir"];
function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) return invalid();
  return value;
}
export function correctionInput(input: unknown): CorrectionCommand {
  const v = object(input, [
    "expected_revision",
    "setEdits",
    "setDeletions",
    "setAdditions",
    "exerciseEdits",
    "exerciseDeletions",
    "exerciseAdditions",
  ]);
  if (
    typeof v.expected_revision !== "number" ||
    !Number.isInteger(v.expected_revision) ||
    v.expected_revision < 0 ||
    v.expected_revision >= 2147483647
  )
    return invalid();
  // Load semantics are validated against the resulting server-derived snapshot below.
  const values = (v: Record<string, unknown>) => draftValues(v, "WEIGHTED");
  const result: CorrectionCommand = {
    expected_revision: v.expected_revision,
    setEdits: list(v.setEdits).map((x) => {
      const v = object(x, ["id", ...valueKeys]);
      return { id: id(v.id), ...values(v) };
    }),
    setDeletions: list(v.setDeletions).map(id),
    setAdditions: list(v.setAdditions).map((x) => {
      const v = object(x, ["id", "sessionExerciseId", ...valueKeys]);
      return {
        id: id(v.id),
        sessionExerciseId: id(v.sessionExerciseId),
        ...values(v),
      };
    }),
    exerciseEdits: list(v.exerciseEdits).map((x) => {
      const v = object(x, ["id", "exerciseId", "skipped"]);
      if (v.skipped !== undefined && typeof v.skipped !== "boolean")
        return invalid();
      if (v.skipped === undefined && v.exerciseId === undefined)
        return invalid();
      return {
        id: id(v.id),
        ...(v.exerciseId === undefined ? {} : { exerciseId: id(v.exerciseId) }),
        ...(v.skipped === undefined ? {} : { skipped: v.skipped as boolean }),
      };
    }),
    exerciseDeletions: list(v.exerciseDeletions).map(id),
    exerciseAdditions: list(v.exerciseAdditions).map((x) => {
      const v = object(x, ["id", "exerciseId"]);
      return { id: id(v.id), exerciseId: id(v.exerciseId) };
    }),
  };
  for (const ids of [
    [
      ...result.setEdits.map((x) => x.id),
      ...result.setDeletions,
      ...result.setAdditions.map((x) => x.id),
    ],
    [
      ...result.exerciseEdits.map((x) => x.id),
      ...result.exerciseDeletions,
      ...result.exerciseAdditions.map((x) => x.id),
    ],
  ])
    if (new Set(ids).size !== ids.length) return invalid();
  return result;
}
export function validateCorrection(
  session: WorkoutDetail,
  plan: CorrectionPlan,
) {
  const { command: c, definitions } = plan;
  const final = structuredClone(session.exercises);
  for (const edit of c.exerciseEdits) {
    const e = final.find((x) => x.id === edit.id);
    if (!e) return invalid();
    if (edit.exerciseId) {
      if (e.origin !== "SESSION_ONLY") return invalid();
      const definition = definitions.get(edit.id)!;
      e.exerciseId = definition.id;
      e.exerciseName = definition.name;
      e.loadType = definition.loadType;
    }
    if (edit.skipped !== undefined) e.skipped = edit.skipped;
  }
  for (const deleted of c.exerciseDeletions) {
    const e = final.find((x) => x.id === deleted);
    if (!e || e.origin !== "SESSION_ONLY") return invalid();
    final.splice(final.indexOf(e), 1);
  }
  for (const add of c.exerciseAdditions) {
    if (session.exercises.some((x) => x.id === add.id)) return invalid();
    const d = definitions.get(add.id)!;
    final.push({
      id: add.id,
      sessionId: session.id,
      exerciseId: d.id,
      exerciseName: d.name,
      loadType: d.loadType,
      origin: "SESSION_ONLY",
      position: 0,
      plannedWorkingSets: 0,
      targetRepsMin: null,
      targetRepsMax: null,
      targetLoadKg: null,
      targetRir: null,
      targetRestSeconds: null,
      notes: null,
      skipped: false,
      sets: [],
    });
  }
  const liveSet = (setId: string) => {
    for (const e of final) {
      const s = e.sets.find((x) => x.id === setId);
      if (s) return { e, s };
    }
    return invalid();
  };
  for (const deleted of c.setDeletions) {
    const { e, s } = liveSet(deleted);
    e.sets.splice(e.sets.indexOf(s), 1);
  }
  for (const edit of c.setEdits) {
    const { s } = liveSet(edit.id);
    if (!s.completedAt) return invalid();
    Object.assign(s, edit);
  }
  for (const add of c.setAdditions) {
    const e = final.find((x) => x.id === add.sessionExerciseId);
    if (!e) return invalid();
    if (session.exercises.some((x) => x.sets.some((s) => s.id === add.id)))
      return invalid();
    e.sets.push({
      ...add,
      position: 0,
      completedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  for (const e of final) {
    if (e.skipped && e.sets.some((s) => s.completedAt)) return invalid();
    if (
      c.exerciseAdditions.some((x) => x.id === e.id) &&
      !e.sets.some((s) => s.completedAt)
    )
      return invalid();
    for (const s of e.sets) {
      // Untouched pre-Finish drafts are frozen; identity replacement must still
      // respect their persisted values, without converting them into facts.
      const values = draftValues(s, e.loadType);
      if (s.completedAt) requireCompleted(values, e.loadType);
    }
  }
}

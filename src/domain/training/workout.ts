import { id, object, PlanningError, type LoadType } from "./planning";
import type { WorkoutSet } from "./sets";

export type SessionStatus = "ACTIVE" | "FINISHED" | "CANCELLED";
export type SessionOrigin = "PLANNED" | "SESSION_ONLY";
export type PlannedExerciseSnapshot = {
  exerciseId: string | null;
  position: number;
  exerciseName: string;
  loadType: LoadType;
  plannedWorkingSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetLoadKg: string | null;
  targetRir: number | null;
  targetRestSeconds: number | null;
  notes: string | null;
};
export type SessionExercise = PlannedExerciseSnapshot & {
  id: string;
  sessionId: string;
  origin: SessionOrigin;
  skipped: boolean;
};
export type WorkoutSession = {
  id: string;
  userId: string;
  sourceProgramId: string | null;
  sourceTemplateId: string | null;
  sourceProgramName: string;
  sourceTemplateName: string;
  status: SessionStatus;
  startedAt: Date;
  plannedWorkingSetQuota: number;
  finishedAt: Date | null;
  finishTimezone: string | null;
  finishUtcOffsetSeconds: number | null;
  trainingDay: string | null;
  finishOrder: string | null;
  cancelledAt: Date | null;
  correctionRevision: number;
};
export type WorkoutDetail = WorkoutSession & {
  exercises: (SessionExercise & { sets: WorkoutSet[] })[];
};
export type ActiveWorkout = WorkoutDetail;
export type StartPlan = {
  sourceProgramId: string;
  sourceTemplateId: string;
  sourceProgramName: string;
  sourceTemplateName: string;
  exercises: PlannedExerciseSnapshot[];
};
export type StartResult = { session: ActiveWorkout; resumed: boolean };

export class ActiveSessionConflict extends Error {
  constructor() {
    super("Active session already exists");
    this.name = "ActiveSessionConflict";
  }
}
export function startTemplateId(input: unknown): string {
  const value = object(input, ["templateId"]);
  return id(value.templateId);
}
export function plannedQuota(exercises: PlannedExerciseSnapshot[]): number {
  let quota = 0;
  for (const entry of exercises) {
    if (
      !Number.isInteger(entry.plannedWorkingSets) ||
      entry.plannedWorkingSets < 1
    )
      throw new PlanningError("conflict");
    quota += entry.plannedWorkingSets;
    if (quota > 2_147_483_647) throw new PlanningError("conflict");
  }
  return quota;
}

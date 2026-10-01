import type {
  ActiveWorkout,
  PlannedExerciseSnapshot,
  StartPlan,
  WorkoutSession,
} from "@/domain/training/workout";

export interface WorkoutTransaction {
  findActive(): Promise<ActiveWorkout | null>;
  findStartPlan(templateId: string): Promise<StartPlan | null>;
  insertSession(plan: StartPlan, quota: number): Promise<WorkoutSession>;
  insertExercise(
    sessionId: string,
    snapshot: PlannedExerciseSnapshot,
  ): Promise<void>;
}
export interface WorkoutRepository {
  forUser<T>(
    userId: string,
    work: (tx: WorkoutTransaction) => Promise<T>,
  ): Promise<T>;
}

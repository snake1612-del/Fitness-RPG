import type { Exercise, LoadType } from "@/domain/training/planning";
import type {
  FinishContext,
  SetValues,
  WorkoutSet,
} from "@/domain/training/sets";
import type {
  SessionStatus,
  WorkoutDetail,
  WorkoutSession,
  SessionExercise,
} from "@/domain/training/workout";

export type ExerciseScope = {
  id: string;
  sessionId: string;
  status: SessionStatus;
  loadType: LoadType;
  skipped: boolean;
};
export type SetScope = {
  set: WorkoutSet;
  status: SessionStatus;
  loadType: LoadType;
  skipped: boolean;
};
export interface ExecutionTransaction {
  readSession(id: string): Promise<WorkoutDetail | null>;
  listFinished(): Promise<WorkoutSession[]>;
  findExercise(id: string): Promise<ExerciseScope | undefined>;
  findSet(id: string): Promise<SetScope | undefined>;
  availableExercise(id: string): Promise<Exercise | undefined>;
  addExercise(sessionId: string, exercise: Exercise): Promise<SessionExercise>;
  skipExercise(id: string, skipped: boolean): Promise<void>;
  createSet(
    exerciseId: string,
    id: string,
    values: SetValues,
  ): Promise<WorkoutSet>;
  changeSet(
    id: string,
    values: Partial<SetValues> & {
      completedAt?: Date | null;
      deletedAt?: Date;
    },
  ): Promise<WorkoutSet>;
  finish(id: string, context: FinishContext): Promise<void>;
  cancel(id: string, at: Date): Promise<void>;
}
export interface ExecutionRepository {
  forUser<T>(
    userId: string,
    work: (tx: ExecutionTransaction) => Promise<T>,
  ): Promise<T>;
}

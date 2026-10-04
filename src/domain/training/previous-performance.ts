import type { LoadType } from "./planning";

// Derived from the selected canonical occurrence, never persisted separately.
export type PreviousPerformance = {
  sessionId: string;
  sessionExerciseId: string;
  trainingDay: string;
  loadType: LoadType;
  sets: {
    id: string;
    position: number;
    loadKg: string | null;
    reps: number;
    rir: number | null;
  }[];
};
export type PreviousPerformances = Record<string, PreviousPerformance | null>;

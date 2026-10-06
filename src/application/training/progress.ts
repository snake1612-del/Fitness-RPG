import { id } from "@/domain/training/planning";
import {
  progressDates,
  projectExercise,
  type HistoricalExercise,
  type Occurrence,
  type ProgressOverview,
  type ProgressRead,
} from "@/domain/training/progress";
export interface ProgressRepository {
  read(
    userId: string,
    dates: ReturnType<typeof progressDates>,
    exerciseId?: string,
  ): Promise<{
    overview: ProgressOverview;
    exercises: HistoricalExercise[];
    occurrences: Occurrence[];
  }>;
}
export function createProgressApplication(
  repository: ProgressRepository,
  now: () => Date = () => new Date(),
) {
  return {
    async read(
      userId: string,
      timeZone: unknown,
      exerciseId?: string,
    ): Promise<ProgressRead> {
      const dates = progressDates(timeZone, now());
      const data = await repository.read(
        userId,
        dates,
        exerciseId === undefined ? undefined : id(exerciseId),
      );
      return {
        today: dates.today,
        overview: data.overview,
        exercises: data.exercises,
        selected: projectExercise(data.occurrences),
      };
    },
  };
}

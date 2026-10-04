import { id, notFound } from "@/domain/training/planning";
import type { PreviousPerformances } from "@/domain/training/previous-performance";

export interface PreviousPerformanceRepository {
  forActive(
    userId: string,
    sessionId: string,
  ): Promise<PreviousPerformances | null>;
}
export function createPreviousPerformanceApplication(
  repository: PreviousPerformanceRepository,
) {
  return {
    async forActive(userId: string, sessionId: string) {
      return (await repository.forActive(userId, id(sessionId))) ?? notFound();
    },
  };
}

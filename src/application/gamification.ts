import { projectGamification, type XpSession } from "@/domain/gamification/xp";
export interface GamificationRepository {
  finished(userId: string): Promise<XpSession[]>;
}
export function createGamificationApplication(
  repository: GamificationRepository,
) {
  return {
    async read(userId: string) {
      return projectGamification(await repository.finished(userId));
    },
  };
}

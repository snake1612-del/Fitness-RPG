import { notFound, PlanningError } from "@/domain/training/planning";
import {
  ActiveSessionConflict,
  plannedQuota,
  startTemplateId,
  type StartResult,
} from "@/domain/training/workout";
import type { WorkoutRepository } from "./workout-ports";

export function createWorkoutApplication(repository: WorkoutRepository) {
  return {
    next(userId: string) {
      return repository.forUser(userId, async (tx) => {
        const active = await tx.findActive();
        return active
          ? { kind: "RESUME" as const, session: active }
          : { kind: "NEXT" as const, template: await tx.findNext() };
      });
    },
    active(userId: string) {
      return repository.forUser(userId, (tx) => tx.findActive());
    },
    async start(userId: string, input: unknown): Promise<StartResult> {
      const templateId = startTemplateId(input);
      try {
        return await repository.forUser(userId, async (tx) => {
          const existing = await tx.findActive();
          if (existing) return { session: existing, resumed: true };
          const plan = (await tx.findStartPlan(templateId)) ?? notFound();
          const quota = plannedQuota(plan.exercises);
          const created = await tx.insertSession(plan, quota);
          for (const snapshot of plan.exercises)
            await tx.insertExercise(created.id, snapshot);
          const session = await tx.findActive();
          if (!session) throw new PlanningError("conflict");
          return { session, resumed: false };
        });
      } catch (error) {
        if (!(error instanceof ActiveSessionConflict)) throw error;
        // The failed transaction has rolled back; re-read the winning aggregate.
        const existing = await repository.forUser(userId, (tx) =>
          tx.findActive(),
        );
        if (!existing) throw new PlanningError("conflict");
        return { session: existing, resumed: true };
      }
    },
  };
}
export type WorkoutApplication = ReturnType<typeof createWorkoutApplication>;

import {
  id,
  notFound,
  PlanningError,
  type Exercise,
} from "@/domain/training/planning";
import {
  correctionInput,
  CorrectionRevisionConflict,
  validateCorrection,
  type CorrectionPlan,
} from "@/domain/training/corrections";
import type { WorkoutDetail } from "@/domain/training/workout";

export interface CorrectionTransaction {
  readOwnedSession(id: string): Promise<WorkoutDetail | null>;
  availableExercise(id: string): Promise<Exercise | undefined>;
  save(session: WorkoutDetail, plan: CorrectionPlan): Promise<WorkoutDetail>;
}
export interface CorrectionRepository {
  forUser<T>(
    userId: string,
    work: (tx: CorrectionTransaction) => Promise<T>,
  ): Promise<T>;
}
export function createCorrectionApplication(repository: CorrectionRepository) {
  return {
    correct(userId: string, sessionId: string, input: unknown) {
      const valueId = id(sessionId),
        command = correctionInput(input);
      return repository.forUser(userId, async (tx) => {
        const session = (await tx.readOwnedSession(valueId)) ?? notFound();
        if (session.status !== "FINISHED") throw new PlanningError("conflict");
        if (session.correctionRevision !== command.expected_revision)
          throw new CorrectionRevisionConflict();
        // Nested identifiers are resolved only within the owned aggregate.
        for (const e of [
          ...command.exerciseEdits,
          ...command.exerciseDeletions.map((id) => ({ id })),
        ])
          if (!session.exercises.some((x) => x.id === e.id)) return notFound();
        for (const s of [
          ...command.setEdits,
          ...command.setDeletions.map((id) => ({ id })),
        ])
          if (!session.exercises.some((e) => e.sets.some((x) => x.id === s.id)))
            return notFound();
        for (const s of command.setAdditions)
          if (
            !session.exercises.some((e) => e.id === s.sessionExerciseId) &&
            !command.exerciseAdditions.some((e) => e.id === s.sessionExerciseId)
          )
            return notFound();
        const definitions = new Map<string, Exercise>();
        for (const e of [
          ...command.exerciseEdits,
          ...command.exerciseAdditions,
        ])
          if (e.exerciseId)
            definitions.set(
              e.id,
              (await tx.availableExercise(e.exerciseId)) ?? notFound(),
            );
        const plan = { command, definitions };
        validateCorrection(session, plan);
        return tx.save(session, plan);
      });
    },
  };
}
export type CorrectionApplication = ReturnType<
  typeof createCorrectionApplication
>;

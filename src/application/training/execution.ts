import {
  id,
  object,
  notFound,
  PlanningError,
} from "@/domain/training/planning";
import {
  changeSetInput,
  createSetInput,
  draftValues,
  finishContext,
  finishTimezone,
  requireCompleted,
} from "@/domain/training/sets";
import type { SessionStatus } from "@/domain/training/workout";
import type {
  ExecutionRepository,
  ExecutionTransaction,
} from "./execution-ports";

function active(status: SessionStatus) {
  if (status !== "ACTIVE") throw new PlanningError("conflict");
}
async function setScope(tx: ExecutionTransaction, setId: string) {
  const scope = (await tx.findSet(setId)) ?? notFound();
  active(scope.status);
  if (scope.set.deletedAt) return notFound();
  return scope;
}
export function createExecutionApplication(
  repository: ExecutionRepository,
  now: () => Date = () => new Date(),
) {
  return {
    addExercise(userId: string, sessionId: string, input: unknown) {
      const valueId = id(sessionId);
      const exerciseId = id(object(input, ["exerciseId"]).exerciseId);
      return repository.forUser(userId, async (tx) => {
        const session = (await tx.readSession(valueId)) ?? notFound();
        active(session.status);
        const exercise = (await tx.availableExercise(exerciseId)) ?? notFound();
        return tx.addExercise(valueId, exercise);
      });
    },
    skipExercise(userId: string, exerciseId: string, input: unknown) {
      const valueId = id(exerciseId);
      const { skipped } = object(input, ["skipped"]);
      if (typeof skipped !== "boolean")
        throw new PlanningError("invalid_input");
      return repository.forUser(userId, async (tx) => {
        const scope = (await tx.findExercise(valueId)) ?? notFound();
        active(scope.status);
        const session = (await tx.readSession(scope.sessionId)) ?? notFound();
        if (
          skipped &&
          session.exercises
            .find((entry) => entry.id === valueId)
            ?.sets.some((set) => set.completedAt)
        )
          throw new PlanningError("conflict");
        await tx.skipExercise(valueId, skipped);
      });
    },
    createSet(userId: string, exerciseId: string, input: unknown) {
      const parentId = id(exerciseId),
        { setId, value } = createSetInput(input);
      return repository.forUser(userId, async (tx) => {
        const parent = (await tx.findExercise(parentId)) ?? notFound();
        active(parent.status);
        if (parent.skipped) throw new PlanningError("conflict");
        const values = draftValues(value, parent.loadType);
        const existing = await tx.findSet(setId);
        if (existing) {
          if (
            existing.set.sessionExerciseId !== parentId ||
            existing.set.deletedAt
          )
            throw new PlanningError("conflict");
          // UUID identifies the original creation. Retries never overwrite corrections.
          return existing.set;
        }
        return tx.createSet(parentId, setId, values);
      });
    },
    updateSet(userId: string, setId: string, input: unknown) {
      const valueId = id(setId);
      return repository.forUser(userId, async (tx) => {
        const scope = await setScope(tx, valueId);
        const values = changeSetInput(input, scope.set, scope.loadType);
        if (scope.set.completedAt) requireCompleted(values, scope.loadType);
        return tx.changeSet(valueId, values);
      });
    },
    completeSet(userId: string, setId: string) {
      const valueId = id(setId);
      return repository.forUser(userId, async (tx) => {
        const scope = await setScope(tx, valueId);
        requireCompleted(scope.set, scope.loadType);
        if (scope.skipped) throw new PlanningError("conflict");
        return scope.set.completedAt
          ? scope.set
          : tx.changeSet(valueId, { completedAt: now() });
      });
    },
    uncompleteSet(userId: string, setId: string) {
      const valueId = id(setId);
      return repository.forUser(userId, async (tx) => {
        const scope = await setScope(tx, valueId);
        return scope.set.completedAt
          ? tx.changeSet(valueId, { completedAt: null })
          : scope.set;
      });
    },
    deleteSet(userId: string, setId: string) {
      const valueId = id(setId);
      return repository.forUser(userId, async (tx) => {
        const scope = (await tx.findSet(valueId)) ?? notFound();
        active(scope.status);
        if (!scope.set.deletedAt)
          await tx.changeSet(valueId, { deletedAt: now() });
      });
    },
    finish(userId: string, sessionId: string, input: unknown) {
      const valueId = id(sessionId),
        timezone = finishTimezone(input);
      return repository.forUser(userId, async (tx) => {
        const session = (await tx.readSession(valueId)) ?? notFound();
        if (session.status === "FINISHED") return session;
        active(session.status);
        await tx.finish(valueId, finishContext(timezone, now()));
        return (await tx.readSession(valueId)) ?? notFound();
      });
    },
    cancel(userId: string, sessionId: string) {
      const valueId = id(sessionId);
      return repository.forUser(userId, async (tx) => {
        const session = (await tx.readSession(valueId)) ?? notFound();
        if (session.status === "CANCELLED") return session;
        active(session.status);
        await tx.cancel(valueId, now());
        return (await tx.readSession(valueId)) ?? notFound();
      });
    },
    history(userId: string) {
      return repository.forUser(userId, (tx) => tx.listFinished());
    },
    historyDetail(userId: string, sessionId: string) {
      const valueId = id(sessionId);
      return repository.forUser(userId, async (tx) => {
        const session = (await tx.readSession(valueId)) ?? notFound();
        return session.status === "FINISHED" ? session : notFound();
      });
    },
  };
}
export type ExecutionApplication = ReturnType<
  typeof createExecutionApplication
>;

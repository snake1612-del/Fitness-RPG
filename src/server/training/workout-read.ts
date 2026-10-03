import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  WorkoutSession,
  SessionStatus,
  WorkoutDetail,
} from "@/domain/training/workout";
import type { UserTransaction } from "../db/user-transaction";
import { workoutSession, sessionExercise, workoutSet } from "../db/schema";

export function sessionView(
  header: typeof workoutSession.$inferSelect,
): WorkoutSession {
  return { ...header, finishOrder: header.finishOrder?.toString() ?? null };
}
export async function readWorkout(
  tx: UserTransaction,
  userId: string,
  filter: { id?: string; status?: SessionStatus },
): Promise<WorkoutDetail | null> {
  const [header] = await tx
    .select()
    .from(workoutSession)
    .where(
      and(
        eq(workoutSession.userId, userId),
        filter.id ? eq(workoutSession.id, filter.id) : undefined,
        filter.status ? eq(workoutSession.status, filter.status) : undefined,
      ),
    );
  if (!header) return null;
  // Historical reads depend only on the saved aggregate and actual Set facts.
  const exercises = await tx
    .select()
    .from(sessionExercise)
    .where(
      and(
        eq(sessionExercise.sessionId, header.id),
        isNull(sessionExercise.deletedAt),
      ),
    )
    .orderBy(asc(sessionExercise.position));
  const sets = exercises.length
    ? await tx
        .select()
        .from(workoutSet)
        .where(
          and(
            inArray(
              workoutSet.sessionExerciseId,
              exercises.map((value) => value.id),
            ),
            isNull(workoutSet.deletedAt),
          ),
        )
        .orderBy(asc(workoutSet.position))
    : [];
  return {
    ...sessionView(header),
    exercises: exercises.map((value) => ({
      ...value,
      sets: sets.filter((set) => set.sessionExerciseId === value.id),
    })),
  };
}

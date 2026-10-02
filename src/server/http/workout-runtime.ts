import "server-only";
import { getSupabaseIdentityProvider } from "../auth/supabase";
import { getWorkoutApplication } from "../training/workout-application";
import { workoutResponse } from "./workout";

export function sessionResponse(request?: Request, next = false) {
  return workoutResponse(
    getSupabaseIdentityProvider,
    getWorkoutApplication,
    request,
    next,
  );
}

import "server-only";
import { getIdentityProvider } from "../auth/better-auth";
import { getWorkoutApplication } from "../training/workout-application";
import { workoutResponse } from "./workout";

export function sessionResponse(request?: Request, next = false) {
  return workoutResponse(
    getIdentityProvider,
    getWorkoutApplication,
    request,
    next,
  );
}

import "server-only";
import { createWorkoutApplication } from "@/application/training/workout";
import { getDatabase } from "../db/runtime";
import { createWorkoutRepository } from "./workout-repository";

export function getWorkoutApplication() {
  return createWorkoutApplication(createWorkoutRepository(getDatabase()));
}

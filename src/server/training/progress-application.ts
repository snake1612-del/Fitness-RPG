import "server-only";
import { createProgressApplication } from "@/application/training/progress";
import { getDatabase } from "../db/runtime";
import { createProgressRepository } from "./progress-repository";
export function getProgressApplication() {
  return createProgressApplication(createProgressRepository(getDatabase()));
}

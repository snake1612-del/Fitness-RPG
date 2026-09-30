import "server-only";
import { createPlanningApplication } from "@/application/training/planning";
import { getDatabase } from "../db/runtime";
import { createPlanningRepository } from "./repository";

export function getPlanningApplication() {
  return createPlanningApplication(createPlanningRepository(getDatabase()));
}

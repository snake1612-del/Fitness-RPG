import "server-only";
import { createExecutionApplication } from "@/application/training/execution";
import { getDatabase } from "../db/runtime";
import { createExecutionRepository } from "./execution-repository";
export function getExecutionApplication() {
  return createExecutionApplication(createExecutionRepository(getDatabase()));
}

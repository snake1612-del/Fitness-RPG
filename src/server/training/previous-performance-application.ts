import "server-only";
import { createPreviousPerformanceApplication } from "@/application/training/previous-performance";
import { getDatabase } from "../db/runtime";
import { createPreviousPerformanceRepository } from "./previous-performance-repository";

export function getPreviousPerformanceApplication() {
  return createPreviousPerformanceApplication(
    createPreviousPerformanceRepository(getDatabase()),
  );
}

import "server-only";
import { createCorrectionApplication } from "@/application/training/corrections";
import { getDatabase } from "../db/runtime";
import { createCorrectionRepository } from "./correction-repository";
export function getCorrectionApplication() {
  return createCorrectionApplication(createCorrectionRepository(getDatabase()));
}

import "server-only";
import { createGamificationApplication } from "@/application/gamification";
import { getDatabase } from "../db/runtime";
import { createGamificationRepository } from "./repository";
export function getGamificationApplication() {
  return createGamificationApplication(
    createGamificationRepository(getDatabase()),
  );
}

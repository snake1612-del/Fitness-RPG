import "server-only";
import type { PlanningApplication } from "@/application/training/planning";
import { getIdentityProvider } from "../auth/better-auth";
import { getPlanningApplication } from "../training/application";
import { withPlanning } from "./planning";

export function planningResponse(
  action: (
    application: PlanningApplication,
    userId: string,
  ) => Promise<unknown>,
  status = 200,
) {
  return withPlanning(
    getIdentityProvider,
    getPlanningApplication,
    action,
    status,
  );
}

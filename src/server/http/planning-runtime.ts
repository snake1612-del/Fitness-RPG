import "server-only";
import type { PlanningApplication } from "@/application/training/planning";
import { getSupabaseIdentityProvider } from "../auth/supabase";
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
    getSupabaseIdentityProvider,
    getPlanningApplication,
    action,
    status,
  );
}

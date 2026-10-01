import "server-only";
import type { ExecutionApplication } from "@/application/training/execution";
import { getSupabaseIdentityProvider } from "../auth/supabase";
import { getExecutionApplication } from "../training/execution-application";
import { withExecution } from "./execution";
export function executionResponse(
  action: (app: ExecutionApplication, userId: string) => Promise<unknown>,
  status = 200,
) {
  return withExecution(
    getSupabaseIdentityProvider,
    getExecutionApplication,
    action,
    status,
  );
}

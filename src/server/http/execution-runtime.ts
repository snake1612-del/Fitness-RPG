import "server-only";
import type { ExecutionApplication } from "@/application/training/execution";
import { getIdentityProvider } from "../auth/better-auth";
import { getExecutionApplication } from "../training/execution-application";
import { withExecution } from "./execution";
export function executionResponse(
  action: (app: ExecutionApplication, userId: string) => Promise<unknown>,
  status = 200,
) {
  return withExecution(
    getIdentityProvider,
    getExecutionApplication,
    action,
    status,
  );
}

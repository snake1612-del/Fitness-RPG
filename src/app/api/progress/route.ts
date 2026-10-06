import { getIdentityProvider } from "@/server/auth/better-auth";
import { getProgressApplication } from "@/server/training/progress-application";
import { progressResponse } from "@/server/http/progress";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return progressResponse(getIdentityProvider, getProgressApplication, request);
}

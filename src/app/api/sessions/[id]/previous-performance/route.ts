import { getIdentityProvider } from "@/server/auth/better-auth";
import { getPreviousPerformanceApplication } from "@/server/training/previous-performance-application";
import { previousPerformanceResponse } from "@/server/http/previous-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return previousPerformanceResponse(
    getIdentityProvider,
    getPreviousPerformanceApplication,
    (await context.params).id,
  );
}

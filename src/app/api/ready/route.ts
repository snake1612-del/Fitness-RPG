import { getDatabaseReadinessGateway } from "@/server/db/runtime";
import { readinessResponse } from "@/server/http/foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return readinessResponse(getDatabaseReadinessGateway);
}

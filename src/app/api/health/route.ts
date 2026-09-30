import { healthResponse } from "@/server/http/foundation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse();
}

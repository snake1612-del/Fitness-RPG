import { sessionResponse } from "@/server/http/workout-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return sessionResponse(request);
}

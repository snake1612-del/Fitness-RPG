import { executionResponse } from "@/server/http/execution-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return executionResponse((app, userId) => app.history(userId));
}

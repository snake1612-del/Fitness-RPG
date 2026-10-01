import { planningResponse } from "@/server/http/planning-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return planningResponse((app, userId) => app.activeProgram(userId));
}

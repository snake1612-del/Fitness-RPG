import { planningResponse } from "@/server/http/planning-runtime";
import { readPlanningJson } from "@/server/http/planning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return planningResponse((app, userId) => app.listExercises(userId));
}
export function POST(request: Request) {
  return planningResponse(
    async (app, userId) =>
      app.createExercise(userId, await readPlanningJson(request)),
    201,
  );
}

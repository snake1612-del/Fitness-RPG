import { executionResponse } from "@/server/http/execution-runtime";
import { readPlanningJson } from "@/server/http/planning";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return executionResponse(async (app, userId) =>
    app.finish(userId, id, await readPlanningJson(request)),
  );
}

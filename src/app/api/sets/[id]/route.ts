import { executionResponse } from "@/server/http/execution-runtime";
import { readPlanningJson } from "@/server/http/planning";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return executionResponse(async (app, userId) =>
    app.updateSet(userId, id, await readPlanningJson(request)),
  );
}
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  return executionResponse((app, userId) => app.deleteSet(userId, id), 204);
}

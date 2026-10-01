import { planningResponse } from "@/server/http/planning-runtime";
import { readPlanningJson } from "@/server/http/planning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return planningResponse(async (app, userId) =>
    app.renameTemplate(userId, id, await readPlanningJson(request)),
  );
}

import { executionResponse } from "@/server/http/execution-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  return executionResponse((app, userId) => app.completeSet(userId, id));
}

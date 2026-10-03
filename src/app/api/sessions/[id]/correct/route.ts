import { getSupabaseIdentityProvider } from "@/server/auth/supabase";
import { getCorrectionApplication } from "@/server/training/correction-application";
import { withCorrection } from "@/server/http/corrections";
import { readPlanningJson } from "@/server/http/planning";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return withCorrection(
    getSupabaseIdentityProvider,
    getCorrectionApplication,
    async (app, userId) =>
      app.correct(userId, id, await readPlanningJson(request)),
  );
}

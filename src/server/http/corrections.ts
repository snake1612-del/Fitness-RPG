import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { CorrectionApplication } from "@/application/training/corrections";
import { CorrectionRevisionConflict } from "@/domain/training/corrections";
import { PlanningError } from "@/domain/training/planning";
export async function withCorrection(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => CorrectionApplication,
  action: (app: CorrectionApplication, userId: string) => Promise<unknown>,
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json(await action(getApplication(), identity.id), {
      headers,
    });
  } catch (error) {
    if (error instanceof CorrectionRevisionConflict)
      return Response.json(
        { error: "CORRECTION_REVISION_CONFLICT" },
        { status: 409, headers },
      );
    if (error instanceof PlanningError)
      return Response.json(
        { error: error.code },
        {
          status: { invalid_input: 400, not_found: 404, conflict: 409 }[
            error.code
          ],
          headers,
        },
      );
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}

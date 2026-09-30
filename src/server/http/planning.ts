import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { PlanningApplication } from "@/application/training/planning";
import { PlanningError, invalid } from "@/domain/training/planning";

export async function readPlanningJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return invalid();
  }
}
export async function withPlanning(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => PlanningApplication,
  action: (
    application: PlanningApplication,
    userId: string,
  ) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const result = await action(getApplication(), identity.id);
    return Response.json(result, { status, headers });
  } catch (error) {
    if (error instanceof PlanningError) {
      const status = { invalid_input: 400, not_found: 404, conflict: 409 }[
        error.code
      ];
      return Response.json({ error: error.code }, { status, headers });
    }
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}

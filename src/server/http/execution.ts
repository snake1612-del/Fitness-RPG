import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { ExecutionApplication } from "@/application/training/execution";
import { PlanningError } from "@/domain/training/planning";

export async function withExecution(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => ExecutionApplication,
  action: (app: ExecutionApplication, userId: string) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const result = await action(getApplication(), identity.id);
    return status === 204
      ? new Response(null, { status, headers })
      : Response.json(result, { status, headers });
  } catch (error) {
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

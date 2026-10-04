import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { createPreviousPerformanceApplication } from "@/application/training/previous-performance";
import { PlanningError } from "@/domain/training/planning";

export async function previousPerformanceResponse(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => ReturnType<typeof createPreviousPerformanceApplication>,
  sessionId: string,
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json(
      await getApplication().forActive(identity.id, sessionId),
      { headers },
    );
  } catch (error) {
    if (error instanceof PlanningError)
      return Response.json(
        { error: error.code },
        { status: error.code === "invalid_input" ? 400 : 404, headers },
      );
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}

import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { createProgressApplication } from "@/application/training/progress";
import { PlanningError } from "@/domain/training/planning";
export async function progressResponse(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => ReturnType<typeof createProgressApplication>,
  request: Request,
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const query = new URL(request.url).searchParams;
    return Response.json(
      await getApplication().read(
        identity.id,
        query.get("timeZone"),
        query.has("exerciseId") ? query.get("exerciseId")! : undefined,
      ),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PlanningError ? error.code : "service_unavailable",
      },
      {
        status:
          error instanceof PlanningError
            ? error.code === "invalid_input"
              ? 400
              : 404
            : 503,
        headers,
      },
    );
  }
}

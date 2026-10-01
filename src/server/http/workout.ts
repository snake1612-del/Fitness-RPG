import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { WorkoutApplication } from "@/application/training/workout";
import { PlanningError } from "@/domain/training/planning";
import { readPlanningJson } from "./planning";

export async function workoutResponse(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => WorkoutApplication,
  request?: Request,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const app = getApplication();
    if (!request)
      return Response.json(await app.active(identity.id), { headers });
    const result = await app.start(
      identity.id,
      await readPlanningJson(request),
    );
    return Response.json(result, {
      status: result.resumed ? 200 : 201,
      headers,
    });
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

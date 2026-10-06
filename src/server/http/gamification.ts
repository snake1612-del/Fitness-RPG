import type { AuthIdentityProvider } from "@/application/foundation/ports";
import type { createGamificationApplication } from "@/application/gamification";
export async function gamificationResponse(
  getAuth: () => Promise<AuthIdentityProvider>,
  getApplication: () => ReturnType<typeof createGamificationApplication>,
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await (await getAuth()).currentIdentity();
    if (!identity)
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const result = await getApplication().read(identity.id);
    return Response.json(result.summary, { headers });
  } catch {
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers },
    );
  }
}

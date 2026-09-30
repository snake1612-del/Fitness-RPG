import {
  checkDatabaseReadiness,
  getApplicationHealth,
  getProtectedFoundationStatus,
} from "@/application/foundation/use-cases";
import type {
  AuthIdentityProvider,
  DatabaseReadinessPort,
} from "@/application/foundation/ports";

const privateResponse = { "Cache-Control": "no-store" };

export function healthResponse(): Response {
  return Response.json(getApplicationHealth(), { headers: privateResponse });
}

export async function readinessResponse(
  getDatabase: () => DatabaseReadinessPort,
): Promise<Response> {
  try {
    const result = await checkDatabaseReadiness(getDatabase());
    return Response.json(result, { headers: privateResponse });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: privateResponse },
    );
  }
}

export async function identityResponse(
  getAuth: () => Promise<AuthIdentityProvider>,
  getDatabase: () => DatabaseReadinessPort,
): Promise<Response> {
  try {
    const result = await getProtectedFoundationStatus(
      await getAuth(),
      getDatabase,
    );
    if (!result) {
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: privateResponse },
      );
    }
    return Response.json(result, { headers: privateResponse });
  } catch {
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers: privateResponse },
    );
  }
}

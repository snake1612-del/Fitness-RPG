import type { AuthIdentityProvider, DatabaseReadinessPort } from "./ports";

export function getApplicationHealth() {
  return { status: "ok" as const };
}

export async function checkDatabaseReadiness(database: DatabaseReadinessPort) {
  await database.check();
  return { status: "ready" as const };
}

export async function getProtectedIdentity(auth: AuthIdentityProvider) {
  return auth.currentIdentity();
}

export async function getProtectedFoundationStatus(
  auth: AuthIdentityProvider,
  getDatabase: () => DatabaseReadinessPort,
) {
  const identity = await getProtectedIdentity(auth);
  if (!identity) return null;
  await checkDatabaseReadiness(getDatabase());
  return { userId: identity.id, status: "ready" as const };
}

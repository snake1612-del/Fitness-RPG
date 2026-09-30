import type { AuthIdentityProvider } from "@/application/foundation/ports";

type ClaimsReader = {
  getClaims(): Promise<{
    data: { claims: { sub?: unknown } } | null;
    error: unknown;
  }>;
};

export function createIdentityProvider(
  auth: ClaimsReader,
): AuthIdentityProvider {
  return {
    async currentIdentity() {
      const { data, error } = await auth.getClaims();
      const subject = data?.claims.sub;
      if (error || typeof subject !== "string" || subject.length === 0) {
        return null;
      }
      return { id: subject };
    },
  };
}

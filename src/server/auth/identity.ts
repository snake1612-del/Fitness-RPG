import type { AuthIdentityProvider } from "@/application/foundation/ports";
type SessionReader = () => Promise<{ user: { id: string } } | null>;
export function createIdentityProvider(
  readSession: SessionReader,
): AuthIdentityProvider {
  return {
    async currentIdentity() {
      const session = await readSession();
      const id = session?.user.id;
      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        return null;
      return { id };
    },
  };
}

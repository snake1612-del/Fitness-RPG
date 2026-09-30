import { describe, expect, it, vi } from "vitest";
import { createIdentityProvider } from "./identity";
import { getProtectedIdentity } from "@/application/foundation/use-cases";

describe("verified Supabase identity boundary", () => {
  it("passes only the verified subject to the application layer", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: { claims: { sub: "user-123", private_metadata: "hidden" } },
      error: null,
    });
    const provider = createIdentityProvider({ getClaims });
    expect(await getProtectedIdentity(provider)).toEqual({ id: "user-123" });
    expect(getClaims).toHaveBeenCalledOnce();
  });

  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: 42 } }, error: null },
    { data: { claims: { sub: "forged" } }, error: new Error("invalid token") },
  ])("rejects absent or unverified identity", async (result) => {
    const provider = createIdentityProvider({
      getClaims: vi.fn().mockResolvedValue(result),
    });
    expect(await getProtectedIdentity(provider)).toBeNull();
  });
});

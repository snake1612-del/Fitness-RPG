import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAll: vi.fn(),
  setCookie: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: mocks.getAll, set: mocks.setCookie }),
}));
vi.mock("../config/server", () => ({
  getServerConfig: () => ({
    supabaseUrl: "https://test.supabase.co",
    supabasePublishableKey: "sb_publishable_test_key",
  }),
}));

import { getSupabaseIdentityProvider } from "./supabase";

describe("Supabase Route Handler cookie integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({
      auth: { getClaims: mocks.getClaims },
    });
    mocks.getAll.mockReturnValue([{ name: "session", value: "stored-token" }]);
  });

  it("uses the publishable key and forwards request cookies to the SSR client", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "verified-user" } },
      error: null,
    });
    const provider = await getSupabaseIdentityProvider();
    const [url, key, options] = mocks.createClient.mock.calls[0];
    expect(url).toBe("https://test.supabase.co");
    expect(key).toBe("sb_publishable_test_key");
    expect(options.cookies.getAll()).toEqual([
      { name: "session", value: "stored-token" },
    ]);
    expect(await provider.currentIdentity()).toEqual({ id: "verified-user" });
  });

  it("writes refreshed session cookies through the Route Handler cookie store", async () => {
    await getSupabaseIdentityProvider();
    const options = mocks.createClient.mock.calls[0][2];
    const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" };
    options.cookies.setAll([
      { name: "session", value: "refreshed-token", options: cookieOptions },
    ]);
    expect(mocks.setCookie).toHaveBeenCalledWith(
      "session",
      "refreshed-token",
      cookieOptions,
    );
  });
});

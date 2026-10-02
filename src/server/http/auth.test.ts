import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));
vi.mock("@/server/auth/supabase", () => ({
  getSupabaseAuthClient: async () => ({
    auth: { signInWithPassword: mocks.login, signOut: mocks.logout },
  }),
}));
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
const request = (body?: unknown, origin = "https://fitness.test") =>
  new Request("https://fitness.test/api/auth", {
    method: "POST",
    headers: { origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockResolvedValue({ error: null });
  mocks.logout.mockResolvedValue({ error: null });
});
it("actual login/logout routes use password auth and local cookie logout with no cached result", async () => {
  const result = await login(
    request({ email: " pilot@example.test ", password: "pilot-password" }),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(mocks.login).toHaveBeenCalledWith({
    email: "pilot@example.test",
    password: "pilot-password",
  });
  expect((await logout(request())).status).toBe(200);
  expect(mocks.logout).toHaveBeenCalledWith({ scope: "local" });
});
it("rejects cross-origin or missing-origin credential/logout requests before auth", async () => {
  for (const origin of ["https://attacker.test", ""]) {
    expect((await login(request({}, origin))).status).toBe(403);
    expect((await logout(request(undefined, origin))).status).toBe(403);
  }
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.logout).not.toHaveBeenCalled();
});
it("invalid inputs and rejected credentials expose controlled errors", async () => {
  for (const body of [
    null,
    { email: "x" },
    { email: "x", password: "" },
    { email: "x", password: "p", userId: "injected" },
  ])
    expect((await login(request(body))).status).toBe(400);
  mocks.login.mockResolvedValue({ error: { message: "private auth detail" } });
  const response = await login(
    request({ email: "x@example.test", password: "p" }),
  );
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "invalid_credentials" });
});
it("network/config errors and failed sign-out are safe 503s", async () => {
  mocks.login.mockResolvedValueOnce({
    error: { name: "AuthRetryableFetchError" },
  });
  expect((await login(request({ email: "x", password: "p" }))).status).toBe(
    503,
  );
  mocks.login.mockResolvedValueOnce({ error: { status: 429 } });
  expect((await login(request({ email: "x", password: "p" }))).status).toBe(
    503,
  );
  mocks.login.mockRejectedValue(new Error("secret infrastructure detail"));
  expect((await login(request({ email: "x", password: "p" }))).status).toBe(
    503,
  );
  mocks.logout.mockResolvedValue({ error: new Error("private") });
  expect((await logout(request())).status).toBe(503);
});

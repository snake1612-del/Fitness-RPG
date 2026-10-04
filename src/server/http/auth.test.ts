import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));
vi.mock("@/server/auth/better-auth", () => ({
  getAuth: () => ({
    handler: (req: Request) =>
      new URL(req.url).pathname.endsWith("sign-out")
        ? mocks.logout(req)
        : mocks.login(req),
  }),
}));
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
const request = (body?: unknown, origin = "https://fitness.test") =>
  new Request("https://fitness.test/api/auth/login", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockResolvedValue(
    new Response(null, {
      headers: { "Set-Cookie": "session=opaque; HttpOnly; SameSite=Lax" },
    }),
  );
  mocks.logout.mockResolvedValue(new Response(null));
});
it("thin routes call documented API, forward request headers/cookies and safe no-store body", async () => {
  const r = await login(
    request({ email: " pilot@example.test ", password: "test-password" }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  expect(r.headers.get("cache-control")).toBe("no-store");
  const forwarded = mocks.login.mock.calls[0][0] as Request;
  expect(new URL(forwarded.url).pathname).toBe("/api/auth/sign-in/email");
  expect(await forwarded.json()).toEqual({
    email: "pilot@example.test",
    password: "test-password",
  });
  expect((await logout(request())).status).toBe(200);
});
it("rejects cross-origin and missing-origin before auth", async () => {
  for (const origin of ["https://evil.test", ""]) {
    expect((await login(request({}, origin))).status).toBe(403);
    expect((await logout(request(undefined, origin))).status).toBe(403);
  }
  expect(mocks.login).not.toHaveBeenCalled();
});
it("rejects malformed input and authority injection", async () => {
  for (const body of [
    null,
    { email: "x" },
    { email: "x", password: "" },
    { email: "x", password: "p", userId: "forged" },
  ])
    expect((await login(request(body))).status).toBe(400);
});
it("credentials and service failures expose safe errors", async () => {
  mocks.login.mockResolvedValueOnce(new Response("private", { status: 401 }));
  const r = await login(request({ email: "x@test.invalid", password: "p" }));
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: "invalid_credentials" });
  mocks.login.mockRejectedValueOnce(new Error("private"));
  expect((await login(request({ email: "x", password: "p" }))).status).toBe(
    503,
  );
  mocks.logout.mockResolvedValueOnce(new Response(null, { status: 500 }));
  expect((await logout(request())).status).toBe(503);
});

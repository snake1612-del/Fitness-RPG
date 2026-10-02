import { afterEach, expect, it, vi } from "vitest";
import { api, draftIdentity } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("keeps exact decimal strings and uses private same-origin requests", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ loadKg: "72.50000000000000000001" }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await api("/api/sets/id", "PATCH", { loadKg: "72.50000000000000000001" }),
  ).toEqual({ loadKg: "72.50000000000000000001" });
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    body: '{"loadKg":"72.50000000000000000001"}',
  });
});
it("reports auth/conflict/network failure without auto-retrying mutations", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(api("/api", "POST")).rejects.toMatchObject({ status: 401 });
  fetcher.mockResolvedValueOnce(new Response(null, { status: 409 }));
  await expect(api("/api", "POST")).rejects.toMatchObject({ status: 409 });
  fetcher.mockRejectedValueOnce(new TypeError("network"));
  await expect(api("/api", "POST")).rejects.toMatchObject({ status: 0 });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("persists one retry UUID per user/session/exercise across reloads", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const first = draftIdentity("alice", "session", "exercise");
  expect(draftIdentity("alice", "session", "exercise")).toEqual(first);
  expect(draftIdentity("bob", "session", "exercise").id).not.toBe(first.id);
  expect(draftIdentity("alice", "other", "exercise").id).not.toBe(first.id);
});

import { describe, expect, it, vi } from "vitest";
import {
  healthResponse,
  identityResponse,
  readinessResponse,
} from "./foundation";

describe("foundation HTTP responses", () => {
  it("returns deterministic application health without external configuration", async () => {
    const response = healthResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns ready only after a successful database check", async () => {
    const response = await readinessResponse(() => ({ check: async () => {} }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it.each(["configuration", "database"])(
    "hides %s failures in readiness responses",
    async (source) => {
      const failure = () => {
        throw new Error("postgresql://user:secret@private-host/database");
      };
      const response = await readinessResponse(() => {
        if (source === "configuration") failure();
        return { check: async () => failure() };
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "unavailable" });
    },
  );

  it("rejects unauthenticated protected requests", async () => {
    const getDatabase = vi.fn();
    const response = await identityResponse(
      async () => ({ currentIdentity: async () => null }),
      getDatabase,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("returns only the authenticated identity", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await identityResponse(
      async () => ({
        currentIdentity: async () => ({
          id: "user-123",
          credentials: "secret",
        }),
      }),
      () => ({ check }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "user-123",
      status: "ready",
    });
    expect(check).toHaveBeenCalledOnce();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("hides internal authentication/configuration failures", async () => {
    const response = await identityResponse(
      async () => {
        throw new Error("private credential");
      },
      () => ({ check: async () => {} }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  it("returns a safe failure if the authenticated database path is unavailable", async () => {
    const response = await identityResponse(
      async () => ({ currentIdentity: async () => ({ id: "user-123" }) }),
      () => ({
        check: async () => {
          throw new Error("private database credentials");
        },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});

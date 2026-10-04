import { expect, it } from "vitest";
import { createIdentityProvider } from "./identity";
const id = "00000000-0000-4000-8000-000000000001";
it("maps only validated session UUID through durable identity boundary", async () =>
  expect(
    await createIdentityProvider(async () => ({
      user: { id },
    })).currentIdentity(),
  ).toEqual({ id }));
it.each([null, { user: { id: "forged" } }, { user: { id: "" } }])(
  "rejects missing/non UUID session",
  async (value) =>
    expect(
      await createIdentityProvider(async () => value).currentIdentity(),
    ).toBeNull(),
);
it("propagates unavailable session reads rather than trusting claims", async () =>
  await expect(
    createIdentityProvider(async () => {
      throw new Error("unavailable");
    }).currentIdentity(),
  ).rejects.toThrow());

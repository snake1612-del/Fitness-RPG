import { describe, expect, it } from "vitest";
import {
  draftValues,
  finishContext,
  finishTimezone,
  requireCompleted,
} from "./sets";

describe("actual Set values and stable Finish context", () => {
  it.each([null, 0, 10])("accepts optional/boundary RIR %s", (rir) => {
    expect(draftValues({ rir }, "WEIGHTED")).toMatchObject({
      reps: null,
      loadKg: null,
      rir,
    });
  });
  it.each([-1, 11, 1.5, "1"])("rejects RIR %s", (rir) => {
    expect(() => draftValues({ rir }, "WEIGHTED")).toThrow("invalid_input");
  });
  it.each([0, -1, 1.5, "8"])("rejects reps %s", (reps) => {
    expect(() => draftValues({ reps }, "WEIGHTED")).toThrow("invalid_input");
  });
  it.each(["BAD", null])("rejects Set type %s", (type) => {
    expect(() => draftValues({ type }, "WEIGHTED")).toThrow("invalid_input");
  });
  it("normalizes exact load strings without floating point conversion", () => {
    expect(
      draftValues({ loadKg: "00072.5000000000000000000000010" }, "WEIGHTED")
        .loadKg,
    ).toBe("72.500000000000000000000001");
  });
  it.each([72.5, "-1", "NaN", "Infinity", "1e2"])(
    "rejects canonical load %s",
    (loadKg) => {
      expect(() => draftValues({ loadKg }, "WEIGHTED")).toThrow(
        "invalid_input",
      );
    },
  );
  it("requires performed values only at explicit completion", () => {
    const draft = draftValues({}, "WEIGHTED");
    expect(() => requireCompleted(draft, "WEIGHTED")).toThrow("invalid_input");
    expect(() =>
      requireCompleted(
        draftValues({ loadKg: "0", reps: 1 }, "WEIGHTED"),
        "WEIGHTED",
      ),
    ).not.toThrow();
    expect(() =>
      requireCompleted(draftValues({ reps: 8 }, "BODYWEIGHT"), "BODYWEIGHT"),
    ).not.toThrow();
    expect(() =>
      requireCompleted(
        draftValues({ reps: 8 }, "ASSISTED_BODYWEIGHT"),
        "ASSISTED_BODYWEIGHT",
      ),
    ).toThrow("invalid_input");
  });
  it.each(["Europe/Berlin", "America/New_York", "Asia/Kathmandu", "UTC"])(
    "validates timezone %s",
    (timeZone) => {
      expect(typeof finishTimezone({ timeZone })).toBe("string");
    },
  );
  it.each([
    {},
    { timeZone: "Invalid/Zone" },
    { timeZone: "" },
    { timeZone: "UTC", userId: "spoof" },
  ])("rejects Finish input %j", (input) => {
    expect(() => finishTimezone(input)).toThrow("invalid_input");
  });
  it.each([
    ["Europe/Berlin", "2026-03-29T00:30:00.123Z", "2026-03-29", 3600],
    ["Europe/Berlin", "2026-03-29T01:30:00.123Z", "2026-03-29", 7200],
    ["America/New_York", "2026-10-01T02:00:00.000Z", "2026-09-30", -14400],
    ["Asia/Kathmandu", "2026-10-01T20:00:00.000Z", "2026-10-02", 20700],
    ["UTC", "2026-10-01T00:00:00.123Z", "2026-10-01", 0],
  ])(
    "captures historical day/offset for %s at %s",
    (timezone, instant, trainingDay, offset) => {
      expect(finishContext(timezone, new Date(instant))).toEqual({
        finishedAt: new Date(instant),
        finishTimezone: timezone,
        finishUtcOffsetSeconds: offset,
        trainingDay,
      });
    },
  );
});

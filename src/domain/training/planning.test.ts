import { describe, expect, it } from "vitest";
import { decimalKg, loadType, reorder, targets } from "./planning";

const required = { targetWorkingSets: 3, targetRepsMin: 8, targetRepsMax: 12 };
describe("planning target semantics", () => {
  it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"])(
    "accepts %s",
    (type) => expect(loadType(type)).toBe(type),
  );
  it("rejects unsupported load types", () =>
    expect(() => loadType("OTHER")).toThrow("invalid_input"));
  it.each([null, 0, 10])("accepts RIR %s", (targetRir) =>
    expect(targets({ ...required, targetRir }, "WEIGHTED").targetRir).toBe(
      targetRir,
    ),
  );
  it.each([-1, 11, 1.5, "1"])("rejects RIR %s", (targetRir) =>
    expect(() => targets({ ...required, targetRir }, "WEIGHTED")).toThrow(
      "invalid_input",
    ),
  );
  it.each([
    { targetWorkingSets: 0 },
    { targetWorkingSets: 1.5 },
    { targetRepsMin: 0 },
    { targetRepsMax: 7 },
    { targetRestSeconds: -1 },
    { targetRestSeconds: 1.5 },
  ])("rejects invalid targets %j", (invalid) =>
    expect(() => targets({ ...required, ...invalid }, "WEIGHTED")).toThrow(
      "invalid_input",
    ),
  );
  it("preserves decimal kg without Number coercion", () => {
    expect(decimalKg("72.5")).toBe("72.5");
    expect(decimalKg("00072.500")).toBe("72.5");
    expect(decimalKg("72.500000000000000000000001")).toBe(
      "72.500000000000000000000001",
    );
  });
  it.each([72.5, "-1", "NaN", "Infinity", "1e2", "", true])(
    "rejects noncanonical kg %s",
    (value) => expect(() => decimalKg(value)).toThrow("invalid_input"),
  );
  it("does not allow external load for basic bodyweight", () => {
    expect(targets(required, "BODYWEIGHT").targetLoadKg).toBeNull();
    expect(() =>
      targets({ ...required, targetLoadKg: "0" }, "BODYWEIGHT"),
    ).toThrow("invalid_input");
  });
  it("treats assisted load as a positive assistance magnitude", () => {
    expect(
      targets({ ...required, targetLoadKg: "30.25" }, "ASSISTED_BODYWEIGHT")
        .targetLoadKg,
    ).toBe("30.25");
    expect(() =>
      targets({ ...required, targetLoadKg: "0" }, "ASSISTED_BODYWEIGHT"),
    ).toThrow("invalid_input");
  });
  it("accepts zero rest seconds and nullable optional targets", () => {
    expect(
      targets({ ...required, targetRestSeconds: 0 }, "WEIGHTED"),
    ).toMatchObject({ targetRestSeconds: 0, targetRir: null, notes: null });
  });
  it("requires an exact permutation for reorder", () => {
    const a = "00000000-0000-0000-0000-000000000001",
      b = "00000000-0000-0000-0000-000000000002";
    expect(reorder({ ids: [b, a] }, [a, b])).toEqual([b, a]);
    for (const ids of [
      [a, a],
      [a],
      [a, "00000000-0000-0000-0000-000000000003"],
    ])
      expect(() => reorder({ ids }, [a, b])).toThrow("invalid_input");
  });
});

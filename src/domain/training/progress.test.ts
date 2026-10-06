import { expect, it } from "vitest";
import {
  e1rm,
  progressDates,
  projectExercise,
  workingVolume,
  type Occurrence,
} from "./progress";
const occurrence = (
  order: number,
  load = "80",
  reps = 8,
  loadType: Occurrence["loadType"] = "WEIGHTED",
  day = "2026-10-06",
): Occurrence => ({
  sessionId: `s${order}`,
  sessionExerciseId: `e${order}`,
  trainingDay: day,
  finishOrder: String(order),
  position: 0,
  loadType,
  sets: [
    {
      id: `set${order}`,
      position: 0,
      loadKg: loadType === "BODYWEIGHT" ? null : load,
      reps,
      rir: null,
    },
  ],
});
it.each([
  ["Europe/Moscow", "2026-10-07", "2026-10-01", "2026-09-08"],
  ["Europe/London", "2026-10-06", "2026-09-30", "2026-09-07"],
])(
  "server instant in %s yields calendar boundaries",
  (zone, today, from7, from30) => {
    expect(progressDates(zone, new Date("2026-10-06T21:30:00Z"))).toEqual({
      today,
      from7,
      from30,
    });
  },
);
it.each([undefined, null, "", "Invalid/Zone", "+03:00"])(
  "rejects missing/invalid timezone %s",
  (zone) => {
    expect(() =>
      progressDates(zone, new Date("2026-10-06T21:30:00Z")),
    ).toThrow();
  },
);
it("calendar subtraction crosses month/leap boundaries without elapsed hours", () => {
  expect(progressDates("UTC", new Date("2024-03-01T00:00:00Z"))).toEqual({
    today: "2024-03-01",
    from7: "2024-02-24",
    from30: "2024-02-01",
  });
});
it.each([
  ["80", 1, "80.0"],
  ["80", 8, "101.3"],
  ["1.05", 1, "1.1"],
  ["1.04999999999999999999", 1, "1.0"],
  ["1.05000000000000000001", 1, "1.1"],
  ["30.05", 6, "36.1"],
  ["30.04166666666666666666", 6, "36.0"],
  ["30.04166666666666666667", 6, "36.1"],
  ["0", 10, "0.0"],
  ["80", 11, null],
])("exact Epley %s × %s → %s", (load, reps, value) => {
  expect(e1rm(load as string, reps as number)).toBe(value);
});
it("exact midpoint at rational x.x5 rounds half-up, not bankers", () => {
  expect(e1rm("1.5", 3)).toBe("1.7");
});
it("volume is exact and arbitrary precision", () => {
  expect(
    workingVolume([
      ...occurrence(1, "20.12500000000000000001", 8).sets,
      ...occurrence(2, "0.1", 3).sets,
    ]),
  ).toBe("161.30000000000000000008");
});
it.each(["WEIGHTED", "BODYWEIGHT", "ASSISTED_BODYWEIGHT"] as const)(
  "%s ties preserve earliest achiever and later secondary reps do not replace source",
  (type) => {
    const data = projectExercise([
      occurrence(2, "80", 9, type),
      occurrence(1, "80", 8, type),
    ])!;
    const record =
      type === "WEIGHTED"
        ? data.highestLoad
        : type === "BODYWEIGHT"
          ? projectExercise([
              occurrence(2, "80", 8, type),
              occurrence(1, "80", 8, type),
            ])!.maxReps
          : data.lowestAssistance;
    expect(record!.source.sessionId).toBe("s1");
    if (type === "WEIGHTED")
      expect(data.latestRepsAtLoad).toEqual([{ loadKg: "80", maxReps: 9 }]);
    else expect(data.recent[0].volume).toBeNull();
  },
);
it("equal rounded e1RM retains earliest source despite different exact result", () => {
  expect(
    projectExercise([occurrence(1, "1.01", 1), occurrence(2, "1.04", 1)])!
      .bestE1rm!.source.sessionId,
  ).toBe("s1");
});
it("no e1RM for >10 reps is null; latest contains all Sets", () => {
  const row = occurrence(1, "80", 11);
  row.sets.push({ ...row.sets[0], id: "other", position: 1, reps: 12 });
  const data = projectExercise([row])!;
  expect(data.bestE1rm).toBeNull();
  expect(data.recent[0].bestE1rm).toBeNull();
  expect(data.latest.sets).toHaveLength(2);
});
it("last eight use training day then immutable Finish order; input/correction order is irrelevant", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    occurrence(
      i + 1,
      "80",
      8,
      "WEIGHTED",
      `2026-10-${String(i + 1).padStart(2, "0")}`,
    ),
  );
  rows[0].finishOrder = "100";
  const data = projectExercise([...rows].reverse())!;
  expect(data.recent.map((x) => x.occurrence.sessionId)).toEqual([
    "s10",
    "s9",
    "s8",
    "s7",
    "s6",
    "s5",
    "s4",
    "s3",
  ]);
  expect(projectExercise([])).toBeNull();
});
it("assisted representative uses minimum then highest reps, without combined PR score", () => {
  const row = occurrence(1, "20", 8, "ASSISTED_BODYWEIGHT");
  row.sets.push({ ...row.sets[0], id: "other", position: 1, reps: 10 });
  const data = projectExercise([row])!;
  expect(data.lowestAssistance!.source.setId).toBe("set1");
  expect(data.recent[0].representative!.id).toBe("other");
});

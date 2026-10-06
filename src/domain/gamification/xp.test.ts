import { expect, it } from "vitest";
import {
  candidateXp,
  levelProgress,
  projectGamification,
  type XpSession,
} from "./xp";
it.each([
  [4, 4, 100],
  [4, 3, 75],
  [3, 2, 65],
  [6, 5, 85],
  [5, 7, 100],
  [0, 10, 0],
  [1, 10, 0],
  [10, 0, 0],
  [10, 1, 0],
  [8, 2, 25],
  [8, 3, 40],
  [8, 5, 65],
  [8, 7, 90],
  [40, 2, 5],
  [40, 3, 10],
  [40, 39, 100],
  [2147483647, 2147483646, 100],
])(
  "P=%s W=%s yields candidate %s with exact half-up multiples of five",
  (p, w, xp) => {
    expect(candidateXp(p, w)).toBe(xp);
  },
);
it.each([
  [0, 1, 0, 100],
  [99, 1, 99, 100],
  [100, 2, 0, 125],
  [224, 2, 124, 125],
  [225, 3, 0, 150],
  [375, 4, 0, 175],
  [4599, 16, 474, 475],
  [4600, 17, 0, 500],
  [5099, 17, 499, 500],
  [5100, 18, 0, 500],
  [6100, 20, 0, 500],
  [1000000000000, 2000000007, 400, 500],
])(
  "total %s derives Level %s, %s/%s",
  (totalXp, level, xpIntoLevel, xpForNextLevel) => {
    expect(levelProgress(totalXp)).toEqual({
      totalXp,
      level,
      xpIntoLevel,
      xpForNextLevel,
      xpRemaining: xpForNextLevel - xpIntoLevel,
    });
  },
);
const session = (
  order: number,
  p = 10,
  w = 7,
  day = "2026-10-06",
): XpSession => ({
  id: String(order),
  finishOrder: String(order),
  trainingDay: day,
  p,
  w,
});
it("daily allocation ignores shuffled input; zero candidate consumes no cap; another stable day resets cap", () => {
  const rows = [
    session(4, 4, 4, "2026-10-05"),
    session(3, 4, 4),
    session(2, 5, 4),
    session(0, 1, 9),
    session(1),
  ];
  const data = projectGamification(rows);
  expect(data.awards.map((s) => [s.id, s.candidateXp, s.awardedXp])).toEqual([
    ["0", 0, 0],
    ["1", 70, 70],
    ["2", 80, 30],
    ["3", 100, 0],
    ["4", 100, 100],
  ]);
  expect(data.summary.totalXp).toBe(200);
  expect(projectGamification(rows)).toEqual(data);
  expect(rows[0].id).toBe("4");
});
it("earlier same-day correction reallocates later awards without reordering, total and Level can decrease", () => {
  const before = projectGamification([session(2, 5, 4), session(1)]);
  const after = projectGamification([session(2, 5, 4), session(1, 10, 5)]);
  expect(before.awards.map((s) => s.awardedXp)).toEqual([70, 30]);
  expect(after.awards.map((s) => s.awardedXp)).toEqual([50, 50]);
  const decreased = projectGamification([session(2, 5, 1), session(1, 10, 5)]);
  expect(decreased.summary).toEqual(levelProgress(50));
  expect(decreased.summary.level).toBe(1);
});
it("non-monotonic stable days remain labels, with Finish order retained inside each day", () => {
  const data = projectGamification([
    session(12, 5, 4, "2026-10-07"),
    session(11, 4, 4, "2026-10-06"),
    session(10, 10, 7, "2026-10-07"),
  ]);
  expect(data.awards.map((s) => [s.id, s.awardedXp])).toEqual([
    ["10", 70],
    ["11", 100],
    ["12", 30],
  ]);
});
it("empty history starts at Level 1; extra sets cannot exceed P or 100 candidate", () => {
  expect(projectGamification([])).toEqual({
    summary: levelProgress(0),
    awards: [],
  });
  expect(projectGamification([session(1, 5, 100)]).awards[0]).toMatchObject({
    p: 5,
    w: 100,
    c: 5,
    candidateXp: 100,
    awardedXp: 100,
  });
});

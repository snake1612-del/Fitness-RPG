import { expect, it } from "vitest";
import { characterMilestone } from "./character-milestones";

it.each([
  [1, 1, 3],
  [2, 1, 3],
  [3, 3, 5],
  [4, 3, 5],
  [5, 5, 10],
  [9, 5, 10],
  [10, 10, 20],
  [19, 10, 20],
  [20, 20, null],
  [21, 20, null],
  [100000, 20, null],
])("Level %s presents milestone %s and next %s", (level, current, next) => {
  expect(characterMilestone(level)).toEqual({ current, next });
});
it("stage follows current Level in both directions, without unlock history", () => {
  expect(
    [2, 3, 5, 20, 2].map((level) => characterMilestone(level).current),
  ).toEqual([1, 3, 5, 20, 1]);
});

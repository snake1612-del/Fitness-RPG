export const milestones = [1, 3, 5, 10, 20] as const;
export type Milestone = (typeof milestones)[number];

export function characterMilestone(level: number) {
  const index = milestones.findLastIndex((milestone) => milestone <= level);
  return { current: milestones[index], next: milestones[index + 1] ?? null };
}

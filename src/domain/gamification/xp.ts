export type XpSession = {
  id: string;
  trainingDay: string;
  finishOrder: string;
  p: number;
  w: number;
};
export type SessionAward = XpSession & {
  c: number;
  candidateXp: number;
  awardedXp: number;
};
export type LevelProgress = {
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpRemaining: number;
};

export function candidateXp(p: number, w: number) {
  const c = Math.min(w, p);
  if (p < 2 || c < 2) return 0;
  // 100*C/P, rounded to multiples of five: exact non-negative half-up division.
  return (
    Number((BigInt(40) * BigInt(c) + BigInt(p)) / (BigInt(2) * BigInt(p))) * 5
  );
}

export function levelProgress(totalXp: number): LevelProgress {
  let level = 1;
  let xpIntoLevel = totalXp;
  let xpForNextLevel = 100;
  // At most sixteen growing thresholds; thereafter skip whole 500-XP levels.
  while (xpForNextLevel < 500 && xpIntoLevel >= xpForNextLevel) {
    xpIntoLevel -= xpForNextLevel;
    level++;
    xpForNextLevel += 25;
  }
  if (xpForNextLevel === 500) {
    level += Math.floor(xpIntoLevel / 500);
    xpIntoLevel %= 500;
  }
  return {
    totalXp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    xpRemaining: xpForNextLevel - xpIntoLevel,
  };
}

export function projectGamification(input: XpSession[]) {
  const remainingByDay = new Map<string, number>();
  const ordered = [...input].sort((a, b) =>
    BigInt(a.finishOrder) < BigInt(b.finishOrder)
      ? -1
      : BigInt(a.finishOrder) > BigInt(b.finishOrder)
        ? 1
        : 0,
  );
  let totalXp = 0;
  const awards: SessionAward[] = ordered.map((session) => {
    const candidate = candidateXp(session.p, session.w);
    const remaining = remainingByDay.get(session.trainingDay) ?? 100;
    const awardedXp = Math.min(candidate, remaining);
    remainingByDay.set(session.trainingDay, remaining - awardedXp);
    totalXp += awardedXp;
    return {
      ...session,
      c: Math.min(session.w, session.p),
      candidateXp: candidate,
      awardedXp,
    };
  });
  return { summary: levelProgress(totalXp), awards };
}

// Templates are already in the current Program order. Historical identity, not
// a client cursor or historical position, determines the successor.
export function nextTemplate<T extends { id: string }>(
  templates: T[],
  latestSourceId: string | null,
): T | null {
  if (!templates.length) return null;
  const index = templates.findIndex((item) => item.id === latestSourceId);
  return templates[(index + 1) % templates.length];
}

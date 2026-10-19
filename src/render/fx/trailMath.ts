// Engine trail math (visual polish): how a trail point fades with age and how often a new point is
// laid down. Pure – unit tested; the ribbon itself lives in Trail.ts.

/** Brightness 0..1 of a trail point of age `age` (s) in a trail living `life` seconds. */
export function trailFade(age: number, life: number): number {
  if (!(life > 0) || age >= life || age < 0) return 0;
  const t = age / life;
  // bright near the nozzle, long soft tail
  return (1 - t) * (1 - t);
}

/** Width multiplier: the ribbon widens a little as the exhaust spreads. */
export const trailSpread = (age: number, life: number): number => 1 + 0.8 * Math.min(1, Math.max(0, age / Math.max(1e-6, life)));

/** Should a new point be laid down? (moved far enough, or enough time passed). */
export function trailNeedsPoint(sinceLast: number, moved: number, minInterval = 1 / 40, minDistance = 0.35): boolean {
  return moved >= minDistance || sinceLast >= minInterval * 3 || (sinceLast >= minInterval && moved > 0.02);
}

// Mining 2.0 (plan 2026-10-17-tazba-2): ore grade (purity) of asteroids and rich nuggets that break
// off while mining. Numbers live here, the logic in src/sim/mining/grade.ts and nuggets.ts.
import type { RingIndex } from './economy';

/** One step of a grade table: the grade (yield multiplier) and its weight (per mille). */
export interface GradeStep {
  grade: number;
  weight: number;
}

/**
 * Grade tables per ring. Most rocks are around 100 %, a few are poor, rare ones rich. The weighted
 * mean of every table is 1.00 ± 0.005 (ore.test.ts), so the average yield – and the econ model's
 * pacing – does not change; a player who scans and picks rich rocks earns a little more.
 * Ring 1 is narrower (70–145 %), the outer rings range 60–160 %.
 */
const INNER: readonly GradeStep[] = [
  { grade: 0.7, weight: 55 },
  { grade: 0.8, weight: 110 },
  { grade: 0.9, weight: 205 },
  { grade: 1.0, weight: 285 },
  { grade: 1.1, weight: 190 },
  { grade: 1.2, weight: 85 },
  { grade: 1.3, weight: 45 },
  { grade: 1.45, weight: 25 },
];

const OUTER: readonly GradeStep[] = [
  { grade: 0.6, weight: 40 },
  { grade: 0.7, weight: 60 },
  { grade: 0.8, weight: 115 },
  { grade: 0.9, weight: 185 },
  { grade: 1.0, weight: 240 },
  { grade: 1.1, weight: 160 },
  { grade: 1.2, weight: 95 },
  { grade: 1.3, weight: 50 },
  { grade: 1.45, weight: 35 },
  { grade: 1.6, weight: 20 },
];

export const GRADE_TABLES: Readonly<Record<RingIndex, readonly GradeStep[]>> = { 1: INNER, 2: OUTER, 3: OUTER, 4: OUTER };

export const ORE = {
  /** A rock of this grade or better is "rich ore" (callout, radar tint, map). */
  richGrade: 1.25,
  /** A rock below this grade is "poor ore". */
  poorGrade: 0.85,
} as const;

export const NUGGET = {
  /** A nugget roll every this many rock units extracted from one asteroid. */
  stepUnits: 2,
  /** Expected nuggets per second of one laser mining a 100 % rock: on the active vein segment / elsewhere. */
  perSecond: { vein: 1 / 40, rock: 1 / 160 },
  /** A nugget holds this many seconds of the laser's mining (rate × difficulty yield × grade). */
  seconds: 5,
  /** Smallest nugget worth breaking off (rock units). */
  minRock: 1,
  /** A rock keeps at least this much (rock units) – a nugget never depletes it. */
  keepRock: 0.5,
  /** Collision radius (u). */
  radius: 0.45,
  /** Drift speed away from the rock (u/s), spread around the surface normal (rad), spin (rad/s). */
  speed: [1.2, 2.6] as readonly [number, number],
  spread: 0.9,
  spin: 3,
  /** Drift slows down a little (share of speed per second). */
  damping: 0.12,
  /** Lifetime (s); the last `fadeSeconds` the nugget blinks before it is gone. */
  ttlSeconds: 45,
  fadeSeconds: 8,
  /** At most this many nuggets exist at once (the oldest goes first). */
  cap: 6,
  /** Magnet: pulls a nugget closer than this to the hull (u) and collects it at `collectRange`. */
  magnetRange: 3,
  collectRange: 0.6,
  /** Magnet acceleration at the hull (u/s²) and how fast the nugget matches the ship's velocity (1/s). */
  magnetAccel: 14,
  magnetMatch: 3,
} as const;

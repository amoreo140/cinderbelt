// Pure look rules of a comet (M4b plan T12): the pose drawn between two sim steps, the tail axes,
// the fade at the pass ends, the nucleus shrinking as it is mined, mined tail shards and the mining
// beam's moving target. No three.js – unit tested. Shard placement is the sim's own (`cometShards`),
// never copied here.
import { COMET } from '../../data/sites';
import type { Vec2 } from '../../sim/math/vec2';
import { cometAt } from '../../sim/sites/comets';
import type { CometPose } from '../../sim/sites/types';
import type { QualityPreset } from '../quality';

export const COMET_LOOK = {
  /** Comets whose nucleus lies within this distance of the ship are built (u). */
  range: 1_500,
  /** Sublimation particles only for comets this close (u) – farther ones are off screen anyway. */
  emitRange: 400,
  /** Fade in / out at the pass ends (s). */
  fadeSeconds: 6,
  /** Length of the tail model along local −X (comet_tail.glb, u). */
  tailModelLength: 30,
  /** Visual ion tail length at the slowest and the fastest comet (× the model length). */
  tailStretch: [1.05, 1.7] as readonly [number, number],
  /** The dust tail bends this far (rad) from the anti-home axis towards the trailing side. */
  dustBend: 0.42,
  /** The nucleus keeps at least this share of its size when its core is mined out. */
  minShrink: 0.62,
} as const;

/** The speed range of the comets (u/s) – the tail stretch interpolates over it. */
const SPEED = COMET.speed;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The comet drawn between the last two sim steps: `cometAt(tick - 1)` → `cometAt(tick)` by `alpha`
 * (the sim integrates to the end of its step, comets.ts "Time convention"). At a pass boundary the
 * existing side is used as is (no lerp across two arcs).
 */
export function renderPose(seed: number, id: string, tick: number, alpha: number): CometPose | null {
  const now = cometAt(seed, id, tick);
  const prev = cometAt(seed, id, tick - 1);
  if (!now) return prev;
  if (!prev || prev.pass !== now.pass) return now;
  const a = clamp01(alpha);
  return {
    id,
    pass: now.pass,
    pos: { x: prev.pos.x + (now.pos.x - prev.pos.x) * a, y: prev.pos.y + (now.pos.y - prev.pos.y) * a },
    vel: { x: prev.vel.x + (now.vel.x - prev.vel.x) * a, y: prev.vel.y + (now.vel.y - prev.vel.y) * a },
    t: prev.t + (now.t - prev.t) * a,
  };
}

/** Unit vector away from home (the star at the origin) – the ion tail and the shards lie along it. */
export function awayFromHome(pos: Vec2): Vec2 {
  const r = Math.hypot(pos.x, pos.y);
  return r > 1e-9 ? { x: pos.x / r, y: pos.y / r } : { x: 1, y: 0 };
}

/** Visual length of the ion tail (u) – faster comets drag a longer tail. */
export function tailLength(speed: number): number {
  const k = clamp01((speed - SPEED[0]) / (SPEED[1] - SPEED[0]));
  const [lo, hi] = COMET_LOOK.tailStretch;
  return COMET_LOOK.tailModelLength * (lo + (hi - lo) * k);
}

/**
 * Direction of the dust tail: the anti-home axis bent by `bend` towards the trailing side (against
 * the velocity) – dust lags behind on the orbit, the ion tail does not.
 */
export function dustTailDir(axis: Vec2, vel: Vec2, bend: number = COMET_LOOK.dustBend): Vec2 {
  // the part of −vel across the axis
  const along = -vel.x * axis.x - vel.y * axis.y;
  const sx = -vel.x - axis.x * along;
  const sy = -vel.y - axis.y * along;
  const s = Math.hypot(sx, sy);
  if (s < 1e-9) return { ...axis };
  const k = Math.tan(bend) / s;
  const dx = axis.x + sx * k;
  const dy = axis.y + sy * k;
  const d = Math.hypot(dx, dy);
  return { x: dx / d, y: dy / d };
}

/**
 * `rotation.y` of a model whose local −X has to point along the sim direction `dir`
 * (comet_tail.glb; world = (x, h, −y), see coords.ts).
 */
export function tailYaw(dir: Vec2): number {
  return Math.atan2(-dir.y, -dir.x);
}

/** Visibility 0..1 at the pass progress `t` – a smooth fade over `fadeSeconds` at both ends. */
export function cometFade(t: number, passTicks: number, fadeSeconds: number = COMET_LOOK.fadeSeconds): number {
  const ticks = Math.max(1, fadeSeconds * 60);
  const edge = Math.min(t, 1 - t) * passTicks;
  const x = clamp01(edge / ticks);
  return x * x * (3 - 2 * x);
}

/** Scale of the nucleus by its core left (rock units of `budget`): it shrinks as it is mined. */
export function nucleusShrink(core: number, budget: number = COMET.budget): number {
  const left = budget > 0 ? clamp01(core / budget) : 1;
  const min = COMET_LOOK.minShrink;
  // a cube-root curve: the volume goes linearly with the rock mined
  return min + (1 - min) * Math.cbrt(left);
}

/** Tail shard indices mined since `before` (bitmasks of `CometState.tail`). */
export function newlyMined(before: number, now: number): number[] {
  const out: number[] = [];
  let bits = (now & ~before) >>> 0;
  while (bits) {
    const low = bits & -bits;
    out.push(31 - Math.clz32(low));
    bits = (bits ^ low) >>> 0;
  }
  return out;
}

/** The comet and the shard of a mining beam's moving target (`cm:3` nucleus, `cm:3#12` tail shard; movers.ts). */
export function moverTarget(mover: string): { id: string; shard: number | null } {
  const mark = mover.indexOf('#');
  if (mark < 0) return { id: mover, shard: null };
  const shard = Number(mover.slice(mark + 1));
  return { id: mover.slice(0, mark), shard: Number.isInteger(shard) ? shard : null };
}

/** The comet's point light: on High only – a light is a cost on every lit pixel, Medium/Low glow instead. */
export const cometLightsFor = (p: Pick<QualityPreset, 'particles'>): number => (p.particles >= 1 ? 1 : 0);

/** Sublimation particles per second of one comet near the ship (by the quality's particle multiplier). */
export function sublimationRate(particles: number, reducedMotion: boolean): number {
  return 34 * Math.max(0, particles) * (reducedMotion ? 0.5 : 1);
}

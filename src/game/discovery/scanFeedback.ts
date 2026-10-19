// Scanner pulse feedback in the world (readability pass R6): the wave that runs from the ship to the
// radar range, the finds the pulse revealed (rich rocks, signals, a located cache or Echo) and how long
// they stay highlighted. Pure – the renderer draws the wave and the rings, the HUD the edge arrows; both
// read the same `ScanView`, so the rings and the arrows appear when the wave front reaches the find.
import { echoSites } from '../../sim/discovery/poi';
import { radarRangeOf } from '../../sim/discovery/scanner';
import type { SignalKind } from '../../sim/discovery/types';
import { assayChunksAround, chunkOfAsteroid, isRich, oreGrade } from '../../sim/mining/grade';
import type { Vec2 } from '../../sim/math/vec2';
import type { ResourceId } from '../../data/resources';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { ECHO_COLOR } from '../../ui/canvasDraw';
import { PALETTE } from '../../ui/theme/tokens';

export const SCAN_WAVE = {
  /** Seconds the front needs to reach the radar range. */
  seconds: 2.2,
  /** Ease-in exponent: slow near the ship (visible zoomed in), fast far out (visible zoomed out). */
  power: 1.6,
  /** Share of the run after which the wave fades (gone at the radar range). */
  fadeFrom: 0.55,
  /** Reduced motion: the ring does not travel – it stands at the radar range and fades (s). */
  reducedSeconds: 1.2,
} as const;

/** A find's highlight: a quick pop when the wave reaches it, a hold, then a fade (s). */
export const FIND_LIFE = { seconds: 3.6, popSeconds: 0.35, fadeSeconds: 1 } as const;

/** At most this many rich rocks get a highlight per pulse (the nearest ones). */
const MAX_RICH = 16;

export type ScanFindKind = 'rich' | 'signal' | 'echo' | 'cache';

/** A find's colour – its ring in the world, its edge arrow and its mark on the radar agree. */
export const findColor = (kind: ScanFindKind): string =>
  kind === 'rich' ? PALETTE.oreRich : kind === 'echo' ? ECHO_COLOR : kind === 'cache' ? PALETTE.glow : PALETTE.warn;

export interface ScanFind {
  id: string;
  kind: ScanFindKind;
  pos: Vec2;
  /** Rock radius, the signal's uncertainty radius, or the place's size (u). */
  radius: number;
  /** Distance from the pulse origin (u). */
  dist: number;
  /** Rich rock: ore and grade (1.3 = 130 %). */
  resource?: ResourceId;
  grade?: number;
  /** Signal: what the scanner heard. */
  signal?: SignalKind;
}

export interface ScanWaveView {
  pos: Vec2;
  /** Radius of the front (u) and its opacity 0..1. */
  radius: number;
  alpha: number;
  /** The radar range the wave runs to (u). */
  range: number;
  /** Seconds since the pulse. */
  age: number;
}

export interface ScanFindView extends ScanFind {
  /** Opacity 0..1 (0 = the wave has not reached it yet). */
  alpha: number;
  /** Size factor of the arrival pop (1 = rest). */
  pop: number;
}

export interface ScanView {
  wave: ScanWaveView | null;
  finds: ScanFindView[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Radius of the wave front `age` seconds after the pulse (reduced motion: standing at the range). */
export function waveRadius(age: number, range: number, reduced = false): number {
  if (reduced) return range;
  return range * clamp01(age / SCAN_WAVE.seconds) ** SCAN_WAVE.power;
}

/** Opacity of the wave: full near the ship, fading out towards the radar range. */
export function waveAlpha(age: number, reduced = false): number {
  if (age < 0) return 0;
  if (reduced) {
    // a soft fade in and out, no travel
    const t = age / SCAN_WAVE.reducedSeconds;
    return t >= 1 ? 0 : Math.min(1, t * 5) * (1 - t);
  }
  const t = age / SCAN_WAVE.seconds;
  if (t >= 1) return 0;
  return t <= SCAN_WAVE.fadeFrom ? 1 : 1 - (t - SCAN_WAVE.fadeFrom) / (1 - SCAN_WAVE.fadeFrom);
}

/** When the front reaches `dist` (s); finds beyond the radar range light up as the wave ends. */
export function waveArrival(dist: number, range: number, reduced = false): number {
  if (reduced || range <= 0) return 0;
  return SCAN_WAVE.seconds * clamp01(dist / range) ** (1 / SCAN_WAVE.power);
}

/** Opacity of a find's highlight `t` seconds after the wave reached it (0 before and after). */
export function findAlpha(t: number, reduced = false): number {
  if (t < 0 || t >= FIND_LIFE.seconds) return 0;
  const fadeAt = FIND_LIFE.seconds - FIND_LIFE.fadeSeconds;
  if (t > fadeAt) return 1 - (t - fadeAt) / FIND_LIFE.fadeSeconds;
  if (reduced) return 1;
  return Math.min(1, t / (FIND_LIFE.popSeconds * 0.5));
}

/** Size factor of the arrival pop: from 1.8× down to 1 (reduced motion: always 1). */
export function findPop(t: number, reduced = false): number {
  if (reduced || t >= FIND_LIFE.popSeconds) return 1;
  const k = 1 - clamp01(t / FIND_LIFE.popSeconds);
  return 1 + 0.8 * k * k;
}

/**
 * The finds of a step's pulse, or null when the step had no pulse. Rich rocks the pulse assayed, the
 * signals it placed, a located cache and a located Echo.
 */
export function collectScanFinds(state: SimState, events: readonly SimEvent[]): { pos: Vec2; range: number; finds: ScanFind[] } | null {
  const pulse = events.find((e): e is Extract<SimEvent, { type: 'scanPulse' }> => e.type === 'scanPulse');
  if (!pulse) return null;
  const at = pulse.pos;
  const range = radarRangeOf(state);
  const finds: ScanFind[] = [];
  const distOf = (p: Vec2): number => Math.hypot(p.x - at.x, p.y - at.y);

  // the rocks whose grade this pulse revealed: whole chunks around the radar range (the same set the
  // pulse's toast counts and the map marks)
  const chunks = new Set(assayChunksAround(at, range));
  const rich: ScanFind[] = [];
  for (const a of state.world.asteroids()) {
    if (!chunks.has(chunkOfAsteroid(a))) continue;
    const dist = distOf(a.pos);
    const grade = oreGrade(state.seed, a);
    if (!isRich(grade)) continue;
    rich.push({ id: `rich:${a.id}`, kind: 'rich', pos: { ...a.pos }, radius: state.world.radiusOf(a), dist, resource: a.resource, grade });
  }
  rich.sort((x, y) => x.dist - y.dist);
  finds.push(...rich.slice(0, MAX_RICH));

  // signals the pulse placed or moved in this step (the step has already advanced the tick)
  for (const s of state.discovery.signals) {
    if (s.tick < state.tick - 1) continue;
    finds.push({ id: `signal:${s.id}`, kind: 'signal', pos: { ...s.pos }, radius: s.radius, dist: distOf(s.pos), signal: s.kind });
  }
  for (const e of events) {
    if (e.type === 'cacheLocated') finds.push({ id: `cache:${e.id}`, kind: 'cache', pos: { ...e.pos }, radius: 5, dist: distOf(e.pos) });
    else if (e.type === 'echoHeard' && e.located) {
      const site = echoSites(state.seed).find((s) => s.index === e.echo);
      if (site) finds.push({ id: `echo:${e.echo}`, kind: 'echo', pos: { ...site.pos }, radius: 11, dist: distOf(site.pos) });
    }
  }
  return { pos: { ...at }, range, finds };
}

/** The last pulse and its finds over time (the game feeds it every step's events). */
export class ScanFeedback {
  private pulse: { at: number; pos: Vec2; range: number; finds: ScanFind[] } | null = null;

  onEvents(state: SimState, events: readonly SimEvent[], clock: number): void {
    const found = collectScanFinds(state, events);
    if (found) this.pulse = { at: clock, ...found };
  }

  /** What to draw at `clock` (null = nothing left of the last pulse). */
  view(clock: number, reduced: boolean): ScanView | null {
    const p = this.pulse;
    if (!p) return null;
    const age = clock - p.at;
    const alpha = waveAlpha(age, reduced);
    const wave: ScanWaveView | null = alpha > 0 ? { pos: p.pos, radius: waveRadius(age, p.range, reduced), alpha, range: p.range, age } : null;
    const finds: ScanFindView[] = [];
    let pending = false;
    for (const f of p.finds) {
      const t = age - waveArrival(f.dist, p.range, reduced);
      if (t < 0) pending = true;
      const a = findAlpha(t, reduced);
      if (a > 0) finds.push({ ...f, alpha: a, pop: findPop(t, reduced) });
    }
    if (!wave && finds.length === 0 && !pending) {
      this.pulse = null;
      return null;
    }
    return { wave, finds };
  }

  clear(): void {
    this.pulse = null;
  }
}

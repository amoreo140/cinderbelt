// Envelopes and click-free smooth parameter changes.

/** The subset of AudioParam we need - easy to fake in tests. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

/** Smallest value for an exponential ramp (must not be 0). */
export const ENV_FLOOR = 0.0001;
/** Shortest attack - anything shorter could click. */
export const MIN_ATTACK = 0.003;

export interface EnvelopeSpec {
  /** Peak level (gain). */
  peak: number;
  /** Attack in seconds. */
  attack: number;
  /** Peak hold in seconds. */
  hold?: number;
  /** Release in seconds (exponential towards zero). */
  release: number;
}

export type EnvelopePoint =
  | { kind: 'set'; time: number; value: number }
  | { kind: 'linear'; time: number; value: number }
  | { kind: 'exp'; time: number; value: number };

export function envelopeDuration(spec: EnvelopeSpec): number {
  return Math.max(MIN_ATTACK, spec.attack) + Math.max(0, spec.hold ?? 0) + Math.max(0.005, spec.release);
}

/**
 * Attack-hold-release envelope points starting at time t0. Starts and ends at zero,
 * the attack is linear (no jump), the release exponential (natural).
 */
export function envelopePoints(spec: EnvelopeSpec, t0: number): EnvelopePoint[] {
  const peak = Math.max(ENV_FLOOR * 2, spec.peak);
  const attack = Math.max(MIN_ATTACK, spec.attack);
  const hold = Math.max(0, spec.hold ?? 0);
  const release = Math.max(0.005, spec.release);
  const tPeak = t0 + attack;
  const tHoldEnd = tPeak + hold;
  const tEnd = tHoldEnd + release;
  const points: EnvelopePoint[] = [
    { kind: 'set', time: t0, value: 0 },
    { kind: 'linear', time: tPeak, value: peak },
  ];
  if (hold > 0) points.push({ kind: 'linear', time: tHoldEnd, value: peak });
  points.push({ kind: 'exp', time: tEnd, value: ENV_FLOOR });
  points.push({ kind: 'linear', time: tEnd + 0.005, value: 0 });
  return points;
}

export function applyEnvelopePoints(param: AudioParamLike, points: readonly EnvelopePoint[]): void {
  for (const p of points) {
    if (p.kind === 'set') param.setValueAtTime(p.value, p.time);
    else if (p.kind === 'linear') param.linearRampToValueAtTime(p.value, p.time);
    else param.exponentialRampToValueAtTime(p.value, p.time);
  }
}

/** Schedules the envelope and returns the time at which it has fully died away. */
export function applyEnvelope(param: AudioParamLike, spec: EnvelopeSpec, t0: number): number {
  const points = envelopePoints(spec, t0);
  applyEnvelopePoints(param, points);
  return points[points.length - 1]!.time;
}

/**
 * Time constant for setTargetAtTime so that ~95 % of the target is reached within `seconds`
 * (3 time constants).
 */
export function timeConstantFor(seconds: number): number {
  return Math.max(0.001, seconds / 3);
}

/**
 * Smooth target tracking called every frame. Schedules new automation
 * only on a noticeable change so events do not pile up.
 */
export class ParamSmoother {
  private lastTarget: number | null = null;

  constructor(
    private readonly param: AudioParamLike,
    private readonly options: { up: number; down: number; epsilon?: number },
  ) {}

  /** Returns true if new automation was scheduled. */
  setTarget(target: number, now: number): boolean {
    const eps = this.options.epsilon ?? 1e-4;
    if (this.lastTarget !== null && Math.abs(target - this.lastTarget) <= eps) return false;
    const rising = this.lastTarget === null || target > this.lastTarget;
    const seconds = rising ? this.options.up : this.options.down;
    this.param.setTargetAtTime(target, now, timeConstantFor(seconds));
    this.lastTarget = target;
    return true;
  }

  /** Sets the value immediately (e.g. at initialisation while the volume is zero). */
  jump(value: number, now: number): void {
    this.param.cancelScheduledValues(now);
    this.param.setValueAtTime(value, now);
    this.lastTarget = value;
  }

  get target(): number | null {
    return this.lastTarget;
  }
}

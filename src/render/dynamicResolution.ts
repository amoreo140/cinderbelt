// Dynamic resolution scaling (optimisation research R3): the 3D view renders at 100 / 85 / 70 % of its
// resolution, chosen from the measured GPU time per frame (gpuTimer.ts) – the first reaction of a weak
// GPU, before `auto` quality steps a preset down (a preset change recompiles materials, a resolution
// change only resizes render targets). GPU time, not frame time: a CPU-bound frame (a slow CPU, 4x
// throttle) must not lower the resolution, it would not get faster. Without GPU timer queries the scale
// stays at 100 % and `auto` behaves as before.
// Hysteresis like drei's PerformanceMonitor: averaged windows, a settling time after every change, a step
// up only when the projected cost at the larger scale stays well below the step-down limit, and a step
// up that had to be taken back soon makes the next one wait twice as long (no ping-pong).
// Pure – no three.js, no DOM – so the governor is unit tested; the setting lives here as page-wide state
// (Settings → Display "Dynamic resolution", applied by applyRenderSettings).

/** Render scales from the full resolution down (relative to the canvas size in device pixels). */
export const RENDER_SCALES: readonly number[] = [1, 0.85, 0.7];

export interface DrsLimits {
  /** Mean GPU time per frame (ms) above which a window is slow. */
  slowMs: number;
  /** A window is fast when its mean GPU time scaled up to the next larger resolution (by pixel count) stays below this (ms). */
  fastMs: number;
}

/** 60 fps leaves 16.7 ms: a step down above 14 ms of GPU work, a step up when the larger scale should take < 11 ms. */
export const DRS_LIMITS: Readonly<DrsLimits> = { slowMs: 14, fastMs: 11 };
/** Length of one measuring window (s), slow windows in a row for a step down, fast ones for a step up. */
export const DRS_WINDOW = 1;
export const DRS_SLOW_WINDOWS = 2;
export const DRS_FAST_WINDOWS = 4;
/** No measuring after a change (s): the targets are rebuilt, the first frames are not representative. */
export const DRS_SETTLE = 1.5;
/** Time after a step down before a step up (s); doubles after a bounce, up to the maximum. */
export const DRS_UP_COOLDOWN = 6;
export const DRS_UP_COOLDOWN_MAX = 120;
/** A step down this soon (s) after a step up is a bounce. */
export const DRS_BOUNCE = 20;
/** GPU samples a window needs (timer results can be missing, e.g. after a disjoint event). */
const MIN_SAMPLES = 8;
/** Frames longer than this (s) are hitches (tab switch, GC) and are ignored. */
const HITCH = 0.25;

/** The setting (Settings → Display), page-wide like the hull shell: on by default. */
let enabled = true;

export function setDynamicResolutionEnabled(on: boolean): void {
  enabled = on;
}

export function dynamicResolutionEnabled(): boolean {
  return enabled;
}

/** Governor of the render scale: fed with frame times and GPU times, returns the new scale when it changes. */
export class DynamicResolution {
  limits: DrsLimits = { ...DRS_LIMITS };
  private index = 0;
  private clock = 0;
  private settling = DRS_SETTLE;
  private windowTime = 0;
  private windowGpu = 0;
  private windowSamples = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  /** Mean GPU time of the last complete window (ms; 0 = none). */
  private lastGpu = 0;
  private lastUp = -Infinity;
  private lastDown = -Infinity;
  private upCooldown = DRS_UP_COOLDOWN;

  get scale(): number {
    return RENDER_SCALES[this.index]!;
  }

  /** Mean GPU time per frame of the last measuring window (ms; 0 = no measurement yet). */
  get gpuMs(): number {
    return this.lastGpu;
  }

  /**
   * GPU-bound with a smaller scale left, or settling after a change: `auto` quality must not step a
   * preset down yet (the resolution reacts first).
   */
  get holdsQuality(): boolean {
    return this.settling > 0 || (this.lastGpu > this.limits.slowMs && this.index < RENDER_SCALES.length - 1);
  }

  /** One rendered frame of `dt` seconds with the GPU time (ms) that finished meanwhile, or null. */
  frame(dt: number, gpuMs: number | null): number | null {
    if (!(dt > 0) || dt > HITCH) return null;
    this.clock += dt;
    if (this.settling > 0) {
      this.settling -= dt;
      return null;
    }
    this.windowTime += dt;
    if (gpuMs !== null && gpuMs >= 0) {
      this.windowGpu += gpuMs;
      this.windowSamples++;
    }
    if (this.windowTime < DRS_WINDOW) return null;
    const samples = this.windowSamples;
    const avg = samples > 0 ? this.windowGpu / samples : 0;
    this.windowTime = 0;
    this.windowGpu = 0;
    this.windowSamples = 0;
    if (samples < MIN_SAMPLES) {
      this.slowWindows = 0;
      this.fastWindows = 0;
      this.lastGpu = 0;
      return null;
    }
    this.lastGpu = avg;
    const up = RENDER_SCALES[this.index - 1];
    this.slowWindows = avg > this.limits.slowMs ? this.slowWindows + 1 : 0;
    this.fastWindows = up !== undefined && avg * (up / this.scale) ** 2 < this.limits.fastMs ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= DRS_SLOW_WINDOWS && this.index < RENDER_SCALES.length - 1) {
      if (this.clock - this.lastUp < DRS_BOUNCE) this.upCooldown = Math.min(DRS_UP_COOLDOWN_MAX, this.upCooldown * 2);
      this.lastDown = this.clock;
      return this.change(this.index + 1);
    }
    if (this.fastWindows >= DRS_FAST_WINDOWS && this.index > 0 && this.clock - this.lastDown >= this.upCooldown) {
      this.lastUp = this.clock;
      return this.change(this.index - 1);
    }
    return null;
  }

  /** Something else changed the GPU cost (a preset change, a resize): measure afresh. */
  settle(): void {
    this.settling = DRS_SETTLE;
    this.windowTime = 0;
    this.windowGpu = 0;
    this.windowSamples = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  /** Back to the full resolution and a fresh start (the setting turned off or on). */
  reset(): void {
    this.index = 0;
    this.clock = 0;
    this.lastGpu = 0;
    this.lastUp = -Infinity;
    this.lastDown = -Infinity;
    this.upCooldown = DRS_UP_COOLDOWN;
    this.settle();
  }

  private change(index: number): number {
    this.index = index;
    this.settle();
    return this.scale;
  }
}

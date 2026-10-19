// Graphics quality (visual polish milestone): presets for Low / Medium / High and the "auto" mode,
// which starts from a guess by the GPU name and then steps down (or once back up) by the measured
// frame time. Pure – no three.js, no DOM – so the presets and the governor are unit tested.

export type GraphicsQuality = 'low' | 'medium' | 'high';
/** What the player picks in the settings; `auto` = by the GPU and the frame rate. */
export type GraphicsSetting = 'auto' | GraphicsQuality;

export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];
export const GRAPHICS_SETTINGS: readonly GraphicsSetting[] = ['auto', 'low', 'medium', 'high'];

export interface QualityPreset {
  /** Upper bound of the device pixel ratio. */
  pixelRatioCap: number;
  /**
   * Sun shadow maps (0 = off) and their PCF softness in texels – kept small: three's PCF spreads
   * its taps with per-pixel noise meant for TAA, wider radii turn the penumbra into stipple.
   */
  shadowMapSize: number;
  shadowRadius: number;
  /** Screen-space ambient occlusion (GTAO) and its resolution relative to the canvas. */
  ao: boolean;
  aoScale: number;
  /**
   * Post chain fill cost (audit 2026-10-16, issue #6): MSAA samples of the HDR scene target (0 = off),
   * FXAA on the final image (the cheap edge smoothing when MSAA is off) and the bloom resolution
   * relative to the canvas.
   */
  msaa: number;
  fxaa: boolean;
  bloomScale: number;
  /** Per-zone colour grading and the vignette. */
  grading: boolean;
  /** Share of the station traffic schedule slots that fly (0..1). */
  traffic: number;
  /** Multiplier of particle counts (dust around asteroids, trail points). */
  particles: number;
  /** Engine trails behind ships. */
  trails: boolean;
  /** Width segments of the planet sphere (height = half). */
  planetSegments: number;
  /** Cloud shell, normal maps and the small moons. */
  planetDetail: boolean;
  /** Largest planet texture width (bigger images are scaled down on load). */
  planetTextureSize: number;
  /** Distant silhouette layers below the plane (0..3) and nebula fog layers (0..2). */
  debrisLayers: number;
  fogLayers: number;
  /** The hangar bay around the shipyard platform (37k triangles, art batch D). */
  hangarBay: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<GraphicsQuality, QualityPreset>> = {
  low: {
    pixelRatioCap: 1,
    shadowMapSize: 0,
    shadowRadius: 0,
    ao: false,
    aoScale: 0.5,
    msaa: 0,
    fxaa: true,
    bloomScale: 0.5,
    grading: true,
    traffic: 0.35,
    particles: 0.35,
    trails: false,
    planetSegments: 48,
    planetDetail: false,
    planetTextureSize: 1024,
    debrisLayers: 1,
    fogLayers: 0,
    hangarBay: true,
  },
  medium: {
    pixelRatioCap: 1.5,
    shadowMapSize: 1024,
    shadowRadius: 0,
    ao: false,
    aoScale: 0.5,
    msaa: 2,
    fxaa: false,
    bloomScale: 0.5,
    grading: true,
    traffic: 0.7,
    particles: 0.65,
    trails: true,
    planetSegments: 96,
    planetDetail: true,
    planetTextureSize: 2048,
    debrisLayers: 2,
    fogLayers: 2,
    hangarBay: true,
  },
  high: {
    pixelRatioCap: 2,
    shadowMapSize: 2048,
    shadowRadius: 0.6,
    ao: true,
    aoScale: 0.5,
    msaa: 4,
    fxaa: false,
    bloomScale: 0.5,
    grading: true,
    traffic: 1,
    particles: 1,
    trails: true,
    planetSegments: 128,
    planetDetail: true,
    planetTextureSize: 4096,
    debrisLayers: 3,
    fogLayers: 2,
    hangarBay: true,
  },
};

/**
 * Low on a software rasterizer (no GPU – a few frames per second at best): the extras that cost a
 * shader compile or real fill there are left out – no planets, sun flare, traffic, far layers or
 * particles, nor the hangar bay around the shipyard platform. The grade stays (it shares the output pass).
 */
export const SOFTWARE_LOW: QualityPreset = { ...QUALITY_PRESETS.low, traffic: 0, particles: 0, debrisLayers: 0, fogLayers: 0, hangarBay: false };

export const presetFor = (quality: GraphicsQuality, software = false): QualityPreset =>
  software && quality === 'low' ? SOFTWARE_LOW : QUALITY_PRESETS[quality];

export const isGraphicsSetting = (v: unknown): v is GraphicsSetting => GRAPHICS_SETTINGS.includes(v as GraphicsSetting);

const lower = (q: GraphicsQuality): GraphicsQuality => (q === 'high' ? 'medium' : 'low');
const higher = (q: GraphicsQuality): GraphicsQuality => (q === 'low' ? 'medium' : 'high');

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/;

/** A software rasterizer (no GPU): Low there also leaves out the planets (shader compile stalls). */
export const isSoftwareGpu = (renderer: string | null | undefined): boolean => SOFTWARE.test((renderer ?? '').toLowerCase());

/**
 * First guess for `auto` from the WebGL renderer string (WEBGL_debug_renderer_info): software
 * rasterizers get Low, integrated / mobile GPUs Medium, everything else (discrete) High.
 */
export function qualityForGpu(renderer: string | null | undefined): GraphicsQuality {
  const name = (renderer ?? '').toLowerCase();
  if (!name) return 'medium';
  if (SOFTWARE.test(name)) return 'low';
  if (/nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|radeon\s*\(tm\)\s*rx|arc\(tm\) a|arc a\d|apple m\d (pro|max|ultra)/.test(name)) return 'high';
  if (/intel|uhd|iris|mali|adreno|powervr|apple|radeon\s*\(tm\)\s*graphics|radeon graphics|vega \d+ graphics/.test(name)) return 'medium';
  return 'high';
}

/** Frame time above which `auto` steps down (s, ≈ 48 fps) and below which it may step up (≈ 100 fps). */
export const AUTO_SLOW_FRAME = 1 / 48;
export const AUTO_FAST_FRAME = 1 / 100;
/** Length of one measuring window (s), windows in a row needed to step down / up. */
export const AUTO_WINDOW = 2;
export const AUTO_SLOW_WINDOWS = 2;
export const AUTO_FAST_WINDOWS = 6;
/** No step up for this long after a step down (s) – no oscillation. */
export const AUTO_UP_COOLDOWN = 30;
/** Frames longer than this (s) are hitches (tab switch, GC, shader compile) and are ignored. */
const HITCH = 0.25;

/**
 * Auto quality governor: fed with frame times, returns a new level when it should change. Starts
 * at the GPU guess; never goes above the guess (a weak GPU that had a fast moment stays capped) and
 * waits a cooldown after every step down before it may climb back.
 */
export class AutoQuality {
  private level: GraphicsQuality;
  private windowTime = 0;
  private windowFrames = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private clock = 0;
  private lastDown = -Infinity;
  /** Settling time after a change (s): new shaders compile, the first frames are slow. */
  private settle = 3;

  constructor(private readonly cap: GraphicsQuality) {
    this.level = cap;
  }

  get current(): GraphicsQuality {
    return this.level;
  }

  /**
   * One rendered frame of `dt` seconds; returns the new level when it changed, else null. `hold`: the
   * dynamic resolution handles a GPU-bound slowdown first (dynamicResolution.ts) – slow windows do not
   * count towards a step down meanwhile.
   */
  frame(dt: number, hold = false): GraphicsQuality | null {
    if (!(dt > 0) || dt > HITCH) return null;
    this.clock += dt;
    if (this.settle > 0) {
      this.settle -= dt;
      return null;
    }
    this.windowTime += dt;
    this.windowFrames++;
    if (this.windowTime < AUTO_WINDOW) return null;
    const avg = this.windowTime / this.windowFrames;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.slowWindows = avg > AUTO_SLOW_FRAME && !hold ? this.slowWindows + 1 : 0;
    this.fastWindows = avg < AUTO_FAST_FRAME ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= AUTO_SLOW_WINDOWS && this.level !== 'low') {
      return this.change(lower(this.level), true);
    }
    const capRank = GRAPHICS_QUALITIES.indexOf(this.cap);
    if (
      this.fastWindows >= AUTO_FAST_WINDOWS &&
      GRAPHICS_QUALITIES.indexOf(this.level) < capRank &&
      this.clock - this.lastDown >= AUTO_UP_COOLDOWN
    ) {
      return this.change(higher(this.level), false);
    }
    return null;
  }

  private change(level: GraphicsQuality, down: boolean): GraphicsQuality {
    this.level = level;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.settle = 3;
    if (down) this.lastDown = this.clock;
    return level;
  }
}

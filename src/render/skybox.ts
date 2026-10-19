import {
  EquirectangularReflectionMapping,
  LinearFilter,
  PMREMGenerator,
  SRGBColorSpace,
  Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { RingIndex } from '../data/economy';
import { prefetched, responseBytes } from './assets/prefetch';
import { assetUrl } from './assets/url';
import { hdrTexture, parseHdr, prestartHdrWorker } from './hdr';
import { decodeImage, type UploadQueue } from './textureUploads';
import { compileDraws } from './warmup';

export interface SkyboxPaths {
  /** Background panorama (equirect, sRGB, WebP – npm run assets:optimize). */
  background: string;
  /** HDR panorama for ambient light and reflections. */
  environment: string;
}

/** Skybox files of a zone (depth 1–4: one panorama per depth). */
export function skyboxPaths(ring: number): SkyboxPaths {
  const n = Math.min(4, Math.max(1, Math.round(ring)));
  return { background: `assets/skybox/ring${n}_bg.webp`, environment: `assets/skybox/ring${n}_env.hdr` };
}

/** Background cross-fade (smoothstep), t = 0..1. */
export function skyMix(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Multiplier of the environment map intensity during the transition – the map is swapped halfway. */
export const envFade = (t: number): number => 0.5 + 0.5 * Math.abs(1 - 2 * Math.min(1, Math.max(0, t)));

/** Intensity of the ambient light from the skybox (the HDR has a low average brightness – the artist's recommendation). */
export const ENVIRONMENT_INTENSITY = 2;
/** Brightness of the background panorama. */
export const BACKGROUND_INTENSITY = 0.9;
/** Sky rotation per unit of distance travelled (rad) – a subtle sense of motion. */
export const SKY_DRIFT = 4e-5;

/** Does the file exist? (The Vite dev server returns index.html with status 200 for a missing file.) */
async function assetExists(path: string): Promise<boolean> {
  // a prefetched file (the start zone's sky, assets/prefetch.ts) is known once its download is in
  const bytes = prefetched(assetUrl(path));
  if (bytes) return (await bytes) !== null;
  try {
    const response = await fetch(assetUrl(path), { method: 'HEAD' });
    return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export interface LoadedSkybox {
  background: Texture | null;
  environment: Texture | null;
  dispose(): void;
}

const EMPTY_SKY: LoadedSkybox = { background: null, environment: null, dispose() {} };

/** What loadSkybox shares between loads of one renderer: the GPU job queue and the PMREM generator. */
export interface SkyboxTools {
  uploads: UploadQueue;
  /** Kept alive between loads: its shaders compile once, not at every sector border (issue #9). */
  pmrem: PMREMGenerator;
  /** The PMREM's programs compiled ahead (set by the first environment map that needs them). */
  pmremPrograms?: Promise<void>;
}

/** How long the PMREM's programs may take to compile ahead before the filter runs anyway (ms). */
const PMREM_COMPILE_MS = 4000;

/**
 * The PMREM's programs (equirect → cube UV, the GGX filter) compiled in parallel, without drawing, for an
 * environment map the size of `hdr` (perf O14): the first filter used to wait for them inside its queue
 * turn, a ~0.3 s long task at 4× CPU.
 */
async function compilePmrem(renderer: WebGLRenderer, pmrem: PMREMGenerator, hdr: Texture): Promise<void> {
  let target: WebGLRenderTarget | null = null;
  try {
    await compileDraws(renderer, () => (target = pmrem.fromEquirectangular(hdr)), new Set(), PMREM_COMPILE_MS);
  } finally {
    (target as WebGLRenderTarget | null)?.dispose();
  }
}

/**
 * Loads a zone's skybox if it exists. Missing files are not an error – the scene keeps the
 * procedural background and stars. `signal` stops the load (the renderer went away): it is checked
 * after every wait, and nothing more reaches the GPU or the PMREM. The panorama is decoded off the
 * main thread and the HDR parsed in a worker; the upload and the PMREM filter each take one turn of
 * the upload queue (audit 2026-10-16, issue #9).
 */
export async function loadSkybox(renderer: WebGLRenderer, ring: number, signal?: AbortSignal, tools?: SkyboxTools): Promise<LoadedSkybox> {
  if (signal?.aborted) return EMPTY_SKY;
  const paths = skyboxPaths(ring);
  const [hasBackground, hasEnvironment] = await Promise.all([
    assetExists(paths.background),
    assetExists(paths.environment),
  ]);
  if (signal?.aborted) return EMPTY_SKY;
  const uploads = tools?.uploads ?? null;
  const gpu = <T>(job: () => T): Promise<T> => (uploads ? uploads.run(job) : Promise.resolve(job()));
  // the HDR downloads (and its parse worker starts) while the panorama downloads and decodes – the two
  // used to follow each other on the first frame's critical path (audit 2026-10-17, P10)
  let environmentData: Promise<ArrayBuffer> | null = null;
  if (hasEnvironment) {
    prestartHdrWorker();
    const url = assetUrl(paths.environment);
    environmentData = (prefetched(url) ?? fetch(url, { signal }).then(responseBytes)).then((data) => {
      if (!data) throw new Error(`missing ${paths.environment}`);
      return data;
    });
    // handled where it is awaited; an early return (abort) must not leave an unhandled rejection
    environmentData.catch(() => {});
  }
  // the HDR is parsed (in the worker) while the panorama decodes (perf O14)
  const environmentParsed = environmentData?.then(parseHdr) ?? null;
  environmentParsed?.catch(() => {});

  let background: Texture | null = null;
  if (hasBackground) {
    try {
      const decoded = await decodeImage(assetUrl(paths.background), Infinity, signal);
      if (signal?.aborted) return EMPTY_SKY;
      if (decoded) {
        const tex = new Texture(decoded.image);
        tex.flipY = decoded.flipY;
        tex.mapping = EquirectangularReflectionMapping;
        tex.colorSpace = SRGBColorSpace;
        // the panorama is not minified (texel ≈ pixel) – without mipmaps there is no seam at the edge of the equirect map
        tex.generateMipmaps = false;
        tex.minFilter = LinearFilter;
        tex.needsUpdate = true;
        background = tex;
        // uploaded when loaded (in its turn of the queue), not at the zone crossing
        await gpu(() => renderer.initTexture(tex));
        if (signal?.aborted) {
          tex.dispose();
          return EMPTY_SKY;
        }
      }
    } catch (e) {
      background?.dispose();
      background = null;
      if (!signal?.aborted) console.warn(`Skybox failed to load: ${paths.background}`, e);
    }
  }

  let environment: Texture | null = null;
  if (environmentParsed) {
    try {
      const parsed = await environmentParsed;
      if (signal?.aborted) {
        background?.dispose();
        return EMPTY_SKY;
      }
      const hdr = hdrTexture(parsed);
      if (tools) await (tools.pmremPrograms ??= compilePmrem(renderer, tools.pmrem, hdr));
      if (signal?.aborted) {
        hdr.dispose();
        background?.dispose();
        return EMPTY_SKY;
      }
      environment = await gpu(() => {
        const pmrem = tools?.pmrem ?? new PMREMGenerator(renderer);
        try {
          return pmrem.fromEquirectangular(hdr).texture;
        } finally {
          if (!tools) pmrem.dispose();
          hdr.dispose();
        }
      });
    } catch (e) {
      if (!signal?.aborted) console.warn(`Environment map failed to load: ${paths.environment}`, e);
    }
  }
  if (signal?.aborted) {
    background?.dispose();
    environment?.dispose();
    return EMPTY_SKY;
  }

  return {
    background,
    environment,
    dispose() {
      background?.dispose();
      environment?.dispose();
    },
  };
}

export type SkyboxLoader = (renderer: WebGLRenderer, ring: RingIndex, signal: AbortSignal, tools?: SkyboxTools) => Promise<LoadedSkybox>;

/**
 * Loaded skyboxes of one renderer – they survive the transition between games (files are not downloaded
 * and PMREM is not computed again). `dispose` aborts the loads in progress and frees the textures.
 */
export class SkyboxCache {
  private readonly entries = new Map<RingIndex, Promise<LoadedSkybox>>();
  private readonly abort = new AbortController();

  /** The GPU queue and the PMREM generator shared by the loads (none without a queue). */
  private tools: SkyboxTools | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly load: SkyboxLoader = loadSkybox,
    /** The renderer's GPU job queue (RenderContext); none = immediate, a PMREM generator per load. */
    private readonly uploads: UploadQueue | null = null,
  ) {}

  get(ring: RingIndex): Promise<LoadedSkybox> {
    let entry = this.entries.get(ring);
    if (!entry) {
      if (this.uploads) this.tools ??= { uploads: this.uploads, pmrem: new PMREMGenerator(this.renderer) };
      entry = this.load(this.renderer, ring, this.abort.signal, this.tools ?? undefined);
      this.entries.set(ring, entry);
    }
    return entry;
  }

  dispose(): void {
    this.abort.abort();
    this.tools?.pmrem.dispose();
    this.tools = null;
    for (const entry of this.entries.values()) void entry.then((sky) => sky.dispose()).catch(() => {});
    this.entries.clear();
  }
}

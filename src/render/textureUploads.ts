// Zone assets without main-thread decode stalls (audit 2026-10-16, issue #9): the skybox panoramas
// (4096 px), the planet textures and the HDR environment maps used to be decoded on the main thread
// and uploaded (or PMREM-filtered) the moment they arrived – 100–500 ms hitches at the sector border
// preload and at the first sight of a planet. Images are now decoded off the main thread
// (createImageBitmap, also the downscale for lower presets), the HDR is parsed in a worker
// (hdr.ts), and the GPU work – one big upload or one PMREM – runs through an UploadQueue: at most
// one job per frame-sized gap, in its own task, independent of the game loop (the shader warm-up
// waits for the start zone's sky before the loop runs).
import { ImageLoader } from 'three';
import { prefetched, responseBytes } from './assets/prefetch';

/** One GPU job (a big texture upload, a PMREM filter) per gap, in its own task. */
export class UploadQueue {
  private readonly jobs: (() => void)[] = [];
  /** Jobs that wait for every other one (the effect textures: nothing waits for them, perf O14). */
  private readonly lateJobs: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /** @param gapMs time between two jobs (about one frame) */
  constructor(private readonly gapMs = 16) {}

  /**
   * Runs `job` once its turn comes; resolves with its result (rejects if the queue is disposed first).
   * A `late` job's turn comes after every waiting job that is not late.
   */
  run<T>(job: () => T, late = false): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('UploadQueue disposed'));
    return new Promise<T>((resolve, reject) => {
      (late ? this.lateJobs : this.jobs).push(() => {
        if (this.disposed) {
          reject(new Error('UploadQueue disposed'));
          return;
        }
        try {
          resolve(job());
        } catch (e) {
          reject(e);
        }
      });
      this.schedule();
    });
  }

  /** Jobs still waiting (tests, stats). */
  get pending(): number {
    return this.jobs.length + this.lateJobs.length;
  }

  private schedule(): void {
    if (this.timer !== null || this.pending === 0 || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      (this.jobs.shift() ?? this.lateJobs.shift())?.();
      this.schedule();
    }, this.gapMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // the waiting jobs reject (their callers stop)
    for (const job of [...this.jobs.splice(0), ...this.lateJobs.splice(0)]) job();
  }
}

/** A decoded image ready for a three.js Texture: `flipY` = what the texture must set. */
export interface DecodedImage {
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  flipY: boolean;
}

/**
 * Downloads and decodes an image off the main thread (createImageBitmap: decode, the vertical flip
 * WebGL needs and an optional downscale to `maxWidth`). Without createImageBitmap it falls back to
 * an <img> (and a canvas for the downscale) on the main thread. Null = missing file. `priority`: the
 * download's network priority (an effect texture yields to the start zone's sky – 'low').
 */
export async function decodeImage(url: string, maxWidth = Infinity, signal?: AbortSignal, priority?: RequestPriority): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return decodeOnMainThread(url, maxWidth);
  // the boot list downloads ahead of the game (assets/prefetch.ts)
  const data = await (prefetched(url) ?? fetch(url, priority ? { signal, priority } : { signal }).then(responseBytes));
  if (!data || signal?.aborted) return null;
  const blob = new Blob([data]);
  // no colour management: albedo is sRGB data three handles itself, normal maps are linear data
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (!(bitmap.width > maxWidth)) return { image: bitmap, flipY: false };
  const scaled = await createImageBitmap(bitmap, {
    resizeWidth: maxWidth,
    resizeHeight: Math.max(1, Math.round((bitmap.height * maxWidth) / bitmap.width)),
    resizeQuality: 'high',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  bitmap.close();
  return { image: scaled, flipY: false };
}

async function decodeOnMainThread(url: string, maxWidth: number): Promise<DecodedImage | null> {
  const img = await new ImageLoader().loadAsync(url).catch(() => null);
  if (!img) return null;
  if (!(img.width > maxWidth) || typeof document === 'undefined') return { image: img, flipY: true };
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = Math.max(1, Math.round((img.height * maxWidth) / img.width));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { image: canvas, flipY: true };
}

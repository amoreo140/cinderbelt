// Asset bytes downloaded ahead of their first use (perf O14: cold boot to the first game frame). The
// layers of a game start their downloads only once the Game is built – after the 62 models of the
// library – so ~16 MB of the start used to queue behind them. The boot list (bootAssets.ts) is fetched
// here while the models download (or behind the menu); fetchAsset, decodeImage and loadImageAsset take
// the bytes from here, the network only for what is not here. Every caller gets its own copy (a worker
// may take the bytes). The bytes stay until `releasePrefetched` (the warm-up's end). Three-free.
import { assetUrl } from './url';

type Bytes = Promise<ArrayBuffer | null>;

/**
 * When a prefetch downloads: `first` at once at high priority (the start zone's sky – the warm-up's
 * first phase waits for it), `early` and `start` in the queue (what the warm-up waits for; `early` at
 * high priority, ahead of every `start` file even when asked for later – what the layers build batches
 * from), `late` once every `start` file is in (what nothing waits for: the effect textures – the first
 * game frame does not wait for their 3.9 MB; they are uploaded in a queue gap when they arrive).
 */
export type PrefetchOrder = 'first' | 'early' | 'start' | 'late';

/** Prefetched downloads by URL. */
const stash = new Map<string, Bytes>();
/** Queued downloads by order, and the number in flight (all, and of the `start` order). */
const queued: Record<'early' | 'start' | 'late', (() => void)[]> = { early: [], start: [], late: [] };
let active = 0;
let activeStart = 0;
let limit = Infinity;

function pump(): void {
  while (active < limit) {
    const next = queued.early.shift() ?? queued.start.shift() ?? (activeStart === 0 ? queued.late.shift() : undefined);
    if (!next) return;
    next();
  }
}

/**
 * At most `max` queued prefetches in flight until `until` settles (the model library: on HTTP/1.1 the
 * browser's six connections would otherwise go to the boot list in the order asked, and the library –
 * the first thing the game start needs – would share them).
 */
export function holdPrefetch(until: Promise<unknown>, max = 1): void {
  limit = max;
  const open = (): void => {
    limit = Infinity;
    pump();
  };
  until.then(open, open);
}

/** The response's bytes, or null when the file does not exist (the dev server answers HTML for it). */
export async function responseBytes(response: Response): Promise<ArrayBuffer | null> {
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return null;
  return response.arrayBuffer();
}

/** Starts downloading `path` (relative to BASE_URL) unless it is prefetched already. */
export function prefetchAsset(path: string, order: PrefetchOrder = 'start'): void {
  const url = assetUrl(path);
  if (stash.has(url) || typeof fetch !== 'function') return;
  if (order === 'first') {
    stash.set(url, fetch(url, { priority: 'high' }).then(responseBytes, () => null));
    return;
  }
  const bytes = new Promise<ArrayBuffer | null>((resolve) => {
    const start = order !== 'late';
    queued[order].push(() => {
      active++;
      if (start) activeStart++;
      // low network priority (`early`: high): whatever the game asks for itself comes first
      fetch(url, { priority: order === 'early' ? 'high' : 'low' })
        .then(responseBytes, () => null)
        .catch(() => null)
        .then((data) => {
          active--;
          if (start) activeStart--;
          resolve(data);
          pump();
        });
    });
  });
  stash.set(url, bytes);
  pump();
}

/** Boot-list files the warm-up waits for that are still queued or downloading (`early` and `start`). */
export function prefetchesPending(): number {
  return queued.early.length + queued.start.length + activeStart;
}

/** A copy of the prefetched bytes of `url` (null = missing file), or undefined when it is not prefetched. */
export function prefetched(url: string): Bytes | undefined {
  const bytes = stash.get(url);
  return bytes?.then((data) => data && data.slice(0));
}

/** The bytes of `url`: prefetched, or downloaded now (null = missing file or no network). */
export function assetBytes(url: string, priority?: RequestPriority): Bytes {
  return prefetched(url) ?? (typeof fetch === 'function' ? fetch(url, priority ? { priority } : undefined).then(responseBytes, () => null) : Promise.resolve(null));
}

/** Drops the prefetched bytes (the game has taken what it needed; a later use downloads again). */
export function releasePrefetched(): void {
  stash.clear();
}

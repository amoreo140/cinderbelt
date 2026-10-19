// Off-main-thread LOD1 of graveyard wreck batches (perf audit 2026-10-17, P2.2; wreckLodCore.ts): a
// wreck's merged meshes simplify in one shared worker (wreckLodWorker.ts) – a 15 k-triangle wreck took
// ~4 ms of simplifier time, too long for a frame at the 4× CPU budget. Without workers (unit tests, a
// worker that fails to start) there is no LOD1: the batches draw LOD0 in every band.
import type { LodJob } from './wreckLodCore';

/** Simplifies the jobs somewhere; null = no LOD1 available now. */
export type LodProvider = (jobs: LodJob[]) => Promise<(Uint32Array | null)[]> | null;

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const waiting = new Map<number, (lods: (Uint32Array | null)[] | null) => void>();

function lodWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./wreckLodWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; lods?: (Uint32Array | null)[]; error?: string }>) => {
      const done = waiting.get(e.data.id);
      if (!done) return;
      waiting.delete(e.data.id);
      done(e.data.lods ?? null);
    };
    worker.onerror = () => {
      // a worker that cannot start: no LOD1 from now on (LOD0 draws everywhere)
      workerFailed = true;
      worker = null;
      for (const done of waiting.values()) done(null);
      waiting.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** The worker's LOD1 (the jobs' arrays are transferred – the caller passes copies). */
export const workerLod: LodProvider = (jobs) => {
  const w = lodWorker();
  if (!w) return null;
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, (lods) => resolve(lods ?? jobs.map(() => null)));
    const transfer: Transferable[] = [];
    for (const j of jobs) {
      transfer.push(j.index.buffer, j.positions.buffer);
      if (j.normals) transfer.push(j.normals.buffer);
    }
    w.postMessage({ id, jobs }, transfer);
  });
};

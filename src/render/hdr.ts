// Off-main-thread RGBE parsing (audit 2026-10-16, issue #9): an environment HDR (1024×512) took
// 50–300 ms of main-thread JS to parse when the next sector's sky preloaded mid-flight. One shared
// worker parses it (hdrWorker.ts); without workers (tests, old browsers) it parses in place.
import { DataTexture, EquirectangularReflectionMapping, LinearFilter, LinearSRGBColorSpace, RGBAFormat, type TextureDataType } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

interface Parsed {
  width: number;
  height: number;
  data: Uint16Array | Float32Array;
  type: TextureDataType;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const waiting = new Map<number, { resolve: (p: Parsed) => void; reject: (e: Error) => void }>();

function hdrWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./hdrWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Parsed & { id: number; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve(e.data);
    };
    worker.onerror = () => {
      // a worker that cannot start: parse on the main thread from now on
      workerFailed = true;
      worker = null;
      for (const w of waiting.values()) w.reject(new Error('HDR worker failed'));
      waiting.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** Starts the parse worker ahead of the first HDR (its script downloads while the HDR does). */
export function prestartHdrWorker(): void {
  hdrWorker();
}

const parseHere = (buffer: ArrayBuffer): Parsed => {
  const r = new HDRLoader().parse(buffer);
  return { width: r.width ?? 0, height: r.height ?? 0, data: r.data as Uint16Array | Float32Array, type: r.type as TextureDataType };
};

/** Parses an .hdr file (in the worker when possible). */
export async function parseHdr(buffer: ArrayBuffer): Promise<Parsed> {
  const w = hdrWorker();
  if (!w) return parseHere(buffer);
  const copy = buffer.slice(0);
  try {
    return await new Promise<Parsed>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      w.postMessage({ id, buffer }, [buffer]);
    });
  } catch {
    return parseHere(copy);
  }
}

/** The equirect DataTexture HDRLoader would make (linear, no mips, flipped) from parsed pixels. */
export function hdrTexture(p: Parsed): DataTexture {
  const tex = new DataTexture(p.data, p.width, p.height, RGBAFormat, p.type);
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.mapping = EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

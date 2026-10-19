// Bounded memo of a pure per-chunk generator (audit 2026-10-16, issue #10): the discovery, combat
// and render code ask for the stations, distress signals and places of the same chunks every frame,
// and each answer was rebuilt (an RNG, its numbers, the result objects) – megabytes of garbage per
// second. The memo only remembers answers of a pure function of (key, chunk): no hidden state that
// could change a result, so the simulation stays deterministic. One `key` (seed and the like) at a
// time: another key starts a fresh memo. Callers must treat the answers as read-only.

/** A number for a chunk (|cx|, |cy| < 2^20 – the world is far smaller): no string per lookup. */
export const chunkKey = (cx: number, cy: number): number => (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576);

/** Chunks with integer |cx|, |cy| < NEAR get a small-integer key (< 2^30, a V8 Smi even with pointer compression). */
const NEAR = 16_384;

/**
 * The small-integer key of a near chunk (integer coordinates), or -1. `chunkKey` is ~2^41: a heap number
 * that V8 boxes on every Map lookup (perf audit 2026-10-17, P4 – a few hundred lookups per step); a Smi key
 * allocates nothing.
 */
export const nearChunkKey = (cx: number, cy: number): number =>
  (cx | 0) === cx && (cy | 0) === cy && cx >= -NEAR && cx < NEAR && cy >= -NEAR && cy < NEAR ? (cx + NEAR) * 32_768 + (cy + NEAR) : -1;

/**
 * A number for an integer chunk that is a Smi for the near ones (`nearChunkKey`) and `chunkKey` shifted
 * past every near key for the rest – exact either way (< 2^53). For Maps keyed by chunk.
 */
export const packedChunkKey = (cx: number, cy: number): number => {
  const k = nearChunkKey(cx, cy);
  return k >= 0 ? k : 2 ** 50 + chunkKey(cx, cy);
};

export class ChunkMemo<T> {
  private key = NaN;
  /** Near chunks by their Smi key (`nearChunkKey`). */
  private readonly near = new Map<number, T>();
  /** Far chunks (never in practice) by `chunkKey`. */
  private readonly far = new Map<number, T>();

  /** @param max answers kept before the memo starts over (bounded memory) */
  constructor(private readonly max = 4096) {}

  /** The remembered answer for (key, chunk), or undefined (then compute it and `set` it). */
  get(key: number, cx: number, cy: number): T | undefined {
    if (key !== this.key) {
      this.clear();
      this.key = key;
      return undefined;
    }
    const k = nearChunkKey(cx, cy);
    return k >= 0 ? this.near.get(k) : this.far.get(chunkKey(cx, cy));
  }

  /** Remembers the answer for (key, chunk) – call right after a `get` miss with the same key. */
  set(key: number, cx: number, cy: number, value: T): T {
    if (key !== this.key) {
      this.clear();
      this.key = key;
    }
    if (this.size >= this.max) this.clear();
    const k = nearChunkKey(cx, cy);
    if (k >= 0) this.near.set(k, value);
    else this.far.set(chunkKey(cx, cy), value);
    return value;
  }

  private clear(): void {
    this.near.clear();
    this.far.clear();
  }

  /** Answers held now (tests). */
  get size(): number {
    return this.near.size + this.far.size;
  }
}

// The prefetch store (perf O14): bytes downloaded ahead and handed out as copies, the boot list's order
// (the library first, the effect textures last), and the drop after the warm-up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAsset } from './ModelLibrary';
import { assetBytes, holdPrefetch, prefetchAsset, prefetched, releasePrefetched } from './prefetch';
import { assetUrl } from './url';

interface Call {
  url: string;
  priority: RequestPriority | undefined;
  resolve: (status?: number) => void;
}

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      calls.push({ url, priority: init?.priority, resolve: (status = 200) => resolve(new Response(new Uint8Array([1, 2, 3]), { status })) });
    }),
  );
});

afterEach(() => {
  releasePrefetched();
  vi.unstubAllGlobals();
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('prefetch store', () => {
  it('hands every caller its own copy of the bytes, until released', async () => {
    prefetchAsset('assets/a.glb');
    expect(calls.map((c) => c.url)).toEqual([assetUrl('assets/a.glb')]);
    // a second request for the same file does not download again
    prefetchAsset('assets/a.glb');
    expect(calls).toHaveLength(1);
    calls[0]!.resolve();
    const one = await prefetched(assetUrl('assets/a.glb'))!;
    const two = await prefetched(assetUrl('assets/a.glb'))!;
    expect(new Uint8Array(one!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(one).not.toBe(two);
    releasePrefetched();
    expect(prefetched(assetUrl('assets/a.glb'))).toBeUndefined();
  });

  it('is where fetchAsset takes its bytes from', async () => {
    prefetchAsset('assets/b.glb');
    const data = fetchAsset('assets/b.glb');
    calls[0]!.resolve();
    expect(new Uint8Array((await data)!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toHaveLength(1);
  });

  it('answers a missing file with null and downloads what it does not have', async () => {
    prefetchAsset('assets/missing.glb');
    calls[0]!.resolve(404);
    expect(await prefetched(assetUrl('assets/missing.glb'))!).toBeNull();
    const bytes = assetBytes(assetUrl('assets/other.glb'), 'high');
    expect(calls[1]).toMatchObject({ url: assetUrl('assets/other.glb'), priority: 'high' });
    calls[1]!.resolve();
    expect(await bytes).not.toBeNull();
  });

  it('keeps one queued download in flight while held, the sky (`first`) at once at high priority', async () => {
    let open = (): void => {};
    holdPrefetch(new Promise<void>((resolve) => (open = resolve)));
    prefetchAsset('assets/1.glb');
    prefetchAsset('assets/2.glb');
    prefetchAsset('assets/sky.hdr', 'first');
    expect(calls.map((c) => [c.url.replace(/^.*\//, ''), c.priority])).toEqual([
      ['1.glb', 'low'],
      ['sky.hdr', 'high'],
    ]);
    open();
    await settle();
    expect(calls.map((c) => c.url.replace(/^.*\//, ''))).toEqual(['1.glb', 'sky.hdr', '2.glb']);
    for (const c of calls) c.resolve();
    await settle();
    await settle();
  });

  it('starts `early` files before the `start` ones and `late` ones only after every `start` file is in', async () => {
    let open = (): void => {};
    holdPrefetch(new Promise<void>((resolve) => (open = resolve)));
    prefetchAsset('assets/blocker.glb');
    prefetchAsset('assets/late.webp', 'late');
    prefetchAsset('assets/start.glb');
    prefetchAsset('assets/early.glb', 'early');
    open();
    await settle();
    const names = (): string[] => calls.map((c) => c.url.replace(/^.*\//, ''));
    expect(names()).toEqual(['blocker.glb', 'early.glb', 'start.glb']);
    expect(calls[1]!.priority).toBe('high');
    calls[0]!.resolve();
    calls[1]!.resolve();
    await settle();
    expect(names()).toHaveLength(3);
    calls[2]!.resolve();
    await settle();
    await settle();
    expect(names()).toEqual(['blocker.glb', 'early.glb', 'start.glb', 'late.webp']);
    calls[3]!.resolve();
    await settle();
  });
});

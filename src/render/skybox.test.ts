import type { WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { envFade, loadSkybox, SkyboxCache, skyboxPaths, skyMix, type LoadedSkybox } from './skybox';

describe('skyboxPaths', () => {
  it('picks the panorama of the zone', () => {
    expect(skyboxPaths(1)).toEqual({
      background: 'assets/skybox/ring1_bg.webp',
      environment: 'assets/skybox/ring1_env.hdr',
    });
    expect(skyboxPaths(3).background).toBe('assets/skybox/ring3_bg.webp');
  });

  it('clamps unknown zones to rings 1–4', () => {
    expect(skyboxPaths(0).background).toBe('assets/skybox/ring1_bg.webp');
    expect(skyboxPaths(9).environment).toBe('assets/skybox/ring4_env.hdr');
  });
});

describe('crossfade', () => {
  it('eases the background mix from 0 to 1', () => {
    expect(skyMix(0)).toBe(0);
    expect(skyMix(1)).toBe(1);
    expect(skyMix(0.5)).toBeCloseTo(0.5);
    expect(skyMix(0.25)).toBeLessThan(0.25);
  });

  it('dips the environment light to half at the swap', () => {
    expect(envFade(0)).toBe(1);
    expect(envFade(0.5)).toBe(0.5);
    expect(envFade(1)).toBe(1);
    expect(envFade(0.25)).toBeCloseTo(0.75);
  });
});

describe('loadSkybox abort (M24)', () => {
  const renderer = () => {
    const calls: string[] = [];
    return { calls, renderer: { initTexture: () => calls.push('initTexture') } as unknown as WebGLRenderer };
  };

  it('does nothing for an already aborted load', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { calls, renderer: r } = renderer();
      const controller = new AbortController();
      controller.abort();
      const sky = await loadSkybox(r, 1, controller.signal);
      expect(sky.background).toBeNull();
      expect(sky.environment).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops before decoding and uploading when the renderer goes away during the download', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => {
      controller.abort(); // the game ended during the download
      return { ok: true, headers: { get: () => 'image/jpeg' } };
    });
    try {
      const { calls, renderer: r } = renderer();
      const sky = await loadSkybox(r, 1, controller.signal);
      expect(sky.background).toBeNull();
      expect(sky.environment).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('SkyboxCache (M25)', () => {
  const fakeSky = (): LoadedSkybox & { disposed: number } => {
    const sky = { background: null, environment: null, disposed: 0, dispose: () => sky.disposed++ };
    return sky;
  };

  it('loads every ring once and shares it between games', async () => {
    const loads: number[] = [];
    const cache = new SkyboxCache({} as WebGLRenderer, async (_r, ring) => (loads.push(ring), fakeSky()));
    const a = cache.get(2);
    const b = cache.get(2);
    expect(a).toBe(b);
    await cache.get(3);
    expect(loads).toEqual([2, 3]);
  });

  it('aborts pending loads and disposes the loaded skies on dispose', async () => {
    const skies: ReturnType<typeof fakeSky>[] = [];
    let signal: AbortSignal | undefined;
    const cache = new SkyboxCache({} as WebGLRenderer, async (_r, _ring, s) => {
      signal = s;
      const sky = fakeSky();
      skies.push(sky);
      return sky;
    });
    await cache.get(1);
    const pending = cache.get(2);
    cache.dispose();
    expect(signal?.aborted).toBe(true);
    await pending;
    await Promise.resolve();
    expect(skies.map((s) => s.disposed)).toEqual([1, 1]);
  });
});

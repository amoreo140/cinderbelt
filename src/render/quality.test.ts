import { describe, expect, it } from 'vitest';
import {
  AUTO_FAST_WINDOWS,
  AUTO_SLOW_WINDOWS,
  AUTO_UP_COOLDOWN,
  AUTO_WINDOW,
  AutoQuality,
  GRAPHICS_QUALITIES,
  isGraphicsSetting,
  isSoftwareGpu,
  presetFor,
  QUALITY_PRESETS,
  qualityForGpu,
} from './quality';

/** Feeds the governor `seconds` of frames of `dt` and returns every change. */
function run(auto: AutoQuality, dt: number, seconds: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const q = auto.frame(dt);
    if (q) out.push(q);
  }
  return out;
}

describe('quality presets', () => {
  it('every step up costs more and never drops a feature', () => {
    const [low, medium, high] = GRAPHICS_QUALITIES.map((q) => QUALITY_PRESETS[q]);
    for (const [a, b] of [[low!, medium!], [medium!, high!]] as const) {
      expect(b.pixelRatioCap).toBeGreaterThanOrEqual(a.pixelRatioCap);
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
      expect(b.traffic).toBeGreaterThanOrEqual(a.traffic);
      expect(b.particles).toBeGreaterThanOrEqual(a.particles);
      expect(b.planetSegments).toBeGreaterThanOrEqual(a.planetSegments);
      expect(b.planetTextureSize).toBeGreaterThanOrEqual(a.planetTextureSize);
      expect(b.debrisLayers).toBeGreaterThanOrEqual(a.debrisLayers);
      if (a.ao) expect(b.ao).toBe(true);
      if (a.trails) expect(b.trails).toBe(true);
    }
  });

  it('post chain: MSAA grows with the level, edges are always smoothed, bloom never above full res', () => {
    const [low, medium, high] = GRAPHICS_QUALITIES.map((q) => QUALITY_PRESETS[q]);
    expect(medium!.msaa).toBeGreaterThanOrEqual(low!.msaa);
    expect(high!.msaa).toBeGreaterThanOrEqual(medium!.msaa);
    expect(low!.msaa).toBe(0);
    for (const p of [low!, medium!, high!]) {
      expect(p.msaa > 0 || p.fxaa).toBe(true);
      expect(p.bloomScale).toBeGreaterThan(0);
      expect(p.bloomScale).toBeLessThanOrEqual(1);
    }
  });

  it('low has no shadows or AO, high has both', () => {
    expect(QUALITY_PRESETS.low.shadowMapSize).toBe(0);
    expect(QUALITY_PRESETS.low.ao).toBe(false);
    expect(QUALITY_PRESETS.high.shadowMapSize).toBeGreaterThan(0);
    expect(QUALITY_PRESETS.high.ao).toBe(true);
  });

  it('recognises the settings values', () => {
    expect(isGraphicsSetting('auto')).toBe(true);
    expect(isGraphicsSetting('high')).toBe(true);
    expect(isGraphicsSetting('ultra')).toBe(false);
    expect(isGraphicsSetting(undefined)).toBe(false);
  });
});

describe('presetFor', () => {
  it('software Low drops the extras, a GPU keeps them', () => {
    expect(presetFor('low', true)).toMatchObject({ traffic: 0, particles: 0, debrisLayers: 0, fogLayers: 0, hangarBay: false });
    for (const q of ['low', 'medium', 'high'] as const) expect(presetFor(q).hangarBay).toBe(true);
    expect(presetFor('low', false)).toBe(QUALITY_PRESETS.low);
    expect(presetFor('high', true)).toBe(QUALITY_PRESETS.high);
  });
});

describe('isSoftwareGpu', () => {
  it('tells software rasterizers from GPUs', () => {
    expect(isSoftwareGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareGpu(null)).toBe(false);
  });
});

describe('qualityForGpu', () => {
  it('software rasterizers are low', () => {
    expect(qualityForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe('low');
    expect(qualityForGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
  });
  it('integrated GPUs are medium', () => {
    expect(qualityForGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(qualityForGpu('ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000164E) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(qualityForGpu('Apple GPU')).toBe('medium');
  });
  it('discrete GPUs are high', () => {
    expect(qualityForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(qualityForGpu('ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
  });
  it('unknown name is medium', () => {
    expect(qualityForGpu(null)).toBe('medium');
  });
});

describe('AutoQuality', () => {
  it('stays put at a steady 60 fps', () => {
    const auto = new AutoQuality('high');
    expect(run(auto, 1 / 60, 60)).toEqual([]);
    expect(auto.current).toBe('high');
  });

  it('steps down after sustained slow frames, one level at a time', () => {
    const auto = new AutoQuality('high');
    const changes = run(auto, 1 / 30, 3 + AUTO_WINDOW * AUTO_SLOW_WINDOWS + 0.5);
    expect(changes).toEqual(['medium']);
    expect(run(auto, 1 / 30, 3 + AUTO_WINDOW * AUTO_SLOW_WINDOWS + 0.5)).toEqual(['low']);
    expect(run(auto, 1 / 20, 30)).toEqual([]);
  });

  it('ignores hitches (one long frame is not a slow GPU)', () => {
    const auto = new AutoQuality('high');
    for (let i = 0; i < 20; i++) {
      run(auto, 1 / 60, 1);
      auto.frame(0.5);
    }
    expect(auto.current).toBe('high');
  });

  it('climbs back after the cooldown but never above the GPU guess', () => {
    const auto = new AutoQuality('medium');
    expect(run(auto, 1 / 30, 3 + AUTO_WINDOW * AUTO_SLOW_WINDOWS + 0.5)).toEqual(['low']);
    // fast right after the drop: no climb before the cooldown
    expect(run(auto, 1 / 200, AUTO_UP_COOLDOWN - 8)).toEqual([]);
    const later = run(auto, 1 / 200, AUTO_WINDOW * AUTO_FAST_WINDOWS + 20);
    expect(later).toEqual(['medium']);
    expect(run(auto, 1 / 200, 120)).toEqual([]);
    expect(auto.current).toBe('medium');
  });

  it('holds the step down while the dynamic resolution handles a GPU-bound slowdown', () => {
    const auto = new AutoQuality('high');
    let changes: string[] = [];
    for (let t = 0; t < 30; t += 1 / 30) {
      const q = auto.frame(1 / 30, true);
      if (q) changes.push(q);
    }
    expect(changes).toEqual([]);
    // the resolution is at its floor (no more hold): the preset steps down as before
    changes = run(auto, 1 / 30, AUTO_WINDOW * AUTO_SLOW_WINDOWS + 0.5);
    expect(changes).toEqual(['medium']);
  });
});

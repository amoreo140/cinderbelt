import { describe, expect, it } from 'vitest';
import { BACKGROUND_BRIGHTNESS_DEFAULT, backdropLook } from './backdrop';

describe('backdrop look (background brightness)', () => {
  it('full brightness is the original look', () => {
    expect(backdropLook(1)).toMatchObject({ sky: 1, skySaturation: 1, skyHighlight: 1, stars: 1, fog: 1, haze: 1, debris: 1, planets: 1, sun: 1 });
  });

  it('the default is about a third darker and less saturated than the original', () => {
    const d = backdropLook(BACKGROUND_BRIGHTNESS_DEFAULT);
    expect(d.sky).toBeGreaterThanOrEqual(0.6);
    expect(d.sky).toBeLessThanOrEqual(0.7);
    expect(d.skySaturation).toBeLessThanOrEqual(0.8);
    expect(d.stars).toBeLessThanOrEqual(0.7);
    expect(d.fog).toBeLessThanOrEqual(0.7);
    // the stars (highlights) are compressed harder than the nebula
    expect(d.skyHighlight).toBeLessThan(d.sky + 0.1);
    expect(d.haze).toBeGreaterThan(1);
  });

  it('darker setting = darker backdrop on every channel; never fully black', () => {
    const keys = ['sky', 'skySaturation', 'skyHighlight', 'stars', 'fog', 'debris', 'planets', 'sun'] as const;
    for (let i = 0; i < 10; i++) {
      const a = backdropLook(i / 10);
      const b = backdropLook((i + 1) / 10);
      for (const k of keys) expect(a[k]).toBeLessThanOrEqual(b[k]);
      expect(a.haze).toBeGreaterThanOrEqual(b.haze);
    }
    const zero = backdropLook(0);
    for (const k of keys) expect(zero[k]).toBeGreaterThan(0);
  });

  it('clamps out-of-range and invalid levels', () => {
    expect(backdropLook(3)).toEqual(backdropLook(1));
    expect(backdropLook(-1)).toEqual(backdropLook(0));
    expect(backdropLook(Number.NaN)).toEqual(backdropLook(BACKGROUND_BRIGHTNESS_DEFAULT));
  });
});

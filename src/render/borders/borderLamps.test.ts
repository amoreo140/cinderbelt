import { describe, expect, it } from 'vitest';
import { BUOY_ON, BUOY_PERIOD, BUOY_STEP, lampLevel, STROBE_PERIOD, type LampRhythm } from './borderLamps';

const ALL: LampRhythm[] = ['guarded', 'quiet', 'contested', 'pirate', 'buoy', 'strobe', 'nav'];

describe('lampLevel', () => {
  it('stays within 0..1 and the quiet marker is the calmest', () => {
    let quietMax = 0;
    let guardedMax = 0;
    for (const r of ALL) {
      for (let t = 0; t < 10; t += 0.013) {
        const l = lampLevel(r, t, 0.3);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
        if (r === 'quiet') quietMax = Math.max(quietMax, l);
        if (r === 'guarded') guardedMax = Math.max(guardedMax, l);
      }
    }
    expect(quietMax).toBeLessThan(guardedMax * 0.6);
  });

  it('chases the buoys outward: buoy k lights BUOY_STEP after buoy k − 1', () => {
    const onAt = (k: number) => {
      for (let t = 0; t < BUOY_PERIOD; t += 0.005) if (lampLevel('buoy', t, k) === 1 && lampLevel('buoy', t - 0.005, k) < 1) return t;
      return -1;
    };
    const a = onAt(2);
    const b = onAt(3);
    expect(b - a).toBeCloseTo(BUOY_STEP, 2);
    let on = 0;
    for (let t = 0; t < BUOY_PERIOD; t += 0.001) if (lampLevel('buoy', t, 0) === 1) on += 0.001;
    expect(on).toBeCloseTo(BUOY_ON, 1);
  });

  it('double-flashes the strobe once per period', () => {
    let flashes = 0;
    let prev = 0;
    for (let t = 0; t < STROBE_PERIOD; t += 0.002) {
      const l = lampLevel('strobe', t, 0);
      if (l === 1 && prev === 0) flashes++;
      prev = l;
    }
    expect(flashes).toBe(2);
  });

  it('holds still with reduced motion', () => {
    for (const r of ALL) expect(new Set([0, 0.37, 1.9, 7.3].map((t) => lampLevel(r, t, 0.5, true))).size).toBe(1);
  });

  it('flickers the contested lamp but keeps it mostly on', () => {
    let on = 0;
    let n = 0;
    for (let t = 0; t < 20; t += 0.01, n++) if (lampLevel('contested', t, 0.2) > 0.5) on++;
    expect(on / n).toBeGreaterThan(0.65);
    expect(on / n).toBeLessThan(0.95);
  });
});

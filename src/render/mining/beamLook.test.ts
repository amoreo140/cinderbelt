import { describe, expect, it } from 'vitest';
import { beamLook, EXTEND_SECONDS, noise1, RETRACT_SECONDS, stepExtend, type BeamState } from './beamLook';

const base: BeamState = { bonus: 1, heat: 0, starved: false, heavy: false, time: 1, phase: 0 };

describe('beamLook', () => {
  it('has a white-hot core brighter than its coloured glow', () => {
    const l = beamLook(base);
    const sum = (c: readonly number[]) => c[0]! + c[1]! + c[2]!;
    expect(sum(l.core)).toBeGreaterThan(sum(l.glow) * 2);
    // near-white: no channel far below the others
    expect(Math.min(...l.core) / Math.max(...l.core)).toBeGreaterThan(0.75);
    expect(l.glow[0]).toBeGreaterThan(l.glow[1]);
    expect(l.glowWidth).toBeGreaterThan(l.coreWidth * 4);
    // the glow keeps its hue through the tone mapping (not blown out to white)
    expect(Math.max(...l.glow)).toBeLessThan(2.5);
    expect(l.intensity).toBe(1);
  });

  it('warms to gold and intensifies on the vein bonus segment', () => {
    const n = beamLook(base);
    const b = beamLook({ ...base, bonus: 1.5 });
    expect(b.intensity).toBeGreaterThan(n.intensity);
    expect(b.glow[1] / b.glow[0]).toBeGreaterThan(n.glow[1] / n.glow[0]);
    expect(b.glow[2]).toBeLessThan(n.glow[2]);
    expect(b.glowWidth).toBeGreaterThan(n.glowWidth);
    expect(b.flow).toBeGreaterThan(n.flow);
  });

  it('a heavy laser draws a thicker beam', () => {
    expect(beamLook({ ...base, heavy: true }).coreWidth).toBeGreaterThan(beamLook(base).coreWidth * 1.4);
  });

  it('flickers toward red near overheating', () => {
    const cool = beamLook({ ...base, heat: 0.5 });
    expect(cool.glow).toEqual(beamLook(base).glow);
    const hot = beamLook({ ...base, heat: 0.98 });
    expect(hot.glow[1]).toBeLessThan(cool.glow[1]);
    const values = new Set<number>();
    for (let i = 0; i < 40; i++) values.add(Math.round(beamLook({ ...base, heat: 0.98, time: i / 24 }).intensity * 100));
    expect(values.size).toBeGreaterThan(5);
  });

  it('sputters out of energy – gaps and dim bursts', () => {
    const seen = Array.from({ length: 60 }, (_, i) => beamLook({ ...base, starved: true, time: i / 18 }).intensity);
    expect(seen.some((x) => x === 0)).toBe(true);
    expect(seen.some((x) => x > 0.3)).toBe(true);
    expect(Math.max(...seen)).toBeLessThan(0.81);
  });

  it('noise is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      expect(noise1(i)).toBe(noise1(i));
      expect(noise1(i)).toBeGreaterThanOrEqual(0);
      expect(noise1(i)).toBeLessThan(1);
    }
  });
});

describe('stepExtend', () => {
  it('shoots out in EXTEND_SECONDS and retracts in RETRACT_SECONDS', () => {
    let e = 0;
    for (let t = 0; t < EXTEND_SECONDS - 1e-6; t += 0.01) e = stepExtend(e, true, 0.01);
    expect(e).toBeGreaterThan(0.85);
    e = stepExtend(e, true, 1);
    expect(e).toBe(1);
    e = stepExtend(e, false, RETRACT_SECONDS / 2);
    expect(e).toBeCloseTo(0.5);
    expect(stepExtend(e, false, 1)).toBe(0);
  });
});

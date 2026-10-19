import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { add, dot, hypot, length, lerp, rotate, scale, sub, vec2 } from './vec2';

describe('vec2', () => {
  it('adds, subtracts and scales', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec2(1, 2), vec2(3, 4))).toEqual({ x: -2, y: -2 });
    expect(scale(vec2(1, -2), 3)).toEqual({ x: 3, y: -6 });
  });

  it('computes dot and length', () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(length(vec2(3, 4))).toBe(5);
  });

  it('rotates counter-clockwise', () => {
    const r = rotate(vec2(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it('lerps', () => {
    expect(lerp(vec2(0, 0), vec2(10, -10), 0.25)).toEqual({ x: 2.5, y: -2.5 });
  });

  it('hypot is Math.hypot bit for bit (the simulation relies on it for determinism)', () => {
    const special = [0, -0, 1, -1, 3, 4, 0.1, Infinity, -Infinity, NaN, 5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, 1e-300, 1e300];
    for (const a of special) for (const b of special) expect(Object.is(hypot(a, b), Math.hypot(a, b))).toBe(true);
    const rng = createRng(20261017);
    const bits = new Float64Array(1);
    const words = new Uint32Array(bits.buffer);
    const pick = (): number => {
      const k = rng();
      if (k < 0.4) return (rng() - 0.5) * 4000;
      if (k < 0.6) return (rng() - 0.5) * 1e-3;
      if (k < 0.7) return Math.round((rng() - 0.5) * 200) * 0.5;
      // any double at all (subnormals, huge values, NaN payloads)
      words[0] = Math.floor(rng() * 4294967296);
      words[1] = Math.floor(rng() * 4294967296);
      return bits[0]!;
    };
    let mismatches = 0;
    for (let i = 0; i < 200_000; i++) {
      const a = pick();
      const b = pick();
      if (!Object.is(hypot(a, b), Math.hypot(a, b))) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

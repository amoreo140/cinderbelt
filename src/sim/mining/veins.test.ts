import { describe, expect, it } from 'vitest';
import { ASTEROID_MODEL_BOUNDS, ASTEROID_VEINS } from '../../data/asteroids';
import type { ResourceId } from '../../data/resources';
import type { Asteroid } from '../world/generate';
import {
  activeSegment,
  advanceVein,
  asteroidModelIndex,
  asteroidOrientation,
  findVeinHit,
  initialVeinState,
  modelNameOf,
  rotateXYZ,
  VEIN_BONUS,
  VEIN_HIT_RADIUS,
  VEIN_SEGMENT_LENGTH,
  veinBonus,
  veinPointAt,
  veinPolyline,
  veinFacing,
  veinsOf,
  veinWorldLength,
  type VeinState,
} from './veins';

const rock = (resource: ResourceId, variant = 0.1, id = 'r1'): Asteroid => ({
  id,
  pos: { x: 10, y: -4 },
  baseRadius: 2.5,
  resource,
  initialAmount: 156,
  variant,
});

describe('asteroid pose (shared with the renderer)', () => {
  it('maps the variant to model a, b or c', () => {
    expect(asteroidModelIndex({ variant: 0 })).toBe(0);
    expect(asteroidModelIndex({ variant: 0.34 })).toBe(1);
    expect(asteroidModelIndex({ variant: 0.999 })).toBe(2);
    expect(modelNameOf(rock('copper', 0.7))).toBe('asteroid_copper_c');
  });

  it('keeps veined rocks upright with their veins turned towards the camera, gently wobbling', () => {
    for (const resource of ['iron', 'copper', 'titanium'] as const) {
      for (const v of [0.05, 0.3, 0.55, 0.81, 0.97]) {
        const a = rock(resource, v);
        const e0 = asteroidOrientation(a, 0);
        expect(Math.abs(e0.x)).toBeLessThanOrEqual(0.25);
        expect(Math.abs(e0.z)).toBeLessThanOrEqual(0.25);
        const angles = [0, 3, 7, 12, 20].map((t) => asteroidOrientation(a, t).y);
        expect(new Set(angles).size).toBeGreaterThan(1);
        for (const y of angles) {
          // veins point at most ~55° from the direction to the camera (+z)
          const d = Math.atan2(Math.sin(y + veinFacing(a)), Math.cos(y + veinFacing(a)));
          expect(Math.abs(d)).toBeLessThanOrEqual(0.6 + 0.35 + 1e-9);
        }
      }
    }
    // ice has no veins – it may be rotated arbitrarily and it spins
    expect(veinsOf(rock('ice'))).toEqual([]);
    expect(Math.abs(asteroidOrientation(rock('ice', 0.4), 0).x)).toBeGreaterThan(0.25);
  });

  it('turns the vein surface towards the camera (normal points up and to +z)', () => {
    for (const resource of ['iron', 'copper', 'titanium'] as const) {
      for (const v of [0.1, 0.5, 0.9]) {
        const a = rock(resource, v);
        for (const vein of veinsOf(a)) {
          const mid = vein.normals[10]!;
          const n = rotateXYZ(asteroidOrientation(a, 5), mid);
          // the camera is to the south (+z) at a 55° angle – the dot product with its direction is positive
          expect(n.y * Math.sin((55 * Math.PI) / 180) + n.z * Math.cos((55 * Math.PI) / 180), `${modelNameOf(a)} ${vein.index}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('rotates vectors like a three.js XYZ Euler (rotation matrix is orthonormal)', () => {
    const e = { x: 0.2, y: 1.3, z: -0.15 };
    const v = rotateXYZ(e, { x: 0.3, y: -0.4, z: 0.86 });
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(Math.hypot(0.3, -0.4, 0.86));
    expect(rotateXYZ({ x: 0, y: Math.PI / 2, z: 0 }, { x: 1, y: 0, z: 0 })).toMatchObject({ x: expect.closeTo(0), z: expect.closeTo(-1) });
  });
});

describe('vein geometry', () => {
  it('normalises the model veins to a unit radius and scales them with the asteroid', () => {
    const a = rock('iron', 0.1);
    const veins = veinsOf(a);
    const source = ASTEROID_VEINS.asteroid_iron_a!;
    expect(veins).toHaveLength(source.length);
    const r = 2.5;
    const vein = veins[0]!;
    expect(veinWorldLength(vein, r)).toBeCloseTo((source[0]!.length / ASTEROID_MODEL_BOUNDS.asteroid_iron_a!.radius) * r);
    const line = veinPolyline(a, vein, r, 3);
    let length3d = 0;
    for (let k = 1; k < line.length; k++) {
      const p = line[k - 1]!;
      const q = line[k]!;
      length3d += Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y, q.height - p.height);
      // every point lies in the bounding sphere
      expect(Math.hypot(q.pos.x - a.pos.x, q.pos.y - a.pos.y, q.height)).toBeLessThanOrEqual(r + 1e-9);
    }
    expect(length3d).toBeCloseTo(veinWorldLength(vein, r), 3);
  });

  it('veins face up on an upright rock', () => {
    for (const resource of ['iron', 'copper', 'titanium'] as const) {
      for (const v of [0.1, 0.5, 0.9]) {
        const a = rock(resource, v);
        for (const vein of veinsOf(a)) {
          // the surface at the centre of the vein faces up (towards the camera) at every tilt
          const mid = veinPointAt(a, vein, 2, 0, 0.5);
          expect(mid.up, `${modelNameOf(a)} ${vein.index}`).toBeGreaterThan(0.1);
        }
      }
    }
  });
});

describe('active segment', () => {
  it('is ~1.5 units long on iron and copper, the whole vein on titanium (deep vein)', () => {
    const iron = veinsOf(rock('iron'))[0]!;
    const state: VeinState = { centers: [0.5, 0.5, 0.5], dirs: [1, 1, 1] };
    const seg = activeSegment(iron, 2.5, state);
    expect(2 * seg.half * veinWorldLength(iron, 2.5)).toBeCloseTo(VEIN_SEGMENT_LENGTH);
    const ti = veinsOf(rock('titanium'))[0]!;
    expect(ti.type).toBe('deep');
    expect(activeSegment(ti, 2.5, state)).toEqual({ center: 0.5, half: 0.5 });
  });

  it('starts at a deterministic place from the asteroid id', () => {
    const a = initialVeinState(rock('copper', 0.2, 'x:1'));
    expect(a).toEqual(initialVeinState(rock('copper', 0.2, 'x:1')));
    expect(a).not.toEqual(initialVeinState(rock('copper', 0.2, 'x:2')));
    for (const c of a.centers) expect(c).toBeGreaterThanOrEqual(0.2);
    expect(a.dirs.every((d) => d === 1 || d === -1)).toBe(true);
  });

  it('moves along the vein and bounces at its ends', () => {
    const vein = veinsOf(rock('iron'))[0]!;
    const r = 2.5;
    const state: VeinState = { centers: [0.5, 0.5], dirs: [1, 1] };
    const { half } = activeSegment(vein, r, state);
    advanceVein(vein, r, state, 0.1);
    expect(state.centers[0]).toBeCloseTo(0.6);
    advanceVein(vein, r, state, 1 - half - 0.6 + 0.05);
    expect(state.centers[0]).toBeCloseTo(1 - half - 0.05);
    expect(state.dirs[0]).toBe(-1);
    // the second vein did not move
    expect(state.centers[1]).toBe(0.5);
  });
});

describe('findVeinHit', () => {
  const a = rock('iron', 0.1);
  const r = 2.5;
  const time = 7;
  const vein = veinsOf(a)[0]!;
  const state: VeinState = { centers: [0.5, 0.5], dirs: [1, 1] };

  it('hits the active segment near its centre line', () => {
    const p = veinPointAt(a, vein, r, time, 0.5);
    const hit = findVeinHit(a, r, time, state, { x: p.pos.x + 0.2, y: p.pos.y });
    expect(hit).toMatchObject({ vein: 0, type: 'drift' });
    expect(hit!.u).toBeGreaterThan(0.35);
    expect(hit!.u).toBeLessThan(0.65);
    expect(hit!.distance).toBeLessThanOrEqual(VEIN_HIT_RADIUS);
  });

  it('misses away from the vein and outside the active segment', () => {
    expect(findVeinHit(a, r, time, state, { x: a.pos.x + 30, y: a.pos.y })).toBeNull();
    const shifted: VeinState = { centers: [0.85, 0.5], dirs: [1, 1] };
    const start = veinPointAt(a, vein, r, time, 0.02);
    const hit = findVeinHit(a, r, time, shifted, start.pos);
    expect(hit === null || hit.vein !== 0).toBe(true);
  });

  it('follows the rotation of the asteroid over time', () => {
    const later = veinPointAt(a, vein, r, time + 20, 0.5);
    const now = veinPointAt(a, vein, r, time, 0.5);
    expect(Math.hypot(later.pos.x - now.pos.x, later.pos.y - now.pos.y)).toBeGreaterThan(0.1);
    expect(findVeinHit(a, r, time + 20, state, later.pos)?.vein).toBe(0);
  });

  it('gives ×1.5 on iron and copper, ×1.2 or ×1.8 (heavy laser) on the deep titanium vein', () => {
    expect(veinBonus('drift', false)).toBe(1.5);
    expect(veinBonus('drift', true)).toBe(1.5);
    expect(veinBonus('deep', false)).toBe(1.2);
    expect(veinBonus('deep', true)).toBe(1.8);
    expect(VEIN_BONUS).toEqual({ drift: 1.5, deep: 1.2, deepHeavy: 1.8 });
  });
});

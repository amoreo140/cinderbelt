import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { asteroidOrientation, rotateXYZ, veinPointAt, veinsOf } from '../sim/mining/veins';
import type { Asteroid } from '../sim/world/generate';
import { simToWorld } from './coords';

describe('asteroid pose shared by the simulation and the renderer', () => {
  it('rotateXYZ matches a three.js Euler (XYZ order)', () => {
    for (const e of [{ x: 0.2, y: 1.3, z: -0.15 }, { x: -2.1, y: 0.4, z: 3 }, { x: 0, y: -5, z: 0.7 }]) {
      const m = new Matrix4().makeRotationFromEuler(new Euler(e.x, e.y, e.z));
      const v = new Vector3(0.3, -0.4, 0.86).applyMatrix4(m);
      const s = rotateXYZ(e, { x: 0.3, y: -0.4, z: 0.86 });
      expect(s.x).toBeCloseTo(v.x, 10);
      expect(s.y).toBeCloseTo(v.y, 10);
      expect(s.z).toBeCloseTo(v.z, 10);
    }
  });

  it('a vein point from the simulation lands where the instanced model puts it', () => {
    const a: Asteroid = { id: 't', pos: { x: 12, y: -3 }, baseRadius: 2, resource: 'copper', initialAmount: 100, variant: 0.55 };
    const vein = veinsOf(a)[0]!;
    const time = 4.2;
    const r = 1.7;
    const sim = veinPointAt(a, vein, r, time, 0.3);
    // model: unit geometry → scale r, rotation from asteroidOrientation, position simToWorld
    const e = asteroidOrientation(a, time);
    let k = 0;
    while (vein.u[k + 1]! < 0.3) k++;
    const t = (0.3 - vein.u[k]!) / (vein.u[k + 1]! - vein.u[k]!);
    const p = vein.points[k]!;
    const q = vein.points[k + 1]!;
    const local = new Vector3(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t);
    const world = local.multiplyScalar(r).applyEuler(new Euler(e.x, e.y, e.z)).add(simToWorld(a.pos));
    expect(sim.pos.x).toBeCloseTo(world.x, 6);
    expect(sim.pos.y).toBeCloseTo(-world.z, 6);
    expect(sim.height).toBeCloseTo(world.y, 6);
  });
});

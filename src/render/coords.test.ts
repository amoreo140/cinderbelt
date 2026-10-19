import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { simToWorld } from './coords';

describe('simToWorld', () => {
  it('maps sim (x, y) to three (x, 0, -y)', () => {
    const v = simToWorld({ x: 3, y: 4 });
    expect(v.x).toBe(3);
    expect(v.y).toBe(0);
    expect(v.z).toBe(-4);
  });

  it('rotation.y = angle points the local +x along the sim heading', () => {
    const angle = 0.7;
    const obj = new Object3D();
    obj.rotation.y = angle;
    obj.updateMatrixWorld();
    const tip = obj.localToWorld(new Vector3(1, 0, 0));
    const expected = simToWorld({ x: Math.cos(angle), y: Math.sin(angle) });
    expect(tip.x).toBeCloseTo(expected.x);
    expect(tip.z).toBeCloseTo(expected.z);
  });
});

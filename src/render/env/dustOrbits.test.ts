import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { chipConstants, dustRand as rand, moteConstants, writeChipMatrix, writeMote } from './dustOrbits';

// The per-frame code these constants replaced (AsteroidDust before audit 2026-10-17 P5), as the reference.
function referenceChip(seed: number, i: number, x: number, z: number, r: number, t: number): number[] {
  const dummy = new Object3D();
  const orbit = r * (1.3 + rand(seed, i) * 1.1);
  const speed = (0.04 + rand(seed, i + 50) * 0.1) * (rand(seed, i + 7) < 0.5 ? -1 : 1);
  const ang = rand(seed, i + 13) * Math.PI * 2 + t * speed;
  const tilt = (rand(seed, i + 29) - 0.5) * 0.9;
  const size = Math.min(0.7, 0.09 + rand(seed, i + 3) * 0.16 * Math.max(1, r * 0.4));
  dummy.position.set(x + Math.cos(ang) * orbit, Math.sin(ang * 1.3 + i) * orbit * tilt * 0.5, z + Math.sin(ang) * orbit);
  dummy.rotation.set(t * (0.3 + rand(seed, i + 41)), rand(seed, i + 43) * 6, t * 0.2);
  dummy.scale.set(size, size * (0.6 + rand(seed, i + 5) * 0.6), size * (0.7 + rand(seed, i + 9) * 0.5));
  dummy.updateMatrix();
  return dummy.matrix.elements;
}

function referenceMote(seed: number, i: number, x: number, z: number, r: number, t: number): { pos: number[]; tw: number } {
  const k = i + 100;
  const rad = r * (1.1 + rand(seed, k) * 2.2);
  const ang = rand(seed, k + 1) * Math.PI * 2 + t * 0.03 * (rand(seed, k + 2) - 0.5);
  const bob = Math.sin(t * (0.2 + rand(seed, k + 3) * 0.3) + i) * 0.6;
  const pos = [x + Math.cos(ang) * rad, (rand(seed, k + 4) - 0.5) * r * 1.2 + bob, z + Math.sin(ang) * rad];
  return { pos, tw: 0.5 + 0.5 * Math.sin(t * (0.6 + rand(seed, k + 5)) + i * 1.7) };
}

const cases = [
  { seed: 12345, x: 10, z: -40, r: 3, t: 0 },
  { seed: 987654321, x: -250.5, z: 180, r: 7.5, t: 13.7 },
  { seed: 42, x: 0, z: 0, r: 1.2, t: 1234.56 },
];

describe('dust chip matrices', () => {
  it('match the Object3D pose of the old per-frame code', () => {
    for (const { seed, x, z, r, t } of cases) {
      const c = chipConstants(seed, 10);
      const out = new Float32Array(16 * 10);
      for (let i = 0; i < 10; i++) {
        writeChipMatrix(out, i * 16, c, i, x, z, r, t, Math.cos(t * 0.2), Math.sin(t * 0.2));
        const ref = referenceChip(seed, i, x, z, r, t);
        for (let e = 0; e < 16; e++) expect(out[i * 16 + e]).toBeCloseTo(ref[e]!, 4);
      }
    }
  });

  it('keep the rubble pick and shade of the old code', () => {
    const c = chipConstants(777, 4);
    for (let i = 0; i < 4; i++) {
      expect(c[i * 12 + 10]).toBe(rand(777, i + 77));
      expect(c[i * 12 + 11]).toBe(0.75 + rand(777, i + 61) * 0.4);
    }
  });
});

describe('dust motes', () => {
  it('match the positions and twinkle of the old per-frame code', () => {
    for (const { seed, x, z, r, t } of cases) {
      const c = moteConstants(seed, 15);
      const out = new Float32Array(3 * 15);
      for (let i = 0; i < 15; i++) {
        const tw = writeMote(out, i * 3, c, i, x, z, r, t);
        const ref = referenceMote(seed, i, x, z, r, t);
        expect(tw).toBeCloseTo(ref.tw, 9);
        for (let e = 0; e < 3; e++) expect(out[i * 3 + e]).toBeCloseTo(ref.pos[e]!, 4);
      }
    }
  });
});

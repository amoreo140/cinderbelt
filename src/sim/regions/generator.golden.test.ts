// The region generator is frozen since stage 2 (save V15 stores `regions.gen`, REGION_GEN_ID = 1):
// saved survey points, bought and sold charts refer to sector ids and point indexes, so for a seed the
// sectors, their shapes, security, start knowledge, lanes and survey points must never change.
// If this test fails, the generator changed: restore it and add the change as a new generator next to
// this one (a new REGION_GEN_ID, picked by the save's `gen`) – never update the digests in place.
import { describe, expect, it } from 'vitest';
import { REGION_GEN_ID } from './constants';
import { regionDigest } from './digest';

const GOLDEN: Record<number, { sectors: number; digest: string }> = {
  1: { sectors: 72, digest: 'f57f1ed1' },
  2: { sectors: 76, digest: 'e856f763' },
  3: { sectors: 77, digest: '5cdbb3e5' },
  42: { sectors: 71, digest: '32420bad' },
  1337: { sectors: 80, digest: 'ee9ec4f3' },
};

describe('region generator 1 (frozen)', () => {
  it('is the generator saves refer to', () => {
    expect(REGION_GEN_ID).toBe(1);
  });

  it.each(Object.keys(GOLDEN).map(Number))('seed %i: sectors, shapes, security, knowledge, lanes and survey points unchanged', (seed) => {
    expect(regionDigest(seed)).toEqual(GOLDEN[seed]);
  });
});

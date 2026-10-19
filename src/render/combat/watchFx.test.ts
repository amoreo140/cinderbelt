import { describe, expect, it } from 'vitest';
import { WATCH } from '../../data/guild';
import { CONVOY_SHAPES } from '../../data/convoys';
import { boltSide, hullSpan, isConvoyHull, npcBulkRadius, npcSmokeLift, smokeRate, watchHullShare, watchShieldRadius } from './watchFx';

describe('Guild Watch looks (M4d T13)', () => {
  it('a shot wears its side: player, pirate or Guild Watch', () => {
    expect(boltSide('player')).toBe('player');
    expect(boltSide('gw:lane:A:0|1')).toBe('guild');
    expect(boltSide('gw:relay:B|0')).toBe('guild');
    expect(boltSide('p:3')).toBe('pirate');
    expect(boltSide('rc:A:0')).toBe('pirate');
  });

  it('the shield bubble sits where a shielded shot stops', () => {
    expect(watchShieldRadius({ kind: 'cutter' })).toBeCloseTo(WATCH.ships.cutter.radius + 0.8, 6);
    expect(watchShieldRadius({ kind: 'frigate' })).toBeGreaterThan(watchShieldRadius({ kind: 'cutter' }));
  });

  it('smoke only below half hull, thicker the lower it gets', () => {
    expect(watchHullShare({ kind: 'cutter', hull: WATCH.ships.cutter.hull })).toBe(1);
    expect(watchHullShare({ kind: 'frigate', hull: -5 })).toBe(0);
    expect(smokeRate(1)).toBe(0);
    expect(smokeRate(0.5)).toBe(0);
    expect(smokeRate(0.45)).toBeGreaterThan(0);
    expect(smokeRate(0.1)).toBeGreaterThan(smokeRate(0.4));
    expect(smokeRate(0)).toBe(12);
  });

  it('escort convoy ships: a slim hull – a bulk radius under the bounding one, blasts at bow and stern', () => {
    expect(isConvoyHull('trader')).toBe(true);
    expect(isConvoyHull('tanker')).toBe(true);
    expect(isConvoyHull('cutter')).toBe(false);
    expect(npcBulkRadius('cutter')).toBe(watchShieldRadius({ kind: 'cutter' }));
    expect(npcBulkRadius('trader')).toBeLessThan(CONVOY_SHAPES.trader.radius);
    expect(npcBulkRadius('trader')).toBeGreaterThan(npcBulkRadius('tanker'));
    const [stern, bow] = hullSpan('trader');
    expect(stern).toBeLessThan(0);
    expect(bow).toBeGreaterThan(0);
    expect(hullSpan('frigate')).toEqual([0, 0]);
    expect(npcSmokeLift('trader')).toBeGreaterThan(npcSmokeLift('cutter'));
  });
});

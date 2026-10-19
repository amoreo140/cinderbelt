import { describe, expect, it } from 'vitest';
import { shakeFor } from './shake';

describe('shakeFor (M3.8)', () => {
  it('scales a collision with the impact speed', () => {
    expect(shakeFor({ type: 'collision', speed: 2 })).toBe(0);
    const soft = shakeFor({ type: 'collision', speed: 9 });
    const hard = shakeFor({ type: 'collision', speed: 25 });
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    expect(shakeFor({ type: 'collision', speed: 200 })).toBe(1);
  });

  it('shakes for hits on the player only, less on the shield', () => {
    const hit = { type: 'projectileHit', owner: 'pr:1', ref: 'player', pos: { x: 0, y: 0 }, damage: 5, from: { x: 1, y: 0 } } as const;
    expect(shakeFor({ ...hit, target: 'ship' })).toBeGreaterThan(shakeFor({ ...hit, target: 'shield' }));
    expect(shakeFor({ ...hit, ref: 'pr:2', target: 'ship' })).toBe(0);
    expect(shakeFor({ type: 'partsLost', cause: 'shot', parts: [] })).toBeGreaterThan(shakeFor({ ...hit, target: 'ship' }));
    expect(shakeFor({ type: 'cargoFull' })).toBe(0);
  });
});

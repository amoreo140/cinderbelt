import { describe, expect, it } from 'vitest';
import { COOL_TICKS, HEAT_MAX, type LaserHeat } from '../sim/mining/heat';
import type { MiningBeam } from '../sim/mining/mining';
import { BONUS_HOLD, MiningHudMemo, miningHud } from './miningView';

const beam = (bonus: number): MiningBeam => ({
  laser: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, asteroidId: 'a', resource: 'iron', bonus, vein: bonus > 1 ? { index: 0, u: 0.5 } : null,
});

describe('miningHud (heat bar of the hottest laser + bonus feedback)', () => {
  it('is hidden for a ship without lasers and idle (dimmed, same layout) with cold lasers', () => {
    const memo = new MiningHudMemo();
    expect(miningHud({ lasers: 0, heat: new Map(), beams: [] }, 0, memo)).toBeNull();
    expect(miningHud({ lasers: 2, heat: new Map(), beams: [] }, 0, memo)).toEqual({
      heat: 0, heatMax: HEAT_MAX, overheated: false, bonus: null, active: false,
    });
  });

  it('shows the hottest laser in seconds and the overheated state', () => {
    const memo = new MiningHudMemo();
    const heat = new Map<number, LaserHeat>([
      [3, { heat: 1.5, cooling: 0 }],
      [8, { heat: 2.5, cooling: 0 }],
    ]);
    expect(miningHud({ lasers: 2, heat, beams: [beam(1)] }, 0, memo)).toEqual({
      heat: 2.5, heatMax: HEAT_MAX, overheated: false, bonus: null, active: true,
    });
    heat.set(8, { heat: 2, cooling: COOL_TICKS / 2 });
    expect(miningHud({ lasers: 2, heat, beams: [] }, 0, memo)).toMatchObject({ heat: 2, overheated: true });
  });

  it('shows the vein bonus while a beam is on a vein and holds it briefly (no flicker)', () => {
    const memo = new MiningHudMemo();
    const heat = new Map<number, LaserHeat>([[3, { heat: 0.5, cooling: 0 }]]);
    expect(miningHud({ lasers: 1, heat, beams: [beam(1.5)] }, 10, memo)?.bonus).toBe(1.5);
    expect(miningHud({ lasers: 1, heat, beams: [beam(1)] }, 10 + BONUS_HOLD / 2, memo)?.bonus).toBe(1.5);
    expect(miningHud({ lasers: 1, heat, beams: [beam(1)] }, 10 + BONUS_HOLD + 0.01, memo)?.bonus).toBeNull();
    // the highest bonus of several beams
    expect(miningHud({ lasers: 2, heat, beams: [beam(1.2), beam(1.8)] }, 20, memo)?.bonus).toBe(1.8);
  });
});

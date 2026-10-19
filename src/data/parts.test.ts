import { VARIANT_IDS } from './variants';
import { describe, expect, it } from 'vitest';
import { sizeHullPoints } from '../sim/ship/budget';
import { ALL_PART_KEYS, PART_DEFS, PART_IDS, PARTS, TIERS, parsePartKey, partDef, partKey } from './parts';

describe('part keys', () => {
  it('round-trips part id and tier', () => {
    expect(partKey('engine', 2)).toBe('engine:2');
    expect(parsePartKey('armor:1')).toEqual({ partId: 'armor', tier: 1 });
    expect(parsePartKey(partKey('miningLaser', 2))).toEqual({ partId: 'miningLaser', tier: 2 });
  });

  it('lists all 18 parts in both tiers (M3 combat parts, the M2d parts, the M3.6 tractor beam and the M4c parts appended)', () => {
    expect(PART_IDS).toHaveLength(18);
    expect(PART_IDS.slice(9)).toEqual(['cannon', 'shield', 'heavyLaser', 'largeCargo', 'battery', 'tractorBeam', 'largeReactor', 'repairModule', 'refinery']);
    expect(TIERS).toEqual([1, 2]);
    // base keys first in the original order, the variants (M3.5b) after them
    expect(ALL_PART_KEYS).toHaveLength(36 + 2 * VARIANT_IDS.length);
    expect(ALL_PART_KEYS.slice(0, 2)).toEqual(['cockpit:1', 'armor:1']);
    expect(ALL_PART_KEYS[18]).toBe('cockpit:2');
    expect(ALL_PART_KEYS[36]).toBe('engine:1:overdrive');
  });
});

describe('partDef', () => {
  it('tier 1 equals the M1 values (PARTS)', () => {
    for (const id of PART_IDS) expect(partDef(id, 1)).toBe(PARTS[id]);
    expect(partDef('engine', 1).thrust).toBe(90);
    expect(partDef('cockpit', 1).hp).toBe(60);
  });

  it('tier 2 follows the 6.2 table', () => {
    expect(partDef('cockpit', 2)).toMatchObject({
      mass: 3.2, hp: 105, torque: 18, cargo: 15, fuel: 30, battery: 30, energyGen: 3, radarRange: 80,
    });
    expect(partDef('armor', 2)).toMatchObject({ mass: 1.6, hp: 70 });
    expect(partDef('engine', 2)).toMatchObject({ mass: 1.2, hp: 44, thrust: 135 });
    expect(partDef('gyro', 2)).toMatchObject({ mass: 1.6, hp: 52, torque: 68 });
    expect(partDef('miningLaser', 2)).toMatchObject({
      mass: 1.2, hp: 44, mining: { rate: 3.75, range: 18, energyPerSecond: 8 },
    });
    expect(partDef('cargo', 2)).toMatchObject({ mass: 1.2, hp: 52, cargo: 90 });
    expect(partDef('fuelTank', 2)).toMatchObject({ mass: 1.2, hp: 35, fuel: 150 });
    expect(partDef('reactor', 2)).toMatchObject({ mass: 2.4, hp: 52, energyGen: 12, battery: 60 });
    expect(partDef('radar', 2)).toMatchObject({ mass: 0.8, hp: 26, radarRange: 260 });
  });

  it('defines the combat parts (M3a): cannon and shield generator', () => {
    expect(partDef('cannon', 1)).toMatchObject({
      mass: 1.5, hp: 30, weapon: { damage: 6, fireRate: 3, projectileSpeed: 75, range: 85, energyPerShot: 2 },
    });
    expect(partDef('cannon', 2)).toMatchObject({
      mass: 1.2, hp: 52, weapon: { damage: 9, fireRate: 3, projectileSpeed: 85, range: 100, energyPerShot: 2.5 },
    });
    expect(partDef('shield', 1)).toMatchObject({
      mass: 2, hp: 30, shield: { capacity: 60, regen: 10, regenDelay: 3, energyPerPoint: 0.5 },
    });
    expect(partDef('shield', 2)).toMatchObject({
      mass: 1.6, hp: 52, shield: { capacity: 90, regen: 15, regenDelay: 2.5, energyPerPoint: 0.5 },
    });
  });

  it('defines the M2d parts: heavy laser 2x1, large cargo 2x2 and battery (spec 3.3)', () => {
    const laser1 = partDef('miningLaser', 1).mining!;
    const laser2 = partDef('miningLaser', 2).mining!;
    const heavy1 = partDef('heavyLaser', 1);
    const heavy2 = partDef('heavyLaser', 2);
    expect(heavy1.size).toEqual({ w: 2, h: 1 });
    expect(heavy1.mining!.rate).toBeCloseTo(laser1.rate * 2.4);
    expect(heavy1.mining!.energyPerSecond).toBeCloseTo(laser1.energyPerSecond * 1.8);
    expect(heavy2.mining!.rate).toBeCloseTo(laser2.rate * 2.4);
    expect(heavy2.mining!.energyPerSecond).toBeCloseTo(laser2.energyPerSecond * 1.8);
    expect(heavy1.mining!.heavy).toBe(true);
    expect(laser1.heavy).toBeFalsy();
    expect(partDef('largeCargo', 1)).toMatchObject({ size: { w: 2, h: 2 }, cargo: 300, cargoSpill: 0.5 });
    expect(partDef('largeCargo', 2).cargo).toBe(450);
    expect(partDef('battery', 1)).toMatchObject({ size: { w: 1, h: 1 }, battery: 120 });
    expect(partDef('battery', 1).energyGen).toBeUndefined();
    expect(partDef('battery', 2).battery).toBe(180);
  });

  it('cockpits carry the hull budget (T1 28 b, T2 48 b)', () => {
    expect(partDef('cockpit', 1).hullBudget).toBe(28);
    expect(partDef('cockpit', 2).hullBudget).toBe(48);
    expect(partDef('armor', 1).hullBudget).toBeUndefined();
  });

  it('tier 2 is lighter and tougher with the same footprint', () => {
    for (const id of PART_IDS) {
      const [t1, t2] = [PART_DEFS[id][1], PART_DEFS[id][2]];
      expect(t2.id).toBe(id);
      expect(t2.size).toEqual(t1.size);
      expect(t2.mass).toBeCloseTo(t1.mass * 0.8);
      expect(t2.hp).toBeGreaterThan(t1.hp * 1.7);
      expect(t2.hp).toBeLessThan(t1.hp * 1.8);
    }
  });
});

describe('M4c parts (plan 2026-10-20 §2.4)', () => {
  it('large reactor 2×2: energy, battery and a blast', () => {
    expect(partDef('largeReactor', 1)).toMatchObject({ size: { w: 2, h: 2 }, mass: 10, hp: 110, energyGen: 45, battery: 120, blast: 40 });
    expect(partDef('largeReactor', 2)).toMatchObject({ size: { w: 2, h: 2 }, mass: 8, hp: 190, energyGen: 68, battery: 180, blast: 50 });
  });

  it('repair module 1×1 and refinery 2×1', () => {
    expect(partDef('repairModule', 1)).toMatchObject({ size: { w: 1, h: 1 }, mass: 1.5, hp: 30, repair: { hpPerSecond: 1, energyPerSecond: 3 } });
    expect(partDef('repairModule', 2)).toMatchObject({ mass: 1.2, hp: 52, repair: { hpPerSecond: 1.5, energyPerSecond: 4 } });
    expect(partDef('refinery', 1)).toMatchObject({
      size: { w: 2, h: 1 }, mass: 4, hp: 55, refinery: { icePerSecond: 0.5, orePerSecond: 0.6, energyPerSecond: 5 },
    });
    expect(partDef('refinery', 2)).toMatchObject({ mass: 3.2, hp: 96, refinery: { icePerSecond: 0.75, orePerSecond: 0.9, energyPerSecond: 6 } });
  });

  it('cost 3 / 1 / 2 hull points', () => {
    expect(sizeHullPoints(partDef('largeReactor', 1).size)).toBe(3);
    expect(sizeHullPoints(partDef('repairModule', 1).size)).toBe(1);
    expect(sizeHullPoints(partDef('refinery', 1).size)).toBe(2);
  });

  it('only the large reactor blasts', () => {
    for (const id of PART_IDS) for (const t of TIERS) if (id !== 'largeReactor') expect(partDef(id, t).blast, id).toBeUndefined();
  });
});

describe('M4c variants (plan 2026-10-20 §2.5)', () => {
  it('focused laser: mining ×1.35 for energy ×1.5', () => {
    const base = PART_DEFS.miningLaser[2].mining!;
    const v = partDef('miningLaser', 2, 'focused').mining!;
    expect(v.rate).toBeCloseTo(base.rate * 1.35, 9);
    expect(v.energyPerSecond).toBeCloseTo(base.energyPerSecond * 1.5, 9);
    expect(v.range).toBe(base.range);
  });

  it('light armour: HP ×0.6, mass ×0.5', () => {
    expect(partDef('armor', 1, 'light')).toMatchObject({ hp: 24, mass: 1, size: { w: 1, h: 1 } });
    expect(partDef('armor', 2, 'light')).toMatchObject({ hp: 42, mass: 0.8 });
  });

  it('flywheel gyroscope: torque ×1.6, mass ×1.75', () => {
    expect(partDef('gyro', 1, 'flywheel').torque).toBeCloseTo(45 * 1.6, 9);
    expect(partDef('gyro', 1, 'flywheel').mass).toBeCloseTo(3.5, 9);
  });

  it('buffer reactor: energy ×0.6, battery ×3', () => {
    expect(partDef('reactor', 1, 'buffer').energyGen).toBeCloseTo(8 * 0.6, 9);
    expect(partDef('reactor', 1, 'buffer').battery).toBe(120);
    expect(partDef('reactor', 2, 'buffer').battery).toBe(180);
  });

  it('long barrel: range ×1.4, fire rate ×0.5, damage ×1.5', () => {
    const base = PART_DEFS.cannon[1].weapon!;
    const v = partDef('cannon', 1, 'longBarrel').weapon!;
    expect(v.range).toBeCloseTo(base.range * 1.4, 9);
    expect(v.fireRate).toBeCloseTo(base.fireRate * 0.5, 9);
    expect(v.damage).toBeCloseTo(base.damage * 1.5, 9);
    expect(v.projectileSpeed).toBe(base.projectileSpeed);
  });

  it('variants without a mass mod keep the base mass', () => {
    expect(partDef('cannon', 2, 'longBarrel').mass).toBe(PART_DEFS.cannon[2].mass);
    expect(partDef('reactor', 2, 'buffer').mass).toBe(PART_DEFS.reactor[2].mass);
  });
});

describe('tractor beam (M3.6)', () => {
  it('reaches 25 units at T1, holds small objects and spends energy only while towing', () => {
    expect(partDef('tractorBeam', 1)).toMatchObject({ size: { w: 1, h: 1 }, tractor: { range: 25, maxParts: 4 } });
    const t2 = partDef('tractorBeam', 2).tractor!;
    expect(t2.range).toBeGreaterThan(25);
    expect(t2.pull).toBeGreaterThan(partDef('tractorBeam', 1).tractor!.pull);
    expect(t2.ripSeconds).toBeLessThan(partDef('tractorBeam', 1).tractor!.ripSeconds);
  });
});

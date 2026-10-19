import { describe, expect, it } from 'vitest';
import { createGrid } from './grid';
import { computeProperties, thrustGroupOf } from './properties';
import { partPolygon, polygonCentroid } from './shape';
import { filledFull, halapartnaE2, kosaE2, mulaE2 } from './specShips.testing';

describe('thrustGroupOf', () => {
  it('maps rotation to thrust group', () => {
    expect(thrustGroupOf(0)).toBe('forward');
    expect(thrustGroupOf(1)).toBe('left');
    expect(thrustGroupOf(2)).toBe('backward');
    expect(thrustGroupOf(3)).toBe('right');
  });
});

describe('computeProperties', () => {
  // cockpit (m=4) at (0,0), engine (m=1.5) at (-1,0) pushing forward
  const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]);
  const props = computeProperties(grid);

  it('sums mass', () => {
    expect(props.mass).toBeCloseTo(5.5);
  });

  it('computes center of mass', () => {
    expect(props.centerOfMass.x).toBeCloseTo(-1.5 / 5.5);
    expect(props.centerOfMass.y).toBeCloseTo(0);
  });

  it('computes moment of inertia about the center of mass', () => {
    const cx = -1.5 / 5.5;
    const expected =
      4 * cx * cx + (4 * 2) / 12 + 1.5 * (-1 - cx) * (-1 - cx) + (1.5 * 2) / 12;
    expect(props.inertia).toBeCloseTo(expected);
  });

  it('groups thrust and sums torque (cockpit has built-in gyro)', () => {
    expect(props.thrust).toEqual({ forward: 90, backward: 0, left: 0, right: 0 });
    expect(props.torque).toBe(12);
  });

  it('adds engines to the right groups', () => {
    const p = computeProperties(
      createGrid([
        ['cockpit', 0, 0],
        ['engine', 1, 0, 2],
        ['engine', 0, -1, 1],
        ['engine', 0, 1, 3],
        ['gyro', -1, 0],
      ]),
    );
    expect(p.thrust).toEqual({ forward: 0, backward: 90, left: 90, right: 90 });
    expect(p.torque).toBe(12 + 45);
  });

  it('throws for an empty ship', () => {
    expect(() => computeProperties({ parts: [], nextId: 1 })).toThrow();
  });
});

describe('computeProperties – systems', () => {
  const grid = createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0, 0],
    ['cargo', -1, 0],
    ['fuelTank', 0, 1],
    ['reactor', 0, -1],
    ['radar', -1, 1],
  ]);
  const p = computeProperties(grid);

  it('sums capacities and energy', () => {
    expect(p.cargoCapacity).toBe(10 + 60);
    expect(p.fuelCapacity).toBe(20 + 100);
    expect(p.batteryCapacity).toBe(20 + 40);
    expect(p.energyGen).toBe(2 + 8);
    expect(p.radarRange).toBe(180);
  });

  it('lists laser mounts relative to the center of mass', () => {
    expect(p.lasers).toHaveLength(1);
    const laser = p.lasers[0]!;
    expect(laser.partId).toBe(2);
    expect(laser.offset.x).toBeCloseTo(1 - p.centerOfMass.x);
    expect(laser.offset.y).toBeCloseTo(0 - p.centerOfMass.y);
    expect(laser.facing).toEqual({ x: 1, y: 0 });
    expect(laser.range).toBe(14);
  });

  it('lists cell offsets and a covering bounding radius', () => {
    expect(p.cellOffsets).toHaveLength(6);
    for (const o of p.cellOffsets) {
      expect(Math.hypot(o.x, o.y) + Math.SQRT1_2).toBeLessThanOrEqual(p.boundingRadius + 1e-9);
    }
  });
});

describe('computeProperties – tiers', () => {
  it('uses the titanium values for tier 2 parts', () => {
    const t1 = computeProperties(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['cargo', 0, 1]]));
    const t2 = computeProperties(createGrid([['cockpit', 0, 0, 0, 2], ['engine', -1, 0, 0, 2], ['cargo', 0, 1, 0, 2]]));
    expect(t1.mass).toBeCloseTo(4 + 1.5 + 1.5);
    expect(t2.mass).toBeCloseTo(3.2 + 1.2 + 1.2);
    expect(t2.thrust.forward).toBe(135);
    expect(t2.cargoCapacity).toBe(15 + 90);
    expect(t2.torque).toBe(18);
  });

  it('gives tier 2 lasers more range and rate', () => {
    const p = computeProperties(createGrid([['cockpit', 0, 0], ['miningLaser', 1, 0, 0, 2]]));
    expect(p.lasers[0]).toMatchObject({ range: 18, rate: 3.75, energyPerSecond: 8 });
  });
});

describe('computeProperties – combat parts (M3a)', () => {
  it('lists cannon mounts relative to the center of mass with their facing and stats', () => {
    const p = computeProperties(createGrid([['cockpit', 0, 0], ['cannon', 1, 0, 0], ['cannon', 0, 1, 1, 2]]));
    expect(p.weapons).toHaveLength(2);
    const [a, b] = p.weapons;
    expect(a).toMatchObject({ partId: 2, facing: { x: 1, y: 0 }, damage: 6, fireRate: 3, projectileSpeed: 75, range: 85, energyPerShot: 2 });
    expect(a!.offset.x).toBeCloseTo(1 - p.centerOfMass.x);
    expect(a!.offset.y).toBeCloseTo(0 - p.centerOfMass.y);
    expect(b).toMatchObject({ partId: 3, facing: { x: 0, y: 1 }, damage: 9, tier: 2 });
  });

  it('sums shield generators into one shield (the shortest regen delay wins)', () => {
    const none = computeProperties(createGrid([['cockpit', 0, 0]]));
    expect(none.shield).toEqual({ capacity: 0, regen: 0, regenDelay: 0, energyPerPoint: 0 });
    const p = computeProperties(createGrid([['cockpit', 0, 0], ['shield', 1, 0], ['shield', 0, 1, 0, 2]]));
    expect(p.shield).toEqual({ capacity: 150, regen: 25, regenDelay: 2.5, energyPerPoint: 0.5 });
  });
});

describe('computeProperties – M2d parts', () => {
  it('heavy laser mounts at its front cell with the heavy flag', () => {
    const grid = createGrid([['cockpit', 0, 0], ['heavyLaser', 1, 0, 0]]);
    const props = computeProperties(grid);
    expect(props.lasers).toHaveLength(1);
    const laser = props.lasers[0]!;
    expect(laser.heavy).toBe(true);
    expect(laser.rate).toBe(6);
    // the front cell (2, 0) relative to the centre of mass
    expect(laser.offset.x).toBeCloseTo(2 - props.centerOfMass.x);
    expect(laser.offset.y).toBeCloseTo(0 - props.centerOfMass.y);
    expect(computeProperties(createGrid([['cockpit', 0, 0], ['miningLaser', 1, 0]])).lasers[0]!.heavy).toBe(false);
  });

  it('large cargo adds 300 and covers four cells; battery adds 120 without generation', () => {
    const props = computeProperties(createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0], ['battery', -1, 0]]));
    expect(props.cargoCapacity).toBe(310);
    expect(props.batteryCapacity).toBe(140);
    expect(props.energyGen).toBe(2);
    expect(props.cellOffsets).toHaveLength(6);
  });
});

describe('computeProperties – cockpit manoeuvring thrusters (RCS)', () => {
  it('take the RCS thrust from the cockpit, by tier', () => {
    expect(computeProperties(createGrid([['cockpit', 0, 0]])).rcsThrust).toBe(14);
    expect(computeProperties(createGrid([['cockpit', 0, 0, 0, 2]])).rcsThrust).toBe(20);
  });

  it('are clearly weaker than a side engine', () => {
    const p = computeProperties(createGrid([['cockpit', 0, 0], ['engine', 0, 1, 3]]));
    expect(p.rcsThrust * 5).toBeLessThan(p.thrust.right);
  });

  it('give no RCS without a cockpit', () => {
    expect(computeProperties(createGrid([['armor', 0, 0], ['engine', -1, 0, 0]])).rcsThrust).toBe(0);
  });
});

describe('computeProperties – shaped armour (SL2 E2, spec §2.7)', () => {
  it('a wedge weighs half a plate, sits at its polygon centroid and keeps half the plate moment', () => {
    // armour T1: mass 2; the wedge at rot 0 is (−½,−½) (½,−½) (−½,½), centroid (−⅙, −⅙)
    const p = computeProperties(createGrid([['armor', 0, 0, 0, 1, 'wedge']]));
    expect(p.mass).toBe(1);
    expect(p.centerOfMass.x).toBeCloseTo(-1 / 6, 12);
    expect(p.centerOfMass.y).toBeCloseTo(-1 / 6, 12);
    expect(p.inertia).toBeCloseTo((2 * (1 + 1)) / 12 * 0.5, 12);
  });

  it('puts the mass at the centroid of the rotated shape next to full parts', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 2, 1, 'wedge']]);
    const wedge = grid.parts[1]!;
    const c = polygonCentroid(partPolygon(wedge)!);
    expect(c.x).toBeCloseTo(1 + 1 / 6, 12);
    expect(c.y).toBeCloseTo(1 / 6, 12);
    const p = computeProperties(grid);
    expect(p.mass).toBe(5);
    expect(p.centerOfMass.x).toBeCloseTo(c.x / 5, 12);
    expect(p.centerOfMass.y).toBeCloseTo(c.y / 5, 12);
    const d2 = (v: { x: number; y: number }) => (v.x - p.centerOfMass.x) ** 2 + (v.y - p.centerOfMass.y) ** 2;
    expect(p.inertia).toBeCloseTo(4 * d2({ x: 0, y: 0 }) + (4 * 2) / 12 + 1 * d2(c) + ((2 * 2) / 12) * 0.5, 12);
  });

  it('a 2×1 shape uses its rotated footprint rectangle × area and its area mass', () => {
    // nose 2×1 rot 1 occupies (0,0) and (0,1): footprint 1 wide, 2 long; area 1.67
    const grid = createGrid([['armor', 0, 0, 1, 2, 'nose2x1']]);
    const part = grid.parts[0]!;
    const p = computeProperties(grid);
    expect(p.mass).toBeCloseTo(1.6 * 1.67, 12);
    const c = polygonCentroid(partPolygon(part)!);
    expect(p.centerOfMass.x).toBeCloseTo(c.x, 12);
    expect(p.centerOfMass.y).toBeCloseTo(c.y, 12);
    expect(c.x).toBeCloseTo(0, 12);
    expect(c.y).toBeGreaterThan(0.3); // the solid rear cell (0,0) and the ogive tip at +y
    expect(c.y).toBeLessThan(0.5);
    expect(p.inertia).toBeCloseTo((1.6 * 1.67 * (1 * 1 + 2 * 2)) / 12, 12);
  });

  it('collision cells and the bounding radius stay per cell', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wingL'], ['armor', -1, 0, 0, 1, 'wedge']]);
    const p = computeProperties(grid);
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }];
    expect(p.cellOffsets).toHaveLength(4);
    for (const [i, cell] of cells.entries()) {
      expect(p.cellOffsets[i]!.x).toBeCloseTo(cell.x - p.centerOfMass.x, 12);
      expect(p.cellOffsets[i]!.y).toBeCloseTo(cell.y - p.centerOfMass.y, 12);
    }
    const radius = Math.max(...cells.map((c) => Math.hypot(c.x - p.centerOfMass.x, c.y - p.centerOfMass.y) + Math.SQRT1_2));
    expect(p.boundingRadius).toBeCloseTo(radius, 12);
  });

  it('a pointed bow (Halberd C after E2) turns easier than the same cells laid full', () => {
    for (const make of [halapartnaE2, kosaE2, mulaE2]) {
      const shapedShip = computeProperties(make());
      const full = computeProperties(filledFull(make()));
      expect(shapedShip.mass).toBeLessThan(full.mass);
      expect(shapedShip.inertia).toBeLessThan(full.inertia);
    }
    // the bow is lighter, so the centre of mass moves aft
    expect(computeProperties(halapartnaE2()).centerOfMass.x).toBeLessThan(computeProperties(filledFull(halapartnaE2())).centerOfMass.x);
  });

  it('mounts are measured from the shifted centre of mass', () => {
    const p = computeProperties(halapartnaE2());
    const cannon = halapartnaE2().parts.find((x) => x.partId === 'cannon' && x.x === 4 && x.y === 2)!;
    const mount = p.weapons.find((w) => w.partId === cannon.id)!;
    expect(mount.offset.x).toBeCloseTo(4 - p.centerOfMass.x, 12);
    expect(mount.offset.y).toBeCloseTo(2 - p.centerOfMass.y, 12);
  });
});

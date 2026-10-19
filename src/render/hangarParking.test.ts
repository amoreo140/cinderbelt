import { describe, expect, it } from 'vitest';
import {
  BAY_DECK,
  clearsHeightRule,
  FLOOR_TOP,
  heightLimit,
  PARKED_MAX,
  PARKING_SPOTS,
  placedBox,
  placeInSpot,
  type ShipBounds,
  type YardBox,
} from './hangarParking';

interface Rect {
  name: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const rect = (name: string, x0: number, x1: number, y0: number, y1: number): Rect => ({ name, minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: Math.min(y0, y1), maxY: Math.max(y0, y1) });
/** A tool cart (1.24 × 0.68 with its handle) turned by `yaw`° – its bounding rectangle. */
const cart = (x: number, y: number, yaw: number): Rect => {
  const a = (yaw * Math.PI) / 180;
  const hx = 0.62 * Math.abs(Math.cos(a)) + 0.34 * Math.abs(Math.sin(a));
  const hy = 0.62 * Math.abs(Math.sin(a)) + 0.34 * Math.abs(Math.cos(a));
  return rect(`cart ${x},${y}`, x - hx, x + hx, y - hy, y + hy);
};

/** What stands on the bay deck (art/blender/hangar.py build_bay, yard frame = Blender x, y). */
const FURNITURE: Rect[] = [
  rect('platform + catwalk', -11, 11, -11, 11),
  rect('rail +y', -9.95, 9.95, 12.38, 13.62),
  rect('rail -y', -9.95, 9.95, -13.62, -12.38),
  ...[1, -1].flatMap((sx) => [1, -1].map((sy) => rect(`tower ${sx},${sy}`, sx * 17 - 1.07, sx * 17 + 1.07, sy * 17 - 1.07, sy * 17 + 1.07))),
  rect('racks back wall', -24, -22.8, -13, 13),
  rect('racks +y wall', -21, -5, 22.8, 24),
  rect('racks -y wall', -21, -5, -24, -22.8),
  rect('fuel +y', -21.5, -14.4, 17.6 - 0.6, 20.75),
  rect('fuel -y', -21.5, -14.4, -20.75, -17.6 + 0.6),
  rect('fuel line +y', -15.2, -14.4, 7, 17.6),
  rect('fuel line -y', -15.2, -14.4, -17.6, -7),
  cart(-12.5, 6, 15),
  cart(-13, -4, -10),
  cart(5, 15.5, 80),
  cart(-4, -15.8, 100),
  cart(11.5, -14, 40),
  cart(14.5, 9, -30),
  rect('door', 23.5, 26.5, -26, 26),
];

const overlaps = (a: Rect, b: Rect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const spotRect = (i: number): Rect => {
  const s = PARKING_SPOTS[i]!;
  return rect(`spot ${i}`, s.x - s.halfX, s.x + s.halfX, s.y - s.halfY, s.y + s.halfY);
};

/** The starter ship's model bounds (about 5 × 3 cells, the engine bells below). */
const STARTER: ShipBounds = { minX: -2.6, maxX: 2.5, minY: -1.5, maxY: 1.5, minZ: -0.36, maxZ: 0.55 };

describe('hangar parking spots', () => {
  it('has a spot for every hangar slot', () => {
    expect(PARKING_SPOTS).toHaveLength(PARKED_MAX);
  });

  it('stand on free deck: clear of the platform, the catwalk, the rails, towers, racks, tanks and carts', () => {
    for (let i = 0; i < PARKING_SPOTS.length; i++) {
      const s = spotRect(i);
      for (const f of FURNITURE) expect(overlaps(s, f), `${s.name} × ${f.name}`).toBe(false);
      for (let j = i + 1; j < PARKING_SPOTS.length; j++) expect(overlaps(s, spotRect(j))).toBe(false);
      // inside the walls
      expect(Math.max(Math.abs(s.minY), Math.abs(s.maxY))).toBeLessThan(24);
    }
  });

  it('one ship on each side first (port, then starboard)', () => {
    expect(Math.sign(PARKING_SPOTS[0]!.y)).toBe(-Math.sign(PARKING_SPOTS[1]!.y));
  });
});

describe('height rule', () => {
  it('nothing above the build floor over the platform, rising 0.6 per cell beyond r 8.5', () => {
    expect(heightLimit(0)).toBe(FLOOR_TOP);
    expect(heightLimit(8.5)).toBe(FLOOR_TOP);
    expect(heightLimit(13.5)).toBeCloseTo(FLOOR_TOP + 3);
    const over: YardBox = { minX: -1, maxX: 1, minY: 7, maxY: 9, top: 0 };
    expect(clearsHeightRule(over)).toBe(false);
    expect(clearsHeightRule({ ...over, minY: 10, maxY: 12 })).toBe(true);
  });
});

describe('placeInSpot', () => {
  it('stands a small ship on the deck at full size, against the edge nearer the platform', () => {
    for (const spot of PARKING_SPOTS) {
      const p = placeInSpot(STARTER, spot);
      expect(p.scale).toBe(1);
      const box = placedBox(STARTER, p);
      expect(p.z + STARTER.minZ).toBeCloseTo(BAY_DECK);
      const inner = spot.y - Math.sign(spot.y) * spot.halfY;
      expect(Math.min(Math.abs(box.minY), Math.abs(box.maxY))).toBeCloseTo(Math.abs(inner));
      expect((box.minX + box.maxX) / 2).toBeCloseTo(spot.x);
      expect(clearsHeightRule(box)).toBe(true);
    }
  });

  it('scales a ship larger than the spot down to fit it, never hiding the build floor', () => {
    // the largest hull: 15 × 15 cells, tall parts
    const huge: ShipBounds = { minX: -7.6, maxX: 7.6, minY: -7.5, maxY: 7.5, minZ: -0.4, maxZ: 1.2 };
    for (const spot of PARKING_SPOTS) {
      const p = placeInSpot(huge, spot);
      expect(p.scale).toBeLessThan(1);
      const box = placedBox(huge, p);
      expect(box.minX).toBeGreaterThanOrEqual(spot.x - spot.halfX - 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(spot.x + spot.halfX + 1e-9);
      expect(box.minY).toBeGreaterThanOrEqual(spot.y - spot.halfY - 1e-9);
      expect(box.maxY).toBeLessThanOrEqual(spot.y + spot.halfY + 1e-9);
      expect(clearsHeightRule(box)).toBe(true);
    }
  });

  it('a ship whose origin is off its centre still lands in the spot', () => {
    const offset: ShipBounds = { ...STARTER, minX: 1, maxX: 6, minY: 2, maxY: 4 };
    const spot = PARKING_SPOTS[1]!;
    const box = placedBox(offset, placeInSpot(offset, spot));
    expect((box.minX + box.maxX) / 2).toBeCloseTo(spot.x);
    expect(box.maxY).toBeCloseTo(spot.y + spot.halfY);
  });
});

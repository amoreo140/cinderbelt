import { describe, expect, it } from 'vitest';
import { BIOMES_BY_DEPTH } from '../../sim/regions/sectors';
import { GAS_GIANT_ANCHOR } from '../../sim/world/landmarks';
import {
  copyMixedLook,
  createMixedLook,
  glareAngle,
  keepOffCenter,
  LANDMARK_PLANET_FADE,
  LANDMARK_PLANET_SIGHT,
  LANDMARK_PLANETS,
  landmarkPlanetFade,
  lightDirection,
  lookAheadAtDepth,
  mixGrade,
  mixHex,
  mixLookInto,
  parallaxLag,
  ZONE_LOOKS,
  zoneLookFor,
  zonePlanetOpacity,
} from './zoneLook';

describe('zone looks', () => {
  it('every ring has a sun near the top of the screen and a planet well below the plane', () => {
    for (const look of Object.values(ZONE_LOOKS)) {
      expect(look.sun.ndc.y).toBeGreaterThan(0.6);
      expect(Math.abs(look.sun.ndc.x)).toBeLessThan(0.9);
      expect(look.planets.length).toBeGreaterThan(0);
      for (const p of look.planets) {
        // the whole planet (and its atmosphere) is below the plane and the deepest silhouettes
        expect(p.depth - p.radius * 1.1).toBeGreaterThan(600);
        // it fits in front of the far plane (5000) seen from the highest camera
        expect(Math.hypot(p.depth + 120, lookAheadAtDepth(p.depth, 55)) + p.radius * 1.1).toBeLessThan(4600);
      }
    }
  });
});

describe('glare', () => {
  it('no zone sun mirrors straight into the camera off a level hull', () => {
    for (const look of Object.values(ZONE_LOOKS)) {
      // the sun's azimuth on the plane: screen right = +x, screen top = −z (approximation of its ray)
      expect(glareAngle(look.sun.ndc.x * 0.6, -1, look.sun.elevationDeg, 55)).toBeGreaterThan(14);
    }
  });
  it('flags the glare case', () => {
    expect(glareAngle(0, -1, 55, 55)).toBeLessThan(1);
  });
});

describe('lightDirection', () => {
  it('keeps the sun azimuth and lifts it to the elevation', () => {
    const d = lightDirection(0.6, -0.8, 45);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(d.x / d.z).toBeCloseTo(0.6 / -0.8, 6);
  });
  it('a sun straight overhead on screen still gives a valid direction', () => {
    const d = lightDirection(0, 0, 30);
    expect(d.z).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
  });
});

describe('parallaxLag', () => {
  it('lags k × the travel close to the anchor', () => {
    const lag = parallaxLag({ x: 100, y: 0 }, 0.3, 2000);
    expect(lag.x).toBeCloseTo(30, 0);
    expect(lag.y).toBe(0);
  });
  it('saturates far away – the planet never drifts off the sky', () => {
    const far = parallaxLag({ x: 0, y: 1e6 }, 0.3, 2000);
    expect(far.y).toBeCloseTo(600, 3);
    const a = parallaxLag({ x: 3000, y: 0 }, 0.3, 2000).x;
    const b = parallaxLag({ x: 3100, y: 0 }, 0.3, 2000).x;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(30 * 0.3);
  });
  it('is continuous through the anchor', () => {
    expect(parallaxLag({ x: 0, y: 0 }, 0.3, 2000)).toEqual({ x: 0, y: 0 });
    expect(Math.abs(parallaxLag({ x: 1e-3, y: 0 }, 0.3, 2000).x)).toBeLessThan(1e-3);
  });
});

describe('keepOffCenter', () => {
  const half = { x: 2000, y: 1000 };
  it('leaves a planet near the edge alone', () => {
    expect(keepOffCenter({ x: 1800, y: 0 }, half, 0.7, { x: 1, y: 0 })).toEqual({ x: 1800, y: 0 });
  });
  it('pushes a planet out of the middle along its direction', () => {
    const d = keepOffCenter({ x: 200, y: 100 }, half, 0.7, { x: 1, y: 0 });
    expect(Math.hypot(d.x / half.x, d.y / half.y)).toBeCloseTo(0.7, 6);
    expect(d.y / d.x).toBeCloseTo(0.5, 6);
  });
  it('uses the fallback direction at the exact centre', () => {
    const d = keepOffCenter({ x: 0, y: 0 }, half, 0.7, { x: -1000, y: 0 });
    expect(d.x).toBeCloseTo(-1400, 6);
    expect(d.y).toBeCloseTo(0, 6);
  });
  it('every zone planet starts off-centre', () => {
    for (const look of Object.values(ZONE_LOOKS)) {
      for (const p of look.planets) {
        const dist = (p.depth + 23) / Math.sin((55 * Math.PI) / 180);
        const t = Math.tan((25 * Math.PI) / 180);
        const h = { x: dist * t * 1.78, y: (dist * t) / Math.sin((55 * Math.PI) / 180) };
        expect(Math.hypot(p.offset.x / h.x, p.offset.y / h.y)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('mixing', () => {
  it('mixes colours per channel', () => {
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixHex(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
    expect(mixHex(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
  });
  it('mixes grades', () => {
    const g = mixGrade(ZONE_LOOKS[1].grade, ZONE_LOOKS[2].grade, 0.5);
    expect(g.vignette).toBeCloseTo((ZONE_LOOKS[1].grade.vignette + ZONE_LOOKS[2].grade.vignette) / 2, 6);
    expect(g.lift[0]).toBeCloseTo((ZONE_LOOKS[1].grade.lift[0] + ZONE_LOOKS[2].grade.lift[0]) / 2, 6);
  });
});

describe('sector zone looks', () => {
  const biomes = Object.entries(BIOMES_BY_DEPTH).flatMap(([d, list]) => list.map((b) => [Number(d) as 1 | 2 | 3 | 4, b] as const));

  it('every biome of every depth has a look built on its depth', () => {
    for (const [depth, biome] of biomes) {
      const look = zoneLookFor(depth, biome);
      const base = ZONE_LOOKS[depth];
      // the panorama, sun and planets stay the depth's – the biome only tints
      expect(look.sun).toBe(base.sun);
      expect(look.planets).toBe(base.planets);
      expect(look.debris.density).toBeGreaterThan(0);
      expect(look.debris.density).toBeLessThanOrEqual(1);
      expect(look.nebulaOpacity).toBeLessThan(0.25);
      expect(zoneLookFor(depth, biome)).toBe(look);
    }
    // the first biome of a depth is its signature look
    for (const d of [1, 2, 3, 4] as const) expect(zoneLookFor(d, BIOMES_BY_DEPTH[d][0]!).dust).toBe(ZONE_LOOKS[d].dust);
  });

  it('the biomes of a depth look different from each other', () => {
    for (const d of [1, 2, 3] as const) {
      const looks = BIOMES_BY_DEPTH[d].map((b) => zoneLookFor(d, b));
      const keys = new Set(looks.map((l) => `${l.dust}|${l.skyTint}|${l.nebula.join()}|${l.nebulaOpacity}|${JSON.stringify(l.debris)}`));
      expect(keys.size).toBe(looks.length);
    }
  });

  it('a cross-fade mixes in place from a snapshot, and a reversal starts where the fade was', () => {
    const a = zoneLookFor(1, 'asteroidField');
    const b = zoneLookFor(2, 'rustField');
    const shown = createMixedLook(a);
    const from = createMixedLook(a);
    mixLookInto(shown, from, b, 0);
    expect(shown).toEqual(createMixedLook(a));
    mixLookInto(shown, from, b, 1);
    expect(shown).toEqual(createMixedLook(b));
    // halfway, then back toward a: the reversal begins at the half-mixed look (no jump)
    mixLookInto(shown, from, b, 0.5);
    const half = createMixedLook(a);
    copyMixedLook(half, shown);
    const back = createMixedLook(b);
    mixLookInto(back, half, a, 0);
    expect(back).toEqual(half);
    expect(half.sunLightIntensity).toBeCloseTo((a.sun.lightIntensity + b.sun.lightIntensity) / 2, 6);
    expect(half.grade.lift[0]).toBeCloseTo((a.grade.lift[0] + b.grade.lift[0]) / 2, 6);
  });
});

describe('landmark planets', () => {
  it('sit below the plane and fade by the distance to their anchor, not by the zone', () => {
    expect(LANDMARK_PLANETS.length).toBeGreaterThan(0);
    for (const p of LANDMARK_PLANETS) {
      expect(p.landmark).toBeDefined();
      expect(p.depth - p.radius * 1.1).toBeGreaterThan(600);
    }
    expect(landmarkPlanetFade(0)).toBe(1);
    expect(landmarkPlanetFade(LANDMARK_PLANET_SIGHT)).toBe(1);
    expect(landmarkPlanetFade(LANDMARK_PLANET_SIGHT + LANDMARK_PLANET_FADE / 2)).toBeCloseTo(0.5, 6);
    expect(landmarkPlanetFade(LANDMARK_PLANET_SIGHT + LANDMARK_PLANET_FADE)).toBe(0);
    // the gas giant is in full view from home and from its own sector past the depth-1 border
    expect(landmarkPlanetFade(Math.hypot(GAS_GIANT_ANCHOR.x, GAS_GIANT_ANCHOR.y))).toBe(1);
    expect(landmarkPlanetFade(Math.hypot(GAS_GIANT_ANCHOR.x - 1500, GAS_GIANT_ANCHOR.y + 0))).toBe(1);
  });
});

describe('zone planet next to a landmark planet', () => {
  it('the major zone planet gives way while a landmark planet is in view, moons stay', () => {
    expect(zonePlanetOpacity(1, 0, false)).toBe(1);
    expect(zonePlanetOpacity(1, 1, false)).toBe(0);
    expect(zonePlanetOpacity(0.8, 0.5, false)).toBeCloseTo(0.4);
    expect(zonePlanetOpacity(0.8, 1, true)).toBe(0.8);
    // the depth-2 zone near home has a big planet that would sit next to the gas giant
    expect(ZONE_LOOKS[2].planets.some((p) => !p.minor && p.radius > 300)).toBe(true);
  });
});

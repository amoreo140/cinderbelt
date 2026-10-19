import { describe, expect, it } from 'vitest';
import { STATION_LAYOUTS, stationModelFor } from '../../data/stations';
import { length } from '../math/vec2';
import { CHUNK_SIZE, chunkCoord } from './chunks';
import { generateChunk, START_CLEAR_RADIUS } from './generate';
import { ringIndexAt } from './rings';
import {
  HOME_STATION_ID,
  HOME_ZONE_RADIUS,
  MIN_STATION_SPACING,
  NAME_PREFIX_COUNT,
  NAME_STAR_COUNT,
  STATION_MARGIN,
  guaranteedStationChunks,
  homeStation,
  nearestDiscoveredStation,
  stationAt,
  stationById,
  stationChance,
  stationsInArea,
  type StationDef,
} from './stations';

describe('home station', () => {
  it('sits at the origin with the port towards +x', () => {
    const home = homeStation();
    expect(home.id).toBe(HOME_STATION_ID);
    expect(home.kind).toBe('home');
    expect(home.pos).toEqual({ x: 0, y: 0 });
    expect(home.portAngle).toBe(0);
    expect(home.ring).toBe(1);
    expect(home.radius).toBe(14);
    expect(home.clearRadius).toBe(START_CLEAR_RADIUS);
    expect(home.services.shipyard).toBe(true);
    expect(stationAt(7, 0, 0)).toEqual(home);
  });

  it('uses the collision circles of its model', () => {
    expect(homeStation().colliders).toEqual(
      STATION_LAYOUTS.station_home.circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r })),
    );
  });
});

describe('stationChance', () => {
  it('falls with the ring and blends smoothly at boundaries', () => {
    expect(stationChance(800)).toBeCloseTo(0.02);
    expect(stationChance(2500)).toBeCloseTo(0.012);
    expect(stationChance(6000)).toBeCloseTo(0.006);
    expect(stationChance(20000)).toBeCloseTo(0.003);
    const mid = stationChance(1500);
    expect(mid).toBeLessThan(0.02);
    expect(mid).toBeGreaterThan(0.012);
  });
});

describe('stationAt', () => {
  it('is deterministic and depends on the seed', () => {
    const seeds = [1, 2, 3, 4, 5];
    const area = (seed: number) => stationsInArea(seed, -12, 12, -12, 12).map((s) => s.id);
    for (const seed of seeds) expect(area(seed)).toEqual(area(seed));
    expect(area(1)).not.toEqual(area(2));
  });

  it('places stations inside their chunk with a margin', () => {
    for (const s of stationsInArea(3, -15, 15, -15, 15)) {
      if (s.kind === 'home') continue;
      const lx = s.pos.x - s.chunk.cx * CHUNK_SIZE;
      const ly = s.pos.y - s.chunk.cy * CHUNK_SIZE;
      expect(lx).toBeGreaterThanOrEqual(STATION_MARGIN);
      expect(lx).toBeLessThanOrEqual(CHUNK_SIZE - STATION_MARGIN);
      expect(ly).toBeGreaterThanOrEqual(STATION_MARGIN);
      expect(ly).toBeLessThanOrEqual(CHUNK_SIZE - STATION_MARGIN);
      expect(s.id).toBe(`st:${s.chunk.cx},${s.chunk.cy}`);
      expect(s.ring).toBe(ringIndexAt(length(s.pos)));
    }
  });

  it('keeps stations at least 800 apart over a large area', () => {
    for (const seed of [11, 12]) {
      const list = stationsInArea(seed, -25, 25, -25, 25);
      expect(list.length).toBeGreaterThan(8);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = Math.hypot(list[i]!.pos.x - list[j]!.pos.x, list[i]!.pos.y - list[j]!.pos.y);
          expect(d).toBeGreaterThanOrEqual(MIN_STATION_SPACING);
        }
      }
    }
  });

  it('puts no random station closer than 600 to the origin', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const s of stationsInArea(seed, -5, 4, -5, 4)) {
        if (s.kind !== 'home') expect(length(s.pos)).toBeGreaterThanOrEqual(HOME_ZONE_RADIUS);
      }
    }
  });

  it('guarantees G1 in ring 1 and G2 in ring 2 for 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [g1, g2] = guaranteedStationChunks(seed);
      const s1 = stationAt(seed, g1.cx, g1.cy);
      const s2 = stationAt(seed, g2.cx, g2.cy);
      expect(s1?.kind).toBe('station');
      expect(s1?.ring).toBe(1);
      expect(s1?.name.number).toBeNull();
      expect(s2?.kind).toBe('station');
      expect(s2?.ring).toBe(2);
      expect(length(s1!.pos)).toBeGreaterThan(820);
      expect(length(s2!.pos)).toBeGreaterThan(2100);
    }
  });

  it('mixes stations and outposts with valid names and prices', () => {
    const list = stationsInArea(5, -30, 30, -30, 30).filter((s) => s.kind !== 'home');
    const outposts = list.filter((s) => s.kind === 'outpost');
    expect(outposts.length).toBeGreaterThan(0);
    expect(outposts.length).toBeLessThan(list.length);
    for (const s of list) {
      expect(s.name.prefix).toBeGreaterThanOrEqual(0);
      expect(s.name.prefix).toBeLessThan(NAME_PREFIX_COUNT);
      expect(s.name.star).toBeLessThan(NAME_STAR_COUNT);
      if (s.name.number !== null) {
        expect(s.name.number).toBeGreaterThanOrEqual(2);
        expect(s.name.number).toBeLessThanOrEqual(99);
      }
      for (const j of Object.values(s.priceJitter)) {
        expect(j).toBeGreaterThanOrEqual(0.95);
        expect(j).toBeLessThanOrEqual(1.05);
      }
      if (s.kind === 'outpost') expect(s.services.shipyard).toBe(false);
      expect(s.clearRadius).toBeGreaterThanOrEqual(STATION_LAYOUTS[s.model].clearRadius);
    }
  });

  it('roughly matches the expected count per ring', () => {
    let ring1 = 0;
    let ring2 = 0;
    const seeds = 6;
    for (let seed = 100; seed < 100 + seeds; seed++) {
      for (const s of stationsInArea(seed, -21, 20, -21, 20)) {
        const d = length(s.pos);
        if (s.kind === 'home') continue;
        if (d < 1500) ring1++;
        else if (d < 4000) ring2++;
      }
    }
    // ring 1: ~3 random + G1; ring 2: ~11 + G2 (the spacing cancels some candidates)
    expect(ring1 / seeds).toBeGreaterThanOrEqual(1);
    expect(ring1 / seeds).toBeLessThanOrEqual(6);
    expect(ring2 / seeds).toBeGreaterThanOrEqual(5);
    expect(ring2 / seeds).toBeLessThanOrEqual(18);
  });
});

describe('stationById and nearestDiscoveredStation', () => {
  it('finds stations by id', () => {
    const [g1] = guaranteedStationChunks(9);
    const s = stationAt(9, g1.cx, g1.cy)!;
    expect(stationById(9, s.id)).toEqual(s);
    expect(stationById(9, HOME_STATION_ID)).toEqual(homeStation());
    expect(stationById(9, 'st:nonsense')).toBeNull();
    expect(stationById(9, 'st:0,1')).toBeNull();
  });

  it('returns the nearest discovered station, home when nothing else is known', () => {
    const [g1, g2] = guaranteedStationChunks(4);
    const s1 = stationAt(4, g1.cx, g1.cy)!;
    const s2 = stationAt(4, g2.cx, g2.cy)!;
    const near1 = { x: s1.pos.x * 0.9, y: s1.pos.y * 0.9 };
    expect(nearestDiscoveredStation(4, [HOME_STATION_ID], near1).id).toBe(HOME_STATION_ID);
    expect(nearestDiscoveredStation(4, [HOME_STATION_ID, s1.id, s2.id], near1).id).toBe(s1.id);
    expect(nearestDiscoveredStation(4, [s2.id], s2.pos).id).toBe(s2.id);
    expect(nearestDiscoveredStation(4, [], { x: 5000, y: 0 }).id).toBe(HOME_STATION_ID);
  });
});

describe('asteroids around stations', () => {
  const clearOf = (station: StationDef, seed: number) => {
    const { cx, cy } = station.chunk;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const a of generateChunk(seed, cx + dx, cy + dy).asteroids) {
          const d = Math.hypot(a.pos.x - station.pos.x, a.pos.y - station.pos.y);
          expect(d).toBeGreaterThanOrEqual(station.clearRadius + a.baseRadius);
        }
      }
    }
  };

  it('keeps the clear zone of stations free of asteroids', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const [g1, g2] = guaranteedStationChunks(seed);
      clearOf(stationAt(seed, g1.cx, g1.cy)!, seed);
      clearOf(stationAt(seed, g2.cx, g2.cy)!, seed);
      clearOf(homeStation(), seed);
    }
  });

  it('attaches the station to its chunk', () => {
    const [g1] = guaranteedStationChunks(2);
    expect(generateChunk(2, g1.cx, g1.cy).station?.id).toBe(`st:${g1.cx},${g1.cy}`);
    expect(generateChunk(2, 0, 0).station?.id).toBe(HOME_STATION_ID);
    expect(chunkCoord(stationAt(2, g1.cx, g1.cy)!.pos.x)).toBe(g1.cx);
  });
});

describe('world generations (worldGen.ts)', () => {
  const area = (seed: number, gen: 1 | 2) => stationsInArea(seed, -21, 20, -21, 20, gen);

  it('generation 1 is the original pick – the models of existing saves never change', () => {
    // pinned: seed 1337 (the fixtures' seed) as every save before V14 knows it
    expect(stationsInArea(1337, -12, 12, -12, 12).map((s) => `${s.id}:${s.model}`)).toEqual([
      'st:-12,8:station_b',
      'st:-10,-10:station_b',
      'st:-8,-3:station_b',
      'st:-5,-7:outpost_b',
      'home:station_home',
      'st:0,5:station_a',
      'st:3,-7:outpost_b',
      'st:6,1:outpost_a',
      'st:7,-8:outpost_b',
    ]);
    for (const seed of [3, 1337]) {
      for (const s of area(seed, 1)) expect(s.model).toBe(s.kind === 'home' ? 'station_home' : stationModelFor(s.kind, s.variant));
      expect(stationsInArea(seed, -21, 20, -21, 20)).toEqual(area(seed, 1));
      for (const s of area(seed, 1).slice(0, 5)) expect(stationById(seed, s.id)).toEqual(s);
    }
  });

  it('generation 2 changes only the model and its collision circles', () => {
    let changed = 0;
    for (const seed of [3, 7, 1337]) {
      const one = area(seed, 1);
      const two = area(seed, 2);
      expect(two.map((s) => s.id)).toEqual(one.map((s) => s.id));
      two.forEach((s, i) => {
        const { model: m2, colliders: c2, ...rest2 } = s;
        const { model: m1, colliders: _c1, ...rest1 } = one[i]!;
        expect(rest2).toEqual(rest1);
        expect(c2).toEqual(STATION_LAYOUTS[m2].circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r })));
        if (m1 !== m2) changed++;
      });
      for (const s of two.slice(0, 5)) expect(stationById(seed, s.id, 2)).toEqual(s);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('the asteroids of a chunk do not depend on the generation', () => {
    for (let cx = -6; cx <= 6; cx += 2) {
      for (let cy = -6; cy <= 6; cy += 3) {
        const one = generateChunk(1337, cx, cy, 1);
        const two = generateChunk(1337, cx, cy, 2);
        expect(two.asteroids).toEqual(one.asteroids);
        expect(two.station?.id).toBe(one.station?.id);
      }
    }
  });
});

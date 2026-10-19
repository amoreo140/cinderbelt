import { describe, expect, it } from 'vitest';
import {
  STATION_KIND_RADIUS,
  STATION_LAYOUTS,
  STATION_MODELS,
  STATION_SERVICES,
  stationModelFor,
  stationModelForRing,
  type StationKind,
  type StationModel,
} from './stations';
import layoutsJson from './station_layouts.json';
import { trafficRole } from './speakers';

const KINDS: StationKind[] = ['home', 'station', 'outpost'];

describe('station layouts', () => {
  it('has a layout for every model', () => {
    for (const kind of KINDS) {
      for (const model of STATION_MODELS[kind]) expect(STATION_LAYOUTS[model]).toBeDefined();
    }
  });

  it('uses the radius of the station kind and puts the dock port at (R, 0)', () => {
    for (const kind of KINDS) {
      for (const model of STATION_MODELS[kind]) {
        const layout = STATION_LAYOUTS[model];
        expect(layout.radius).toBe(STATION_KIND_RADIUS[kind]);
        expect(layout.dockPort).toEqual({ x: layout.radius, y: 0 });
        expect(layout.clearRadius).toBeGreaterThanOrEqual(layout.radius + 12);
      }
    }
  });

  it('keeps all collision circles inside the station radius', () => {
    for (const model of Object.keys(STATION_LAYOUTS) as StationModel[]) {
      const layout = STATION_LAYOUTS[model];
      expect(layout.circles.length).toBeGreaterThan(0);
      for (const c of layout.circles) {
        expect(c.r).toBeGreaterThan(0);
        expect(Math.hypot(c.x, c.y) + c.r).toBeLessThanOrEqual(layout.radius + 0.1);
      }
    }
  });

  it('matches the layout exported by the artist (art/blender/data)', () => {
    // the artist's source may not exist (e.g. in a bundle without art/)
    const sources = import.meta.glob('../../art/blender/data/station_layouts.json', { eager: true, import: 'default' });
    const art = Object.values(sources)[0];
    if (!art) return;
    // on mismatch: copy art/blender/data/station_layouts.json to src/data/
    expect(layoutsJson).toEqual(art);
  });
});

describe('station services', () => {
  it('home and stations offer everything', () => {
    for (const kind of ['home', 'station'] as const) {
      expect(Object.values(STATION_SERVICES[kind]).every(Boolean)).toBe(true);
    }
  });

  it('outposts have no production, parts market or shipyard', () => {
    const s = STATION_SERVICES.outpost;
    expect(s.crafting).toBe(false);
    expect(s.shipyard).toBe(false);
    expect(s.partsMarket).toBe(false);
    expect(s.market && s.refuel && s.repair && s.save).toBe(true);
  });
});

describe('stationModelFor', () => {
  it('picks a model of the right kind by variant', () => {
    expect(stationModelFor('home', 0.7)).toBe('station_home');
    expect(stationModelFor('station', 0)).toBe('station_a');
    expect(stationModelFor('station', 0.5)).toBe('station_b');
    expect(stationModelFor('station', 0.99)).toBe('station_c');
    expect(stationModelFor('outpost', 0.2)).toBe('outpost_a');
    expect(stationModelFor('outpost', 0.8)).toBe('outpost_b');
    expect(stationModelFor('outpost', 1)).toBe('outpost_b');
  });
});

describe('stationModelForRing (world generation 2)', () => {
  const variants = Array.from({ length: 600 }, (_, i) => i / 599);
  const rings = [1, 2, 3, 4];

  it('keeps the role of the generation-1 pick (the traffic voice never changes)', () => {
    for (const kind of KINDS) {
      for (const ring of rings) {
        for (const v of variants) {
          expect(trafficRole(kind, stationModelForRing(kind, v, ring))).toBe(trafficRole(kind, stationModelFor(kind, v)));
          expect(STATION_MODELS[kind]).toContain(stationModelForRing(kind, v, ring));
        }
      }
    }
  });

  it('puts each batch D model only into its rings', () => {
    const seen = new Map<StationModel, Set<number>>();
    for (const kind of KINDS) {
      for (const ring of rings) {
        for (const v of variants) {
          const m = stationModelForRing(kind, v, ring);
          if (!seen.has(m)) seen.set(m, new Set());
          seen.get(m)!.add(ring);
        }
      }
    }
    expect([...seen.get('station_d')!].sort()).toEqual([1, 2, 3]);
    expect([...seen.get('station_e')!]).toEqual([2]);
    expect([...seen.get('outpost_c')!]).toEqual([3]);
    expect([...seen.get('outpost_d')!]).toEqual([2]);
    // every model stays in use somewhere
    for (const kind of KINDS) for (const m of STATION_MODELS[kind]) expect(seen.has(m)).toBe(true);
  });

  it('splits the shares as designed', () => {
    const count = (kind: StationKind, ring: number, model: StationModel) => variants.filter((v) => stationModelForRing(kind, v, ring) === model).length / variants.length;
    expect(count('station', 2, 'station_e')).toBeCloseTo(1 / 6, 1);
    expect(count('station', 1, 'station_d')).toBeCloseTo(2 / 9, 1);
    expect(count('station', 4, 'station_c')).toBeCloseTo(1 / 3, 1);
    expect(count('outpost', 2, 'outpost_d')).toBeCloseTo(1 / 3, 1);
    expect(count('outpost', 3, 'outpost_c')).toBeCloseTo(1 / 3, 1);
    expect(count('outpost', 1, 'outpost_c') + count('outpost', 1, 'outpost_d')).toBe(0);
  });
});

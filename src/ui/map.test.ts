import { describe, expect, it } from 'vitest';
import {
  autoHalfSize,
  GRADE_LABEL_MIN_SCALE,
  distToPolyline,
  legendGroups,
  mapViewHalfSize,
  MAX_HALF_SIZE,
  MIN_HALF_SIZE,
  nearestRingBorder,
  niceScale,
  parseChunkKey,
  ringLabelPoint,
  showGradeLabels,
  zoomAround,
  type LegendInput,
} from './map';

describe('map helpers', () => {
  it('parses chunk keys', () => {
    expect(parseChunkKey('-2,5')).toEqual({ cx: -2, cy: 5 });
  });

  it('fits explored chunks and the player with a minimum size', () => {
    expect(mapViewHalfSize(['0,0'], { x: 0, y: 0 })).toBe(600);
    // chunk 9,0 reaches x = 2000 → 2000 * 1.15
    expect(mapViewHalfSize(['9,0'], { x: 0, y: 0 })).toBeCloseTo(2300);
    expect(mapViewHalfSize([], { x: 0, y: -1000 })).toBeCloseTo(1150);
  });

  it('the automatic view includes the nearest ring border and the contract targets', () => {
    expect(nearestRingBorder({ x: 1200, y: 0 })).toBe(300);
    // at home: the ring 1 border is 1 500 u away
    expect(autoHalfSize({ x: 0, y: 0 }, [])).toBe(1500 + 220);
    // a contract target 2 000 u to the east
    expect(autoHalfSize({ x: 1400, y: 0 }, [{ x: 3400, y: 0 }])).toBeCloseTo(2000 * 1.15 + 60);
    expect(autoHalfSize({ x: 0, y: 0 }, [{ x: 50_000, y: 0 }])).toBe(MAX_HALF_SIZE);
  });

  it('picks a round scale bar length', () => {
    expect(niceScale(1, 110)).toBe(100);
    expect(niceScale(4, 110)).toBe(500);
    expect(niceScale(15, 110)).toBe(2000);
  });

  it('zooms around the cursor and clamps the zoom', () => {
    const z = zoomAround({ x: 0, y: 0 }, 1000, { x: 500, y: 0 }, 0.5);
    expect(z.half).toBe(500);
    expect(z.center).toEqual({ x: 250, y: 0 });
    expect(zoomAround({ x: 0, y: 0 }, 400, { x: 0, y: 0 }, 0.1).half).toBe(MIN_HALF_SIZE);
  });

  it('places the ring name on the visible part of the border', () => {
    const p = ringLabelPoint(1500, { x: 1300, y: 0 }, 600)!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1500, 6);
    expect(Math.abs(p.x - 1300)).toBeLessThan(600);
    expect(ringLabelPoint(1500, { x: 0, y: 0 }, 300)).toBeNull();
    // a wide view reaches the border sideways even when it is too short to reach it up or down
    const wide = ringLabelPoint(1500, { x: 0, y: 0 }, 1600, 600)!;
    expect(Math.abs(wide.y)).toBeLessThan(600);
    expect(ringLabelPoint(1500, { x: 0, y: 0 }, 1200, 600)).toBeNull();
  });

  it('shows ore grade labels only when zoomed in', () => {
    // the default view at home on a 640 px tall display
    expect(showGradeLabels(320 / autoHalfSize({ x: 0, y: 0 }, []))).toBe(false);
    expect(showGradeLabels(GRADE_LABEL_MIN_SCALE)).toBe(true);
    expect(showGradeLabels(320 / MIN_HALF_SIZE)).toBe(true);
  });
});

describe('map legend', () => {
  const all = { stations: true, signals: true, places: true, contracts: true, fields: true, sectors: true, convoys: true, notes: true };
  const base: LegendInput = {
    layers: all,
    stations: [{ kind: 'home' }, { kind: 'outpost' }],
    targets: 2,
    signals: 1,
    places: [{ kind: 'giant' }, { kind: 'echo' }],
    pirates: [{ kind: 'fortress' }, { kind: 'beacon' }],
    fields: [
      { resource: 'ice', depleted: false },
      { resource: 'iron', depleted: false, grade: 1.3 },
      { resource: 'copper', depleted: true },
    ],
  };

  it('lists what the active layers show, in a fixed order', () => {
    const g = legendGroups(base);
    expect(g.map((x) => x.layer)).toEqual(['ship', 'contracts', 'stations', 'signals', 'places', 'fields', 'sectors']);
    expect(g.find((x) => x.layer === 'stations')!.items).toEqual([
      { kind: 'station', station: 'home' },
      { kind: 'station', station: 'outpost' },
    ]);
    expect(g.find((x) => x.layer === 'places')!.items).toEqual([
      { kind: 'place', place: 'echo' },
      { kind: 'place', place: 'giant' },
      { kind: 'pirate', pirate: 'fortress' },
      { kind: 'pirate', pirate: 'beacon' },
    ]);
  });

  it('explains the asteroid field colours, mined-out fields and rich ore', () => {
    const fields = legendGroups(base).find((x) => x.layer === 'fields')!.items;
    // copper only in a mined-out field → no copper colour
    expect(fields).toEqual([{ kind: 'field', resource: 'iron' }, { kind: 'field', resource: 'ice' }, { kind: 'depleted' }, { kind: 'rich' }]);
  });

  it('the Sectors layer explains the four securities, the three knowledge glyphs and the lane', () => {
    const items = legendGroups(base).find((x) => x.layer === 'sectors')!.items;
    expect(items).toEqual([
      { kind: 'security', security: 'quiet' },
      { kind: 'security', security: 'guarded' },
      { kind: 'security', security: 'contested' },
      { kind: 'security', security: 'pirate' },
      { kind: 'knowledge', knowledge: 'charted' },
      { kind: 'knowledge', knowledge: 'reported' },
      { kind: 'knowledge', knowledge: 'uncharted' },
      { kind: 'lane' },
    ]);
  });

  it('a layer that is off or empty has no entries, the ship is always there', () => {
    const g = legendGroups({ ...base, layers: { ...all, fields: false, stations: false }, targets: 0, signals: 0 });
    expect(g.map((x) => x.layer)).toEqual(['ship', 'places', 'sectors']);
    const none = legendGroups({ ...base, layers: { stations: false, signals: false, places: false, contracts: false, fields: false, sectors: false, convoys: false, notes: false } });
    expect(none).toEqual([{ layer: 'ship', items: [{ kind: 'ship' }] }]);
  });

  it('names the world sites on the map (M4b): derelict, graveyard, a passing comet and a known pass track', () => {
    const places = (input: Partial<LegendInput>) => legendGroups({ ...base, ...input }).find((x) => x.layer === 'places')!.items;
    const sites = [{ kind: 'graveyard' as const }, { kind: 'derelict' as const }];
    expect(places({ sites })).toEqual([
      { kind: 'place', place: 'echo' },
      { kind: 'place', place: 'giant' },
      { kind: 'place', place: 'derelict' },
      { kind: 'place', place: 'graveyard' },
      { kind: 'pirate', pirate: 'fortress' },
      { kind: 'pirate', pirate: 'beacon' },
    ]);
    // a known comet away from its pass: only its track; passing: the comet too
    expect(places({ comets: [{ now: null }] })).toContainEqual({ kind: 'cometArc' });
    expect(places({ comets: [{ now: null }] })).not.toContainEqual({ kind: 'place', place: 'comet' });
    const passing = places({ comets: [{ now: { x: 0, y: 0 } }] });
    expect(passing.slice(2, 4)).toEqual([{ kind: 'place', place: 'comet' }, { kind: 'cometArc' }]);
    // the Places layer off hides them all
    const off = legendGroups({ ...base, sites, comets: [{ now: null }], layers: { ...all, places: false } });
    expect(off.some((g) => g.layer === 'places')).toBe(false);
  });

  it('M4d: the Guild layer and the notes layer name what is on the map, stale marks join the places', () => {
    const guild = {
      convoys: [{}],
      relays: [
        { known: true, stage: 'broken' },
        { known: false, stage: 'secured' },
      ],
      watch: [{}, {}],
    };
    const notes = [{ icon: 'ore' as const }, { icon: 'star' as const }, { icon: 'ore' as const }];
    const stale = [{ kind: 'comet' as const }, { kind: 'pirates' as const }];
    const g = legendGroups({ ...base, guild, notes, stale });
    expect(g.map((x) => x.layer)).toEqual(['ship', 'contracts', 'stations', 'signals', 'places', 'convoys', 'notes', 'fields', 'sectors']);
    // the unknown secured relay is not on the map, so the one relay entry is not lit
    expect(g.find((x) => x.layer === 'convoys')!.items).toEqual([{ kind: 'convoy' }, { kind: 'watch' }, { kind: 'relay', lit: false }]);
    const allLit = { ...guild, relays: [{ known: true, stage: 'powered' }, { known: true, stage: 'secured' }] };
    expect(legendGroups({ ...base, guild: allLit }).find((x) => x.layer === 'convoys')!.items).toEqual([{ kind: 'convoy' }, { kind: 'watch' }, { kind: 'relay', lit: true }]);
    expect(g.find((x) => x.layer === 'notes')!.items).toEqual([
      { kind: 'note', icon: 'star' },
      { kind: 'note', icon: 'ore' },
    ]);
    expect(g.find((x) => x.layer === 'places')!.items.slice(-2)).toEqual([
      { kind: 'stale', stale: 'pirates' },
      { kind: 'stale', stale: 'comet' },
    ]);
    // empty data or the layers off: no groups
    const quiet = legendGroups({ ...base, guild: { convoys: [], relays: [], watch: [] }, notes: [] });
    expect(quiet.some((x) => x.layer === 'convoys' || x.layer === 'notes')).toBe(false);
    const off = legendGroups({ ...base, guild, notes, layers: { ...all, convoys: false, notes: false } });
    expect(off.some((x) => x.layer === 'convoys' || x.layer === 'notes')).toBe(false);
  });
});

describe('distToPolyline', () => {
  it('measures to the nearest segment, clamped to its ends', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distToPolyline(pts, { x: 5, y: 3 })).toBeCloseTo(3);
    expect(distToPolyline(pts, { x: 13, y: 5 })).toBeCloseTo(3);
    expect(distToPolyline(pts, { x: -4, y: -3 })).toBeCloseTo(5);
    expect(distToPolyline([{ x: 1, y: 1 }], { x: 4, y: 5 })).toBeCloseTo(5);
    expect(distToPolyline([], { x: 0, y: 0 })).toBe(Infinity);
  });
});

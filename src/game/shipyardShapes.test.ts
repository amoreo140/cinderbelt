import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { createGrid } from '../sim/ship/grid';
import { shaped } from '../sim/ship/testing';
import { evaluateDesign } from '../sim/shipyard/design';
import { buildHullView, hasShapes, nextFittingShape, nextShape, reshapePreview, SHAPE_CYCLE, shapeStrip, shapeTip } from './shipyardView';

// SL2 E2 U2: the shape strip, the ghost tooltip and ½ hull points in the shipyard view model.

afterEach(() => setLocale('sk'));

describe('shapeStrip', () => {
  it('only armour has a strip: full + the 9 shapes in the Tab order', () => {
    expect(shapeStrip(null, null)).toBeNull();
    expect(shapeStrip('cannon:1', null)).toBeNull();
    expect(hasShapes('armor:2')).toBe(true);
    const strip = shapeStrip('armor:1', null)!;
    expect(strip.items.map((i) => i.shape)).toEqual([null, 'wedge', 'chamfer', 'round', 'arc', 'half', 'nose', 'wingL', 'wingR', 'nose2x1']);
    expect(strip.label).toBe('Tvar');
    expect(strip.keys).toBe('Tab');
    expect(strip.hint).toContain('10 kr');
    expect(strip.activeIndex).toBe(0);
    expect(strip.items.filter((i) => i.active).map((i) => i.shape)).toEqual([null]);
  });

  it('gives each shape its points, HP and a "½ b · 20 HP" fact line', () => {
    const strip = shapeStrip('armor:1', 'wedge')!;
    const by = Object.fromEntries(strip.items.map((i) => [i.shape ?? 'full', i]));
    expect(by.full).toMatchObject({ name: 'Plný', points: 1, hp: 40, facts: '1 b · 40 HP' });
    expect(by.wedge).toMatchObject({ name: 'Klin', points: 0.5, hp: 20, facts: '½ b · 20 HP', active: true });
    expect(by.chamfer).toMatchObject({ points: 1, hp: 35 });
    expect(by.nose2x1).toMatchObject({ points: 1.5, hp: 67, facts: '1½ b · 67 HP' });
    expect(strip.activeIndex).toBe(1);
    expect(shapeStrip('armor:2', null)!.tier).toBe(2);
  });

  it('speaks English', () => {
    setLocale('en');
    const strip = shapeStrip('armor:1', 'half')!;
    expect(strip.items[strip.activeIndex]).toMatchObject({ name: 'Half plate', facts: '½ pt · 20 HP' });
  });

  it('cycles full → wedge → … → nose 2×1 → full and back', () => {
    expect(nextShape(null, 1)).toBe('wedge');
    expect(nextShape('nose2x1', 1)).toBeNull();
    expect(nextShape(null, -1)).toBe('nose2x1');
    expect(nextShape('wedge', -1)).toBeNull();
    let s: (typeof SHAPE_CYCLE)[number] = SHAPE_CYCLE[0]!;
    for (let i = 0; i < SHAPE_CYCLE.length; i++) s = nextShape(s, 1);
    expect(s).toBeNull();
  });
});

describe('shapeTip', () => {
  // cannon at (1,0) facing the bow; the cell diagonal in front of it, (2,1), trims its arc when full
  const ship = () => createGrid([['cockpit', 0, 0], ['cannon', 1, 0]]);

  it('is null for parts without shapes', () => {
    expect(shapeTip(ship(), { key: 'cannon:1', x: 2, y: 1, rot: 0, shape: null })).toBeNull();
  });

  it('shows points, HP and the arc a full plate takes from a nearby cannon', () => {
    const tip = shapeTip(ship(), { key: 'armor:1', x: 2, y: 1, rot: 0, shape: null })!;
    expect(tip.points).toBe(1);
    expect(tip.hp).toBe(40);
    expect(tip.arcs).toHaveLength(1);
    expect(tip.arcs[0]).toMatchObject({ partId: 2, x: 1, y: 0 });
    expect(tip.arcs[0]!.deg).toBeLessThan(0);
    expect(tip.text).toBe(`1 b · 40 HP · −${-tip.arcs[0]!.deg}° výseku pre kanón (1,0)`);
  });

  it('a wedge in the same place takes less arc – and reshaping the plate gives the difference back', () => {
    const full = shapeTip(ship(), { key: 'armor:1', x: 2, y: 1, rot: 0, shape: null })!;
    const wedges = ([0, 1, 2, 3] as const).map((rot) => shapeTip(ship(), { key: 'armor:1', x: 2, y: 1, rot, shape: 'wedge' })!);
    const best = Math.max(...wedges.map((w) => w.arcs[0]?.deg ?? 0));
    expect(best).toBeGreaterThan(full.arcs[0]!.deg);
    // reshape in place: the placed full plate becomes the best wedge – the cannon gains arc
    const rot = wedges.findIndex((w) => (w.arcs[0]?.deg ?? 0) === best) as 0 | 1 | 2 | 3;
    const placed = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, 1, rot]]);
    const reshape = shapeTip(placed, { key: 'armor:1', x: 2, y: 1, rot, shape: 'wedge', replaceId: 3 })!;
    expect(reshape.points).toBe(0.5);
    expect(reshape.arcs[0]!.deg).toBeGreaterThan(0);
    expect(reshape.text).toMatch(/^½ b · 20 HP · \+\d+° výseku pre kanón \(1,0\)$/);
  });

  it('ignores cannons further than 2 cells away and unchanged arcs', () => {
    const tip = shapeTip(ship(), { key: 'armor:1', x: -3, y: 3, rot: 0, shape: 'wedge' })!;
    expect(tip.arcs).toEqual([]);
    expect(tip.text).toBe('½ b · 20 HP');
  });

  it('caches per ghost and grid', () => {
    const grid = ship();
    const g = { key: 'armor:1' as const, x: 2, y: 1, rot: 0 as const, shape: 'wedge' as const };
    expect(shapeTip(grid, g)).toBe(shapeTip(grid, { ...g }));
    expect(shapeTip(grid, { ...g, x: 3 })).not.toBe(shapeTip(grid, g));
  });
});

describe('reshapePreview (empty hand over a placed plate)', () => {
  const placed = () => createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 2, 1]]);

  it('shows the shape Tab lays the plate in next, with its points, HP and arc change', () => {
    const grid = placed();
    const preview = reshapePreview(grid, 3)!;
    expect(preview).toMatchObject({ id: 3, key: 'armor:1', tier: 1, rot: 0, from: null, to: 'wedge', name: 'Pancier T1 · Plný → Klin' });
    expect(preview.tip).toBe(shapeTip(grid, { key: 'armor:1', x: 2, y: 1, rot: 0, shape: 'wedge', replaceId: 3 })!.text);
    expect(preview.tip).toMatch(/^½ b · 20 HP/);
    expect(reshapePreview(shaped(grid, 3, 'wedge'), 3)).toMatchObject({ from: 'wedge', to: 'chamfer', name: 'Pancier T1 · Klin → Zrezaný roh' });
    setLocale('en');
    expect(reshapePreview(grid, 3)!.name).toBe('Armour T1 · Full → Wedge');
  });

  it('is null for parts without shapes and missing parts', () => {
    const grid = placed();
    expect(reshapePreview(grid, 2)).toBeNull();
    expect(reshapePreview(grid, 99)).toBeNull();
  });

  it('skips shapes that do not fit, like the editor (the 2×1 wings and nose next to a part)', () => {
    const boxed = shaped(createGrid([['cockpit', 0, 0], ['armor', 2, 1], ['armor', 3, 1], ['armor', 1, 1]]), 2, 'nose');
    const plate = boxed.parts.find((p) => p.id === 2)!;
    expect(nextFittingShape(boxed, plate)).toEqual({ shape: null });
    expect(nextFittingShape(boxed, plate, -1)).toEqual({ shape: 'half' });
    expect(reshapePreview(boxed, 2)).toMatchObject({ from: 'nose', to: null });
  });

  it('caches per grid and part', () => {
    const grid = placed();
    expect(reshapePreview(grid, 3)).toBe(reshapePreview(grid, 3));
  });
});

describe('hull view with ½ points', () => {
  it('prints "1½ / 28 b" for a cockpit with a wedge', () => {
    const grid = shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]), 2, 'wedge');
    const draftLike = {
      grid,
      base: { grid, hp: new Map(), inventory: {}, stationId: 'home' },
      acquire: {},
    } as unknown as Parameters<typeof evaluateDesign>[0];
    const report = evaluateDesign(draftLike, {
      ring: 1,
      services: { crafting: false, partsMarket: false },
      credits: 0,
      storage: { iron: 0, copper: 0, ice: 0, titanium: 0 },
      cargo: { iron: 0, copper: 0, ice: 0, titanium: 0 },
      fuel: 0,
    });
    const hull = buildHullView(report);
    expect(hull.used).toBe(report.hull.used);
    expect(hull.used % 1).toBe(0.5);
    expect(hull.points).toMatch(/^\d+½ \/ \d+ b$/);
  });
});

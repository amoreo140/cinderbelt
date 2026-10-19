import { describe, expect, it } from 'vitest';
import { createGrid, partCells } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import type { ShipGrid } from '../ship/types';
import { normalizeParts, normalizeTemplate } from '../templates/normalize';
import { randomShip, shifted } from '../templates/testShips';
import type { ShipTemplate, TemplatePart } from '../templates/types';
import { HANGAR_MAX, HANGAR_MIN, replayOps } from './editor';
import { templateOps } from './template';

const tpl = (grid: ShipGrid, name = 'T'): ShipTemplate => ({ name, parts: normalizeTemplate(grid)! });
const idAt = (grid: ShipGrid, x: number, y: number) => grid.parts.find((p) => p.x === x && p.y === y)!.id;
/** Replays the plan and returns the resulting grid (fails the test when the ops do not replay). */
function apply(grid: ShipGrid, ops: Parameters<typeof replayOps>[1]): ShipGrid {
  const r = replayOps(grid, ops);
  if (!r.ok) throw new Error(`op ${r.index} failed: ${r.error}`);
  return r.grid;
}

describe('templateOps', () => {
  it('identical ship → no ops, also when it stands elsewhere in the hangar', () => {
    const ship = createStarterShip();
    expect(templateOps(ship, new Map(), tpl(ship))).toEqual({ ops: [], offset: { x: 1, y: 0 }, kept: ship.parts.length, moved: 0, removed: {}, placed: {}, unplaced: 0 });
    const elsewhere = shifted(ship, -3, 2);
    expect(templateOps(elsewhere, new Map(), tpl(ship)).ops).toEqual([]);
  });

  it('a cockpit-only ship → every other part is placed, around the cockpit where it stands', () => {
    const ship = createStarterShip();
    const cockpitOnly = createGrid([['cockpit', 3, -2]]);
    const plan = templateOps(cockpitOnly, new Map(), tpl(ship));
    expect(plan).toMatchObject({ offset: { x: 3, y: -2 }, kept: 1, moved: 0, removed: {}, unplaced: 0 });
    expect(plan.ops.every((o) => o.op === 'place')).toBe(true);
    expect(plan.placed).toEqual({ 'gyro:1': 1, 'miningLaser:1': 1, 'reactor:1': 1, 'cargo:1': 2, 'fuelTank:1': 1, 'radar:1': 1, 'engine:1': 6 });
    const result = apply(cockpitOnly, plan.ops);
    expect(normalizeTemplate(result)).toEqual(tpl(ship).parts);
    expect(result.parts.find((p) => p.partId === 'cockpit')).toMatchObject({ id: 1, x: 3, y: -2 });
  });

  it('keeps damaged matching parts (repair is the shipyard business) and takes extra parts off', () => {
    const ship = createStarterShip();
    const gyro = idAt(ship, 0, 0);
    const withExtra: ShipGrid = { parts: [...ship.parts, { id: 99, partId: 'armor', tier: 1, x: 3, y: 0, rot: 0 }], nextId: 100 };
    const plan = templateOps(withExtra, new Map([[gyro, 1]]), tpl(ship));
    expect(plan.ops).toEqual([{ op: 'remove', id: 99 }]);
    expect(plan).toMatchObject({ kept: ship.parts.length, removed: { 'armor:1': 1 }, placed: {} });
  });

  it('moves a part of the right key into its place instead of buying a new one (keeps id and HP)', () => {
    const template = tpl(createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0]]));
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 0, 1]]);
    const plan = templateOps(ship, new Map([[3, 10]]), template);
    expect(plan).toMatchObject({ kept: 2, moved: 1, removed: {}, placed: {} });
    const result = apply(ship, plan.ops);
    expect(result.parts.find((p) => p.id === 3)).toMatchObject({ x: 1, y: 0 });
    expect(normalizeTemplate(result)).toEqual(template.parts);
  });

  it('a turned part is turned in place', () => {
    const template = tpl(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]));
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 2]]);
    const plan = templateOps(ship, new Map(), template);
    expect(plan.ops).toEqual([{ op: 'moveGroup', moves: [{ id: 2, x: -1, y: 0, rot: 0 }] }]);
  });

  it('parts may trade places (one group move)', () => {
    const template = tpl(createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0], ['cargo', 0, 1]]));
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['cargo', 1, 0], ['armor', 0, 1]]);
    const plan = templateOps(ship, new Map(), template);
    expect(plan).toMatchObject({ moved: 2, placed: {}, removed: {} });
    expect(normalizeTemplate(apply(ship, plan.ops))).toEqual(template.parts);
  });

  it('moves the healthiest spare part; a damaged surplus one comes off', () => {
    const template = tpl(createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0]]));
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 0, 1], ['armor', 0, -1]]);
    const plan = templateOps(ship, new Map([[3, 5]]), template);
    expect(plan.ops).toEqual([{ op: 'remove', id: 3 }, { op: 'moveGroup', moves: [{ id: 4, x: 1, y: 0, rot: 0 }] }]);
  });

  it('a different cockpit is swapped like any other part; the template goes to the hangar centre', () => {
    const template = tpl(createGrid([['cockpit', 2, 2, 0, 2], ['engine', 1, 2]]));
    const ship = createGrid([['cockpit', 4, 4], ['engine', 3, 4]]);
    const plan = templateOps(ship, new Map(), template);
    expect(plan).toMatchObject({ offset: { x: 0, y: 0 }, kept: 0, moved: 1, removed: { 'cockpit:1': 1 }, placed: { 'cockpit:2': 1 } });
    const result = apply(ship, plan.ops);
    expect(result.parts.find((p) => p.partId === 'cockpit')).toMatchObject({ tier: 2, x: 0, y: 0 });
    expect(normalizeTemplate(result)).toEqual(template.parts);
  });

  it('shifts the template into the hangar when the cockpit stands near an edge', () => {
    // a 15-cell line, cockpit at its left end
    const parts: TemplatePart[] = [['cockpit:1', 0, 0, 0], ...Array.from({ length: 14 }, (_, i): TemplatePart => ['armor:1', i + 1, 0, 0])];
    const template: ShipTemplate = { name: 'L', parts: normalizeParts(parts)! };
    const ship = createGrid([['cockpit', 5, 5]]);
    const plan = templateOps(ship, new Map(), template);
    expect(plan.offset).toEqual({ x: HANGAR_MIN, y: 5 });
    expect(plan.unplaced).toBe(0);
    const result = apply(ship, plan.ops);
    expect(result.parts.flatMap(partCells).every((c) => c.x >= HANGAR_MIN && c.x <= HANGAR_MAX)).toBe(true);
    expect(normalizeTemplate(result)).toEqual(template.parts);
  });

  it('locked parts and variants produce ops (the editor shows the lock)', () => {
    const template: ShipTemplate = { name: 'V', parts: [['cockpit:2:scout', 0, 0, 0], ['engine:2:overdrive', -1, 0, 0]] };
    const plan = templateOps(createGrid([['cockpit', 0, 0], ['engine', -1, 0]]), new Map(), template);
    expect(plan.placed).toEqual({ 'cockpit:2:scout': 1, 'engine:2:overdrive': 1 });
    expect(plan.removed).toEqual({ 'cockpit:1': 1, 'engine:1': 1 });
  });

  it('a Guild loan part in place stays; an owned spare is moved before a loan one', () => {
    const template = tpl(createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0]]));
    const ship = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 0, 1], ['armor', 0, -1]]);
    ship.parts[1]!.loan = true;
    ship.parts[2]!.loan = true;
    const plan = templateOps(ship, new Map(), template);
    expect(plan.kept).toBe(2);
    expect(plan.ops).toEqual([{ op: 'remove', id: 3 }, { op: 'moveGroup', moves: [{ id: 4, x: 1, y: 0, rot: 0 }] }]);
  });

  it('property: any ship → any template, the ops replay and give exactly the template', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const from = randomShip(seed, seed % 40);
      const target = tpl(randomShip(10_000 + seed, 1 + (seed % 50)));
      const hp = new Map(from.parts.filter((p) => p.id % 3 === 0).map((p) => [p.id, 1]));
      const plan = templateOps(from, hp, target);
      expect(plan.unplaced, `seed ${seed}`).toBe(0);
      const result = apply(from, plan.ops);
      expect(normalizeTemplate(result), `seed ${seed}`).toEqual(target.parts);
      // the counts add up: every original part is kept, moved or removed; every template part kept, moved or placed
      const count = (inv: Record<string, number | undefined>) => Object.values(inv).reduce<number>((s, n) => s + (n ?? 0), 0);
      expect(plan.kept + plan.moved + count(plan.removed), `seed ${seed}`).toBe(from.parts.length);
      expect(plan.kept + plan.moved + count(plan.placed), `seed ${seed}`).toBe(target.parts.length);
      // a part is never bought while one of the same key comes off
      for (const key of Object.keys(plan.placed)) expect(plan.removed[key as keyof typeof plan.removed], `seed ${seed} ${key}`).toBeUndefined();
      // applying again does nothing
      expect(templateOps(result, new Map(), target).ops, `seed ${seed}`).toEqual([]);
    }
  });
});

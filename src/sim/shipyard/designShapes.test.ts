// SL2 E2 S6b: shaped armour in the shipyard design.
import { describe, expect, it } from 'vitest';
import { repairCost, scrapResources } from '../../data/economy';
import type { PartId, PartInventory, Tier } from '../../data/parts';
import { emptyCargo, type Cargo } from '../../data/resources';
import type { ShapeId } from '../../data/shapes';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { shaped } from '../ship/testing';
import type { HpMap, Rotation, ShipGrid } from '../ship/types';
import { applyStroke, createDraft, type ShipyardDraft } from './draft';
import { evaluateDesign, type DesignInput, type ShipyardContext } from './design';
import type { EditorOp } from './editor';

function ctx(patch: Partial<ShipyardContext> = {}): ShipyardContext {
  return {
    ring: 1,
    services: { crafting: true, partsMarket: true },
    credits: 10_000,
    storage: emptyCargo(),
    cargo: emptyCargo(),
    fuel: 0,
    ...patch,
  };
}
const cargo = (c: Partial<Cargo>): Cargo => ({ ...emptyCargo(), ...c });
const codes = (list: { code: string }[]) => list.map((e) => e.code);

function draftWith(ops: EditorOp[], inventory: PartInventory = {}, hp: HpMap = new Map(), grid = createStarterShip()): ShipyardDraft {
  const r = applyStroke(createDraft('home', grid, hp, inventory), ops);
  expect(r.errors).toEqual([]);
  return r.draft;
}

/** Cockpit, a forward engine behind it and one T1 armour plate (id 3) in front, laid in `shape`. */
const plate = (shape?: ShapeId): ShipGrid => {
  const armour: [PartId, number, number, Rotation?, Tier?, ShapeId?] = shape ? ['armor', 1, 0, 0, 1, shape] : ['armor', 1, 0, 0, 1];
  return createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], armour]);
};
const on = (grid: ShipGrid, ops: EditorOp[], hp: HpMap = new Map()) => draftWith(ops, {}, hp, grid);

/** The design of `grid` against itself (no change). */
const rawDesign = (grid: ShipGrid): DesignInput => ({ base: { grid, hp: new Map(), inventory: {} }, grid, acquire: {} });

/** Base `grid` with HP `hp`, the draft = part 3 laid in `shape` in place (a crafted op – the editor never sends it for damaged parts). */
const rawShaped = (grid: ShipGrid, shape: ShapeId | null, hp: HpMap): DesignInput => ({
  base: { grid, hp, inventory: {} },
  grid: shaped(grid, 3, shape),
  acquire: {},
});

/** Part 3 turned to `rot` in place. */
const rotated = (grid: ShipGrid, rot: Rotation): ShipGrid => ({ ...grid, parts: grid.parts.map((p) => (p.id === 3 ? { ...p, rot } : p)) });

describe('evaluateDesign – reshape is an installation', () => {
  it('a reshape is one installation (10 cr) and needs no part', () => {
    const r = evaluateDesign(on(plate(), [{ op: 'reshape', id: 3, shape: 'wedge' }]), ctx());
    expect(r.errors).toEqual([]);
    expect(r.cost).toMatchObject({ installCount: 1, installCredits: 10, credits: 10, fromStorage: {}, toStorage: {}, craft: {}, buy: {} });
  });

  it('a reshape and a move of the same part count once', () => {
    const r = evaluateDesign(on(plate(), [{ op: 'reshape', id: 3, shape: 'wedge' }, { op: 'move', id: 3, x: 0, y: 1, rot: 3 }]), ctx());
    expect(r.cost.installCount).toBe(1);
    expect(r.cost.credits).toBe(10);
  });

  it('reshaping back is another installation – no free trick across commits', () => {
    // in one draft there and back again is no change at all
    const same = evaluateDesign(on(plate(), [{ op: 'reshape', id: 3, shape: 'wedge' }, { op: 'reshape', id: 3, shape: null }]), ctx());
    expect(same.cost.installCount).toBe(0);
    // after the wedge was committed, laying it full again is a new installation
    const back = evaluateDesign(on(plate('wedge'), [{ op: 'reshape', id: 3, shape: null }]), ctx());
    expect(back.cost).toMatchObject({ installCount: 1, credits: 10 });
  });
});

describe('evaluateDesign – damaged shaped armour (default b: damage = HP missing in full-plate HP)', () => {
  it('a damaged plate removed and placed again as a wedge: the repair is priced at the full plate’s ratio', () => {
    const d = on(plate(), [{ op: 'remove', id: 3 }, { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0, shape: 'wedge' }], new Map([[3, 20]]));
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 50 }) }));
    expect(r.errors).toEqual([]);
    const full = repairCost('armor:1', 20, 40, 1);
    expect(full.credits).toBeGreaterThan(0);
    expect(r.cost.repairs).toEqual([{ id: 3, key: 'armor:1', hp: 20, maxHp: 40, credits: full.credits, material: full.material, amount: full.amount }]);
    // the repaired plate is the new wedge's item: nothing to storage, nothing new
    expect(r.cost.toStorage).toEqual({});
    expect(r.cost.fromStorage).toEqual({});
    expect(r.cost.installCount).toBe(1);
    expect(r.cost.credits).toBe(10 + full.credits);
  });

  it('repair parity per HP: a wedge missing 10 HP costs what a full plate missing 10 HP costs', () => {
    const rich = ctx({ storage: cargo({ iron: 50 }) });
    const wedge = evaluateDesign(on(plate('wedge'), [{ op: 'remove', id: 3 }], new Map([[3, 10]])), rich);
    const full = evaluateDesign(on(plate(), [{ op: 'remove', id: 3 }], new Map([[3, 30]])), rich);
    expect(wedge.cost.repairs[0]).toMatchObject({ hp: 10, maxHp: 20 });
    expect(wedge.cost.repairCredits).toBeGreaterThan(0);
    expect(wedge.cost.repairCredits).toBe(full.cost.repairCredits);
    expect(wedge.cost.resources).toEqual(full.cost.resources);
  });

  it('a scrapped damaged shaped plate scraps from its full-equivalent HP', () => {
    const noRepair = ctx({ services: { crafting: true, partsMarket: true, repair: false } });
    const wedge = evaluateDesign(on(plate('wedge'), [{ op: 'remove', id: 3 }], new Map([[3, 10]])), noRepair);
    expect(wedge.cost.scrapped).toEqual({ 'armor:1': 1 });
    expect(wedge.cost.scrap).toEqual(scrapResources('armor:1', 30, 40));
    const full = evaluateDesign(on(plate(), [{ op: 'remove', id: 3 }], new Map([[3, 30]])), noRepair);
    expect(wedge.cost.scrap).toEqual(full.cost.scrap);
  });

  it('a crafted reshape of a damaged part is the error reshapeDamaged; a full-HP part reshapes freely', () => {
    const damaged = evaluateDesign(rawShaped(plate(), 'wedge', new Map([[3, 30]])), ctx());
    expect(damaged.errors).toContainEqual({ code: 'reshapeDamaged', partId: 3 });
    expect(damaged.canCommit).toBe(false);
    // an explicit HP entry at full HP is no damage
    expect(codes(evaluateDesign(rawShaped(plate(), 'wedge', new Map([[3, 40]])), ctx()).errors)).not.toContain('reshapeDamaged');
    // a damaged wedge laid back full (10 HP of 40) – refused as well
    expect(evaluateDesign(rawShaped(plate('wedge'), null, new Map([[3, 10]])), ctx()).errors).toContainEqual({ code: 'reshapeDamaged', partId: 3 });
    // the editor path: the same reshape sent as a reshape op on a damaged part
    const crafted = evaluateDesign(on(plate(), [{ op: 'reshape', id: 3, shape: 'chamfer' }], new Map([[3, 1]])), ctx());
    expect(codes(crafted.errors)).toContain('reshapeDamaged');
  });

  it('a damaged wing mirrored to the other wing keeps its max HP – no reshape error', () => {
    const r = evaluateDesign(rawShaped(plate('wingL'), 'wingR', new Map([[3, 25]])), ctx());
    expect(codes(r.errors)).not.toContain('reshapeDamaged');
  });
});

describe('evaluateDesign – shapeLooseContact', () => {
  it('warns about a wedge touching the ship only by its hypotenuse side, and not after a rotation', () => {
    // wedge rot 0: solid on −x and −y; rot 2 (and rot 1) turn the open side towards the cockpit at −x
    const loose = evaluateDesign(rawDesign(rotated(plate('wedge'), 2)), ctx());
    expect(loose.warnings).toContainEqual({ code: 'shapeLooseContact', partId: 3, shape: 'wedge' });
    expect(codes(evaluateDesign(rawDesign(rotated(plate('wedge'), 1)), ctx()).warnings)).toContain('shapeLooseContact');
    for (const rot of [0, 3] as const) {
      expect(codes(evaluateDesign(rawDesign(rotated(plate('wedge'), rot)), ctx()).warnings)).not.toContain('shapeLooseContact');
    }
  });

  it('a half plate by its open side warns; full parts never do', () => {
    // half rot 0 is solid on its −y half: a ½-long edge on −x (enough), rot 1 none on −x, rot 3 the full side
    expect(codes(evaluateDesign(rawDesign(rotated(plate('half'), 1)), ctx()).warnings)).toContain('shapeLooseContact');
    for (const rot of [0, 3] as const) {
      expect(codes(evaluateDesign(rawDesign(rotated(plate('half'), rot)), ctx()).warnings)).not.toContain('shapeLooseContact');
    }
    expect(codes(evaluateDesign(rawDesign(plate()), ctx()).warnings)).not.toContain('shapeLooseContact');
    expect(codes(evaluateDesign(draftWith([]), ctx()).warnings)).not.toContain('shapeLooseContact');
  });

  it('the best neighbour counts: a loose side on one neighbour is fine when another holds it', () => {
    // wedge rot 2 is open towards the cockpit (−x) but solid on +y, where a second plate sits
    const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 1, 0, 2, 1, 'wedge'], ['armor', 0, 1], ['armor', 1, 1]]);
    expect(codes(evaluateDesign(rawDesign(grid), ctx()).warnings)).not.toContain('shapeLooseContact');
  });
});

describe('evaluateDesign – hull budget in half points', () => {
  it('28 b fits a T1 cockpit, 28½ b is a hullBudget error', () => {
    // starter ship 14 pts + 13 plates + n wedges (½ pt each)
    const plates: EditorOp[] = [];
    for (let i = 0; i < 13; i++) plates.push({ op: 'place', key: 'armor:1', x: [0, 1, -1, 2][i % 4]!, y: 3 + Math.floor(i / 4), rot: 0 });
    const wedges = (n: number): EditorOp[] => [1, -1, 2].slice(0, n).map((x) => ({ op: 'place', key: 'armor:1', x, y: 6, rot: 0, shape: 'wedge' }));
    const fits = evaluateDesign(draftWith([...plates, ...wedges(2)], { 'armor:1': 20 }), ctx());
    expect(fits.hull).toEqual({ used: 28, budget: 28, cockpitTier: 1, over: false });
    expect(codes(fits.errors)).not.toContain('hullBudget');
    const over = evaluateDesign(draftWith([...plates, ...wedges(3)], { 'armor:1': 20 }), ctx());
    expect(over.errors).toContainEqual({ code: 'hullBudget', used: 28.5, budget: 28, cockpitTier: 1 });
  });
});

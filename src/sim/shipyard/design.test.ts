import { describe, expect, it } from 'vitest';
import type { PartInventory } from '../../data/parts';
import { emptyCargo, type Cargo } from '../../data/resources';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import type { HpMap, ShipGrid } from '../ship/types';
import { applyStroke, createDraft, setAcquire, type ShipyardDraft } from './draft';
import { evaluateDesign, WEAK_TURNING, type DesignInput, type ShipyardContext } from './design';
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

function draftWith(ops: EditorOp[], inventory: PartInventory = {}, hp: HpMap = new Map(), grid = createStarterShip()): ShipyardDraft {
  const r = applyStroke(createDraft('home', grid, hp, inventory), ops);
  expect(r.errors).toEqual([]);
  return r.draft;
}

/** A design straight from a grid (even an invalid one – the editor would not allow it). */
const rawDesign = (grid: ShipGrid, base = grid): DesignInput => ({
  base: { grid: base, hp: new Map(), inventory: {} },
  grid,
  acquire: {},
});

const codes = (list: { code: string }[]) => list.map((e) => e.code);

describe('evaluateDesign – cost from the difference', () => {
  it('an unchanged ship costs nothing and has no errors', () => {
    const r = evaluateDesign(draftWith([]), ctx());
    expect(r.errors).toEqual([]);
    expect(r.cost.credits).toBe(0);
    expect(r.cost.installCount).toBe(0);
    expect(r.props?.cargoCapacity).toBe(130);
  });

  it('takes a new part from the storage and charges the installation', () => {
    const r = evaluateDesign(draftWith([{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }], { 'armor:1': 2 }), ctx());
    expect(r.cost.fromStorage).toEqual({ 'armor:1': 1 });
    expect(r.cost.installCount).toBe(1);
    expect(r.cost.installCredits).toBe(10);
    expect(r.cost.credits).toBe(10);
    expect(r.cost.craft).toEqual({});
    expect(r.cost.buy).toEqual({});
  });

  it('removing is free and the part goes to the storage', () => {
    const r = evaluateDesign(draftWith([{ op: 'remove', id: 11 }]), ctx());
    expect(r.cost.toStorage).toEqual({ 'engine:1': 1 });
    expect(r.cost.credits).toBe(0);
  });

  it('removed and placed again cancel out – only the installation is paid', () => {
    const r = evaluateDesign(
      draftWith([{ op: 'remove', id: 11 }, { op: 'place', key: 'engine:1', x: 2, y: 1, rot: 2 }]),
      ctx(),
    );
    expect(r.cost.toStorage).toEqual({});
    expect(r.cost.fromStorage).toEqual({});
    expect(r.cost.installCount).toBe(1);
    expect(r.cost.credits).toBe(10);
  });

  it('moved or rotated parts pay the installation, untouched ones do not', () => {
    const r = evaluateDesign(
      draftWith([{ op: 'move', id: 7, x: 1, y: 2, rot: 0 }, { op: 'move', id: 2, x: 0, y: 0, rot: 1 }]),
      ctx(),
    );
    expect(r.cost.installCount).toBe(2);
    expect(r.cost.toStorage).toEqual({});
    expect(r.cost.credits).toBe(20);
  });

  it('crafts a missing part by default when the resources suffice (storage + cargo)', () => {
    const d = draftWith([{ op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 }]);
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 20 }), cargo: cargo({ iron: 10, copper: 10 }) }));
    expect(r.cost.craft).toEqual({ 'cargo:1': 1 });
    expect(r.cost.acquired).toEqual({ 'cargo:1': 'craft' });
    expect(r.cost.resources).toEqual({ iron: 30, copper: 10 });
    expect(r.cost.craftCredits).toBe(900);
    expect(r.cost.credits).toBe(910);
    expect(r.errors).toEqual([]);
  });

  it('buys a missing part when the resources do not suffice', () => {
    const d = draftWith([{ op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 }]);
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 29 }), cargo: cargo({ copper: 10 }) }));
    expect(r.cost.buy).toEqual({ 'cargo:1': 1 });
    expect(r.cost.buyCredits).toBe(1605);
    expect(r.cost.credits).toBe(1615);
    expect(r.cost.resources).toEqual({});
  });

  it('counts crafting resources cumulatively over all keys', () => {
    const d = draftWith([
      { op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 },
      { op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 },
    ]);
    // 40 Fe: the armour (15) is crafted, the cargo bay (30) is no longer affordable
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 40, copper: 10 }) }));
    expect(r.cost.craft).toEqual({ 'armor:1': 1 });
    expect(r.cost.buy).toEqual({ 'cargo:1': 1 });
  });

  it('follows the player choice to buy or craft', () => {
    const d = setAcquire(draftWith([{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]), 'armor:1', 'buy');
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 100 }) }));
    expect(r.cost.buy).toEqual({ 'armor:1': 1 });
    const crafted = evaluateDesign(setAcquire(d, 'armor:1', 'craft'), ctx({ storage: cargo({ iron: 3 }) }));
    expect(crafted.cost.craft).toEqual({ 'armor:1': 1 });
    expect(crafted.errors).toContainEqual({ code: 'missingResources', resources: { iron: 12 } });
  });

  it('a part that can be neither crafted nor bought here is missing', () => {
    const d = draftWith([{ op: 'place', key: 'engine:2', x: -2, y: 0, rot: 0 }]);
    const r = evaluateDesign(d, ctx());
    expect(r.cost.missing).toEqual({ 'engine:2': 1 });
    expect(r.cost.acquired).toEqual({ 'engine:2': 'unavailable' });
    expect(r.errors).toContainEqual({ code: 'missingParts', parts: { 'engine:2': 1 } });
    // without crafting and the parts market nothing can be obtained
    const t1 = draftWith([{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]);
    const none = evaluateDesign(t1, ctx({ services: { crafting: false, partsMarket: false }, storage: cargo({ iron: 99 }) }));
    expect(none.errors).toContainEqual({ code: 'missingParts', parts: { 'armor:1': 1 } });
  });

  it('reports unaffordable designs with the exact sums', () => {
    const d = draftWith([{ op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 }]);
    const r = evaluateDesign(d, ctx({ credits: 1240 }));
    expect(r.errors).toEqual([{ code: 'unaffordable', needed: 1615, available: 1240 }]);
  });

  it('repairs a damaged part when it is removed, also when it is placed again', () => {
    // T1 engine at 40% HP (10 / 25) → 72 cr + 4 Fe
    const hp: HpMap = new Map([[11, 10]]);
    const removed = evaluateDesign(draftWith([{ op: 'remove', id: 11 }], {}, hp), ctx({ storage: cargo({ iron: 4 }) }));
    expect(removed.cost.repairs).toEqual([
      { id: 11, key: 'engine:1', hp: 10, maxHp: 25, credits: 72, material: 'iron', amount: 4 },
    ]);
    expect(removed.cost.repairCredits).toBe(72);
    expect(removed.cost.resources).toEqual({ iron: 4 });
    expect(removed.cost.credits).toBe(72);
    const replaced = evaluateDesign(
      draftWith([{ op: 'remove', id: 11 }, { op: 'place', key: 'engine:1', x: 2, y: 1, rot: 2 }], {}, hp),
      ctx({ storage: cargo({ iron: 4 }) }),
    );
    expect(replaced.cost.credits).toBe(72 + 10);
    // without repair material the part is scrapped (M12) – see below
  });

  it('a moved damaged part keeps its damage and is not repaired', () => {
    const hp: HpMap = new Map([[11, 10]]);
    const r = evaluateDesign(draftWith([{ op: 'move', id: 11, x: 2, y: 1, rot: 1 }], {}, hp), ctx());
    expect(r.cost.repairs).toEqual([]);
  });
});

describe('evaluateDesign – free placement and moves (Shipyard 2.0)', () => {
  const moveAway = (id: number, x: number, y: number): EditorOp => ({ op: 'move', id, x, y, rot: 0 });

  it('a loose part is marked disconnected and blocks the confirm', () => {
    const r = evaluateDesign(draftWith([{ op: 'place', key: 'armor:1', x: 5, y: 5, rot: 0 }], { 'armor:1': 1 }), ctx());
    expect(r.disconnected).toEqual([15]);
    expect(codes(r.errors)).toEqual(['disconnected']);
    expect(r.canCommit).toBe(false);
  });

  it('only the net change is priced: moving a part away and back costs nothing', () => {
    const away = draftWith([moveAway(9, 5, 5)]);
    expect(evaluateDesign(away, ctx()).cost.installCount).toBe(1);
    const back = applyStroke(away, [{ op: 'move', id: 9, x: -1, y: 1, rot: 0 }]).draft;
    const r = evaluateDesign(back, ctx());
    expect(r.cost.credits).toBe(0);
    expect(r.cost.installCount).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it('a part moved through several loose spots pays one mount fee', () => {
    let d = draftWith([moveAway(9, 5, 5)]);
    for (const [x, y] of [[5, -5], [-5, -5], [-2, 1]]) d = applyStroke(d, [moveAway(9, x!, y!)]).draft;
    const r = evaluateDesign(d, ctx());
    expect(r.cost.installCount).toBe(1);
    expect(r.cost.credits).toBe(10);
  });

  it('a group move pays the mount fee per moved part, and nothing when it ends where it started', () => {
    const moves = [{ id: 13, x: 1, y: -2, rot: 1 as const }, { id: 14, x: 1, y: 2, rot: 3 as const }, { id: 9, x: -2, y: 0, rot: 0 as const }];
    const d = draftWith([{ op: 'moveGroup', moves }]);
    const r = evaluateDesign(d, ctx());
    expect(r.errors).toEqual([]);
    expect(r.cost.installCount).toBe(3);
    expect(r.cost.credits).toBe(30);
    expect(r.cost.fromStorage).toEqual({});
    expect(r.cost.toStorage).toEqual({});
    const back = applyStroke(d, [{ op: 'moveGroup', moves: [{ id: 13, x: 0, y: -2, rot: 1 }, { id: 14, x: 0, y: 2, rot: 3 }, { id: 9, x: -1, y: 1, rot: 0 }] }]).draft;
    expect(evaluateDesign(back, ctx()).cost.credits).toBe(0);
  });

  it('no free mount: taking a part off and placing the same type elsewhere costs the same as moving it', () => {
    const viaStorage = evaluateDesign(draftWith([{ op: 'remove', id: 9 }, { op: 'place', key: 'engine:1', x: -2, y: 0, rot: 0 }]), ctx());
    const moved = evaluateDesign(draftWith([moveAway(9, -2, 0)]), ctx());
    expect(viaStorage.cost.credits).toBe(moved.cost.credits);
    expect(viaStorage.cost.credits).toBe(10);
    expect(viaStorage.cost.toStorage).toEqual({});
    expect(viaStorage.cost.fromStorage).toEqual({});
  });
});

describe('evaluateDesign – errors', () => {
  it('an empty design has no properties, no cockpit and no forward engine', () => {
    const empty: ShipGrid = { parts: [], nextId: 1 };
    const r = evaluateDesign(rawDesign(empty, createStarterShip()), ctx());
    expect(r.props).toBeNull();
    expect(codes(r.errors)).toEqual(['noCockpit', 'noForwardEngine']);
  });

  it('reports a missing or doubled cockpit', () => {
    expect(codes(evaluateDesign(rawDesign(createGrid([['armor', 0, 0], ['engine', -1, 0]])), ctx()).errors)).toContain(
      'noCockpit',
    );
    const two = evaluateDesign(rawDesign(createGrid([['cockpit', 0, 0], ['cockpit', 1, 0], ['engine', -1, 0]])), ctx());
    expect(two.errors).toContainEqual({ code: 'multipleCockpits', count: 2 });
  });

  it('lists parts that are not connected to the cockpit', () => {
    const d = draftWith([{ op: 'remove', id: 2 }], {}, new Map(), createGrid([
      ['cockpit', 1, 0], ['armor', 0, 0], ['engine', -1, 0], ['engine', -2, 0],
    ]));
    const r = evaluateDesign(d, ctx());
    expect(r.errors).toContainEqual({ code: 'disconnected', partIds: [3, 4] });
  });

  it('needs an engine pushing forward', () => {
    const r = evaluateDesign(draftWith([{ op: 'move', id: 9, x: -1, y: 1, rot: 2 }, { op: 'remove', id: 10 }]), ctx());
    expect(codes(r.errors)).toEqual(['noForwardEngine']);
  });

  it('lets a ship that already cannot fly forward take parts off (to sell them), but not add or move any (S1)', () => {
    const starter = createStarterShip();
    const engineless = { ...starter, parts: starter.parts.filter((p) => !(p.partId === 'engine' && p.rot === 0)) };
    const strip = evaluateDesign(draftWith([{ op: 'remove', id: 13 }, { op: 'remove', id: 14 }], {}, new Map(), engineless), ctx());
    expect(strip.errors).toEqual([]);
    expect(strip.cost.toStorage).toEqual({ 'engine:1': 2 });
    const add = evaluateDesign(draftWith([{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }], {}, new Map(), engineless), ctx());
    expect(codes(add.errors)).toContain('noForwardEngine');
    const move = evaluateDesign(draftWith([{ op: 'move', id: 7, x: 3, y: 0, rot: 0 }], {}, new Map(), engineless), ctx());
    expect(codes(move.errors)).toContain('noForwardEngine');
    // a ship that can fly may not strip its last forward engine (only an already stranded one is let off)
    expect(codes(evaluateDesign(draftWith([{ op: 'remove', id: 9 }, { op: 'remove', id: 10 }]), ctx()).errors)).toEqual(['noForwardEngine']);
  });

  it('catches overlaps and ships larger than the hangar', () => {
    expect(codes(evaluateDesign(rawDesign(createGrid([['cockpit', 0, 0], ['engine', 0, 0]])), ctx()).errors)).toContain('overlap');
    expect(codes(evaluateDesign(rawDesign(createGrid([['cockpit', 7, 0], ['engine', 8, 0]])), ctx()).errors)).toContain('tooLarge');
  });
});

describe('evaluateDesign – hull budget (spec 3.4.1)', () => {
  /** The starter ship (14 pts) + `n` armour parts in rows above it. */
  function armorOps(n: number, startId = 15): EditorOp[] {
    const ops: EditorOp[] = [];
    for (let i = 0; i < n; i++) ops.push({ op: 'place', key: 'armor:1', x: [0, 1, -1, 2][i % 4]!, y: 3 + Math.floor(i / 4), rot: 0 });
    void startId;
    return ops;
  }

  it('a T1 cockpit carries 28 points: 14 more armour plates fit, the 15th is a hullBudget error', () => {
    expect(evaluateDesign(draftWith(armorOps(14), { 'armor:1': 20 }), ctx()).errors).toEqual([]);
    const over = evaluateDesign(draftWith(armorOps(15), { 'armor:1': 20 }), ctx());
    expect(over.errors).toEqual([{ code: 'hullBudget', used: 29, budget: 28, cockpitTier: 1 }]);
    expect(over.canCommit).toBe(false);
  });

  it('multi-cell parts cost their footprint points (large cargo 3 b, heavy laser 2 b)', () => {
    const r = evaluateDesign(draftWith([
      { op: 'place', key: 'largeCargo:1', x: -1, y: 3, rot: 0 },
      { op: 'place', key: 'heavyLaser:1', x: 3, y: 0, rot: 0 },
    ], { 'largeCargo:1': 1, 'heavyLaser:1': 1 }), ctx());
    expect(r.errors).toEqual([]);
    expect(r.hull).toEqual({ used: 19, budget: 28, cockpitTier: 1, over: false });
  });

  it('swapping to a T2 cockpit raises the budget to 48', () => {
    const d = draftWith([
      { op: 'remove', id: 1 },
      { op: 'place', key: 'cockpit:2', x: 1, y: 0, rot: 0 },
      ...armorOps(15),
    ], { 'cockpit:2': 1, 'armor:1': 20 });
    const r = evaluateDesign(d, ctx());
    expect(codes(r.errors)).not.toContain('hullBudget');
    expect(r.hull).toEqual({ used: 29, budget: 48, cockpitTier: 2, over: false });
  });

  it('a legacy ship over budget may fly and be trimmed, but nothing can be added (overBudgetLegacy)', () => {
    const list: [('cockpit' | 'armor' | 'engine'), number, number][] = [['cockpit', 0, 0], ['engine', -1, 0]];
    for (let i = 0; i < 30; i++) list.push(['armor', 1 + (i % 6), -2 + Math.floor(i / 6)]);
    const legacy = createGrid(list);
    // an unchanged old ship (32 pts > 28 pts): a warning only
    const same = evaluateDesign(draftWith([], {}, new Map(), legacy), ctx());
    expect(same.errors).toEqual([]);
    expect(same.warnings).toContainEqual({ code: 'overBudgetLegacy', used: 32, budget: 28, cockpitTier: 1 });
    // removing and moving are allowed even if the ship stays over budget
    const trimmed = evaluateDesign(draftWith([{ op: 'remove', id: 32 }, { op: 'move', id: 31, x: 7, y: 1, rot: 0 }], {}, new Map(), legacy), ctx());
    expect(trimmed.errors).toEqual([]);
    expect(codes(trimmed.warnings)).toContain('overBudgetLegacy');
    // adding a part (also swapping) over budget is an error
    const added = evaluateDesign(draftWith([{ op: 'remove', id: 32 }, { op: 'place', key: 'armor:1', x: 0, y: 1, rot: 0 }], { 'armor:1': 1 }, new Map(), legacy), ctx());
    expect(added.errors).toContainEqual({ code: 'hullBudget', used: 32, budget: 28, cockpitTier: 1 });
  });

  it('warns when a heavy laser points straight into a part (front cell only)', () => {
    const blocked = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['heavyLaser', 1, 0, 0], ['armor', 3, 0]]);
    expect(evaluateDesign(rawDesign(blocked), ctx()).warnings).toContainEqual({ code: 'blockedLaser', partId: 3 });
    const free = createGrid([['cockpit', 0, 0], ['engine', -1, 0], ['heavyLaser', 1, 0, 0], ['armor', 1, 1]]);
    expect(codes(evaluateDesign(rawDesign(free), ctx()).warnings)).not.toContain('blockedLaser');
  });

  it('has no budget check without exactly one cockpit (other errors cover it)', () => {
    const r = evaluateDesign(rawDesign(createGrid([['armor', 0, 0], ['engine', -1, 0]])), ctx());
    expect(codes(r.errors)).not.toContain('hullBudget');
    expect(r.hull.budget).toBeNull();
  });
});

describe('evaluateDesign – warnings', () => {
  const bare = () => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]);

  it('warns about missing engine directions and a missing mining laser', () => {
    const r = evaluateDesign(rawDesign(bare()), ctx());
    expect(r.errors).toEqual([]);
    expect(codes(r.warnings)).toEqual(['noBackwardEngine', 'noLeftEngine', 'noRightEngine', 'noMiningLaser']);
  });

  it('the starter ship has no warnings', () => {
    expect(evaluateDesign(draftWith([]), ctx()).warnings).toEqual([]);
  });

  it('warns about an energy deficit while mining', () => {
    const d = draftWith([{ op: 'remove', id: 4 }, { op: 'place', key: 'miningLaser:1', x: -1, y: 0, rot: 2 }]);
    const r = evaluateDesign(d, ctx({ storage: cargo({ iron: 20, copper: 30 }) }));
    // cockpit +2, two lasers −12
    expect(r.warnings).toContainEqual({ code: 'energyDeficit', balance: -10, activity: 'mining' });
  });

  it('warns that cargo goes to the storage and fuel is lost', () => {
    const r = evaluateDesign(draftWith([{ op: 'remove', id: 5 }, { op: 'remove', id: 7 }, { op: 'remove', id: 14 }]), ctx({
      cargo: cargo({ iron: 60, copper: 36 }),
      fuel: 110,
    }));
    expect(r.warnings).toContainEqual({ code: 'cargoOverflow', cargo: 96, capacity: 70, toStorage: 26 });
    expect(r.warnings).toContainEqual({ code: 'fuelOverflow', fuel: 110, capacity: 20, lost: 90 });
    expect(r.cost.cargoToStorage).toBe(26);
    expect(r.cost.cargoMoves).toEqual({ iron: 26 });
    expect(r.cost.fuelLost).toBe(90);
  });

  it('resources used for crafting leave the cargo before the overflow is computed', () => {
    const d = draftWith([
      { op: 'remove', id: 5 },
      { op: 'remove', id: 14 },
      { op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 },
    ]);
    const r = evaluateDesign(d, ctx({ cargo: cargo({ iron: 100 }) }));
    expect(r.errors).toEqual([]);
    expect(r.cost.craft).toEqual({ 'armor:1': 1 });
    expect(r.cost.cargoToStorage).toBe(100 - 15 - 70);
  });

  it('warns about blocked engine exhausts and laser outputs', () => {
    const grid = createGrid([['cockpit', 0, 0], ['engine', 1, 0, 0], ['miningLaser', 0, 1, 3], ['armor', 2, 0]]);
    const r = evaluateDesign(rawDesign(grid), ctx());
    expect(r.warnings).toContainEqual({ code: 'blockedExhaust', partId: 2 });
    expect(r.warnings).toContainEqual({ code: 'blockedLaser', partId: 3 });
  });

  it('warns about weak turning', () => {
    expect(WEAK_TURNING).toBe(0.5);
    const long: ['cockpit' | 'armor' | 'engine', number, number][] = [['cockpit', 0, 0], ['engine', -1, 0]];
    for (let x = 1; x <= 7; x++) long.push(['armor', x, 0]);
    for (let x = -7; x <= -2; x++) long.push(['armor', x, 0]);
    const r = evaluateDesign(rawDesign(createGrid(long)), ctx());
    const w = r.warnings.find((x) => x.code === 'weakTurning');
    expect(w).toBeDefined();
    expect(w && 'accel' in w && w.accel).toBeLessThan(0.5);
  });
});

describe('evaluateDesign – removing damaged parts (M12, M13)', () => {
  // T1 engine at 40% HP (10 / 25): repair 72 cr + 4 Fe, scrap 5 Fe + 3 Cu
  const hp = (): HpMap => new Map([[11, 10]]);
  const remove = () => draftWith([{ op: 'remove', id: 11 }], {}, hp());

  it('repairs the part when the station repairs and the player can pay', () => {
    const r = evaluateDesign(remove(), ctx({ storage: cargo({ iron: 4 }) }));
    expect(r.cost.repairCredits).toBe(72);
    expect(r.cost.toStorage).toEqual({ 'engine:1': 1 });
    expect(r.cost.scrapped).toEqual({});
    expect(codes(r.warnings)).not.toContain('damagedScrapped');
  });

  it('scraps the part into resources when the repair is unaffordable instead of blocking the removal', () => {
    const r = evaluateDesign(remove(), ctx({ credits: 0 }));
    expect(r.errors).toEqual([]);
    expect(r.cost.repairs).toEqual([]);
    expect(r.cost.credits).toBe(0);
    expect(r.cost.toStorage).toEqual({});
    expect(r.cost.scrapped).toEqual({ 'engine:1': 1 });
    expect(r.cost.scrap).toEqual({ iron: 5, copper: 3 });
    expect(r.warnings).toContainEqual({
      code: 'damagedScrapped', parts: { 'engine:1': 1 }, resources: { iron: 5, copper: 3 }, reason: 'unaffordable',
    });
    // missing repair material also leads to scrapping
    const noIron = evaluateDesign(remove(), ctx());
    expect(noIron.errors).toEqual([]);
    expect(noIron.cost.scrapped).toEqual({ 'engine:1': 1 });
  });

  it('scraps damaged parts at a shipyard without a repair service', () => {
    const r = evaluateDesign(remove(), ctx({ services: { crafting: true, partsMarket: true, repair: false }, storage: cargo({ iron: 4 }) }));
    expect(r.cost.repairs).toEqual([]);
    expect(r.cost.scrapped).toEqual({ 'engine:1': 1 });
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'damagedScrapped', reason: 'noRepairService' }));
  });

  it('a scrapped part does not cancel out a newly placed part of the same kind', () => {
    const d = draftWith([{ op: 'remove', id: 11 }, { op: 'place', key: 'engine:1', x: 2, y: 1, rot: 2 }], { 'engine:1': 1 }, hp());
    const r = evaluateDesign(d, ctx({ credits: 10, services: { crafting: true, partsMarket: true, repair: false } }));
    expect(r.errors).toEqual([]);
    expect(r.cost.fromStorage).toEqual({ 'engine:1': 1 });
    expect(r.cost.scrapped).toEqual({ 'engine:1': 1 });
  });
});

describe('evaluateDesign – energy balance (M14)', () => {
  it('warns when sustained cannon fire and shield recharge drain more than the ship generates', () => {
    // starter (+10, laser −6) + 2 cannons (−12/s) + shield (−5/s): combat −17 > mining −6
    const d = draftWith(
      [
        { op: 'place', key: 'cannon:1', x: 3, y: 0, rot: 0 },
        { op: 'place', key: 'cannon:1', x: 2, y: 2, rot: 0 },
        { op: 'place', key: 'shield:1', x: 1, y: 2, rot: 0 },
      ],
      { 'cannon:1': 2, 'shield:1': 1 },
    );
    const r = evaluateDesign(d, ctx());
    expect(r.warnings).toContainEqual({ code: 'energyDeficit', balance: -7, activity: 'combat' });
  });

  it('one cannon on the starter ship is within its power budget', () => {
    const d = draftWith([{ op: 'place', key: 'cannon:1', x: 3, y: 0, rot: 0 }], { 'cannon:1': 1 });
    expect(codes(evaluateDesign(d, ctx()).warnings)).not.toContain('energyDeficit');
  });
});

describe('evaluateDesign – Guild loan parts', () => {
  const lent = (): ShipGrid => {
    const g = createStarterShip();
    return { ...g, parts: g.parts.map((p) => (p.partId === 'miningLaser' ? { ...p, loan: true as const } : p)) };
  };

  it('a removed loan part goes back to the Guild: not to storage, never repaired or scrapped', () => {
    const r = evaluateDesign(draftWith([{ op: 'remove', id: 3 }], {}, new Map([[3, 4]]), lent()), ctx());
    expect(r.cost.returned).toEqual({ 'miningLaser:1': 1 });
    expect(r.cost.toStorage).toEqual({});
    expect(r.cost.repairs).toEqual([]);
    expect(r.cost.scrapped).toEqual({});
    expect(r.cost.credits).toBe(0);
    const noRepair = evaluateDesign(draftWith([{ op: 'remove', id: 3 }], {}, new Map([[3, 4]]), lent()), ctx({ services: { crafting: true, partsMarket: true, repair: false } }));
    expect(noRepair.cost.scrap).toEqual({});
  });

  it('a removed loan never cancels a new part of the same type – that part must be acquired', () => {
    const r = evaluateDesign(draftWith([{ op: 'remove', id: 3 }, { op: 'place', key: 'miningLaser:1', x: 2, y: 0, rot: 0 }], {}, new Map(), lent()), ctx());
    expect(r.cost.returned).toEqual({ 'miningLaser:1': 1 });
    expect({ ...r.cost.craft, ...r.cost.buy }).toEqual({ 'miningLaser:1': 1 });
  });

  it('warns which parts on the draft are lent by the Guild', () => {
    const r = evaluateDesign(draftWith([], {}, new Map(), lent()), ctx());
    expect(r.warnings).toContainEqual({ code: 'loanParts', partIds: [3], parts: { 'miningLaser:1': 1 } });
  });
});

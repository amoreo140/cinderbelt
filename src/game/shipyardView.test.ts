import { describe, expect, it } from 'vitest';
import { emptyCargo, type Cargo } from '../data/resources';
import { sk } from '../i18n/sk';
import { skParts } from '../i18n/skParts';
import { VARIANT_PART_KEYS } from '../data/parts';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import { computeProperties } from '../sim/ship/properties';
import { turnTime180 } from '../sim/ship/turnTime';
import { evaluateDesign, type ShipyardContext } from '../sim/shipyard/design';
import { applyStroke, createDraft, type ShipyardDraft } from '../sim/shipyard/draft';
import type { EditorOp } from '../sim/shipyard/editor';
import {
  buildCostBreakdown,
  buildPalette,
  buildShipyardView,
  buildStatsPanel,
  designMessages,
  formatResources,
  partName,
  partStatCompare,
  partStats,
  placementMessage,
  type PartStat,
} from './shipyardView';

function ctx(patch: Partial<ShipyardContext> = {}): ShipyardContext {
  return {
    ring: 1,
    services: { crafting: true, partsMarket: true },
    credits: 1240,
    storage: emptyCargo(),
    cargo: emptyCargo(),
    fuel: 0,
    // new game: part variants (M3.5b) are locked until a blueprint or the Archive unlocks them
    locked: new Set(VARIANT_PART_KEYS),
    ...patch,
  };
}
const cargo = (c: Partial<Cargo>): Cargo => ({ ...emptyCargo(), ...c });
/** Thousands are separated by a non-breaking space – in tests we compare it as a plain one. */
const plain = (s: string): string => s.replace(/ /g, ' ');

function draft(ops: EditorOp[] = [], inventory = { 'armor:1': 2 }): ShipyardDraft {
  const r = applyStroke(createDraft('home', createStarterShip(), new Map(), inventory), ops);
  expect(r.errors).toEqual([]);
  return r.draft;
}

describe('formatting helpers', () => {
  it('names parts with their tier', () => {
    expect(partName('cargo:1')).toBe('Nákladný priestor T1');
    expect(partName('engine:2')).toBe('Motor T2');
  });

  it('formats resource lists with symbols', () => {
    expect(formatResources({ iron: 25, copper: 15 })).toBe('25 Fe, 15 Cu');
    expect(formatResources({ titanium: 2.25, ice: 10 })).toBe('10 ľad, 2,3 Ti');
    expect(formatResources({})).toBe('');
  });

  it('translates placement errors', () => {
    expect(placementMessage('occupied')).toBe('Bunka je obsadená');
    expect(placementMessage('outOfBounds')).toBe('Mimo hangára');
  });
});

describe('buildPalette', () => {
  it('lists the 18 parts of the tier with hotkeys and icons', () => {
    const entries = buildPalette(draft(), ctx(), 1);
    expect(entries.map((e) => e.key)).toEqual([
      'cockpit:1', 'armor:1', 'engine:1', 'gyro:1', 'miningLaser:1', 'cargo:1', 'fuelTank:1', 'reactor:1', 'radar:1',
      'cannon:1', 'shield:1', 'heavyLaser:1', 'largeCargo:1', 'battery:1', 'tractorBeam:1',
      'largeReactor:1', 'repairModule:1', 'refinery:1',
    ]);
    expect(entries.map((e) => e.hotkey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(entries[15]!.icon).toBe('assets/icons/parts/largeReactor_t1.png');
    expect(entries[1]!.icon).toBe('assets/icons/parts/armor_t1.png');
    expect(entries[0]!.unique).toBe(true);
    expect(entries[1]!.unique).toBe(false);
  });

  it('counts pieces available in the draft: storage + removed − newly placed', () => {
    const d = draft([
      { op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 },
      { op: 'remove', id: 11 },
    ]);
    const byKey = new Map(buildPalette(d, ctx(), 1).map((e) => [e.key, e]));
    expect(byKey.get('armor:1')).toMatchObject({ available: 1, inStorage: 2, source: 'storage' });
    expect(byKey.get('engine:1')).toMatchObject({ available: 1, inStorage: 0, source: 'storage' });
  });

  it('tells how a missing part would be acquired', () => {
    const byKey = new Map(buildPalette(draft(), ctx({ storage: cargo({ iron: 30, copper: 10 }) }), 1).map((e) => [e.key, e]));
    const cargoPart = byKey.get('cargo:1')!;
    expect(cargoPart.source).toBe('craft');
    expect(cargoPart.tooltip).toBe('Vyrobiť: 30 Fe, 10 Cu, 900 kr');
    expect(cargoPart.craft).toEqual({ resources: { iron: 30, copper: 10 }, credits: 900 });
    expect(cargoPart.buyPrice).toBe(1605);
    const engine = byKey.get('engine:1')!;
    expect(engine.source).toBe('buy');
    expect(plain(engine.tooltip)).toBe('Kúpiť: 1 465 kr');
    const t2 = new Map(buildPalette(draft(), ctx(), 2).map((e) => [e.key, e]));
    expect(t2.get('engine:2')).toMatchObject({ source: 'unavailable', tooltip: 'Nedá sa získať na tejto stanici', buyPrice: null });
  });

  it('compares T1 and T2 stats in the tooltip data', () => {
    const engine = buildPalette(draft(), ctx(), 1)[2]!;
    expect(engine.compare).toContainEqual(expect.objectContaining({ id: 'thrust', label: 'Ťah', t1: 90, t2: 135 }));
    expect(engine.compare).toContainEqual(expect.objectContaining({ id: 'mass', label: 'Hmotnosť', t1: 1.5, t2: 1.2 }));
    expect(engine.compare).toContainEqual(expect.objectContaining({ id: 'hp', label: 'HP', t1: 25, t2: 44 }));
  });
});

/** Stats without the glossary text (checked separately). */
const noTip = ({ tip: _tip, ...rest }: PartStat) => rest;

describe('partStats', () => {
  it('every stat label carries its plain-language explanation', () => {
    for (const s of [...partStats('cannon:1'), ...partStats('gyro:2'), ...partStats('tractorBeam:1')]) expect(s.tip, s.id).toBeTruthy();
    expect(partStats('gyro:2').find((s) => s.id === 'torque')!.tip).toBe('Sila, ktorou gyroskopy otáčajú loď. Ťažká a rozľahlá loď ho potrebuje viac.');
  });
  it('lists the function of a part', () => {
    expect(partStats('cargo:1').map(noTip)).toEqual([
      { id: 'mass', label: 'Hmotnosť', value: 1.5 },
      { id: 'hp', label: 'HP', value: 30 },
      { id: 'cargo', label: 'Náklad', value: 60 },
    ]);
    expect(partStats('miningLaser:2').map((s) => s.id)).toEqual([
      'mass', 'hp', 'miningRate', 'miningRange', 'miningEnergy',
    ]);
  });

  it('lists weapon and shield stats (compared T1 → T2 in the palette)', () => {
    expect(partStats('cannon:1').slice(2).map(noTip)).toEqual([
      { id: 'damage', label: 'Poškodenie', value: 6 },
      { id: 'fireRate', label: 'Kadencia', value: 3 },
      { id: 'weaponRange', label: 'Dostrel', value: 85 },
      { id: 'shotEnergy', label: 'Energia na výstrel', value: 2 },
      { id: 'arc', label: 'Palebný výsek', value: 120 },
    ]);
    expect(partStats('shield:2').slice(2).map((s) => [s.id, s.value])).toEqual([
      ['shieldCapacity', 90],
      ['shieldRegen', 15],
      ['shieldDelay', 2.5],
    ]);
    expect(partStatCompare('cannon').find((s) => s.id === 'damage')).toMatchObject({ t1: 6, t2: 9 });
  });

  it('the ship stats show the effective cannon arcs (a neighbour in front trims them)', () => {
    const open = createGrid([['cockpit', 0, 0], ['cannon', 1, 0]]);
    const walled = createGrid([['cockpit', 0, 0], ['cannon', 1, 0], ['armor', 1, 1], ['armor', 2, 1]]);
    const rows = buildStatsPanel(walled, open);
    const arc = rows.find((r) => r.id === 'cannonArc')!;
    expect(buildStatsPanel(open, open).find((r) => r.id === 'cannonArc')!.value).toBe(120);
    expect(arc.value).toBeLessThan(120);
    expect(arc.trend).toBe('worse');
  });

  it('lists the tractor beam reach, how many parts it tows and its energy (M3.6)', () => {
    expect(partStats('tractorBeam:1').slice(2).map(noTip)).toEqual([
      { id: 'tractorRange', label: 'Dosah lúča', value: 25 },
      { id: 'tractorParts', label: 'Utiahne dielov', value: 4 },
      { id: 'tractorEnergy', label: 'Spotreba lúča', value: 4 },
    ]);
  });
});

describe('buildStatsPanel', () => {
  it('shows values and deltas against the original ship', () => {
    const base = createStarterShip();
    const d = draft([{ op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 }]);
    const rows = new Map(buildStatsPanel(d.grid, base).map((r) => [r.id, r]));
    expect(rows.get('mass')).toMatchObject({ value: 26.5, delta: 1.5, trend: 'worse', group: 'general' });
    expect(rows.get('parts')).toMatchObject({ value: 15, delta: 1, trend: 'same' });
    expect(rows.get('cargo')).toMatchObject({ value: 190, delta: 60, trend: 'better', group: 'capacity' });
    const fwd = rows.get('thrustForward')!;
    expect(fwd.value).toBe(180);
    expect(fwd.delta).toBe(0);
    expect(fwd.secondary!.value).toBeCloseTo(180 / 26.5);
    expect(fwd.secondary!.delta).toBeLessThan(0);
    expect(fwd.trend).toBe('worse');
    expect(rows.get('energyBalance')).toMatchObject({ value: 4, alert: false });
    expect(rows.get('hp')).toMatchObject({ value: 420, delta: 30 });
    expect(rows.get('turning')!.secondary!.value).toBeGreaterThan(0);
  });

  it('flags an energy deficit and survives an empty design', () => {
    const grid = createGrid([['cockpit', 0, 0], ['miningLaser', 1, 0]]);
    const rows = new Map(buildStatsPanel(grid, createStarterShip()).map((r) => [r.id, r]));
    expect(rows.get('energyBalance')).toMatchObject({ value: -4, alert: true });
    const empty = buildStatsPanel({ parts: [], nextId: 1 }, createStarterShip());
    expect(empty.find((r) => r.id === 'mass')).toMatchObject({ value: 0, delta: -25 });
  });
});

describe('buildStatsPanel – turn 180°', () => {
  const turn = (grid: Parameters<typeof buildStatsPanel>[0], base = createStarterShip()) =>
    buildStatsPanel(grid, base).find((r) => r.id === 'turn180')!;

  it('shows the turn time in seconds with its label, tip and group', () => {
    const base = createStarterShip();
    const props = computeProperties(base);
    const row = turn(base, base);
    expect(row).toMatchObject({ label: 'Otočenie 180°', group: 'thrust', delta: 0, trend: 'same', tip: skParts.glossary.turn180 });
    expect(row.value).toBeCloseTo(turnTime180(props.torque, props.inertia)!, 9);
    expect(row.none).toBeFalsy();
  });

  it('is better (lower) with a gyroscope and worse with heavy parts far out', () => {
    const gyro = turn(draft([{ op: 'place', key: 'gyro:1', x: -1, y: 2, rot: 0 }]).grid);
    expect(gyro.delta).toBeLessThan(0);
    expect(gyro.trend).toBe('better');
    const heavy = turn(draft([{ op: 'place', key: 'armor:1', x: 0, y: 3, rot: 0 }]).grid);
    expect(heavy.delta).toBeGreaterThan(0);
    expect(heavy.trend).toBe('worse');
  });

  it('says "cannot turn" without torque and counts losing it as worse', () => {
    const row = turn({ parts: [], nextId: 1 });
    expect(row).toMatchObject({ none: true, value: 0, delta: 0, trend: 'worse' });
    const back = buildStatsPanel(createStarterShip(), { parts: [], nextId: 1 }).find((r) => r.id === 'turn180')!;
    expect(back).toMatchObject({ trend: 'better', delta: 0 });
    expect(back.none).toBeFalsy();
  });
});

describe('designMessages', () => {
  it('turns errors and warnings into texts with highlighted parts', () => {
    const d = draft([{ op: 'remove', id: 2 }, { op: 'remove', id: 1 }]);
    const report = evaluateDesign(d, ctx());
    const msgs = designMessages(report);
    expect(msgs[0]).toEqual({
      severity: 'error', code: 'noCockpit', i18nKey: 'shipyard.errors.noCockpit', text: 'Loď nemá kokpit.', partIds: [],
    });
    // errors first, then warnings
    const severities = msgs.map((m) => m.severity);
    expect(severities).toEqual([...severities].sort());
  });

  it('formats amounts in the messages', () => {
    const d = draft([{ op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 }]);
    const unaffordable = designMessages(evaluateDesign(d, ctx()));
    expect(unaffordable.map((m) => plain(m.text))).toContain('Nedostatok kreditov: treba 1 615 kr, máš 1 240 kr.');
    const disconnected = designMessages(
      evaluateDesign(draft([{ op: 'remove', id: 5 }]), ctx()),
    ).find((m) => m.code === 'disconnected')!;
    expect(disconnected.text).toBe('1 diel nie je spojený s kokpitom (označený červeno).');
    expect(disconnected.partIds).toEqual([14]);
    const blocked = designMessages(evaluateDesign(draft([{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]), ctx()));
    expect(blocked).toContainEqual({
      severity: 'warning',
      code: 'blockedLaser',
      i18nKey: 'shipyard.warnings.blockedLaser',
      text: 'Laser #3 mieri priamo do dielu (len vzhľad).',
      partIds: [3],
    });
    // a covered nozzle is a real penalty since M3 (design 3.4.2): half thrust, the part burns
    const covered = designMessages(evaluateDesign(draft([{ op: 'place', key: 'armor:1', x: -2, y: 1, rot: 0 }]), ctx()));
    expect(covered).toContainEqual({
      severity: 'warning',
      code: 'blockedExhaust',
      i18nKey: 'shipyard.warnings.blockedExhaust',
      text: 'Tryska motora #9 je zakrytá dielom – motor dá len polovičný ťah a kým ťahá, diel pred tryskou horí (2 HP/s).',
      partIds: [9],
    });
    const missing = designMessages(evaluateDesign(draft([{ op: 'place', key: 'engine:2', x: -2, y: 0, rot: 0 }]), ctx()));
    expect(missing.map((m) => m.text)).toContain('1× Motor T2 sa na tejto stanici nedá vyrobiť ani kúpiť.');
  });
});

describe('hull budget (spec 3.4.1)', () => {
  it('heads the properties panel with "HULL 14 / 28 pts · cockpit T1"', () => {
    const v = buildShipyardView(draft(), ctx(), 1);
    expect(v.hull).toEqual({ label: 'Trup', points: '14 / 28 b', cockpit: 'kokpit T1', used: 14, budget: 28, over: false });
    expect(`${v.hull.label.toUpperCase()} ${v.hull.points} · ${v.hull.cockpit}`).toBe('TRUP 14 / 28 b · kokpit T1');
  });

  it('turns an over-budget design into the hullBudget error text', () => {
    const ops: EditorOp[] = [];
    for (let i = 0; i < 15; i++) ops.push({ op: 'place', key: 'armor:1', x: [0, 1, -1, 2][i % 4]!, y: 3 + Math.floor(i / 4), rot: 0 });
    const v = buildShipyardView(draft(ops, { 'armor:1': 20 }), ctx({ credits: 5000 }), 1);
    expect(v.hull).toMatchObject({ points: '29 / 28 b', over: true });
    expect(v.messages[0]).toMatchObject({ severity: 'error', code: 'hullBudget', text: 'Kokpit T1 unesie 28 b trupu (máš 29 b).' });
    expect(v.canCommit).toBe(false);
  });

  it('shows the used points without a cockpit', () => {
    const v = buildShipyardView(draft([{ op: 'remove', id: 1 }]), ctx(), 1);
    expect(v.hull).toMatchObject({ points: '13 b', cockpit: 'bez kokpitu', budget: null, over: false });
  });
});

describe('buildCostBreakdown', () => {
  it('lists every line of the change cost', () => {
    const d = draft([
      { op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0 },
      { op: 'place', key: 'cargo:1', x: -1, y: 2, rot: 0 },
      { op: 'remove', id: 13 },
    ]);
    const c = ctx({ credits: 2000, storage: cargo({ iron: 30, copper: 10 }) });
    const b = buildCostBreakdown(evaluateDesign(d, c).cost, c);
    const lines = new Map(b.lines.map((l) => [l.id, l]));
    expect(lines.get('fromStorage')).toMatchObject({ label: sk.shipyard.cost.fromStorage, text: '1× Pancier T1', credits: 0 });
    expect(lines.get('craft')).toMatchObject({ text: '1× Nákladný priestor T1', credits: 900, resources: { iron: 30, copper: 10 } });
    expect(lines.get('buy')).toMatchObject({ text: '–', credits: 0 });
    expect(lines.get('install')).toMatchObject({ text: '2 × 10 kr = 20 kr', credits: 20 });
    expect(lines.get('toStorage')).toMatchObject({ text: '1× Motor T1' });
    expect(lines.get('repairs')).toMatchObject({ text: '–', credits: 0 });
    expect(b.total).toBe(920);
    expect(b.totalText).toBe('920 kr + 30 Fe, 10 Cu');
    expect(b.affordable).toBe(true);
    expect(b.remaining).toBe(1080);
  });
});

describe('buildShipyardView', () => {
  it('bundles everything the editor screen needs', () => {
    const d = draft([{ op: 'place', key: 'armor:1', x: 1, y: 2, rot: 0 }]);
    const v = buildShipyardView(d, ctx(), 1);
    expect(v.canCommit).toBe(true);
    expect(v.dirty).toBe(true);
    expect(v.canUndo).toBe(true);
    expect(v.canRedo).toBe(false);
    expect(v.palette).toHaveLength(18);
    expect(v.cost.total).toBe(10);
    expect(v.messages).toEqual([]);
    expect(v.disconnected).toEqual([]);
    expect(v.commit).toEqual({
      type: 'shipyardCommit',
      baseHash: expect.any(String),
      ops: [{ op: 'place', key: 'armor:1', x: 1, y: 2, rot: 0 }],
      acquire: {},
    });
  });
});

describe('palette with variants (M3.5b)', () => {
  it('lists an unlocked variant after the base parts and keeps locked base parts unavailable', () => {
    const locked = new Set([...VARIANT_PART_KEYS.filter((k) => k !== 'engine:1:eco'), 'heavyLaser:1' as const]);
    const d = draft();
    const palette = buildPalette(d, ctx({ locked, lockReasons: new Map([['heavyLaser:1', 'Archív: Ťažký laser 2×1']]) }), 1);
    const eco = palette.find((e) => e.key === 'engine:1:eco')!;
    expect(eco.variant).toBe('eco');
    expect(eco.name).toBe(`${sk.parts.engine} – úsporný`);
    expect(palette.indexOf(eco)).toBe(18);
    const heavy = palette.find((e) => e.key === 'heavyLaser:1')!;
    expect(heavy.source).toBe('unavailable');
    expect(heavy.tooltip).toBe('Archív: Ťažký laser 2×1');
  });
});

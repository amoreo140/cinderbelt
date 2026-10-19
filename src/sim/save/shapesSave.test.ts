// Save V18 (SL2 E2 "Shaped Parts"): shaped armour in grids and templates – the 17 → 18 migration (the
// number only), the round trip of every saved grid (player, blueprint, respawn, stored ships, wrecks)
// and of templates, the AF2 code of a saved template, and the validation of shapes.
import { describe, expect, it } from 'vitest';
import { createWreck, emptyLoot } from '../combat/wrecks';
import { richSim } from '../fleet/testing';
import { fnv1aHex } from '../math/fnv1a';
import { createGrid } from '../ship/grid';
import { maxHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import { createStarterShip } from '../ship/presets';
import { halapartnaE2, mulaE2 } from '../ship/specShips.testing';
import type { ShipGrid } from '../ship/types';
import { act, resultOf } from '../station/testHarness';
import { decodeTemplate, encodeTemplate, TEMPLATE_CODE_PREFIX_V2 } from '../templates/codec';
import { gridTemplateParts } from '../templates/normalize';
import { klinE2 } from '../templates/testShips';
import type { Simulation } from '../Simulation';
import { HOME_STATION_ID } from '../world/stations';
import { gridFromSave, gridToSave } from './gridSave';
import { loadSave } from './load';
import { v17ToV18 } from './migrations';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV17, downgradeToV18, testContext } from './testing';
import type { SaveEnvelope, SaveGame } from './types';

const ctx = testContext();

function envelopeOf(data: { version: number }): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: data.version, checksum: fnv1aHex(text), data: text };
}

const shapedCount = (g: { parts: readonly { shape?: unknown }[] }): number => g.parts.filter((p) => p.shape !== undefined).length;

/**
 * A docked game full of shapes: the active ship Mule (T2, wedges and wings) with a damaged wedge, the
 * blueprint and respawn grid Halberd (nose 2×1, wedges, wings), Wedge stored in the hangar, a player
 * wreck of shaped plates and a shaped template.
 */
function shapedGame(): Simulation {
  const sim = richSim(200_000);
  const s = sim.state;
  s.discovery.archive.add('templates');
  const mule = mulaE2();
  s.player.grid = mule;
  s.player.blueprint = mule;
  s.player.props = computeProperties(mule);
  // docked: battery and shield full, as a docked ship always is after a load
  s.player.energy = s.player.props.batteryCapacity;
  s.player.shield = s.player.props.shield.capacity;
  const wedge = mule.parts.find((p) => p.shape === 'wedge')!;
  s.player.hp.clear();
  s.player.hp.set(wedge.id, maxHp(wedge) / 2);
  s.respawn.grid = halapartnaE2();
  s.fleet.slots.set(HOME_STATION_ID, 1);
  s.fleet.stored.push({
    record: { id: s.fleet.nextShipId++, name: null, nameIdx: 3, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 } },
    stationId: HOME_STATION_ID,
    grid: klinE2(),
    blueprint: klinE2(),
    hp: new Map(),
    fuel: 0,
    cargo: { iron: 0, copper: 0, ice: 0, titanium: 0 },
  });
  const p = s.player;
  const plates = mule.parts.filter((x) => x.shape === 'wingL' || x.shape === 'wingR');
  s.combat.wrecks.push(createWreck(s.combat.nextId++, plates, { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default'));
  expect(resultOf(act(sim, { type: 'templateSave', name: 'Halapartňa', parts: gridTemplateParts(halapartnaE2()) }))).toMatchObject({ ok: true });
  return sim;
}

function load(save: unknown) {
  const result = loadSave(envelopeOf(save as { version: number }));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  return result;
}

describe('save V18 – migration 17 → 18', () => {
  it('changes the version number and nothing else', () => {
    const save = toSave(richSim(), ctx);
    const old = downgradeToV17(save);
    expect(old.version).toBe(17);
    expect(v17ToV18(old)).toEqual(downgradeToV18(save));
  });

  it('a V17 save loads as the same game', () => {
    const sim = richSim();
    const save = toSave(sim, ctx);
    const result = load(downgradeToV17(save));
    expect(result.fromVersion).toBe(17);
    expect(result.warnings).toEqual([]);
    expect(result.save).toEqual(save);
  });

  it('rejects a V17 save that is not an object', () => {
    expect(() => v17ToV18(null)).toThrow();
  });
});

describe('save V18 – shaped grids and templates round trip', () => {
  it('only shaped parts carry a shape in the save; an unshaped grid saves as before', () => {
    const starter = gridToSave(createStarterShip());
    expect(starter.parts.every((p) => !('shape' in p))).toBe(true);
    const mule = gridToSave(mulaE2());
    expect(shapedCount(mule)).toBe(mulaE2().parts.filter((p) => p.shape).length);
    expect(gridFromSave(mule)).toEqual(mulaE2());
  });

  it('player grid, blueprint, respawn grid, stored ships, wrecks and templates keep their shapes', () => {
    const sim = shapedGame();
    const save = toSave(sim, ctx);
    expect(save.version).toBe(20);
    expect(shapedCount(save.player.grid)).toBeGreaterThan(0);
    expect(shapedCount(save.player.blueprint)).toBeGreaterThan(0);
    expect(shapedCount(save.respawn.grid)).toBeGreaterThan(0);
    expect(shapedCount(save.fleet.stored[0]!.grid)).toBeGreaterThan(0);
    expect(shapedCount(save.fleet.stored[0]!.blueprint)).toBeGreaterThan(0);
    expect(shapedCount(save.combat.wrecks[0]!.grid)).toBe(2);
    expect(save.templates[0]!.parts.some((p) => p.length === 5)).toBe(true);

    const result = load(JSON.parse(JSON.stringify(save)));
    expect(result.warnings).toEqual([]);
    const loaded = restoreSimulation(result.save);
    const s = sim.state;
    const l = loaded.state;
    expect(l.player.grid).toEqual(s.player.grid);
    expect(l.player.blueprint).toEqual(s.player.blueprint);
    expect(l.respawn.grid).toEqual(s.respawn.grid);
    expect(l.fleet.stored[0]!.grid).toEqual(s.fleet.stored[0]!.grid);
    expect(l.fleet.stored[0]!.blueprint).toEqual(s.fleet.stored[0]!.blueprint);
    expect(l.combat.wrecks[0]!.grid).toEqual(s.combat.wrecks[0]!.grid);
    expect(l.templates).toEqual(s.templates);
    // the damaged wedge keeps its HP (within its shaped maximum) and the ship its shaped properties
    expect([...l.player.hp]).toEqual([...s.player.hp]);
    expect(l.player.props.mass).toBeCloseTo(s.player.props.mass, 9);
    expect(toSave(loaded, ctx)).toEqual(save);
  });

  it('a template with a shape → save → load → the same CB2 code', () => {
    const sim = shapedGame();
    const code = encodeTemplate(sim.state.templates[0]!);
    expect(code.startsWith(TEMPLATE_CODE_PREFIX_V2)).toBe(true);
    const loaded = restoreSimulation(load(toSave(sim, ctx)).save);
    expect(encodeTemplate(loaded.state.templates[0]!)).toBe(code);
    expect(decodeTemplate(code)).toEqual({ ok: true, template: loaded.state.templates[0] });
  });

  it('a template without shapes stays a 4-tuple template with the same CB2 code', () => {
    const sim = richSim();
    sim.state.discovery.archive.add('templates');
    expect(resultOf(act(sim, { type: 'templateSave', name: 'Baník', parts: gridTemplateParts(createStarterShip()) }))).toMatchObject({ ok: true });
    const code = encodeTemplate(sim.state.templates[0]!);
    expect(code.startsWith(TEMPLATE_CODE_PREFIX_V2)).toBe(true);
    const save = toSave(sim, ctx);
    expect(save.templates[0]!.parts.every((p) => p.length === 4)).toBe(true);
    expect(encodeTemplate(restoreSimulation(load(save).save).state.templates[0]!)).toBe(code);
  });
});

describe('save V18 – validation of shapes', () => {
  const base = (): SaveGame => toSave(shapedGame(), ctx);

  it('rejects an unknown shape', () => {
    const save = base();
    (save.player.grid.parts.find((p) => p.shape === 'wedge') as { shape?: string }).shape = 'blob';
    const result = loadSave(envelopeOf(save));
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    if (!result.ok) expect(result.details.join(';')).toMatch(/player\.grid\.parts\[\d+\]\.shape/);
  });

  it('rejects a shape on an engine', () => {
    const save = base();
    (save.player.grid.parts.find((p) => p.partId === 'engine') as { shape?: string }).shape = 'wedge';
    const result = loadSave(envelopeOf(save));
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    if (!result.ok) expect(result.details.join(';')).toMatch(/shape not allowed/);
  });

  it('rejects a shape in a wreck or a stored ship the same way', () => {
    const wreck = base();
    (wreck.combat.wrecks[0]!.grid.parts[0] as { shape?: string }).shape = 'blob';
    expect(loadSave(envelopeOf(wreck))).toMatchObject({ ok: false, error: 'invalid' });
    const stored = base();
    (stored.fleet.stored[0]!.grid.parts.find((p) => p.partId === 'cockpit') as { shape?: string }).shape = 'nose';
    expect(loadSave(envelopeOf(stored))).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('an overlapping wing makes the ship invalid: the active ship is replaced, a stored ship dropped, a wreck rejected', () => {
    // a wing L laid on a plate whose second cell is taken (a 2×1 footprint over the neighbour)
    const overlap = (g: SaveGame['player']['grid']) => {
      const cells = new Set(g.parts.map((p) => `${p.x},${p.y}`));
      const plate = g.parts.find((p) => p.partId === 'armor' && p.shape === undefined && p.rot === 0 && cells.has(`${p.x + 1},${p.y}`));
      if (!plate) throw new Error('no plate with a right neighbour');
      plate.shape = 'wingL';
    };
    const active = base();
    active.respawn.grid = gridToSave(createStarterShip());
    active.player = { ...active.player, grid: gridToSave(klinE2()), blueprint: gridToSave(klinE2()), hp: [], cooldowns: [], heat: [], energy: 0, shield: 0 };
    expect(load(active).warnings).toEqual([]);
    overlap(active.player.grid);
    const replaced = load(active);
    expect(replaced.warnings.map((w) => w.code)).toContain('shipReplaced');

    const stored = base();
    overlap(stored.fleet.stored[0]!.grid);
    const dropped = load(stored);
    expect(dropped.warnings.map((w) => w.code)).toContain('storedShipDropped');
    expect(dropped.save.fleet.stored).toEqual([]);

    const wreck = base();
    wreck.combat.wrecks[0]!.grid = gridToSave(halapartnaE2());
    overlap(wreck.combat.wrecks[0]!.grid);
    expect(loadSave(envelopeOf(wreck))).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('drops a 6-tuple template and a template with a shape on a cannon (capacityClamped)', () => {
    for (const bad of ['sixTuple', 'cannon'] as const) {
      const save = base();
      const parts = save.templates[0]!.parts as unknown[][];
      if (bad === 'sixTuple') parts[parts.findIndex((p) => p.length === 5)]!.push('extra');
      else parts[parts.findIndex((p) => String(p[0]).startsWith('cannon'))]!.push('wedge');
      const result = load(save);
      expect(result.save.templates).toEqual([]);
      expect(result.warnings).toContainEqual({ code: 'capacityClamped', paths: ['templates[0]'] });
    }
  });

  it('clamps a shaped part HP to its shaped maximum', () => {
    const save = base();
    const [id] = save.player.hp[0]!;
    const wedge = save.player.grid.parts.find((p) => p.id === id)!;
    expect(wedge.shape).toBe('wedge');
    save.player.hp[0] = [id, 1000];
    const result = load(save);
    expect(result.save.player.hp).toEqual([[id, maxHp(gridFromSave(save.player.grid).parts.find((p) => p.id === id)!)]]);
    expect(result.warnings).toContainEqual({ code: 'capacityClamped', paths: ['player.hp[0]'] });
  });

  it('the hull budget counts shaped parts by their points (no overBudgetLegacy for a ship within ½-point budgets)', () => {
    const grid: ShipGrid = createGrid([
      ['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0, 0, 1, 'nose'], ['armor', 0, 1, 0, 1, 'wedge'], ['armor', 0, -1, 3, 1, 'wedge'],
    ]);
    const sim = richSim();
    sim.state.player.grid = grid;
    sim.state.player.blueprint = grid;
    const result = load(toSave(sim, ctx));
    expect(result.warnings.map((w) => w.code)).not.toContain('overBudgetLegacy');
    expect(result.save.player.grid.parts.filter((p) => p.shape)).toHaveLength(3);
  });
});

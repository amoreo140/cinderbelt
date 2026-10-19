import { describe, expect, it } from 'vitest';
import { dockedSim } from '../station/testHarness';
import { fnv1aHex } from '../math/fnv1a';
import { loadSave } from './load';
import { LATEST_SAVE_VERSION, MIGRATIONS, migrate, type MigrationTable } from './migrations';
import { IDLE_COMMAND } from '../commands';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV1, downgradeToV2, downgradeToV3, downgradeToV4, downgradeToV5, downgradeToV6, downgradeToV7, downgradeToV8, downgradeToV9, downgradeToV11, downgradeToV12, downgradeToV13, legacyWorldSave, testContext } from './testing';
import { STARTING_HOME_PARTS } from '../../data/economy';
import { partKey } from '../../data/parts';
import { stepIndex, TRAINING_STEPS } from '../../data/training';
import { createGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import type { ShipGrid } from '../ship/types';
import { trainingSim } from '../training/testing';
import { beginTraining, legacyTraining, remainingRewardParts } from '../training/training';
import { createEnemy } from '../combat/enemies';
import { Simulation } from '../Simulation';
import { stationById } from '../world/stations';
import { asLoan } from '../ship/loan';
import { createStarterShip } from '../ship/presets';
import { legacyDiscovery } from './discovery';
import { legacyFleet } from './fleet';
import { partUnlocked } from '../discovery/archive';
import { legacyCareer } from './career';
import { legacyPirates } from './pirates';
import type { SaveEnvelope } from './types';

/** The legacy career of a V3 save after all migrations (the First Day replaced by the done training, V10). */
function currentLegacyCareer() {
  const { firstDay: _f, ...career } = legacyCareer();
  return { ...career, training: legacyTraining() };
}

/** A current save as it comes out of the 9 → 10 migration (a game in progress: the training done). */
function withLegacyTraining<T extends { career: object }>(save: T): T {
  return { ...save, career: { ...save.career, training: legacyTraining() } };
}

/**
 * A fictional version 0 (only to test the framework): no statistics, no `fallenFromHardcore`,
 * credits as `money` and the ship as `ship`.
 */
function fakeV0(): Record<string, unknown> {
  const v1 = downgradeToV1(toSave(dockedSim(), testContext())) as unknown as Record<string, unknown>;
  const { stats: _stats, credits, player, settings, ...rest } = v1 as Record<string, unknown> & { settings: Record<string, unknown> };
  const { fallenFromHardcore: _f, ...oldSettings } = settings;
  return { ...rest, version: 0, money: credits, ship: player, settings: oldSettings };
}

const v0ToV1 = (data: unknown): unknown => {
  const { money, ship, settings, ...rest } = data as Record<string, unknown> & { settings: Record<string, unknown> };
  return {
    ...rest,
    version: 1,
    credits: money,
    player: ship,
    settings: { ...settings, fallenFromHardcore: false },
    stats: { mined: { iron: 0, copper: 0, ice: 0, titanium: 0 }, creditsEarned: 0, partsCrafted: 0, distanceFlown: 0, deaths: 0 },
  };
};

const FAKE: MigrationTable = { ...MIGRATIONS, 0: v0ToV1 };

function envelopeOf(data: { version: number }): SaveEnvelope {
  const text = JSON.stringify(data);
  return { format: 'cinderbelt-save', version: data.version, checksum: fnv1aHex(text), data: text };
}

describe('migrate', () => {
  it('has the real 1 → 2 (M3a combat), 2 → 3 (M2d veins), 3 → 4 (M3.5a career), 4 → 5 (M3.5b discoveries), 5 → 6 (M3.6 salvage), 6 → 7 (M3.8 blueprint), 7 → 8 (Guild loans), 8 → 9 (pirate fuel and gunnery), 9 → 10 (M3.7 Guild Training), 10 → 11 (paid tolls), 11 → 12 (Mining 2.0), 12 → 13 (the training hull with a reverse engine), 13 → 14 (world generation), 14 → 15 (sector charts), 15 → 16 (M4a fleet), 16 → 17 (M4b world sites and events director), 17 → 18 (SL2 E2 shaped armour), 18 → 19 (M4c home and workshop) and 19 → 20 (M4d Guild, convoys and map notes) migrations', () => {
    expect(LATEST_SAVE_VERSION).toBe(20);
    expect(Object.keys(MIGRATIONS)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
  });

  it('returns the latest version unchanged', () => {
    const data = { version: 20, a: 1 };
    expect(migrate(data, 20)).toEqual({ ok: true, data });
  });

  it('chains migrations step by step', () => {
    const table: MigrationTable = {
      0: (d) => ({ ...(d as object), version: 1, one: true }),
      1: (d) => ({ ...(d as object), version: 2, two: true }),
    };
    expect(migrate({ version: 0 }, 0, table, 2)).toEqual({ ok: true, data: { version: 2, one: true, two: true } });
  });

  it('rejects a version newer than the game', () => {
    expect(migrate({ version: 3 }, 3, {}, 2)).toMatchObject({ ok: false, error: 'tooNew' });
  });

  it('fails when a migration step is missing', () => {
    expect(migrate({ version: 0 }, 0, {}, 1)).toMatchObject({ ok: false, error: 'migration' });
  });

  it('fails when a migration throws or forgets to bump the version', () => {
    expect(migrate({ version: 0 }, 0, { 0: () => { throw new Error('boom'); } }, 1)).toMatchObject({ ok: false, error: 'migration' });
    expect(migrate({ version: 0 }, 0, { 0: (d) => d }, 1)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('loadSave with the fake V0 → V1 migration', () => {
  it('migrates and validates an old save', () => {
    const result = loadSave(envelopeOf(fakeV0() as { version: number }), { migrations: FAKE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(0);
    const expected = { ...legacyWorldSave(toSave(dockedSim(), testContext())), career: currentLegacyCareer(), discovery: legacyDiscovery() };
    expect(result.save).toEqual(expected);
  });

  it('reports a broken migration as a migration error with the version', () => {
    const broken: MigrationTable = { 0: () => { throw new Error('boom'); } };
    const result = loadSave(envelopeOf(fakeV0() as { version: number }), { migrations: broken });
    expect(result).toMatchObject({ ok: false, error: 'migration', version: 0 });
  });

  it('reports invalid data produced by a migration', () => {
    const sloppy: MigrationTable = { ...MIGRATIONS, 0: (d) => ({ ...(d as object), version: 1, stats: {}, player: (d as { ship: unknown }).ship }) };
    const result = loadSave(envelopeOf(fakeV0() as { version: number }), { migrations: sloppy });
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('leaves current saves untouched', () => {
    const save = toSave(dockedSim(), testContext());
    const result = loadSave(toEnvelope(save), { migrations: FAKE });
    expect(result).toMatchObject({ ok: true, fromVersion: 20 });
  });
});

describe('migration 1 → 2 (M3a combat)', () => {
  it('loads a version 1 save as the same game without combat state', () => {
    const sim = dockedSim();
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'undock', reqId: 1 }] });
    for (let i = 0; i < 20; i++) sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0.2 } });
    sim.state.player.cargo.iron = 12;
    sim.state.stats.deaths = 3;
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV1(current);
    expect(old.version).toBe(1);
    expect('combat' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 1 });
    // the only ship of an old game gets the whole game's stats as its log (15 → 16)
    const legacy = legacyFleet(current.seed, current.stats);
    // … in its factory paint (18 → 19)
    const fleet = { ...legacy, active: { ...legacy.active, paint: 'factory' as const }, stored: [] };
    if (result.ok) expect(result.save).toEqual({ ...current, career: currentLegacyCareer(), discovery: legacyDiscovery(), pirates: { ...legacyPirates(), paid: [] }, fleet });
  });

  it('rejects data that is not a version 1 save', () => {
    expect(migrate({ version: 1 }, 1)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 2 → 3 (M2d veins and hull budget)', () => {
  it('loads a version 2 save as the same game with untouched veins, no cracked ice and cold lasers', () => {
    const sim = dockedSim();
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'undock', reqId: 1 }] });
    for (let i = 0; i < 20; i++) sim.step({ ...IDLE_COMMAND, flight: { forward: 1, strafe: 0, turn: 0.2 } });
    sim.state.player.cargo.iron = 7;
    const current = legacyWorldSave(toSave(sim, testContext()));
    expect(current.player.heat).toEqual([]);
    expect(current.world.veins).toEqual([]);
    expect(current.world.cracked).toEqual([]);
    const old = downgradeToV2(current);
    expect(old.version).toBe(2);
    expect('heat' in old.player).toBe(false);
    expect('veins' in old.world).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 2 });
    if (result.ok) expect(result.save).toEqual({ ...current, career: currentLegacyCareer(), discovery: legacyDiscovery(), pirates: { ...legacyPirates(), paid: [] } });
  });

  it('keeps an over-budget ship from an old save (it flies on) and warns about it', () => {
    const save = downgradeToV2(toSave(dockedSim(), testContext()));
    const grid = save.player.grid;
    // 15 extra armour plates in the column x = −2 (touching the reactor and engines): 29 pts > 28 pts of a T1 cockpit
    for (let i = 0; i < 15; i++) grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -2, y: -7 + i, rot: 0 });
    const result = loadSave(toEnvelope(save));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.player.grid.parts).toHaveLength(14 + 15);
    expect(result.warnings).toContainEqual({ code: 'overBudgetLegacy', used: 29, budget: 28 });
  });

  it('rejects data that is not a version 2 save', () => {
    expect(migrate({ version: 2 }, 2)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 3 → 4 (M3.5a career)', () => {
  it('loads a version 3 save without contracts or reputation and with the first day skipped', () => {
    const sim = dockedSim();
    sim.state.credits = 777;
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV3(current);
    expect(old.version).toBe(3);
    expect('career' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 3 });
    if (!result.ok) return;
    expect(result.save).toEqual({ ...current, career: currentLegacyCareer(), discovery: legacyDiscovery(), pirates: { ...legacyPirates(), paid: [] } });
    expect(result.save.career.contracts).toEqual([]);
    expect(result.save.career.rep.guild).toEqual({ points: 0, level: 0, assignments: {} });
    expect(result.save.career.training.status).toBe('done');
  });

  it('rejects data that is not a version 3 save', () => {
    expect(migrate({ version: 3 }, 3)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 4 → 5 (M3.5b discoveries)', () => {
  it('loads a version 4 save without Data or discoveries, keeping the M2d parts unlocked', () => {
    const sim = dockedSim();
    sim.state.credits = 555;
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV4(current);
    expect(old.version).toBe(4);
    expect('discovery' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 4 });
    if (!result.ok) return;
    expect(result.save).toEqual({ ...withLegacyTraining(current), discovery: legacyDiscovery(), pirates: { ...legacyPirates(), paid: [] } });
    expect(result.save.discovery.archive).toEqual(['battery', 'heavyLaser', 'largeCargo']);
    expect(result.save.discovery.dataTotal).toBe(0);
    // an old game may keep crafting the parts M2d made available directly
    const loaded = restoreSimulation(result.save);
    expect(partUnlocked(loaded.state, 'heavyLaser:1')).toBe(true);
    expect(partUnlocked(loaded.state, 'engine:1:overdrive')).toBe(false);
  });

  it('a new game starts with the M2d parts locked behind the Archive', () => {
    const sim = dockedSim();
    for (const key of ['heavyLaser:1', 'largeCargo:2', 'battery:1'] as const) expect(partUnlocked(sim.state, key)).toBe(false);
    expect(partUnlocked(sim.state, 'engine:2')).toBe(true);
  });

  it('rejects data that is not a version 4 save', () => {
    expect(migrate({ version: 4 }, 4)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 5 → 6 (M3.6 salvage)', () => {
  it('loads a version 5 save with no tractor target, no containers and nothing cut from wrecks', () => {
    const sim = dockedSim();
    sim.state.credits = 444;
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV5(current);
    expect(old.version).toBe(5);
    expect('tractor' in old.player).toBe(false);
    expect('containers' in old.combat).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 5 });
    if (!result.ok) return;
    expect(result.save).toEqual({ ...withLegacyTraining(current), pirates: { ...legacyPirates(), paid: [] } });
    expect(result.save.player.tractor).toBeNull();
    expect(result.save.combat.containers).toEqual([]);
    expect(result.save.discovery.cut).toEqual([]);
  });

  it('rejects data that is not a version 5 save', () => {
    expect(migrate({ version: 5 }, 5)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 6 → 7 (M3.8 ship blueprint)', () => {
  it('takes the ship as it is at load as the blueprint', () => {
    const sim = dockedSim();
    // the ship already lost its radar before the save – an old save cannot know that
    const grid = sim.state.player.grid;
    sim.state.player.grid = { nextId: grid.nextId, parts: grid.parts.filter((p) => p.partId !== 'radar') };
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV6(current);
    expect(old.version).toBe(6);
    expect('blueprint' in old.player).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 6 });
    if (!result.ok) return;
    expect(result.save.player.blueprint).toEqual(result.save.player.grid);
    expect(result.save.player.blueprint.parts.some((p) => p.partId === 'radar')).toBe(false);
    expect(result.save).toEqual({ ...withLegacyTraining(current), player: { ...current.player, blueprint: current.player.grid } });
  });

  it('keeps the blueprint through save and load', () => {
    const sim = dockedSim();
    const full = createStarterShip();
    sim.state.player.grid = { nextId: full.nextId, parts: full.parts.filter((p) => p.partId !== 'radar') };
    const save = toSave(sim, testContext());
    expect(save.player.blueprint.parts).toHaveLength(full.parts.length);
    const result = loadSave(toEnvelope(save));
    if (!result.ok) throw new Error('load failed');
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.player.blueprint.parts).toHaveLength(full.parts.length);
    expect(loaded.state.player.grid.parts).toHaveLength(full.parts.length - 1);
  });

  it('rejects data that is not a version 6 save', () => {
    expect(migrate({ version: 6 }, 6)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 7 → 8 (Guild loans and the scuttle flag)', () => {
  it('loads a version 7 save with every part owned and no scuttle pending', () => {
    const current = legacyWorldSave(toSave(dockedSim(), testContext()));
    const old = downgradeToV7(current);
    expect(old.version).toBe(7);
    expect('scuttled' in old.player).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 7 });
    if (!result.ok) return;
    expect(result.save.player.scuttled).toBe(false);
    expect(result.save).toEqual(withLegacyTraining(current));
  });

  it('keeps loan parts and a pending scuttle through save and load', () => {
    const sim = dockedSim();
    sim.state.player.grid = asLoan(sim.state.player.grid);
    sim.state.player.scuttled = true;
    const save = toSave(sim, testContext());
    expect(save.player.grid.parts.every((p) => p.loan === true)).toBe(true);
    const result = loadSave(toEnvelope(save));
    if (!result.ok) throw new Error('load failed');
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.player.grid.parts.every((p) => p.loan === true)).toBe(true);
    expect(loaded.state.player.scuttled).toBe(true);
  });

  it('rejects a loan flag that is not true', () => {
    const save = toSave(dockedSim(), testContext());
    (save.player.grid.parts[0] as { loan?: unknown }).loan = 'yes';
    expect(loadSave(toEnvelope(save))).toMatchObject({ ok: false });
  });

  it('rejects data that is not a version 7 save', () => {
    expect(migrate({ version: 7 }, 7)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 8 → 9 (pirate fuel and gunner reaction)', () => {
  /** A ship in flight with a Jackal half-way through its tanks and a gunner still reacting. */
  function withPirate(): Simulation {
    const sim = new Simulation({ seed: 7, startDocked: false });
    const e = createEnemy({ id: 'pr:0,0:0', kind: 'jackal', tier: 1, pos: { x: 60, y: 0 }, angle: Math.PI, home: { x: 60, y: 0 }, orbit: 1 });
    e.fuel = e.props.fuelCapacity / 2;
    e.ai = { ...e.ai, mode: 'attack', react: 7, seen: { x: 1, y: 2 } };
    sim.state.combat.enemies.push(e);
    return sim;
  }

  it('gives an old pirate full tanks and no pending reaction', () => {
    const current = legacyWorldSave(toSave(withPirate(), testContext()));
    const old = downgradeToV8(current);
    expect(old.version).toBe(8);
    expect('fuel' in old.combat.enemies[0]!).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 8 });
    if (!result.ok) return;
    const e = result.save.combat.enemies[0]!;
    const capacity = withPirate().state.combat.enemies[0]!.props.fuelCapacity;
    expect(capacity).toBeGreaterThan(0);
    expect(e.fuel).toBe(capacity);
    expect(e.ai).toMatchObject({ mode: 'attack', react: 0, seen: { x: 0, y: 0 } });
  });

  it('keeps fuel and the reaction state through save and load', () => {
    const save = toSave(withPirate(), testContext());
    const result = loadSave(toEnvelope(save));
    if (!result.ok) throw new Error('load failed');
    const e = restoreSimulation(result.save).state.combat.enemies[0]!;
    expect(e.fuel).toBeCloseTo(e.props.fuelCapacity / 2);
    expect(e.ai.react).toBe(7);
    expect(e.ai.seen).toEqual({ x: 1, y: 2 });
  });

  it('clamps a pirate with more fuel than its tanks hold, with a warning (M1 – the game must still save)', () => {
    const save = toSave(withPirate(), testContext());
    save.combat.enemies[0]!.fuel = 1e6;
    const result = loadSave(toEnvelope(save));
    expect(result).toMatchObject({ ok: true, warnings: [{ code: 'capacityClamped', paths: ['combat.enemies[0].fuel'] }] });
    if (result.ok) expect(result.save.combat.enemies[0]!.fuel).toBe(withPirate().state.combat.enemies[0]!.props.fuelCapacity);
  });

  it('rejects data that is not a version 8 save', () => {
    expect(migrate({ version: 8 }, 8)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 9 → 10 (M3.7 Guild Training)', () => {
  it('replaces a First Day still running with a done training (a game in progress)', () => {
    const current = legacyWorldSave(toSave(dockedSim(), testContext()));
    const old = downgradeToV9(current);
    expect(old.version).toBe(9);
    expect(old.career.firstDay.status).toBe('active');
    expect('training' in old.career).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 9 });
    if (!result.ok) return;
    expect(result.save.career.training).toEqual(legacyTraining());
    expect('firstDay' in result.save.career).toBe(false);
    expect(result.save).toEqual(withLegacyTraining(current));
  });

  it('keeps a running training through save and load', () => {
    const sim = new Simulation({ seed: 5 });
    beginTraining(sim.state);
    sim.state.career.training.step = 3;
    sim.state.career.training.flags = 1;
    const save = toSave(sim, testContext());
    const result = loadSave(toEnvelope(save));
    if (!result.ok) throw new Error('load failed');
    expect(restoreSimulation(result.save).state.career.training).toEqual(sim.state.career.training);
  });

  it('rejects data that is not a version 9 save', () => {
    expect(migrate({ version: 9 }, 9)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 11 → 12 (Mining 2.0)', () => {
  it('loads a version 11 save with no nuggets and nothing assayed', () => {
    const sim = dockedSim();
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'undock', reqId: 1 }] });
    for (let i = 0; i < 30; i++) sim.step(IDLE_COMMAND);
    const current = legacyWorldSave(toSave(sim, testContext()));
    const old = downgradeToV11(current);
    expect(old.version).toBe(11);
    expect('mining' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 11 });
    if (!result.ok) return;
    expect(result.save.mining).toEqual({ nextId: 1, nuggets: [], assayed: [] });
    expect(result.save).toEqual(current);
    expect(restoreSimulation(result.save).state.mining.nuggets).toEqual([]);
  });

  it('rejects data that is not a version 11 save', () => {
    expect(migrate(null, 11)).toMatchObject({ ok: false, error: 'migration' });
  });

  it('a V12 save with a broken nugget is invalid, a grade outside the tables is clamped', () => {
    const sim = dockedSim();
    const save = toSave(sim, testContext());
    const body = { pos: { x: 1, y: 2 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    const good = { ...save, mining: { nextId: 3, nuggets: [{ id: 2, resource: 'iron', amount: 5, grade: 9, source: '0,0:1', body, ttl: 10 }], assayed: ['0,0'] } };
    const ok = loadSave(toEnvelope(good));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.save.mining.nuggets[0]!.grade).toBe(1.6);
    const bad = { ...save, mining: { nextId: 2, nuggets: [{ id: 2, resource: 'gold', amount: -1, grade: 1, source: '', body, ttl: 10 }], assayed: ['x'] } };
    expect(loadSave(toEnvelope(bad))).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('migration 12 → 13 (the training hull gets a reverse engine)', () => {
  /** The V12 training hull: no reverse engine (the brake step paid two). */
  const oldHull = (): ShipGrid =>
    createGrid([
      ['cockpit', 1, 0],
      ['miningLaser', 2, 0, 0],
      ['cargo', 0, 0],
      ['fuelTank', -1, 0],
      ['engine', -2, 0, 0],
    ]);
  const keys = (inv: Partial<Record<string, number>>): string[] => Object.entries(inv).flatMap(([k, n]) => Array<string>(n ?? 0).fill(k));
  const composition = (grid: ShipGrid): string[] => grid.parts.map((p) => partKey(p.partId, p.tier, p.variant));

  /** A training game at `step` as a V12 game had it: the old hull at the home dock. */
  function oldTraining(step: number) {
    const sim = trainingSim(1337);
    const grid = oldHull();
    const { player } = sim.state;
    player.grid = grid;
    player.blueprint = grid;
    player.props = computeProperties(grid);
    sim.state.respawn = { ...sim.state.respawn, grid };
    sim.state.career.training.step = step;
    // the reward parts paid so far wait in the home storage (the steps before the brake step paid the same in V12)
    const paid: Record<string, number> = {};
    for (const s of TRAINING_STEPS.slice(0, step)) for (const [k, n] of Object.entries(s.reward.parts)) paid[k] = (paid[k] ?? 0) + (n ?? 0);
    sim.state.stations.get('home')!.parts = paid;
    return sim;
  }

  it('a training before the brake reward gets the missing reverse engine into the reward storage – the end stays the starter ship', () => {
    for (const step of [0, stepIndex('installSide'), stepIndex('brakeBuoy')]) {
      const sim = oldTraining(step);
      const old = downgradeToV12(toSave(sim, testContext()));
      expect(old.version).toBe(12);
      const result = loadSave(toEnvelope(old));
      expect(result).toMatchObject({ ok: true, fromVersion: 12 });
      if (!result.ok) return;
      expect(result.save.stations.home!.parts['engine:1']).toBe((old.stations.home?.parts['engine:1'] ?? 0) + 1);
      // hull + storage + the rewards still to come = the starter ship + the starting storage
      const loaded = restoreSimulation(result.save);
      const all = [...composition(loaded.state.player.grid), ...keys(loaded.state.stations.get('home')!.parts), ...keys(remainingRewardParts(loaded.state.career.training))].sort();
      expect(all).toEqual([...composition(createStarterShip()), ...keys(STARTING_HOME_PARTS)].sort());
      // skipping at the dock fits the starter ship at once (nothing missing)
      loaded.step({ ...IDLE_COMMAND, actions: [{ type: 'trainingSkip', reqId: 1 }] });
      expect(composition(loaded.state.player.grid).sort()).toEqual(composition(createStarterShip()).sort());
      expect(loaded.state.stations.get('home')!.parts).toEqual(STARTING_HOME_PARTS);
    }
  });

  it('a training past the brake step, a done or skipped one, changes nothing but the version', () => {
    const past = legacyWorldSave(toSave(oldTraining(stepIndex('installReverse')), testContext()));
    const done = legacyWorldSave(toSave(dockedSim(), testContext()));
    for (const current of [past, done]) {
      const result = loadSave(toEnvelope(downgradeToV12(current)));
      expect(result).toMatchObject({ ok: true, fromVersion: 12 });
      if (result.ok) expect(result.save).toEqual(current);
    }
  });

  it('rejects data that is not a version 12 save', () => {
    expect(migrate({ version: 12 }, 12)).toMatchObject({ ok: false, error: 'migration' });
  });
});

describe('migration 13 → 14 (world generation)', () => {
  /** A station whose model differs between the generations (seed 1337, ring 2: outpost_b → outpost_d). */
  const OUTPOST = 'st:-5,-7';

  it('an old save keeps the world it was generated with – the same station models and colliders', () => {
    const sim = new Simulation({ seed: 1337, worldGen: 1, startDocked: false });
    const old = downgradeToV13(toSave(sim, testContext()));
    expect(old.version).toBe(13);
    expect('worldGen' in old).toBe(false);
    const result = loadSave(toEnvelope(old));
    expect(result).toMatchObject({ ok: true, fromVersion: 13 });
    if (!result.ok) return;
    expect(result.save.worldGen).toBe(1);
    expect(result.save).toEqual(legacyWorldSave(toSave(sim, testContext())));
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.world.gen).toBe(1);
    const legacy = stationById(1337, OUTPOST, 1)!;
    expect(legacy.model).toBe('outpost_b');
    expect(loaded.station(OUTPOST)).toEqual(legacy);
    // also once its chunk is active (colliders and the station view come from the world)
    loaded.state.world.update(legacy.pos);
    expect(loaded.state.world.stations().find((s) => s.id === OUTPOST)).toEqual(legacy);
  });

  it('a new game takes the latest generation and keeps it through save and load', () => {
    const sim = new Simulation({ seed: 1337, startDocked: false });
    expect(sim.state.world.gen).toBe(2);
    const save = toSave(sim, testContext());
    expect(save.worldGen).toBe(2);
    const result = loadSave(toEnvelope(save));
    expect(result).toMatchObject({ ok: true, fromVersion: 20 });
    if (!result.ok) return;
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.world.gen).toBe(2);
    expect(loaded.station(OUTPOST)!.model).toBe('outpost_d');
    expect(toSave(loaded, testContext())).toEqual(save);
  });

  it('rejects an unknown generation', () => {
    const save = { ...toSave(dockedSim(), testContext()), worldGen: 3 };
    expect(loadSave(envelopeOf(save))).toMatchObject({ ok: false, error: 'invalid' });
  });
});

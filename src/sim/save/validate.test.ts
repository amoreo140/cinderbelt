import { describe, expect, it } from 'vitest';
import { FORTRESS } from '../../data/pirates';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { computeProperties } from '../ship/properties';
import { dockedSim } from '../station/testHarness';
import { dockPose } from '../station/dock';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { toSave } from './serialize';
import { testContext } from './testing';
import type { SaveGame } from './types';
import { validateSave } from './validate';

const good = (): SaveGame => {
  const sim = dockedSim();
  sim.state.player.hp.set(1, 10);
  sim.state.player.cargo.iron = 5;
  return toSave(sim, testContext());
};

function errorsOf(mutate: (s: SaveGame & Record<string, unknown>) => void): string[] {
  const save = good() as SaveGame & Record<string, unknown>;
  mutate(save);
  const result = validateSave(JSON.parse(JSON.stringify(save)));
  return result.ok ? [] : result.errors;
}

describe('validateSave', () => {
  it('accepts a valid save and returns an equal, clean copy', () => {
    const save = good();
    const result = validateSave({ ...save, extra: 'ignored' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (result.ok) expect(result.save).toEqual(save);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave([]).ok).toBe(false);
    expect(errorsOf((s) => ((s as unknown as Record<string, unknown>).version = 1))[0]).toMatch(/^version/);
  });

  it.each<[string, (s: SaveGame & Record<string, unknown>) => void]>([
    ['gameId', (s) => (s.gameId = '')],
    ['name', (s) => ((s as unknown as Record<string, unknown>).name = 5)],
    ['savedAt', (s) => (s.savedAt = 'yesterday')],
    ['saveReason', (s) => ((s as unknown as Record<string, unknown>).saveReason = 'cheat')],
    ['seed', (s) => (s.seed = -1)],
    ['seed', (s) => (s.seed = 2 ** 32)],
    ['settings.deathPenalty', (s) => ((s.settings as unknown as Record<string, unknown>).deathPenalty = 'easy')],
    ['settings.miningYield', (s) => ((s.settings as unknown as Record<string, unknown>).miningYield = 3)],
    ['settings.enemyDensity', (s) => ((s.settings as unknown as Record<string, unknown>).enemyDensity = 'none')],
    ['settings.fallenFromHardcore', (s) => ((s.settings as unknown as Record<string, unknown>).fallenFromHardcore = 'no')],
    ['tick', (s) => (s.tick = 1.5)],
    ['credits', (s) => (s.credits = -1)],
    ['credits', (s) => ((s as unknown as Record<string, unknown>).credits = null)],
    ['player.grid.parts[0].partId', (s) => ((s.player.grid.parts[0] as unknown as Record<string, unknown>).partId = 'laserCannon')],
    ['player.grid.parts[0].tier', (s) => ((s.player.grid.parts[0] as unknown as Record<string, unknown>).tier = 3)],
    ['player.grid.parts[0].rot', (s) => ((s.player.grid.parts[0] as unknown as Record<string, unknown>).rot = 4)],
    ['player.grid.parts[1].id', (s) => (s.player.grid.parts[1]!.id = s.player.grid.parts[0]!.id)],
    ['player.grid.nextId', (s) => (s.player.grid.nextId = 1)],
    ['player.hp[0]', (s) => (s.player.hp = [[999, 1]])],
    ['player.hp[0]', (s) => (s.player.hp = [[1, 0]])],
    ['player.body.pos', (s) => ((s.player.body.pos as unknown as Record<string, unknown>).x = 'far')],
    ['player.fuel', (s) => (s.player.fuel = -1)],
    ['player.cargo.gold', (s) => ((s.player.cargo as unknown as Record<string, unknown>).gold = 1)],
    ['player.dockedAt', (s) => ((s.player as unknown as Record<string, unknown>).dockedAt = 'moon')],
    ['respawn.stationId', (s) => (s.respawn.stationId = '')],
    ['stations.home.parts', (s) => ((s.stations.home!.parts as unknown as Record<string, unknown>)['laser:1'] = 1)],
    ['stations.home.parts', (s) => (s.stations.home!.parts['armor:1'] = 1.5)],
    ['stations.home.resources.ice', (s) => (s.stations.home!.resources.ice = -2)],
    ['stations.bogus', (s) => (s.stations.bogus = s.stations.home!)],
    ['world.remaining[0]', (s) => ((s.world as unknown as Record<string, unknown>).remaining = [['a', -1]])],
    ['world.explored[0]', (s) => (s.world.explored = ['x,y'])],
    ['world.discoveredStations[0]', (s) => (s.world.discoveredStations = ['nowhere'])],
    ['world.center', (s) => ((s.world as unknown as Record<string, unknown>).center = [1])],
    ['stats.deaths', (s) => (s.stats.deaths = -1)],
    ['stats.mined.iron', (s) => ((s.stats.mined as unknown as Record<string, unknown>).iron = 'lots')],
  ])('reports %s', (path, mutate) => {
    const errors = errorsOf(mutate);
    expect(errors.some((e) => e.startsWith(path)), errors.join('\n')).toBe(true);
  });

  it('allows an empty cargo hold and missing optional damage', () => {
    expect(errorsOf((s) => (s.player.hp = []))).toEqual([]);
  });

  it('M1: clamps values above a (tunable) capacity with a warning instead of rejecting the save', () => {
    const save = good();
    save.player.fuel = 1e9;
    save.player.energy = 1e9;
    save.player.shield = 1e9;
    save.player.cargo = { iron: 1e9, copper: 1e9, ice: 0, titanium: 0 };
    save.player.hp = [[1, 9999]];
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const props = computeProperties(createStarterShip());
    expect(result.save.player.fuel).toBe(props.fuelCapacity);
    expect(result.save.player.energy).toBe(props.batteryCapacity);
    expect(result.save.player.shield).toBe(props.shield.capacity);
    expect(result.save.player.cargo.iron + result.save.player.cargo.copper).toBeCloseTo(props.cargoCapacity);
    expect(result.save.player.hp[0]![1]).toBeLessThan(9999);
    expect(result.warnings).toEqual([
      { code: 'capacityClamped', paths: ['player.hp[0]', 'player.fuel', 'player.energy', 'player.shield', 'player.cargo'] },
    ]);
  });
});

describe('validateSave – invalid ship recovery (spec 12.4)', () => {
  /** A grid with known parts but without a cockpit and disconnected. */
  const brokenGrid = () => {
    const g = createGrid([
      ['engine', 0, 0],
      ['armor', 5, 5],
      ['gyro', 6, 5, 0, 2],
    ]);
    return { nextId: g.nextId, parts: g.parts.map((p) => ({ ...p })) };
  };

  it('moves the parts to the respawn station storage and gives the starter ship docked there', () => {
    const save = good();
    save.player.grid = brokenGrid();
    save.player.hp = [[1, 5]];
    save.player.dockedAt = null;
    save.player.body = { pos: { x: 500, y: 500 }, vel: { x: 3, y: 0 }, angle: 1, angVel: 0.1 };
    save.player.cargo = { iron: 20, copper: 0, ice: 1, titanium: 0 };
    save.player.fuel = 5;
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([{ code: 'shipReplaced', stationId: HOME_STATION_ID }]);
    const s = result.save;
    const starter = createStarterShip();
    expect(s.player.grid.parts.map((p) => p.partId)).toEqual(starter.parts.map((p) => p.partId));
    expect(s.player.hp).toEqual([]);
    expect(s.player.dockedAt).toBe(HOME_STATION_ID);
    const props = computeProperties(starter);
    expect(s.player.body).toEqual(dockPose(homeStation(), props.boundingRadius));
    expect(s.player.fuel).toBe(5);
    expect(s.player.energy).toBe(props.batteryCapacity);
    expect(s.player.cargo).toEqual({ iron: 0, copper: 0, ice: 0, titanium: 0 });
    expect(s.stations.home!.parts).toEqual({ 'armor:1': 3, 'cannon:1': 1, 'engine:1': 1, 'gyro:2': 1 });
    expect(s.stations.home!.resources).toEqual({ iron: 20, copper: 0, ice: 1, titanium: 0 });
    expect(s.world.center).toBeNull();
  });

  it('resets an invalid respawn layout to the current ship without a warning', () => {
    const save = good();
    save.respawn.grid = brokenGrid();
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (result.ok) expect(result.save.respawn.grid).toEqual(save.player.grid);
  });

  it('still rejects unknown part ids instead of recovering', () => {
    const save = good() as unknown as { player: { grid: { parts: Record<string, unknown>[] } } };
    save.player.grid.parts[0]!.partId = 'plasma';
    expect(validateSave(save).ok).toBe(false);
  });
});

describe('validateSave – M2d veins, cracked ice and laser heat', () => {
  it('accepts valid vein states, cracked rocks and heat of a mining laser', () => {
    const save = good();
    save.world.veins = [['0,0:3', [0.25, 0.8], [1, -1]]];
    save.world.cracked = [['0,0:7', 12.5]];
    // starter: the mining laser has id 3
    save.player.heat = [[3, 2.5, 0]];
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.save.world.veins).toEqual(save.world.veins);
  });

  it('rejects broken vein states, cracked entries and heat of a part that is not a laser', () => {
    expect(errorsOf((s) => (s.world.veins = [['0,0:3', [1.5], [1]]])).join()).toMatch(/world\.veins/);
    expect(errorsOf((s) => (s.world.veins = [['0,0:3', [0.5, 0.5], [1]]])).join()).toMatch(/1–3 veins/);
    expect(errorsOf((s) => (s.world.veins = [['0,0:3', [0.5], [0]]])).join()).toMatch(/dirs/);
    expect(errorsOf((s) => (s.world.cracked = [['0,0:7', -1]])).join()).toMatch(/world\.cracked/);
    expect(errorsOf((s) => (s.player.heat = [[1, 1, 0]])).join()).toMatch(/not a mining laser/);
    expect(errorsOf((s) => (s.player.heat = [[3, 9, 0]])).join()).toMatch(/player\.heat/);
    expect(errorsOf((s) => (s.player.heat = [[3, 1, 500]])).join()).toMatch(/player\.heat/);
    expect(errorsOf((s) => (s.player.heat = [[99, 1, 0]])).join()).toMatch(/no part with id 99/);
  });
});

describe('validateSave – hangar bounds (M7)', () => {
  const shifted = (dx: number, dy: number) => {
    const g = createStarterShip();
    return { nextId: g.nextId, parts: g.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
  };

  it('recentres a ship that fits the hangar but lies outside it, without changing its pose', () => {
    const save = good();
    save.player.grid = shifted(10, -9);
    save.respawn.grid = shifted(-12, 0);
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    const cells = result.save.player.grid.parts.flatMap((p) => [p.x, p.y]);
    expect(Math.min(...cells)).toBeGreaterThanOrEqual(-7);
    expect(Math.max(...cells)).toBeLessThanOrEqual(7);
    // the same shape (just shifted) and the same centre-of-mass position in the world
    const starter = createStarterShip();
    const d = { x: result.save.player.grid.parts[0]!.x - starter.parts[0]!.x, y: result.save.player.grid.parts[0]!.y - starter.parts[0]!.y };
    expect(result.save.player.grid.parts).toEqual(starter.parts.map((p) => ({ ...p, x: p.x + d.x, y: p.y + d.y })));
    expect(result.save.player.body).toEqual(save.player.body);
    const respawn = result.save.respawn.grid.parts.flatMap((p) => [p.x, p.y]);
    expect(Math.min(...respawn)).toBeGreaterThanOrEqual(-7);
    expect(Math.max(...respawn)).toBeLessThanOrEqual(7);
  });

  it('replaces a ship larger than the hangar like an invalid ship', () => {
    const save = good();
    const long = createGrid([['cockpit', 0, 0], ...Array.from({ length: 16 }, (_, i): ['armor', number, number] => ['armor', i + 1, 0])]);
    save.player.grid = { nextId: long.nextId, parts: long.parts.map((p) => ({ ...p })) };
    save.player.hp = [];
    save.player.cooldowns = [];
    save.player.heat = [];
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContainEqual({ code: 'shipReplaced', stationId: HOME_STATION_ID });
    expect(result.save.player.grid.parts.map((p) => p.partId)).toEqual(createStarterShip().parts.map((p) => p.partId));
    expect(result.save.stations.home!.parts['armor:1']).toBe(2 + 16);
  });
});

describe('validateSave – salvage (V6)', () => {
  it('checks the tractor target, containers and the dismantle state of wrecks', () => {
    expect(errorsOf((s) => (s.player.tractor = { target: { kind: 'bogus' as 'wreck', id: 1 }, rip: null }))[0]).toMatch(/player\.tractor\.target\.kind/);
    expect(errorsOf((s) => (s.player.tractor = { target: { kind: 'wreck', id: 3 }, rip: { partId: 2, progress: 2 } }))[0]).toMatch(/rip\.progress/);
    expect(errorsOf((s) => (s.player.tractor = { target: { kind: 'container', id: 7 }, rip: null }))).toEqual([]);
    const container = { id: 5, body: { pos: { x: 1, y: 2 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, loot: { cargo: { iron: 3, copper: 0, ice: 0, titanium: 0 }, parts: {} }, ttl: 60 };
    expect(errorsOf((s) => s.combat.containers.push(container))).toEqual([]);
    expect(errorsOf((s) => s.combat.containers.push({ ...container, id: -4 }))[0]).toMatch(/containers\[0\]\.id/);
    expect(errorsOf((s) => s.combat.containers.push({ ...container, id: -4, poi: 'ct:wreck:1,2:0' }))).toEqual([]);
    const wreck = { id: 9, grid: { nextId: 3, parts: [{ id: 1, partId: 'cockpit' as const, tier: 1 as const, x: 0, y: 0, rot: 0 as const }, { id: 2, partId: 'armor' as const, tier: 1 as const, x: 1, y: 0, rot: 0 as const }] }, body: container.body, loot: container.loot, ttl: 60, livery: 'default' as const };
    expect(errorsOf((s) => s.combat.wrecks.push({ ...wreck, dismantle: { intact: [2] }, cutting: { partId: 1, progress: 0.4 } }))).toEqual([]);
    expect(errorsOf((s) => s.combat.wrecks.push({ ...wreck, dismantle: { intact: [5] } }))[0]).toMatch(/dismantle\.intact/);
    expect(errorsOf((s) => (s.discovery.cut = [['wreck:1,2', [3, 4]]]))).toEqual([]);
    expect(errorsOf((s) => (s.discovery.cut = [['wreck:1,2', [-3]]]))[0]).toMatch(/discovery\.cut/);
  });
});

describe('validateSave – pirates (V6)', () => {
  it('checks attention, the raid, the toll and fortress damage', () => {
    expect(errorsOf((s) => (s.pirates.attention = 120))[0]).toMatch(/pirates\.attention/);
    expect(errorsOf((s) => (s.pirates.toll = { group: 'pr:1,2', amount: 300, until: 100 }))).toEqual([]);
    expect(errorsOf((s) => (s.pirates.raid = { serial: 1, kind: 'challenge', pos: { x: 1, y: 2 }, station: null, beacon: 'beacon:0', captain: 3, ships: 4, arrive: 10, ends: 20, spawned: false }))).toEqual([]);
    expect(errorsOf((s) => (s.pirates.raid = { serial: 1, kind: 'bogus' as 'raid', pos: { x: 1, y: 2 }, station: null, beacon: null, captain: null, ships: 4, arrive: 10, ends: 20, spawned: false }))[0]).toMatch(/raid\.kind/);
    const fort = { core: 100, gens: [0, 50], turrets: [0, 0, 160, 10], destroyed: null, kills: 0, reinforce: 300, spawned: 2, cooldowns: [0, 0, 3, 0] };
    expect(errorsOf((s) => (s.pirates.fortresses = [['fort:0', fort]]))).toEqual([]);
    // HP above the (tunable) maximum is clamped with a warning (M1), a negative one is an error
    expect(errorsOf((s) => (s.pirates.fortresses = [['fort:0', { ...fort, core: -1 }]]))[0]).toMatch(/fortresses\[0\]\.core/);
    const save = good();
    save.pirates.fortresses = [['fort:0', { ...fort, core: 99999 }]];
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result).toMatchObject({ ok: true, warnings: [{ code: 'capacityClamped', paths: ['pirates.fortresses[0].core'] }] });
    if (result.ok) expect(result.save.pirates.fortresses[0]![1].core).toBe(FORTRESS.coreHp);
  });
});

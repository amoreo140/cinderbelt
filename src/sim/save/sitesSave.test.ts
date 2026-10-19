// Save V17 (M4b "World Comes Alive"): the world sites and the events director – round trip, the 16 → 17
// migration, the shape validation (rejects) and the repair against the seed's generator (warnings), the
// new enemy kinds / AI modes / ids, graveyard keys in the discovery state, and the terminal probe
// "take → save → load → take again = refused".
import { describe, expect, it } from 'vitest';
import { COMET } from '../../data/sites';
import { createEnemy } from '../combat/enemies';
import type { EnemyKind } from '../combat/types';
import { IDLE_COMMAND, type GameAction } from '../commands';
import { run } from '../discovery/testing';
import { createDirector } from '../events/state';
import { berthedAt, findDerelict } from '../sites/derelictTesting';
import { mineId } from '../sites/graveyardKeys';
import { armedMineList, restoreArmedMines } from '../sites/mines';
import { sitesInChunk } from '../sites/placement';
import { cometDefs, cometPassWindow } from '../sites/comets';
import { createSites } from '../sites/state';
import type { GraveyardSite } from '../sites/types';
import type { Simulation } from '../Simulation';
import { loadSave, type LoadResult } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { downgradeToV16, testContext } from './testing';
import type { SaveGame } from './types';

const SEED = 42;
const ctx = testContext();

const D = findDerelict(SEED, (d) => d.service === 'stash');
const D2 = findDerelict(SEED, (d) => d.id !== D.id);

function firstGraveyard(seed: number): GraveyardSite {
  const out: GraveyardSite[] = [];
  for (let cx = -30; cx <= 30; cx++) for (let cy = -30; cy <= 30; cy++) for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === 'graveyard' && s.mines.length > 1 && s.sleepers.length > 0) out.push(s);
  return out.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
}
const G = firstGraveyard(SEED);
const COMET_ID = cometDefs(SEED)[0]!.id;

const enemy = (id: string, kind: EnemyKind, at: { x: number; y: number }) => createEnemy({ id, kind, tier: 1, pos: at, angle: 0, home: at, orbit: 1 });

/** Berthed at derelict D, with every kind of M4b state set: the save used by the tests below. */
function everything(): Simulation {
  const sim = berthedAt(SEED, D);
  const s = sim.state;
  // later in the game (a fuse and a wake tick need room before "now")
  s.tick += 5000;
  const tick = s.tick;
  // a second derelict: one relay lit, another half charged, its defence awake
  s.sites.powered.add(D2.relays[1]!.id);
  s.sites.charge = { id: D2.relays[0]!.id, progress: 2.5 };
  s.sites.derelicts.set(D2.id, { woke: Math.max(0, tick - 100), taken: 0, visited: false });
  // a graveyard: mine 0 gone, the party awake, Data given, one fragment roll; mine 1 burning its fuse
  s.sites.graveyards.set(G.id, { mines: 1, party: 'awake', data: true, rolls: 1 });
  restoreArmedMines(s.sites, [[mineId(G.id, 1), tick - 10]]);
  // a comet mined in its current pass
  const pass = cometPassWindow(SEED, COMET_ID, tick)!.pass;
  s.sites.comets.set(COMET_ID, { pass, core: 12.5, tail: 0b101 });
  // the director: a running ambush (hail decided), a comet flyby announced, the quiet window in the future
  s.director.last = tick + 500;
  s.director.fired.set('ev:ambush:rg:A:3.3@5', 300);
  s.director.fired.set('ev:ambush:rg:A:3.3@5#hail', 700);
  s.director.fired.set('ev:micrometeors:rg:B:2.1@9', 540);
  s.director.fired.set('ev:micrometeors:rg:B:2.1@9#end', 2100);
  s.director.fired.set(`ev:comet:${COMET_ID}@${pass}`, tick + 9000);
  // the site enemies: a sentry, an awake Gunner sleeper, an evading ambush Gunner, a dormant sleeper
  s.combat.enemies = [
    enemy(`dd:${D2.cx},${D2.cy}:0`, 'sentry', D2.pos),
    { ...enemy(`gs:${G.cx},${G.cy}:0`, G.sleepers[0]!, G.pos), ai: { ...enemy('x', 'jackal', G.pos).ai, mode: 'dormant' } },
    { ...enemy('ab:rg:A:3.3@5:0', 'gunner', D.pos), ai: { ...enemy('x', 'gunner', D.pos).ai, mode: 'evade' } },
  ];
  // a graveyard wreck dismantled and its container opened (keys of the seed wrecks)
  s.discovery.cut.set(`${G.id}#3`, [1]);
  s.discovery.opened.add(`ct:${G.id}#3:0`);
  s.discovery.scanned.add(`${G.id}#3`);
  return sim;
}

function load(save: unknown): LoadResult {
  return loadSave(toEnvelope(save as { version: number }));
}

function loaded(save: unknown): { save: SaveGame; warnings: unknown[] } {
  const r = load(save);
  if (!r.ok) throw new Error(`load failed: ${r.error} ${r.details.join('; ')}`);
  return { save: r.save, warnings: r.warnings };
}

/** The save with a change applied to a JSON copy. */
function edited(save: SaveGame, change: (s: Record<string, any>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(save)) as Record<string, any>;
  change(copy);
  return copy;
}

describe('save V17 – world sites and the events director', () => {
  it('round trip: every field survives save and load, the save is canonical', () => {
    const sim = everything();
    const save = toSave(sim, ctx);
    expect(save.version).toBe(20);
    expect(save.sites.berth).toBe(D.id);
    expect(save.sites.powered).toEqual([...save.sites.powered].sort());
    expect(save.sites.graveyards).toEqual([[G.id, { mines: 1, party: 1, data: true, rolls: 1 }]]);
    expect(save.sites.armed).toEqual([[mineId(G.id, 1), sim.state.tick - 10]]);
    expect(save.director.fired.map(([k]) => k)).toEqual([...save.director.fired.map(([k]) => k)].sort());
    const { save: back, warnings } = loaded(save);
    expect(warnings).toEqual([]);
    expect(back).toEqual(save);
    const restored = restoreSimulation(back);
    expect(restored.state.sites).toEqual(sim.state.sites);
    expect(restored.state.director).toEqual(sim.state.director);
    expect(armedMineList(restored.state.sites)).toEqual(armedMineList(sim.state.sites));
    expect(restored.state.combat.enemies.map((e) => [e.id, e.kind, e.ai.mode])).toEqual(sim.state.combat.enemies.map((e) => [e.id, e.kind, e.ai.mode]));
    expect(JSON.stringify(toSave(restored, ctx))).toBe(JSON.stringify(save));
  });

  it('migration 16 → 17: an old save gets empty sites and a director with no event yet', () => {
    const sim = everything();
    const current = toSave(sim, ctx);
    const old = downgradeToV16(current);
    expect(old.version).toBe(16);
    expect('sites' in old || 'director' in old).toBe(false);
    const { save } = loaded(old);
    expect(save.sites).toEqual({ powered: [], charge: null, berth: null, derelicts: [], graveyards: [], comets: [], armed: [] });
    expect(save.director).toEqual({ last: -1e9, fired: [] });
    const restored = restoreSimulation(save);
    expect(restored.state.sites).toEqual(createSites());
    expect(restored.state.director).toEqual(createDirector());
  });

  it('accepts the new enemy kinds and AI modes, ambush / sentry / sleeper ids and graveyard keys in the discovery state', () => {
    const { save } = loaded(toSave(everything(), ctx));
    expect(save.combat.enemies.map((e) => e.kind)).toEqual(['sentry', G.sleepers[0], 'gunner']);
    expect(save.combat.enemies.slice(1).map((e) => e.ai.mode)).toEqual(['dormant', 'evade']);
    expect(save.discovery.cut).toEqual([[`${G.id}#3`, [1]]]);
    expect(save.discovery.opened).toContain(`ct:${G.id}#3:0`);
    expect(save.discovery.scanned).toContain(`${G.id}#3`);
  });

  describe('rejects malformed data', () => {
    const base = toSave(everything(), ctx);
    const cases: [string, (s: Record<string, any>) => void][] = [
      ['missing sites', (s) => delete s.sites],
      ['missing director', (s) => delete s.director],
      ['a negative charge', (s) => (s.sites.charge = { id: D2.relays[0]!.id, progress: -1 })],
      ['a party state out of range', (s) => (s.sites.graveyards[0][1].party = 3)],
      ['a fractional mine mask', (s) => (s.sites.graveyards[0][1].mines = 1.5)],
      ['a negative tail mask', (s) => (s.sites.comets[0][1].tail = -1)],
      ['a duplicate derelict', (s) => s.sites.derelicts.push(s.sites.derelicts[0])],
      ['a derelict without `visited`', (s) => delete s.sites.derelicts[0][1].visited],
      ['a fractional wake tick', (s) => (s.sites.derelicts[0][1].woke = 1.5)],
      ['a comet entry that is not a pair', (s) => s.sites.comets.push(['cm:0'])],
      ['a fractional director tick', (s) => (s.director.fired[0][1] = 0.5)],
      ['a director `last` that is not a number', (s) => (s.director.last = 'never')],
      ['a duplicate director key', (s) => s.director.fired.push(s.director.fired[0])],
      ['an unknown enemy kind', (s) => (s.combat.enemies[0].kind = 'dreadnought')],
      ['an unknown AI mode', (s) => (s.combat.enemies[0].ai.mode = 'sleep')],
    ];
    it.each(cases)('%s', (_name, change) => {
      expect(load(edited(base, change))).toMatchObject({ ok: false, error: 'invalid' });
    });
  });

  describe('repairs what does not match this world (with a warning)', () => {
    const base = toSave(everything(), ctx);
    const repaired = (change: (s: Record<string, any>) => void): { save: SaveGame; paths: string[] } => {
      const { save, warnings } = loaded(edited(base, change));
      const w = warnings.find((x): x is { code: 'sitesRepaired'; paths: string[] } => (x as { code: string }).code === 'sitesRepaired');
      return { save, paths: w?.paths ?? [] };
    };

    it('an unknown berth id is cleared', () => {
      const { save, paths } = repaired((s) => (s.sites.berth = 'dl:9999,9999'));
      expect(save.sites.berth).toBeNull();
      expect(paths).toEqual(['sites.berth']);
    });

    it('a berth at a derelict whose relays are not all powered, or while docked, is cleared', () => {
      expect(repaired((s) => (s.sites.powered = s.sites.powered.filter((id: string) => id !== D.relays[2]!.id))).save.sites.berth).toBeNull();
      expect(repaired((s) => (s.sites.berth = G.id)).save.sites.berth).toBeNull();
      expect(repaired((s) => (s.player.dockedAt = 'home')).save.sites.berth).toBeNull();
    });

    it('unknown relays, derelicts, graveyards and comets are dropped; masks cut to the site', () => {
      const { save, paths } = repaired((s) => {
        s.sites.powered.push('dl:9999,9999:r0', `${D.id}:r7`);
        s.sites.derelicts.push(['dl:9999,9999', { woke: null, taken: 1, visited: true }]);
        s.sites.graveyards.push(['gy:9999,9999', { mines: 1, party: 0, data: false, rolls: 0 }]);
        s.sites.comets.push(['cm:99999', { pass: 0, core: 1, tail: 0 }]);
        s.sites.graveyards[0][1].mines = 0xffff;
        s.sites.graveyards[0][1].rolls = 9;
        s.sites.comets[0][1].tail = 0x7fff_ffff;
        s.sites.comets[0][1].core = COMET.budget + 50;
        s.sites.derelicts[0][1].taken = 0xff;
      });
      expect(save.sites.powered).toEqual(base.sites.powered);
      expect(save.sites.derelicts.map(([id]) => id)).toEqual(base.sites.derelicts.map(([id]) => id));
      expect(save.sites.graveyards).toEqual([[G.id, { mines: (1 << G.mines.length) - 1, party: 1, data: true, rolls: 2 }]]);
      expect(save.sites.comets).toEqual([[COMET_ID, { pass: base.sites.comets[0]![1].pass, core: COMET.budget, tail: (1 << COMET.tail.shards) - 1 }]]);
      expect(save.sites.derelicts[0]![1].taken).toBeLessThan(0xff);
      expect(paths.length).toBeGreaterThan(5);
    });

    it('a charge on an unknown or already powered relay is dropped', () => {
      expect(repaired((s) => (s.sites.charge = { id: 'dl:9999,9999:r1', progress: 1 })).save.sites.charge).toBeNull();
      expect(repaired((s) => (s.sites.charge = { id: D.relays[0]!.id, progress: 1 })).save.sites.charge).toBeNull();
    });

    it('an armed mine that is gone, unknown or past its fuse is dropped', () => {
      expect(repaired((s) => (s.sites.armed = [[mineId(G.id, 0), s.tick - 1]])).save.sites.armed).toEqual([]);
      expect(repaired((s) => (s.sites.armed = [['gy:9999,9999:m0', s.tick - 1]])).save.sites.armed).toEqual([]);
      expect(repaired((s) => (s.sites.armed = [[mineId(G.id, 1), s.tick - 1000]])).save.sites.armed).toEqual([]);
      expect(repaired((s) => (s.sites.armed = [[mineId(G.id, 1), s.tick + 5]])).save.sites.armed).toEqual([]);
    });

    it('foreign director keys are dropped', () => {
      const { save, paths } = repaired((s) => s.director.fired.push(['ds:1,2@4', 10]));
      expect(save.director.fired).toEqual(base.director.fired);
      expect(paths).toEqual(['director.fired']);
    });

    it('site enemies whose site is gone are dropped; only a sleeper may be dormant', () => {
      const { save } = repaired((s) => {
        s.combat.enemies[0].id = 'dd:9999,9999:0';
        s.combat.enemies[1].id = `gs:${G.cx},${G.cy}:99`;
        s.combat.enemies[2].ai.mode = 'dormant';
      });
      expect(save.combat.enemies.map((e) => [e.id, e.ai.mode])).toEqual([['ab:rg:A:3.3@5:0', 'patrol']]);
      // a sentry outside a derelict's posts, or a non-sentry with a sentry id
      expect(repaired((s) => (s.combat.enemies[0].id = `dd:${D2.cx},${D2.cy}:50`)).save.combat.enemies).toHaveLength(2);
      expect(repaired((s) => (s.combat.enemies[0].kind = 'jackal')).save.combat.enemies).toHaveLength(2);
      expect(repaired((s) => (s.combat.enemies[2].id = 'ab:nonsense')).save.combat.enemies).toHaveLength(2);
    });
  });

  it('the terminal probe: take an item, save, load, take it again – refused', () => {
    const sim = berthedAt(SEED, D);
    const take = (s: Simulation, reqId: number) =>
      s.step({ ...IDLE_COMMAND, actions: [{ type: 'derelictTake', site: D.id, item: 0, reqId } as GameAction] }).filter((e) => e.type === 'actionResult');
    expect(take(sim, 1)).toEqual([{ type: 'actionResult', reqId: 1, ok: true }]);
    const { save } = loaded(toSave(sim, ctx));
    expect(save.sites.berth).toBe(D.id);
    const back = restoreSimulation(save);
    run(back, 2);
    expect(back.state.sites.berth).toBe(D.id);
    expect(take(back, 2)).toEqual([{ type: 'actionResult', reqId: 2, ok: false, reason: 'itemTaken' }]);
    // the Data and the log were given once – the derelict stays visited
    expect(back.state.sites.derelicts.get(D.id)!.visited).toBe(true);
  });
});

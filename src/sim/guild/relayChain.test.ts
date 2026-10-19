// M4d T2: the Guild relay chain (plan §2.2 "Relay contract"): the pinned offer, the repair from the
// ship's cargo, the power stage, the hold against the Rust counterattack (warning → fight → won) and
// the interrupted / re-armed hold – no failure, no deadline.
import { describe, expect, it } from 'vitest';
import type { RepLevel } from '../../data/factions';
import { RELAY_CHAIN } from '../../data/guild';
import { RELAY } from '../../data/sites';
import type { Contract } from '../career/types';
import { RESPAWN_TICKS, SPAWN_CHECK_INTERVAL } from '../combat/combat';
import { IDLE_COMMAND } from '../commands';
import { boardContext, currentBoard, ensureBoard } from '../contracts/board';
import { ofType, run, teleport } from '../discovery/testing';
import type { MiningBeam } from '../mining/mining';
import { securityHere } from '../pirates/sectors';
import { relayCandidates } from '../sites/placement';
import { receiverPos, stepRelays } from '../sites/relays';
import { Simulation, type SimEvent, type SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { stationsInArea, type StationDef } from '../world/stations';
import { acceptOffer } from '../contracts/board';
import {
  counterattackPoint,
  debugSecureRelay,
  interactRelay,
  relayContractSites,
  relayInteraction,
  relayOffer,
  relayOfferAvailable,
  relaySeconds,
  relaySpawns,
  relayStage,
} from './relayChain';
import { guildRelaySite } from './relaySites';
import type { GuildRelaySite } from './types';

const SEED = 1;
const TICKS = 60;
const site = guildRelaySite(SEED, 'A')!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest station to the site (within the offer range). */
function nearestStation(s: GuildRelaySite): StationDef {
  const r = Math.ceil(RELAY_CHAIN.offerRange / 200);
  const cx = chunkCoord(s.pos.x);
  const cy = chunkCoord(s.pos.y);
  const all = stationsInArea(SEED, cx - r, cx + r, cy - r, cy + r).sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos));
  return all[0]!;
}

function flying(pos = { x: site.pos.x - 8, y: site.pos.y }): Simulation {
  const sim = new Simulation({ seed: SEED, startDocked: false });
  teleport(sim, pos);
  return sim;
}

/** Guild level 2 (the `guildRelay` unlock). */
const guildLevel = (state: SimState, level: RepLevel): void => {
  state.career.rep.guild.level = level;
};

/** A relay contract of lane A accepted at the nearest station. */
function accept(sim: Simulation): Contract {
  const state = sim.state;
  guildLevel(state, 2);
  const station = nearestStation(site);
  const offer = currentBoard(state, station).offers.find((o) => o.type === 'relay');
  if (!offer) throw new Error('no relay offer');
  const c = acceptOffer(state, station, offer.id);
  if (typeof c === 'string') throw new Error(c);
  return c;
}

const fillRepair = (state: SimState): void => {
  for (const [r, n] of Object.entries(RELAY_CHAIN.repair)) state.player.cargo[r as keyof typeof state.player.cargo] += n!;
};

/** Steps with only the relay counterattack around (no stray pirates of the sector). */
function steps(sim: Simulation, n: number, onlyRc = true): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    if (onlyRc) sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
    out.push(...sim.step(IDLE_COMMAND));
  }
  return out;
}

/** Kill the counterattack ships alive now (as a destroyed pirate is recorded). */
function killParty(state: SimState): number {
  const rc = state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
  for (const e of rc) state.combat.defeated.set(e.id, state.tick);
  state.combat.enemies = state.combat.enemies.filter((e) => !e.id.startsWith('rc:'));
  return rc.length;
}

/** Repaired and powered (the beam stage is covered on its own). */
function powered(sim: Simulation): void {
  sim.state.guild.relays.set('A', { stage: 'repaired', sector: site.sector, tick: sim.state.tick });
  sim.state.sites.powered.add(site.id);
}

describe('relay offer', () => {
  const station = nearestStation(site);

  it('is pinned at stations in range from Guild level 2, the nearest site', () => {
    const sim = flying();
    const state = sim.state;
    expect(dist(station.pos, site.pos)).toBeLessThanOrEqual(RELAY_CHAIN.offerRange);
    expect(currentBoard(state, station).offers.some((o) => o.type === 'relay')).toBe(false);
    guildLevel(state, 2);
    const offer = currentBoard(state, station).offers.find((o) => o.type === 'relay')!;
    expect(offer.id).toMatch(/\.relay$/);
    expect(offer.faction).toBe('guild');
    expect(offer.risk).toBe(RELAY_CHAIN.risk);
    expect(offer.ring).toBe(site.depth);
    expect(offer.target).toEqual({ kind: 'relay', lane: 'A', relay: 'gr:A', sector: site.sector, pos: site.pos });
  });

  it('is not offered out of range, for a secured lane, or while a relay contract is active', () => {
    const sim = flying();
    const state = sim.state;
    guildLevel(state, 2);
    const ctx = boardContext(state, station);
    expect(relayOffer({ ...ctx, relays: [site], station: { ...station, pos: { x: site.pos.x + RELAY_CHAIN.offerRange + 10, y: site.pos.y } } })).toBeNull();
    expect(relayOffer({ ...ctx, relays: [site], unlocks: new Set() })).toBeNull();
    const c = accept(sim);
    expect(relayContractSites(state)).toEqual([]);
    expect(relayOfferAvailable(state, c.target as Extract<Contract['target'], { kind: 'relay' }>)).toBe(false);
    state.career.contracts = [];
    state.guild.relays.set('A', { stage: 'secured', sector: site.sector, tick: 1 });
    expect(relayContractSites(state).map((s) => s.lane)).not.toContain('A');
    const again = relayOffer(boardContext(state, station));
    expect(again === null || (again.target.kind === 'relay' && again.target.lane !== 'A')).toBe(true);
  });

  it('a stored slip is unavailable once the lane is secured or another relay contract is active', () => {
    const sim = flying();
    const state = sim.state;
    guildLevel(state, 2);
    // two boards in range carry a lane-A slip (stored – fixed for the epoch)
    const r = Math.ceil(RELAY_CHAIN.offerRange / 200);
    const near = stationsInArea(SEED, chunkCoord(site.pos.x) - r, chunkCoord(site.pos.x) + r, chunkCoord(site.pos.y) - r, chunkCoord(site.pos.y) + r)
      .map((st) => ({ st, slip: ensureBoard(state, st).offers.find((o) => o.target.kind === 'relay' && o.target.lane === 'A') }))
      .filter((x) => x.slip);
    expect(near.length).toBeGreaterThanOrEqual(2);
    const [a, b] = near as { st: StationDef; slip: NonNullable<(typeof near)[number]['slip']> }[];
    const c = acceptOffer(state, a!.st, a!.slip.id);
    expect(typeof c).not.toBe('string');
    // another relay contract is active
    expect(acceptOffer(state, b!.st, b!.slip.id)).toBe('contractUnavailable');
    // the lane secured since the slip was posted
    state.career.contracts = [];
    state.guild.relays.set('A', { stage: 'secured', sector: site.sector, tick: state.tick });
    expect(acceptOffer(state, b!.st, b!.slip.id)).toBe('contractUnavailable');
    expect(state.career.contracts).toEqual([]);
  });

  it('quotes travel, the work and the fight', () => {
    const t = { kind: 'relay' as const, lane: 'A' as const, relay: 'gr:A', sector: site.sector, pos: site.pos };
    expect(relaySeconds(site.pos, t)).toBeGreaterThan(200);
    expect(relaySeconds({ x: site.pos.x - 1000, y: site.pos.y }, t) - relaySeconds(site.pos, t)).toBeCloseTo(2000 / 25);
  });
});

describe('relay repair (stage 1)', () => {
  it('F at the broken mast takes the materials from the ship cargo, not the storage', () => {
    const sim = flying();
    const c = accept(sim);
    const state = sim.state;
    const it0 = relayInteraction(state)!;
    expect(it0).toEqual({ kind: 'relayRepair', contract: c.serial, lane: 'A', pos: site.pos });
    // nothing in the hold
    expect(interactRelay(state, it0)).toEqual([{ type: 'interactFailed', contractId: c.serial, reason: 'notEnoughResources' }]);
    expect(relayStage(state, 'A')).toBe('broken');
    fillRepair(state);
    state.player.cargo.iron += 5;
    const ev = run(sim, 1, { dock: true });
    expect(ofType(ev, 'relayRepaired')).toEqual([{ type: 'relayRepaired', lane: 'A' }]);
    expect(relayStage(state, 'A')).toBe('repaired');
    expect(state.player.cargo.iron).toBeCloseTo(5);
    expect(state.player.cargo.copper).toBeCloseTo(0);
    expect(state.player.cargo.titanium).toBeCloseTo(0);
    expect(state.career.contracts[0]!.progress).toBe(1);
    // repaired – nothing more to do with F
    expect(relayInteraction(state)).toBeNull();
  });

  it('takes raw units first (the refined sub-account is clamped to what is left)', () => {
    const sim = flying();
    accept(sim);
    const state = sim.state;
    fillRepair(state);
    state.player.cargo.iron += 20;
    state.player.refined.iron = 30;
    interactRelay(state, relayInteraction(state)!);
    expect(state.player.cargo.iron).toBeCloseTo(20);
    expect(state.player.refined.iron).toBeCloseTo(20);
  });

  it('is out of reach away from the mast and without a contract', () => {
    const sim = flying({ x: site.pos.x - 60, y: site.pos.y });
    accept(sim);
    expect(relayInteraction(sim.state)).toBeNull();
    const other = flying();
    expect(relayInteraction(other.state)).toBeNull();
  });
});

describe('relay power (stage 2)', () => {
  const beam = (): MiningBeam => {
    const lens = receiverPos(site.relay);
    return { laser: 0, from: { x: lens.x - 10, y: lens.y + 0.3 }, to: { x: lens.x + 0.2, y: lens.y }, asteroidId: null, resource: null, bonus: 1, vein: null };
  };
  const charge = (state: SimState): SimEvent[] => {
    const events: SimEvent[] = [];
    for (let i = 0; i < Math.round(RELAY.powerSeconds * TICKS) + 2; i++) {
      state.player.beams = [beam()];
      stepRelays(state, relayCandidates(state), events, 1 / TICKS);
    }
    return events;
  };

  it('cannot be charged before the repair; after it a beam powers it and the hold arms', () => {
    const sim = flying();
    const state = sim.state;
    expect(ofType(charge(state), 'relayPowered')).toEqual([]);
    expect(state.sites.powered.has(site.id)).toBe(false);
    state.guild.relays.set('A', { stage: 'repaired', sector: site.sector, tick: 0 });
    expect(ofType(charge(state), 'relayPowered')).toEqual([{ type: 'relayPowered', id: 'gr:A', site: 'gr:A', lit: 1 }]);
    const ev = steps(sim, 1);
    expect(relayStage(state, 'A')).toBe('powered');
    expect(state.guild.hold).toEqual({ lane: 'A', start: state.tick - 1 + RELAY_CHAIN.counterattackDelay * TICKS, phase: 'warning', reinforced: false });
    expect(ofType(ev, 'relayHoldStarted')).toEqual([{ type: 'relayHoldStarted', lane: 'A', at: counterattackPoint(site) }]);
  });
});

describe('relay hold (stage 3)', () => {
  it('the counterattack comes after the warning, 320 u out; killing it secures the sector and readies the contract', () => {
    const sim = flying();
    const c = accept(sim);
    const state = sim.state;
    powered(sim);
    steps(sim, 1);
    expect(state.guild.hold?.phase).toBe('warning');
    expect(relaySpawns(state)).toEqual([]);
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS - 2);
    expect(state.guild.hold?.phase).toBe('warning');
    steps(sim, 2);
    expect(state.guild.hold?.phase).toBe('fight');
    // careerSpawns adds the party at the next spawn check
    steps(sim, SPAWN_CHECK_INTERVAL);
    const rc = state.combat.enemies.filter((e) => e.id.startsWith('rc:A:'));
    expect(rc.map((e) => e.kind)).toEqual([...RELAY_CHAIN.party[2]]);
    for (const e of rc) {
      expect(dist(e.body.pos, site.pos)).toBeGreaterThan(RELAY_CHAIN.counterattackDistance - 20);
      expect(e.ai.mode).toBe('attack');
    }
    // away from home
    expect(Math.hypot(rc[0]!.body.pos.x, rc[0]!.body.pos.y)).toBeGreaterThan(Math.hypot(site.pos.x, site.pos.y));
    expect(c.progress).toBe(2);
    // the reinforcement call
    steps(sim, RELAY_CHAIN.watchArrive * TICKS);
    expect(state.guild.hold?.reinforced).toBe(true);
    // two down: not yet
    const [first, second] = state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
    for (const e of [first!, second!]) state.combat.defeated.set(e.id, state.tick);
    state.combat.enemies = state.combat.enemies.filter((e) => e !== first && e !== second);
    expect(ofType(steps(sim, 1), 'sectorSecured')).toEqual([]);
    killParty(state);
    const ev = steps(sim, 1);
    expect(ofType(ev, 'sectorSecured')).toEqual([{ type: 'sectorSecured', lane: 'A', sector: site.sector }]);
    expect(ofType(ev, 'contractReady')).toEqual([{ type: 'contractReady', contractId: c.serial }]);
    expect(relayStage(state, 'A')).toBe('secured');
    expect(state.guild.hold).toBeNull();
    expect(state.sites.powered.has('gr:A')).toBe(true);
    expect(c.progress).toBe(3);
    // the sector is Guarded now (T1's security overrides)
    expect(securityHere(state, site.pos)).toBe('guarded');
    // never offered again
    expect(relayContractSites(state).some((s) => s.lane === 'A')).toBe(false);
  });

  it('a ship that fled beyond 600 u counts as gone and leaves', () => {
    const sim = flying();
    const state = sim.state;
    powered(sim);
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    const rc = state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
    expect(rc).toHaveLength(3);
    const runner = rc[0]!;
    for (const e of rc.slice(1)) state.combat.defeated.set(e.id, state.tick);
    state.combat.enemies = state.combat.enemies.filter((e) => e === runner || !e.id.startsWith('rc:'));
    runner.ai.mode = 'flee';
    runner.body = { ...runner.body, pos: { x: site.pos.x + 650, y: site.pos.y } };
    const ev = steps(sim, 1);
    expect(ofType(ev, 'sectorSecured')).toHaveLength(1);
    expect(runner.ai.mode).toBe('retreat');
    expect(state.combat.defeated.has(runner.id)).toBe(true);
  });

  it('death or leaving interrupts the hold without failing; coming back within 400 u re-arms it', () => {
    const sim = flying();
    const c = accept(sim);
    const state = sim.state;
    powered(sim);
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    expect(state.guild.hold?.phase).toBe('fight');
    // flying away beyond the hold radius
    teleport(sim, { x: site.pos.x - RELAY_CHAIN.holdRadius - 50, y: site.pos.y });
    const ev = steps(sim, 2);
    expect(state.guild.hold?.phase).toBe('idle');
    expect(ofType(ev, 'contractFailed')).toEqual([]);
    for (const e of state.combat.enemies.filter((x) => x.id.startsWith('rc:'))) expect(e.ai.mode).toBe('retreat');
    // between the re-arm and the hold radius: still idle
    teleport(sim, { x: site.pos.x - 600, y: site.pos.y });
    steps(sim, 5);
    expect(state.guild.hold?.phase).toBe('idle');
    // back near the mast: a new warning, then the same counterattack (the leavers despawned, none was shot down)
    teleport(sim, { x: site.pos.x - 8, y: site.pos.y });
    state.combat.enemies = state.combat.enemies.filter((e) => !e.id.startsWith('rc:'));
    const back = steps(sim, 1);
    expect(ofType(back, 'relayHoldStarted')).toHaveLength(1);
    expect(state.guild.hold?.phase).toBe('warning');
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    expect(state.guild.hold?.phase).toBe('fight');
    expect(state.combat.enemies.filter((e) => e.id.startsWith('rc:'))).toHaveLength(3);
    // the player dies: interrupted again, the contract stays
    state.player.destroyed = true;
    steps(sim, 1);
    expect(state.guild.hold?.phase).toBe('idle');
    expect(state.career.contracts).toContain(c);
    expect(c.ready).toBe(false);
  });

  it('a re-armed hold brings back only the ships not shot down – no fresh party, no loot twice (G1)', () => {
    const sim = flying();
    const state = sim.state;
    powered(sim);
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    const rc = state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
    expect(rc).toHaveLength(3);
    // two shot down, the third survives
    const [a, b, survivor] = rc;
    for (const e of [a!, b!]) state.combat.defeated.set(e.id, state.tick);
    state.combat.enemies = state.combat.enemies.filter((e) => e !== a && e !== b);
    for (let cycle = 0; cycle < 2; cycle++) {
      // out beyond the hold radius (the survivor leaves and despawns), then long enough for the
      // 20 min respawn of `combat.defeated` to have run out
      teleport(sim, { x: site.pos.x - RELAY_CHAIN.holdRadius - 50, y: site.pos.y });
      steps(sim, 2);
      expect(state.guild.hold?.phase).toBe('idle');
      state.combat.enemies = state.combat.enemies.filter((e) => !e.id.startsWith('rc:'));
      for (const e of [a!, b!]) if (state.combat.defeated.has(e.id)) state.combat.defeated.set(e.id, state.tick - RESPAWN_TICKS);
      steps(sim, SPAWN_CHECK_INTERVAL);
      // back: the hold re-arms, only the survivor comes back
      teleport(sim, { x: site.pos.x - 8, y: site.pos.y });
      steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
      expect(state.guild.hold?.phase).toBe('fight');
      expect(state.combat.enemies.filter((e) => e.id.startsWith('rc:')).map((e) => e.id)).toEqual([survivor!.id]);
      expect(relaySpawns(state).filter((s) => !state.combat.defeated.has(s.id)).map((s) => s.id)).toEqual([survivor!.id]);
    }
    // the survivor shot down: the sector is secured
    killParty(state);
    expect(ofType(steps(sim, 1), 'sectorSecured')).toHaveLength(1);
  });

  it('a ship shot down while it leaves an interrupted hold stays down', () => {
    const sim = flying();
    const state = sim.state;
    powered(sim);
    steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    teleport(sim, { x: site.pos.x - RELAY_CHAIN.holdRadius - 50, y: site.pos.y });
    steps(sim, 2);
    expect(state.guild.hold?.phase).toBe('idle');
    expect(killParty(state)).toBe(3);
    teleport(sim, { x: site.pos.x - 8, y: site.pos.y });
    const ev = steps(sim, RELAY_CHAIN.counterattackDelay * TICKS + 2 + SPAWN_CHECK_INTERVAL);
    expect(state.combat.enemies.filter((e) => e.id.startsWith('rc:'))).toEqual([]);
    expect(ofType(ev, 'sectorSecured')).toHaveLength(1);
  });

  it('a slip accepted after the lane was secured never pays', () => {
    const sim = flying();
    const c = accept(sim);
    const state = sim.state;
    state.guild.relays.set('A', { stage: 'secured', sector: site.sector, tick: c.acceptedTick - 1 });
    steps(sim, 1);
    expect(c.ready).toBe(false);
  });

  it('the dev command secures a lane now', () => {
    const sim = flying();
    const ev = debugSecureRelay(sim.state, { type: 'debugGuild', what: 'secure', lane: 'A', reqId: 7 });
    expect(ev).toEqual([
      { type: 'actionResult', reqId: 7, ok: true },
      { type: 'sectorSecured', lane: 'A', sector: site.sector },
    ]);
    expect(relayStage(sim.state, 'A')).toBe('secured');
    expect(debugSecureRelay(sim.state, { type: 'debugGuild', what: 'secure', lane: 'A', reqId: 8 })[0]).toMatchObject({ ok: false });
  });

  it('is deterministic: the same commands give the same state', () => {
    const digest = (sim: Simulation): string => {
      const s = sim.state;
      return JSON.stringify({
        tick: s.tick,
        relays: [...s.guild.relays],
        hold: s.guild.hold,
        powered: [...s.sites.powered].sort(),
        enemies: s.combat.enemies.map((e) => [e.id, e.body.pos, e.ai.mode, [...e.hp]]),
        player: [s.player.body.pos, s.player.cargo, s.player.destroyed],
        contracts: s.career.contracts.map((c) => [c.serial, c.progress, c.ready]),
      });
    };
    const play = (): Simulation => {
      const sim = flying();
      accept(sim);
      fillRepair(sim.state);
      run(sim, 1, { dock: true });
      sim.state.sites.powered.add(site.id);
      run(sim, RELAY_CHAIN.counterattackDelay * TICKS + 240);
      return sim;
    };
    const a = play();
    const b = play();
    expect(a.state.guild.hold?.phase).toBe('fight');
    expect(digest(a)).toBe(digest(b));
  });
});

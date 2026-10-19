// The escort contract (M4d plan §2.7, T6): the offer, the deposit, the convoy's flight, the ambushes,
// every failure, the success and its turn-in, and a P2 ship winning an escort at both risk levels.
import { describe, expect, it } from 'vitest';
import { ESCORT } from '../../data/convoys';
import { FREE_CANCEL_TICKS, type ContractRisk } from '../../data/contracts';
import type { RepUnlock } from '../../data/factions';
import type { ContractOffer, Contract } from '../career/types';
import { careerSpawns } from '../career/career';
import { createEnemy } from '../combat/enemies';
import { steerTo } from '../combat/ai';
import { leadPoint } from '../combat/weapons';
import { IDLE_COMMAND, type GameActionInput, type GameAction, type PlayerCommand } from '../commands';
import { boardContext, boardEpoch, cancelIsFree, ensureBoard } from '../contracts/board';
import { generateBoard, type ContractDraft } from '../contracts/generate';
import { teleport } from '../discovery/testing';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { canHit } from '../npc/sides';
import { NO_SECURITY_OVERRIDES, isDangerousSecurity, sectorIdAt, sectorSecurity } from '../regions';
import { createGrid } from '../ship/grid';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { stationsInArea, type StationDef } from '../world/stations';
import {
  AMBUSH_LEAD,
  escortAmbushId,
  escortAvailable,
  escortColliders,
  escortDepositOf,
  escortHasTanker,
  escortHitTargets,
  escortOffer,
  escortSpawns,
  onConvoyHit,
} from './escort';
import type { EscortState } from './types';

type EscortTarget = Extract<ContractOffer['target'], { kind: 'escort' }>;

/** Empty space (no asteroids, no station hulls): the escort's rules alone – pirates still spawn by the seed. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

const UNLOCKS = new Set<RepUnlock>(['contractsBasic', 'contractsRing1', 'contractsRing2']);
const SEED = 11;

/** Stations within reach of a lane, nearest to home first. */
function laneStations(seed: number): StationDef[] {
  const sim = new Simulation({ seed });
  return stationsInArea(seed, -30, 30, -30, 30)
    .filter((s) => escortAvailable(boardContext(sim.state, s)))
    .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
}

/** The first escort draft at a lane station of `seed` that `want` accepts (slip rngs 1, 2, …). */
function findDraft(seed: number, want: (d: ContractDraft) => boolean = () => true): { station: StationDef; draft: ContractDraft; roll: number } {
  const sim = new Simulation({ seed });
  for (const station of laneStations(seed)) {
    const ctx = { ...boardContext(sim.state, station), unlocks: UNLOCKS };
    for (let roll = 1; roll <= 60; roll++) {
      const draft = escortOffer(ctx, createRng(roll));
      if (draft && want(draft)) return { station, draft, roll };
    }
  }
  throw new Error(`no escort draft for seed ${seed}`);
}

const targetOf = (c: { target: ContractOffer['target'] }): EscortTarget => {
  if (c.target.kind !== 'escort') throw new Error('not an escort');
  return c.target;
};

const act = (sim: Simulation, action: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...action, reqId: 1 } as GameAction] });

interface Escort {
  sim: Simulation;
  contract: Contract;
  t: EscortTarget;
  station: StationDef;
  events: SimEvent[];
}

/** An accepted escort contract (the slip put on the station's board, the player docked there). */
function acceptEscort(opts: { seed?: number; risk?: ContractRisk; credits?: number; tanker?: boolean; grid?: ReturnType<typeof createGrid> } = {}): Escort {
  const seed = opts.seed ?? SEED;
  const sim = new Simulation({ seed, startDocked: true, generator: emptySpace, ...(opts.grid ? { grid: opts.grid } : {}) });
  const { station, draft } = findDraft(seed, (d) => opts.risk === undefined || d.risk === opts.risk);
  // the slip's serial picks the tanker (escortHasTanker hashes the offer id)
  let id = '';
  for (let k = 90; k < 140 && !id; k++) {
    const offerId = `${station.id}@${boardEpoch(sim.state.tick)}.${k}`;
    if (opts.tanker === undefined || escortHasTanker(seed, offerId) === opts.tanker) id = offerId;
  }
  if (!id) throw new Error('no escort with the wanted tanker');
  const offer: ContractOffer = { id, type: 'escort', faction: 'guild', station: station.id, ring: draft.ring, risk: draft.risk, target: draft.target, modifiers: [], bonus: 0, part: null };
  sim.state.player.dock = { mode: 'docked', stationId: station.id };
  ensureBoard(sim.state, station).offers = [offer];
  sim.state.credits = opts.credits ?? 50_000;
  const events = act(sim, { type: 'acceptContract', offerId: id });
  const contract = sim.state.career.contracts.find((c) => c.id === id);
  if (!contract) throw new Error(`not accepted: ${JSON.stringify(events.find((e) => e.type === 'actionResult'))}`);
  return { sim, contract, t: targetOf(contract), station, events };
}

const record = (x: Escort): EscortState | undefined => x.sim.state.convoys.escorts.get(x.contract.serial);
const trader = (sim: Simulation, serial: number) => escortHitTargets(sim.state).find((t) => t.id === `es:${serial}:trader`);

/** Flying, stopped, at `pos`. */
function flyTo(sim: Simulation, pos: Vec2): void {
  sim.state.player.dock = { mode: 'flying' };
  teleport(sim, pos);
}

/** Steps with the ship carried `gap` u beside the trader (no piloting); pirates other than the ambushers are removed. */
function ride(x: Escort, steps: number, gap = 60, until?: (events: SimEvent[]) => boolean): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const tr = trader(x.sim, x.contract.serial);
    if (tr) {
      const p = x.sim.state.player;
      p.body = { pos: { x: tr.pos.x, y: tr.pos.y + gap }, vel: { ...(tr.vel ?? { x: 0, y: 0 }) }, angle: 0, angVel: 0 };
      p.prevBody = p.body;
      x.sim.state.world.update(p.body.pos);
    }
    x.sim.state.combat.enemies = x.sim.state.combat.enemies.filter((e) => e.id.startsWith('ea:'));
    const ev = x.sim.step(IDLE_COMMAND);
    out.push(...ev);
    if (until?.(ev)) break;
  }
  return out;
}

/** Meet the convoy: fly beside it, one step → departed. */
function meet(x: Escort): SimEvent[] {
  flyTo(x.sim, { x: x.t.meet.x, y: x.t.meet.y + 60 });
  return ride(x, 1);
}

const failed = (events: SimEvent[]) => events.find((e) => e.type === 'contractFailed');

// ---------------------------------------------------------------------------

describe('escort offer', () => {
  it('only at stations near a lane; the stretch lies on one route leg, 2 000–4 000 u, through a dangerous sector', () => {
    for (const seed of [1, 4, 11, 19]) {
      const sim = new Simulation({ seed });
      const stations = stationsInArea(seed, -30, 30, -30, 30);
      let offers = 0;
      for (const station of stations) {
        const ctx = { ...boardContext(sim.state, station), unlocks: UNLOCKS };
        for (let roll = 1; roll <= 6; roll++) {
          const d = escortOffer(ctx, createRng(roll));
          if (!escortAvailable(ctx)) {
            expect(d, station.id).toBeNull();
            continue;
          }
          if (!d) continue;
          offers++;
          const t = targetOf(d);
          const len = t.to - t.from;
          expect(len).toBeGreaterThanOrEqual(ESCORT.segment[0] - 1e-6);
          expect(len).toBeLessThanOrEqual(ESCORT.segment[1] + 1e-6);
          expect(Math.hypot(t.meet.x - station.pos.x, t.meet.y - station.pos.y)).toBeLessThan(ESCORT.offerRange + 200);
          expect(t.ambushes.length).toBe(d.risk === 0.5 ? 2 : 1);
          expect(d.risk === 0.25 || d.risk === 0.5).toBe(true);
          for (const s of t.ambushes) {
            expect(s).toBeGreaterThan(t.from);
            expect(s).toBeLessThan(t.to);
          }
          if (t.ambushes.length === 2) expect(t.ambushes[1]! - t.ambushes[0]!).toBeGreaterThanOrEqual(ESCORT.ambushSpacing);
          // the first ambush point (`where`) lies in a dangerous sector by the security now
          expect(isDangerousSecurity(sectorSecurity(seed, sectorIdAt(seed, d.where.x, d.where.y), NO_SECURITY_OVERRIDES))).toBe(true);
          expect(d.ring === 1 || d.ring === 2).toBe(true);
        }
      }
      expect(offers, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('is deterministic from the slip rng; both risk levels occur', () => {
    const a = findDraft(SEED);
    const ctx = { ...boardContext(new Simulation({ seed: SEED }).state, a.station), unlocks: UNLOCKS };
    expect(escortOffer(ctx, createRng(a.roll))).toEqual(a.draft);
    expect(findDraft(SEED, (d) => d.risk === 0.25).draft.risk).toBe(0.25);
    expect(findDraft(SEED, (d) => d.risk === 0.5).draft.risk).toBe(0.5);
  });

  it('follows the current security: with every Contested lane sector secured only Pirate sectors carry ambushes', () => {
    const { station } = findDraft(SEED);
    const sim = new Simulation({ seed: SEED });
    const base = { ...boardContext(sim.state, station), unlocks: UNLOCKS };
    const all = new Set<string>();
    for (let x = -6000; x <= 6000; x += 100) for (let y = -6000; y <= 6000; y += 100) all.add(sectorIdAt(SEED, x, y));
    const security = { destroyedFortresses: new Set<string>(), secured: all };
    for (let roll = 1; roll <= 20; roll++) {
      const d = escortOffer({ ...base, security }, createRng(roll));
      if (!d) continue;
      for (const s of targetOf(d).ambushes) expect(s).toBeGreaterThan(0);
      expect(sectorSecurity(SEED, sectorIdAt(SEED, d.where.x, d.where.y), security)).toBe('pirate');
    }
  });

  it('needs the ring unlock', () => {
    const { station, roll } = findDraft(SEED);
    const ctx = { ...boardContext(new Simulation({ seed: SEED }).state, station), unlocks: new Set<RepUnlock>(['contractsBasic']) };
    expect(escortOffer(ctx, createRng(roll))).toBeNull();
  });

  it('the board rolls escorts at lane stations', () => {
    const sim = new Simulation({ seed: SEED });
    const station = laneStations(SEED)[0]!;
    let escorts = 0;
    for (let epoch = 0; epoch < 30; epoch++) {
      const board = generateBoard({ ...boardContext(sim.state, station), unlocks: UNLOCKS, epoch });
      escorts += board.offers.filter((o) => o.type === 'escort').length;
    }
    expect(escorts).toBeGreaterThan(0);
  });
});

describe('escort deposit', () => {
  it('takes 10 % of the frozen reward on acceptance; the convoy waits at the meeting point', () => {
    const x = acceptEscort();
    const deposit = escortDepositOf(x.contract.reward);
    expect(deposit).toBeGreaterThan(0);
    expect(x.sim.state.credits).toBe(50_000 - deposit);
    expect(x.events).toContainEqual({ type: 'creditsChanged', delta: -deposit, reason: 'contract' });
    const e = record(x)!;
    expect(e).toMatchObject({ state: 'waiting', progress: x.t.from, departed: null, fired: 0, deposit });
    expect(e.hulls[0]).toBe(ESCORT.traderHull);
    const tr = trader(x.sim, x.contract.serial)!;
    expect(Math.hypot(tr.pos.x - x.t.meet.x, tr.pos.y - x.t.meet.y)).toBeLessThan(1e-6);
  });

  it('a free cancel within 2 min gives it back; a later cancel loses it and fails the contract', () => {
    const free = acceptEscort();
    const deposit = escortDepositOf(free.contract.reward);
    expect(cancelIsFree(free.sim.state, free.contract)).toBe(true);
    let ev = act(free.sim, { type: 'abandonContract', contractId: free.contract.serial });
    expect(ev).toContainEqual({ type: 'creditsChanged', delta: deposit, reason: 'contract' });
    expect(failed(ev)).toBeUndefined();
    expect(free.sim.state.credits).toBe(50_000);
    expect(free.sim.state.convoys.escorts.size).toBe(0);

    const late = acceptEscort();
    late.sim.state.tick += FREE_CANCEL_TICKS + 60;
    ev = act(late.sim, { type: 'abandonContract', contractId: late.contract.serial });
    expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: late.contract.serial, reason: 'abandoned' });
    expect(ev.some((e) => e.type === 'creditsChanged')).toBe(false);
    expect(late.sim.state.credits).toBe(50_000 - deposit);
    expect(late.sim.state.convoys.escorts.size).toBe(0);
  });

  it('no free cancel once the convoy has departed or an ambush fired: the deposit is lost, the slip stays off the board (G2)', () => {
    for (const how of ['departed', 'fired'] as const) {
      const x = acceptEscort();
      const deposit = escortDepositOf(x.contract.reward);
      if (how === 'departed') {
        meet(x);
        expect(record(x)!.state).toBe('moving');
      } else {
        record(x)!.fired = 1;
      }
      expect(x.sim.state.tick - x.contract.acceptedTick).toBeLessThan(FREE_CANCEL_TICKS);
      expect(cancelIsFree(x.sim.state, x.contract)).toBe(false);
      const ev = act(x.sim, { type: 'abandonContract', contractId: x.contract.serial });
      expect(ev).toContainEqual({ type: 'contractAbandoned', contractId: x.contract.serial, refunded: false });
      expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: x.contract.serial, reason: 'abandoned' });
      expect(ev.some((e) => e.type === 'creditsChanged')).toBe(false);
      expect(x.sim.state.credits).toBe(50_000 - deposit);
      expect(ensureBoard(x.sim.state, x.station).offers.some((o) => o.id === x.contract.id)).toBe(false);
    }
  });

  it('a poor pilot pays what he has and gets back only that', () => {
    const x = acceptEscort({ credits: 20 });
    expect(x.sim.state.credits).toBe(0);
    expect(record(x)!.deposit).toBe(20);
    act(x.sim, { type: 'abandonContract', contractId: x.contract.serial });
    expect(x.sim.state.credits).toBe(20);
  });
});

describe('escort flight', () => {
  it('waits until the player comes within 150 u, then departs and flies the stretch at 10 u/s', () => {
    const x = acceptEscort();
    flyTo(x.sim, { x: x.t.meet.x, y: x.t.meet.y + ESCORT.departRadius + 30 });
    let ev = ride(x, 60, ESCORT.departRadius + 30);
    expect(record(x)!.state).toBe('waiting');
    expect(ev.some((e) => e.type === 'escortDeparted')).toBe(false);
    ev = ride(x, 1, ESCORT.departRadius - 10);
    expect(ev).toContainEqual({ type: 'escortDeparted', serial: x.contract.serial });
    const e = record(x)!;
    expect(e.state).toBe('moving');
    ride(x, 60);
    expect(e.progress - x.t.from).toBeCloseTo(ESCORT.speed, 3);
    expect(trader(x.sim, x.contract.serial)!.vel).toBeDefined();
    expect(Math.hypot(trader(x.sim, x.contract.serial)!.vel!.x, trader(x.sim, x.contract.serial)!.vel!.y)).toBeCloseTo(ESCORT.speed, 6);
  });

  it('stops while a pirate is within 250 u of the trader and resumes 5 s after it left', () => {
    const x = acceptEscort();
    meet(x);
    const e = record(x)!;
    const tr = trader(x.sim, x.contract.serial)!;
    const pirate = createEnemy({ id: 'ea:999:0:0', kind: 'jackal', tier: 1, pos: { x: tr.pos.x + 200, y: tr.pos.y }, angle: 0, home: { x: tr.pos.x + 200, y: tr.pos.y }, orbit: 1 });
    pirate.ai.mode = 'dormant';
    x.sim.state.combat.enemies.push(pirate);
    // a dormant sleeper does not stop it
    ride(x, 2);
    expect(e.state).toBe('moving');
    pirate.ai.mode = 'patrol';
    const ev = ride(x, 2);
    expect(ev).toContainEqual({ type: 'escortStopped', serial: x.contract.serial });
    expect(e.state).toBe('stopped');
    const at = e.progress;
    x.sim.state.combat.enemies = [];
    ride(x, ESCORT.resumeSeconds * 60 - 5);
    expect(e.progress).toBe(at);
    ride(x, 10);
    expect(e.state).toBe('moving');
    expect(e.progress).toBeGreaterThan(at);
  });

  it('is a moving obstacle and a damageable target with its velocity; player shots pass through it', () => {
    const x = acceptEscort({ tanker: true });
    meet(x);
    const targets = escortHitTargets(x.sim.state);
    expect(targets.map((t) => t.id)).toEqual([`es:${x.contract.serial}:trader`, `es:${x.contract.serial}:tanker`]);
    for (const t of targets) {
      expect(t).toMatchObject({ kind: 'convoy', damageable: true, shield: 0 });
      expect(t.vel).toBeDefined();
      expect(canHit('player', t.id)).toBe(false);
      expect(canHit('pr:1,1:0', t.id)).toBe(true);
    }
    const tr = targets[0]!;
    const circles = escortColliders(x.sim.state, tr.pos, 20);
    expect(circles.length).toBeGreaterThan(3);
    expect(circles.every((c) => c.safe)).toBe(true);
    expect(escortColliders(x.sim.state, { x: tr.pos.x + 500, y: tr.pos.y }, 20)).toHaveLength(0);
  });

  it('pirate hits damage the escort hull (npcHit, npcDestroyed); a scheduled convoy ship only stops the shot', () => {
    const x = acceptEscort({ tanker: true });
    const [tr, tk] = escortHitTargets(x.sim.state);
    const events: SimEvent[] = [];
    const hit = { owner: 'pr:1,1:0', pos: { ...tk!.pos }, damage: 100, from: { x: 0, y: 0 } };
    onConvoyHit(x.sim.state, tk!, hit, events);
    expect(record(x)!.hulls[1]).toBe(ESCORT.tankerHull - 100);
    expect(events).toContainEqual({ type: 'npcHit', id: tk!.id, pos: hit.pos, damage: 100, shielded: false, by: 'pr:1,1:0' });
    onConvoyHit(x.sim.state, tk!, { ...hit, damage: 1000 }, events);
    expect(events.some((e) => e.type === 'npcDestroyed' && e.id === tk!.id && e.kind === 'tanker')).toBe(true);
    expect(escortHitTargets(x.sim.state).map((t) => t.id)).toEqual([tr!.id]);
    const spent: SimEvent[] = [];
    onConvoyHit(x.sim.state, { id: 'cv:A@3:trader', kind: 'convoy', pos: { x: 1, y: 2 }, radius: 2, shield: 0, damageable: false }, hit, spent);
    expect(spent).toEqual([{ type: 'projectileHit', target: 'station', owner: 'pr:1,1:0', ref: null, pos: hit.pos, damage: 100, from: hit.from, site: 'cv:A@3:trader' }]);
  });
});

describe('escort ambushes', () => {
  it('each party is armed once before its point and spawned for careerSpawns in attack mode, going for the trader', () => {
    const x = acceptEscort({ risk: 0.5 });
    meet(x);
    const e = record(x)!;
    expect(x.t.ambushes).toHaveLength(2);
    e.progress = x.t.ambushes[0]! - AMBUSH_LEAD - 5;
    let ev = ride(x, 60, 60, (es) => es.some((q) => q.type === 'escortAmbush'));
    const first = ev.filter((q) => q.type === 'escortAmbush');
    expect(first).toHaveLength(1);
    expect(e.fired).toBe(1);
    const spawns = escortSpawns(x.sim.state);
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    expect(spawns.every((s) => s.id.startsWith(`ea:${x.contract.serial}:0:`))).toBe(true);
    expect(careerSpawns(x.sim.state).map((s) => s.id)).toEqual(expect.arrayContaining(spawns.map((s) => s.id)));
    const enemy = spawns[0]!.create();
    expect(enemy.ai.mode).toBe('attack');
    // the party comes in near the player (careerSpawns) and the convoy stops for it
    ev = ride(x, 120);
    expect(x.sim.state.combat.enemies.some((q) => q.id === escortAmbushId(x.contract.serial, 0, 0))).toBe(true);
    expect(ev.filter((q) => q.type === 'escortAmbush')).toHaveLength(0);
    // fought down: never back for this contract (combat.defeated), never armed again
    for (const q of x.sim.state.combat.enemies) x.sim.state.combat.defeated.set(q.id, x.sim.state.tick);
    x.sim.state.combat.enemies = [];
    ev = ride(x, 30);
    expect(x.sim.state.combat.enemies).toHaveLength(0);
    // the second party when the trader nears the second point
    e.progress = x.t.ambushes[1]! - AMBUSH_LEAD - 5;
    e.state = 'moving';
    ev = ride(x, 60, 60, (es) => es.some((q) => q.type === 'escortAmbush'));
    expect(ev.filter((q) => q.type === 'escortAmbush')).toHaveLength(1);
    expect(e.fired).toBe(3);
  });

  it('a fired mask is kept: a restored record with both bits set arms nothing', () => {
    const x = acceptEscort({ risk: 0.5 });
    meet(x);
    const e = record(x)!;
    e.fired = 3;
    e.progress = x.t.ambushes[1]! - AMBUSH_LEAD + 10;
    const ev = ride(x, 30);
    expect(ev.some((q) => q.type === 'escortAmbush')).toBe(false);
  });
});

describe('escort failures', () => {
  it('the trader destroyed → traderLost; the deposit is lost', () => {
    const x = acceptEscort();
    meet(x);
    const tr = trader(x.sim, x.contract.serial)!;
    onConvoyHit(x.sim.state, tr, { owner: 'pr:1,1:0', pos: tr.pos, damage: ESCORT.traderHull, from: tr.pos }, []);
    const ev = ride(x, 1);
    expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: x.contract.serial, reason: 'traderLost' });
    expect(x.sim.state.career.contracts).toHaveLength(0);
    expect(x.sim.state.convoys.escorts.size).toBe(0);
    expect(x.sim.state.career.log.at(-1)).toMatchObject({ kind: 'contractFailed', type: 'escort' });
  });

  it('away from the departed convoy for 60 s → abandoned; coming back in time resets the count', () => {
    const x = acceptEscort();
    meet(x);
    ride(x, 50 * 60, ESCORT.awayRadius + 50);
    expect(record(x)!.away).toBeGreaterThan(49);
    ride(x, 1, 60);
    expect(record(x)!.away).toBe(0);
    const ev = ride(x, 61 * 60, ESCORT.awayRadius + 50, (es) => !!failed(es));
    expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: x.contract.serial, reason: 'abandoned' });
  });

  it('the player destroyed → playerLost', () => {
    const x = acceptEscort();
    meet(x);
    const ev = x.sim.step({ ...IDLE_COMMAND, scuttle: true });
    expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: x.contract.serial, reason: 'playerLost' });
  });

  it('the meeting missed: 600 s after acceptance the waiting convoy gives up → missed', () => {
    const x = acceptEscort();
    x.sim.state.tick += ESCORT.waitSeconds * 60 - 2;
    let ev = x.sim.step(IDLE_COMMAND);
    expect(failed(ev)).toBeUndefined();
    ev = [...x.sim.step(IDLE_COMMAND), ...x.sim.step(IDLE_COMMAND)];
    expect(failed(ev)).toEqual({ type: 'contractFailed', contractId: x.contract.serial, reason: 'missed' });
  });
});

describe('escort success', () => {
  it('arrival → ready, the deposit back, the convoy flies on and leaves; turn-in pays the reward', () => {
    const x = acceptEscort();
    meet(x);
    const e = record(x)!;
    // past both ambushes (fired, fought) – straight to the end of the stretch
    e.fired = (1 << x.t.ambushes.length) - 1;
    e.progress = x.t.to - 20;
    const before = x.sim.state.credits;
    const deposit = escortDepositOf(x.contract.reward);
    let ev = ride(x, 3 * 60);
    expect(ev).toContainEqual({ type: 'contractReady', contractId: x.contract.serial });
    expect(ev).toContainEqual({ type: 'creditsChanged', delta: deposit, reason: 'contract' });
    expect(x.sim.state.credits).toBe(before + deposit);
    expect(x.sim.state.career.contracts[0]!.ready).toBe(true);
    ev = ride(x, (ESCORT.flyOnSeconds + 1) * 60);
    // flown on and gone: no ships, the record waits for the turn-in
    expect(escortHitTargets(x.sim.state)).toHaveLength(0);
    expect(record(x)!.state).toBe('done');
    expect(failed(ev)).toBeUndefined();
    // turn-in at any station
    const station = laneStations(SEED).at(-1)!;
    x.sim.state.player.dock = { mode: 'docked', stationId: station.id };
    const paid = x.sim.state.credits;
    ev = act(x.sim, { type: 'turnInContract', contractId: x.contract.serial });
    expect(ev).toContainEqual(expect.objectContaining({ type: 'contractCompleted', contractId: x.contract.serial, reward: x.contract.reward }));
    expect(x.sim.state.credits).toBe(paid + x.contract.reward);
    x.sim.step(IDLE_COMMAND);
    expect(x.sim.state.convoys.escorts.size).toBe(0);
  });

  it('is deterministic', () => {
    const runOnce = () => {
      const x = acceptEscort({ risk: 0.5 });
      meet(x);
      record(x)!.progress = x.t.ambushes[0]! - AMBUSH_LEAD - 50;
      const ev = ride(x, 40 * 60);
      return { escort: structuredClone(record(x)), events: ev.filter((q) => q.type.startsWith('escort') || q.type === 'npcHit').length, tick: x.sim.state.tick };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

// ---------------------------------------------------------------------------
// fairness: the econ main path's P2 ship (the M3 weapons package: 2 cannons, a shield, armour)

const p2Ship = () =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/** A plain escort pilot: keeps beside the trader, turns on any pirate near the convoy or itself and shoots it down. */
function pilot(x: Escort): PlayerCommand {
  const { state } = x.sim;
  const p = state.player;
  const tr = trader(x.sim, x.contract.serial);
  if (!tr) return IDLE_COMMAND;
  // the pirate nearest the trader when one is near it, else one that comes for the ship – never far from the convoy
  let foe: (typeof state.combat.enemies)[number] | null = null;
  let best = Infinity;
  const leash = Math.hypot(tr.pos.x - p.body.pos.x, tr.pos.y - p.body.pos.y) < 350;
  for (const e of leash ? state.combat.enemies : []) {
    const dt = Math.hypot(e.body.pos.x - tr.pos.x, e.body.pos.y - tr.pos.y);
    if (dt < 320 && dt < best) {
      best = dt;
      foe = e;
    }
  }
  if (!foe && leash) {
    for (const e of state.combat.enemies) {
      const dp = Math.hypot(e.body.pos.x - p.body.pos.x, e.body.pos.y - p.body.pos.y);
      if (dp < 150 && dp < best) {
        best = dp;
        foe = e;
      }
    }
  }
  if (foe) best = Math.hypot(foe.body.pos.x - p.body.pos.x, foe.body.pos.y - p.body.pos.y);
  const w = p.props.weapons[0];
  if (foe && w) {
    const aim = leadPoint(p.body.pos, p.body.vel, foe.body.pos, foe.body.vel, w.projectileSpeed);
    return { ...IDLE_COMMAND, flight: steerTo(p.body, aim, best > 60 ? 1 : 0.2), aim, fire: best < w.range * 0.95 };
  }
  const v = tr.vel ?? { x: 0, y: 0 };
  const at = { x: tr.pos.x + v.x * 3 - v.y * 4, y: tr.pos.y + v.y * 3 + v.x * 4 };
  const d = Math.hypot(at.x - p.body.pos.x, at.y - p.body.pos.y);
  return { ...IDLE_COMMAND, flight: steerTo(p.body, at, Math.min(1, Math.max(0, (d - 25) / 120))), aim: at };
}

/** A whole escort flown by `pilot`: 'ready' or the failure reason. */
function flyEscort(seed: number, risk: ContractRisk): { result: string; ambushes: number; seconds: number } {
  const x = acceptEscort({ seed, risk, grid: p2Ship() });
  flyTo(x.sim, { x: x.t.meet.x, y: x.t.meet.y + 40 });
  const limit = 20 * 60 * 60;
  let armed = 0;
  for (let i = 0; i < limit; i++) {
    const p = x.sim.state.player;
    p.fuel = p.props.fuelCapacity;
    const ev = x.sim.step(pilot(x));
    armed += ev.filter((e) => e.type === 'escortAmbush').length;
    if (ev.some((e) => e.type === 'contractReady')) return { result: 'ready', ambushes: armed, seconds: i / 60 };
    const f = failed(ev);
    if (f && f.type === 'contractFailed') return { result: f.reason, ambushes: armed, seconds: i / 60 };
  }
  return { result: 'timeout', ambushes: armed, seconds: limit / 60 };
}

describe('escort fairness (P2 ship)', () => {
  it('an escort at risk 0.25 and 0.5 is winnable with the P2 ship', () => {
    for (const seed of [SEED, 2, 10]) {
      for (const risk of [0.25, 0.5] as const) {
        const r = flyEscort(seed, risk);
        expect(r.result, `seed ${seed} risk ${risk}: ${JSON.stringify(r)}`).toBe('ready');
        expect(r.ambushes).toBe(risk === 0.5 ? 2 : 1);
      }
    }
  }, 240_000);
});

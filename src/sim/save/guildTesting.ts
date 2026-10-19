// Helpers of the M4d save tests (not used by the game): games in the middle of a relay hold, a Guild Watch
// fight, a convoy link and an escort contract – each built the same way every time (deterministic).
import type { RepUnlock } from '../../data/factions';
import { RELAY_CHAIN } from '../../data/guild';
import type { Contract, ContractOffer } from '../career/types';
import { createEnemy } from '../combat/enemies';
import type { EnemyKind } from '../combat/types';
import { IDLE_COMMAND, type GameAction, type PlayerCommand } from '../commands';
import { acceptOffer, boardContext, boardEpoch, currentBoard, ensureBoard } from '../contracts/board';
import { linkedTo } from '../convoys/convoyTesting';
import { escortAvailable, escortHitTargets, escortOffer } from '../convoys/escort';
import { convoyComposition } from '../convoys/schedule';
import { teleport } from '../discovery/testing';
import { manageWatch } from '../guild/watch';
import { guildRelaySite } from '../guild/relaySites';
import { routeById, scheduledAt } from '../guild/watchRoutes';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import { Simulation, type SimEvent } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { stationsInArea, type StationDef } from '../world/stations';

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- relay hold

export const RELAY_SEED = 1;

/** The station nearest to a lane's relay site (within the offer range). */
function relayStation(seed: number, lane: 'A' | 'B'): StationDef {
  const site = guildRelaySite(seed, lane)!;
  const r = Math.ceil(RELAY_CHAIN.offerRange / 200);
  const cx = chunkCoord(site.pos.x);
  const cy = chunkCoord(site.pos.y);
  return stationsInArea(seed, cx - r, cx + r, cy - r, cy + r).sort((a, b) => dist(a.pos, site.pos) - dist(b.pos, site.pos))[0]!;
}

/**
 * Flying 150 u from the Guild relay mast of lane A (seed 1), Guild level 2, the relay contract accepted at
 * the nearest station, the mast repaired and lit – the next step arms the hold (warning, then the fight).
 */
export function relayHoldGame(): { sim: Simulation; contract: Contract } {
  const sim = new Simulation({ seed: RELAY_SEED, startDocked: false });
  const state = sim.state;
  const site = guildRelaySite(RELAY_SEED, 'A')!;
  teleport(sim, { x: site.pos.x - 150, y: site.pos.y });
  state.career.rep.guild.level = 2;
  const station = relayStation(RELAY_SEED, 'A');
  const offer = currentBoard(state, station).offers.find((o) => o.type === 'relay');
  if (!offer) throw new Error('no relay offer');
  const contract = acceptOffer(state, station, offer.id);
  if (typeof contract === 'string') throw new Error(contract);
  state.guild.relays.set('A', { stage: 'repaired', sector: site.sector, tick: state.tick });
  state.sites.powered.add(site.id);
  return { sim, contract };
}

/** One step with only the relay counterattack around (no stray pirates of the sector). */
export function stepHold(sim: Simulation, cmd: PlayerCommand = IDLE_COMMAND): SimEvent[] {
  sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id.startsWith('rc:'));
  return sim.step(cmd);
}

// ---------------------------------------------------------------- Watch fight

export const WATCH_SEED = 1;

/**
 * Flying 120 u beside the leader of the Watch lane patrol `lane:B:1` (seed 1, tick 6000): the patrol is
 * live and a Hammer + Jackal pair attacks 150 u ahead of the player.
 */
export function watchFightGame(): Simulation {
  const sim = new Simulation({ seed: WATCH_SEED, startDocked: false });
  const state = sim.state;
  state.tick = 6000;
  const route = routeById(state, 'lane:B:1')!;
  const s = scheduledAt(route, 0, state.tick);
  const side = { x: Math.sin(s.heading) * 120, y: -Math.cos(s.heading) * 120 };
  const pos = { x: s.pos.x + side.x, y: s.pos.y + side.y };
  teleport(sim, pos);
  state.combat.enemies = [];
  manageWatch(state);
  if (state.guild.watch.length === 0) throw new Error('no live Watch ship');
  const ahead = { x: Math.cos(s.heading), y: Math.sin(s.heading) };
  (['hammer', 'jackal'] as EnemyKind[]).forEach((kind, i) => {
    const at = { x: pos.x + ahead.x * 150 + i * 14, y: pos.y + ahead.y * 150 - i * 10 };
    const e = createEnemy({ id: `test:${i}`, kind, tier: 1, pos: at, angle: 0, home: at, orbit: i % 2 === 0 ? 1 : -1 });
    e.ai.mode = 'attack';
    state.combat.enemies.push(e);
  });
  return sim;
}

// ---------------------------------------------------------------- convoy link

export const CONVOY_SEED = 3;

/** The first pass of lane A of seed 3 with a tanker. */
export function tankerPass(): number {
  let n = 1;
  while (!convoyComposition(CONVOY_SEED, 'A', n).tanker) n++;
  return n;
}

/** Linked to the trader of a lane-A pass with a tanker (60 s after its departure), 50 000 cr, 100 Fe aboard. */
export function linkedGame(): Simulation {
  const sim = linkedTo(CONVOY_SEED, 'A', tankerPass(), 60);
  sim.state.credits = 50_000;
  sim.state.player.cargo.iron = 100;
  return sim;
}

// ---------------------------------------------------------------- escort

export const ESCORT_SEED = 11;

/**
 * An escort contract of seed 11 accepted (the first escort slip of the lane station nearest home, the
 * deposit taken), the ship flying 60 u beside the waiting convoy – the next step departs it.
 */
export function escortGame(): { sim: Simulation; contract: Contract } {
  const sim = new Simulation({ seed: ESCORT_SEED, startDocked: true });
  const state = sim.state;
  state.career.rep.guild.level = 2;
  const stations = stationsInArea(ESCORT_SEED, -30, 30, -30, 30)
    .filter((s) => escortAvailable(boardContext(state, s)))
    .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  let found: { station: StationDef; offer: ContractOffer } | null = null;
  for (const station of stations) {
    const ctx = { ...boardContext(state, station), unlocks: new Set<RepUnlock>(['contractsBasic', 'contractsRing1', 'contractsRing2']) };
    for (let roll = 1; roll <= 60 && !found; roll++) {
      const draft = escortOffer(ctx, createRng(roll));
      if (!draft) continue;
      const id = `${station.id}@${boardEpoch(state.tick)}.90`;
      found = { station, offer: { id, type: 'escort', faction: 'guild', station: station.id, ring: draft.ring, risk: draft.risk, target: draft.target, modifiers: [], bonus: 0, part: null } };
    }
    if (found) break;
  }
  if (!found) throw new Error('no escort draft');
  state.player.dock = { mode: 'docked', stationId: found.station.id };
  ensureBoard(state, found.station).offers = [found.offer];
  state.credits = 50_000;
  sim.step({ ...IDLE_COMMAND, actions: [{ type: 'acceptContract', offerId: found.offer.id, reqId: 1 } as GameAction] });
  const contract = state.career.contracts.find((c) => c.id === found!.offer.id);
  if (!contract || contract.target.kind !== 'escort') throw new Error('escort not accepted');
  state.player.dock = { mode: 'flying' };
  teleport(sim, { x: contract.target.meet.x, y: contract.target.meet.y + 60 });
  return { sim, contract };
}

/** One step with the ship carried `gap` u beside the escorted trader; pirates other than the ambushers removed. */
export function rideEscort(sim: Simulation, serial: number, gap = 60): SimEvent[] {
  const tr = escortHitTargets(sim.state).find((t) => t.id === `es:${serial}:trader`);
  if (tr) {
    const p = sim.state.player;
    p.body = { pos: { x: tr.pos.x, y: tr.pos.y + gap }, vel: { ...(tr.vel ?? { x: 0, y: 0 }) }, angle: 0, angVel: 0 };
    p.prevBody = p.body;
    sim.state.world.update(p.body.pos);
  }
  sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => e.id.startsWith('ea:'));
  return sim.step(IDLE_COMMAND);
}

// The Guild relay chain and its contract (M4d plan §2.2 "Relay contract") – OWNED BY T2.
//
// Pinned offer (`relayOffer`, wrapped by generate.ts `pinnedRelayOffer` as `<station>@<epoch>.relay`) at
// stations within `RELAY_CHAIN.offerRange` of a relay site whose lane is not secured, from Guild level 2
// (`guildRelay` unlock), while no relay contract is active (`relayContractSites` lists the eligible sites
// for the board context). Stage 1 repair (F, `relayInteraction` / `interactRelay`, materials from the
// ship's cargo), stage 2 power (`stepRelays` via `guildRelayCandidates`), stage 3 hold (`stepRelayChain`:
// counterattack `rc:<lane>:<i>` through `relaySpawns` → careerSpawns, the Guild reinforcement via
// `spawnRelayWatch`), won → `secured`, `sectorSecured`, the contract ready (`stepRelayContracts`).
//
// The hold (`guild.hold`, one lane at a time):
//   warning – the counterattack spawns at `start` (`relayHoldStarted` was sent `counterattackDelay` s
//             before); it waits while the AI budget is full (`ambushBudgetOk`).
//   fight   – the party is listed by `relaySpawns` (careerSpawns spawns it 320 u from the mast, on the
//             bearing away from home) until each ship is destroyed (`combat.defeated`) or has fled beyond
//             `fledRadius` of the mast (then it is marked defeated and leaves). `watchArrive` s after the
//             start the Guild reinforcement arrives. Every ship done → won.
//   idle    – interrupted (the player died, docked or is beyond `holdRadius`): the party leaves; the
//             hold re-arms (warning) when the flying player comes back within `rearmRadius`. Ships shot
//             down (or fled) stay down for the whole hold (`keepPartyDown`): a re-armed hold brings back
//             only the ships still alive.
// No failure, no deadline. The chain does not need the contract after the repair: a powered relay holds
// and secures its sector whatever happens to the contract (the reward needs the contract).
import { CONTRACT_DEFS, CRUISE_SPEED, HUNT_SECONDS_PER_ENEMY, INTERACT_RANGE } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import { RELAY_CHAIN } from '../../data/guild';
import { RESOURCE_IDS } from '../../data/resources';
import type { CareerSpawn } from '../career/career';
import type { Contract, ContractOutcome, ContractTarget } from '../career/types';
import { createEnemy } from '../combat/enemies';
import type { Enemy } from '../combat/types';
import type { GameAction } from '../commands';
import type { BoardContext, ContractDraft } from '../contracts/generate';
import { ambushBudgetOk } from '../events/ambush';
import type { Vec2 } from '../math/vec2';
import type { LaneId } from '../regions/lanes';
import { clampRefined } from '../ship/workshop';
import type { SimEvent, SimState } from '../Simulation';
import { guildRelayId, guildRelaySite, guildRelaySites, MAST_RADIUS } from './relaySites';
import type { GuildRelaySite, RelayInteraction, RelayStage } from './types';
import { spawnRelayWatch } from './watch';

type RelayTarget = Extract<ContractTarget, { kind: 'relay' }>;

const TICKS = 60;
const LANES: readonly LaneId[] = ['A', 'B'];
const NO_SITES: readonly GuildRelaySite[] = [];

/** Seconds of a relay contract on top of the travel: repair + power, the warning and the fight (3 ships). */
const RELAY_WORK_SECONDS = 30;
const RELAY_PARTY_SIZE = 3;
/** A party member spawns this far from the party's spawn point (u). */
const PARTY_SPREAD = 12;
/** A leaving counterattack ship heads for a point this far beyond its spawn point (u). */
const LEAVE_DISTANCE = 1500;

/** Progress of a relay contract = the lane's stage (0 broken, 1 repaired, 2 powered, 3 secured). */
export const RELAY_PROGRESS: Readonly<Record<RelayStage | 'broken', number>> = { broken: 0, repaired: 1, powered: 2, secured: 3 };

/** The lane's relay stage now. */
export const relayStage = (state: SimState, lane: LaneId): RelayStage | 'broken' => state.guild.relays.get(lane)?.stage ?? 'broken';

// ---------------------------------------------------------------------------
// the offer

/** Relay sites a board may offer a contract for now: lane not secured, no relay contract active. */
export function relayContractSites(state: SimState): readonly GuildRelaySite[] {
  if (state.career.contracts.some((c) => c.target.kind === 'relay')) return NO_SITES;
  const sites = guildRelaySites(state.seed);
  if (sites.length === 0) return NO_SITES;
  return sites.filter((s) => relayStage(state, s.lane) !== 'secured');
}

/**
 * Is a relay slip still good to accept? Not when its lane is already secured or another relay contract
 * is active (a slip stored on another board earlier in the epoch). For `acceptOffer` (board.ts).
 */
export function relayOfferAvailable(state: SimState, target: RelayTarget): boolean {
  return relayStage(state, target.lane) !== 'secured' && !state.career.contracts.some((c) => c.target.kind === 'relay');
}

/** The pinned relay contract draft of a board (the nearest eligible site in range, `ctx.relays`), or null. */
export function relayOffer(ctx: BoardContext): ContractDraft | null {
  if (!ctx.unlocks.has('guildRelay')) return null;
  const at = ctx.station.pos;
  let best: GuildRelaySite | null = null;
  let bestD: number = RELAY_CHAIN.offerRange;
  for (const s of ctx.relays ?? NO_SITES) {
    const d = Math.hypot(s.pos.x - at.x, s.pos.y - at.y);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!best) return null;
  const ring = Math.min(4, best.depth) as RingIndex;
  const unlock = CONTRACT_DEFS.relay.unlock[ring];
  if (unlock === undefined || !ctx.unlocks.has(unlock)) return null;
  return {
    ring,
    risk: RELAY_CHAIN.risk,
    target: { kind: 'relay', lane: best.lane, relay: best.id, sector: best.sector, pos: { ...best.pos } },
    where: { ...best.pos },
  };
}

/** Duration estimate of a relay contract beyond the overhead (s): travel, repair, power, hold. */
export function relaySeconds(origin: Vec2, target: RelayTarget): number {
  const travel = (2 * Math.hypot(target.pos.x - origin.x, target.pos.y - origin.y)) / CRUISE_SPEED;
  return travel + RELAY_WORK_SECONDS + RELAY_CHAIN.counterattackDelay + RELAY_PARTY_SIZE * HUNT_SECONDS_PER_ENEMY;
}

// ---------------------------------------------------------------------------
// stage 1 – the repair (F at the broken mast)

const activeRelayContract = (state: SimState, lane: LaneId): Contract | null =>
  state.career.contracts.find((c) => !c.ready && c.target.kind === 'relay' && c.target.lane === lane) ?? null;

/** F at the broken mast of an active relay contract (repair), or null. */
export function relayInteraction(state: SimState): RelayInteraction | null {
  const { player } = state;
  if (player.destroyed || player.dock.mode !== 'flying') return null;
  const pos = player.body.pos;
  const reach = player.props.boundingRadius + INTERACT_RANGE;
  for (const c of state.career.contracts) {
    const t = c.target;
    if (c.ready || t.kind !== 'relay' || state.guild.relays.has(t.lane)) continue;
    const site = guildRelaySite(state.seed, t.lane);
    if (!site) continue;
    if (Math.hypot(site.pos.x - pos.x, site.pos.y - pos.y) - MAST_RADIUS <= reach) return { kind: 'relayRepair', contract: c.serial, lane: t.lane, pos: { ...site.pos } };
  }
  return null;
}

/** The repair: materials from the ship's cargo (raw first), stage `repaired`, `relayRepaired`. */
export function interactRelay(state: SimState, it: RelayInteraction): SimEvent[] {
  const c = state.career.contracts.find((x) => x.serial === it.contract);
  const site = guildRelaySite(state.seed, it.lane);
  if (!c || c.ready || c.target.kind !== 'relay' || c.target.lane !== it.lane || !site || state.guild.relays.has(it.lane)) return [];
  const { cargo, refined } = state.player;
  const need = RELAY_CHAIN.repair;
  for (const r of RESOURCE_IDS) if (cargo[r] + 1e-9 < (need[r] ?? 0)) return [{ type: 'interactFailed', contractId: c.serial, reason: 'notEnoughResources' }];
  for (const r of RESOURCE_IDS) cargo[r] = Math.max(0, cargo[r] - (need[r] ?? 0));
  // the refined sub-account never exceeds the cargo: the raw units went first
  clampRefined(cargo, refined);
  state.guild.relays.set(it.lane, { stage: 'repaired', sector: site.sector, tick: state.tick });
  c.progress = RELAY_PROGRESS.repaired;
  return [{ type: 'relayRepaired', lane: it.lane }];
}

// ---------------------------------------------------------------------------
// stage 3 – the hold

/** The counterattack ship `i` of a lane. */
export const counterattackId = (lane: LaneId, i: number): string => `rc:${lane}:${i}`;

/** The counterattack party of a site (kinds by its depth). */
const partyOf = (site: GuildRelaySite) => RELAY_CHAIN.party[site.depth >= 3 ? 3 : 2];

/** Unit vector from home to the mast (the counterattack comes from farther out). */
function outward(site: GuildRelaySite): Vec2 {
  const l = Math.hypot(site.pos.x, site.pos.y) || 1;
  return { x: site.pos.x / l, y: site.pos.y / l };
}

/** Where the counterattack spawns: `counterattackDistance` from the mast, away from home. */
export function counterattackPoint(site: GuildRelaySite): Vec2 {
  const d = outward(site);
  return { x: site.pos.x + d.x * RELAY_CHAIN.counterattackDistance, y: site.pos.y + d.y * RELAY_CHAIN.counterattackDistance };
}

/** The Rust counterattack ships of a running hold (listed by `careerSpawns`). */
export function relaySpawns(state: SimState): CareerSpawn[] {
  const hold = state.guild.hold;
  if (!hold || hold.phase !== 'fight') return [];
  const site = guildRelaySite(state.seed, hold.lane);
  if (!site) return [];
  const at = counterattackPoint(site);
  const d = outward(site);
  const face = Math.atan2(-d.y, -d.x);
  return partyOf(site).map((kind, i) => {
    const id = counterattackId(hold.lane, i);
    const pos = i === 0 ? at : { x: at.x + Math.cos(face + 1.6 + i) * PARTY_SPREAD, y: at.y + Math.sin(face + 1.6 + i) * PARTY_SPREAD };
    return {
      id,
      pos,
      create: (): Enemy => {
        const e = createEnemy({ id, kind, tier: 1, pos, angle: face, home: at, orbit: i % 2 === 0 ? 1 : -1 });
        e.ai.mode = 'attack';
        return e;
      },
    };
  });
}

/** The living counterattack ships of a lane. */
const partyAlive = (state: SimState, lane: LaneId): Enemy[] => state.combat.enemies.filter((e) => e.id.startsWith(`rc:${lane}:`));

/** Send a counterattack ship away (it despawns once out of the player's range). */
function leave(e: Enemy, site: GuildRelaySite): void {
  const d = outward(site);
  const far = RELAY_CHAIN.counterattackDistance + LEAVE_DISTANCE;
  e.home = { x: site.pos.x + d.x * far, y: site.pos.y + d.y * far };
  e.ai.mode = 'retreat';
}

/** The hold is interrupted: the player died, docked or flew beyond `holdRadius`. */
function interrupted(state: SimState, site: GuildRelaySite): boolean {
  const { player } = state;
  if (player.destroyed || player.dock.mode !== 'flying') return true;
  return Math.hypot(player.body.pos.x - site.pos.x, player.body.pos.y - site.pos.y) > RELAY_CHAIN.holdRadius;
}

/** A new warning: the counterattack comes in `counterattackDelay` s. */
function arm(state: SimState, site: GuildRelaySite, events: SimEvent[]): void {
  state.guild.hold = { lane: site.lane, start: state.tick + RELAY_CHAIN.counterattackDelay * TICKS, phase: 'warning', reinforced: false };
  events.push({ type: 'relayHoldStarted', lane: site.lane, at: counterattackPoint(site) });
}

/**
 * The fight begins: the ships of the party not yet down are listed for the spawn. A ship shot down
 * (or fled) in an earlier fight of this hold stays down – a re-armed hold is never a fresh party with
 * fresh loot (saboteur G1).
 */
function beginFight(state: SimState, site: GuildRelaySite): void {
  const hold = state.guild.hold!;
  hold.phase = 'fight';
  hold.start = state.tick;
  const at = counterattackPoint(site);
  // a ship left over from an interrupted fight joins the new one
  for (const e of partyAlive(state, site.lane)) {
    e.home = { ...at };
    e.ai.mode = 'attack';
  }
}

/** Is every counterattack ship destroyed or gone (fled beyond `fledRadius`)? Marks the fled ones. */
function partyDone(state: SimState, site: GuildRelaySite): boolean {
  const { combat } = state;
  let done = true;
  partyOf(site).forEach((_, i) => {
    const id = counterattackId(site.lane, i);
    if (combat.defeated.has(id)) return;
    const e = combat.enemies.find((x) => x.id === id);
    // not spawned yet (or despawned): careerSpawns brings it
    if (!e) {
      done = false;
      return;
    }
    const d = Math.hypot(e.body.pos.x - site.pos.x, e.body.pos.y - site.pos.y);
    const engaged = e.ai.mode === 'attack' || e.ai.mode === 'evade' || e.ai.mode === 'hail';
    if (d > RELAY_CHAIN.fledRadius && !engaged) {
      // fled: it leaves and never comes back for this hold
      combat.defeated.set(id, state.tick);
      leave(e, site);
      return;
    }
    done = false;
  });
  return done;
}

function secure(state: SimState, site: GuildRelaySite, events: SimEvent[]): void {
  state.sites.powered.add(site.id);
  state.guild.relays.set(site.lane, { stage: 'secured', sector: site.sector, tick: state.tick });
  if (state.guild.hold?.lane === site.lane) state.guild.hold = null;
  for (const e of partyAlive(state, site.lane)) leave(e, site);
  events.push({ type: 'sectorSecured', lane: site.lane, sector: site.sector });
}

/**
 * The counterattack ships of a powered lane that are down (destroyed or fled) stay down until the lane is
 * secured: their `combat.defeated` entries are kept fresh, so the 20 min respawn (`RESPAWN_TICKS`) never
 * brings them back – however long the hold stays interrupted (saboteur G1). Runs before `stepCombat`.
 */
function keepPartyDown(state: SimState): void {
  const { defeated } = state.combat;
  for (const lane of LANES) {
    if (state.guild.relays.get(lane)?.stage !== 'powered') continue;
    const site = guildRelaySite(state.seed, lane);
    if (!site) continue;
    partyOf(site).forEach((_, i) => {
      const id = counterattackId(lane, i);
      if (defeated.has(id)) defeated.set(id, state.tick);
    });
  }
}

/** One step of the chain: powered → hold, counterattack, reinforcement, won / interrupted / re-armed. */
export function stepRelayChain(state: SimState, events: SimEvent[], _dt: number): void {
  const g = state.guild;
  if (g.relays.size === 0) return;
  keepPartyDown(state);
  // stage 2: the relay got powered (stepRelays ran before this step) → the hold arms
  for (const lane of LANES) {
    const rec = g.relays.get(lane);
    if (rec?.stage !== 'repaired' || !state.sites.powered.has(guildRelayId(lane))) continue;
    g.relays.set(lane, { stage: 'powered', sector: rec.sector, tick: state.tick });
    const site = guildRelaySite(state.seed, lane);
    if (site && (!g.hold || g.hold.phase === 'idle')) arm(state, site, events);
  }
  // a hold of a lane that is no longer powered (secured by a dev command, a retuned seed) ends
  if (g.hold && g.relays.get(g.hold.lane)?.stage !== 'powered') g.hold = null;
  // a powered lane without a hold (the other lane's hold ended, a load) waits idle
  if (!g.hold) {
    const lane = LANES.find((l) => g.relays.get(l)?.stage === 'powered');
    if (lane) g.hold = { lane, start: state.tick, phase: 'idle', reinforced: false };
  }
  const hold = g.hold;
  if (!hold) return;
  const site = guildRelaySite(state.seed, hold.lane);
  if (!site) {
    g.hold = null;
    return;
  }
  if (hold.phase === 'idle') {
    const { player } = state;
    const near = Math.hypot(player.body.pos.x - site.pos.x, player.body.pos.y - site.pos.y) <= RELAY_CHAIN.rearmRadius;
    if (near && !player.destroyed && player.dock.mode === 'flying') arm(state, site, events);
    return;
  }
  if (interrupted(state, site)) {
    hold.phase = 'idle';
    for (const e of partyAlive(state, site.lane)) leave(e, site);
    return;
  }
  if (hold.phase === 'warning') {
    if (state.tick >= hold.start && ambushBudgetOk(state)) beginFight(state, site);
    return;
  }
  // fight
  if (!hold.reinforced && state.tick >= hold.start + RELAY_CHAIN.watchArrive * TICKS) {
    spawnRelayWatch(state, hold.lane);
    hold.reinforced = true;
  }
  if (partyDone(state, site)) secure(state, site, events);
}

// ---------------------------------------------------------------------------
// the contract

/** Relay contracts after a step: progress = the lane's stage, ready when it is `secured` (`stepContracts` hook). */
export function stepRelayContracts(state: SimState, _events: readonly SimEvent[], outcome: ContractOutcome): void {
  const paid = new Set<LaneId>();
  for (const c of state.career.contracts) {
    const t = c.target;
    if (t.kind !== 'relay') continue;
    if (c.ready) {
      paid.add(t.lane);
      continue;
    }
    const rec = state.guild.relays.get(t.lane);
    c.progress = RELAY_PROGRESS[rec?.stage ?? 'broken'];
    // one contract per lane is paid, and only for a sector secured after it was accepted (a stale slip
    // of another board accepted later never pays – relayOfferAvailable keeps it off in acceptOffer)
    if (rec?.stage === 'secured' && rec.tick >= c.acceptedTick && !paid.has(t.lane)) {
      paid.add(t.lane);
      outcome.ready(c);
    }
  }
}

// ---------------------------------------------------------------------------
// dev

/** `debugGuild { what: 'secure', lane? }` (dev builds only): the lane's relay sector is secured now. */
export function debugSecureRelay(state: SimState, action: GameAction): SimEvent[] {
  const fail: SimEvent[] = [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
  if (action.type !== 'debugGuild' || !import.meta.env.DEV) return fail;
  const site = action.lane ? guildRelaySite(state.seed, action.lane) : (guildRelaySites(state.seed).find((s) => relayStage(state, s.lane) !== 'secured') ?? null);
  if (!site || relayStage(state, site.lane) === 'secured') return fail;
  const events: SimEvent[] = [{ type: 'actionResult', reqId: action.reqId, ok: true }];
  secure(state, site, events);
  return events;
}

// F interaction in discoveries: open a found cache and help a ship in distress.
// Distress signals are picked up on their own (broadcast); a trap launches an ambush on approach.
import { CACHE } from '../../data/poi';
import { DISTRESS } from '../../data/events';
import type { RingIndex } from '../../data/economy';
import { emptyCargo, cargoUsed, RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { createEnemy } from '../combat/enemies';
import { TAU } from '../math/angle';
import { createRng } from '../math/rng';
import { fnv1a32 } from '../math/fnv1a';
import { length, sub, type Vec2 } from '../math/vec2';
import { quoteRefIncome } from '../contracts/board';
import { contractReward } from '../contracts/reward';
import { addPoints } from '../factions/reputation';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { distressById, distressNear, type Distress } from './events';
import { fireJournal } from './journal';
import { awardFragment, rollFragment } from './plans';
import { echoId, poisNear, type CachePoi } from './poi';
import { scanAssignment } from './scanner';

export type DiscoveryInteraction =
  | { kind: 'cache'; id: string; pos: Vec2 }
  | { kind: 'distress'; id: string; pos: Vec2; distress: Distress };

/** The nearest discovery interaction within F range (a found cache, a ship in distress), or null. */
export function discoveryInteraction(state: SimState): DiscoveryInteraction | null {
  const player = state.player;
  const pos = player.body.pos;
  const r = player.props.boundingRadius;
  const d = state.discovery;
  let best: DiscoveryInteraction | null = null;
  let bestD = Infinity;
  for (const poi of poisNear(state.seed, pos, r + CACHE.openRange + 3)) {
    if (poi.kind !== 'cache' || !d.known.has(poi.id) || d.opened.has(poi.id)) continue;
    const gap = length(sub(poi.pos, pos)) - r - 2;
    if (gap <= CACHE.openRange && gap < bestD) {
      best = { kind: 'cache', id: poi.id, pos: poi.pos };
      bestD = gap;
    }
  }
  for (const ds of distressNear(state.seed, pos, r + DISTRESS.shipRadius + DISTRESS.interactRange, state.tick)) {
    if (d.opened.has(ds.id) || ds.kind === 'trap') continue;
    const gap = length(sub(ds.pos, pos)) - r - DISTRESS.shipRadius;
    if (gap <= DISTRESS.interactRange && gap < bestD) {
      best = { kind: 'distress', id: ds.id, pos: ds.pos, distress: ds };
      bestD = gap;
    }
  }
  return best;
}

function addToCargo(state: SimState, add: Partial<Cargo>): Partial<Cargo> {
  const player = state.player;
  let free = Math.max(0, player.props.cargoCapacity - cargoUsed(player.cargo));
  const taken: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) {
    const n = Math.min(add[r] ?? 0, free);
    if (n <= 0) continue;
    player.cargo[r] += n;
    free -= n;
    taken[r] = n;
  }
  return taken;
}

/** Cache loot (deterministic from the id). */
export function cacheLoot(poi: CachePoi): { credits: number; cargo: Cargo } {
  const rng = createRng(hash3(0xcac4e, fnv1a32(poi.id), 0));
  const credits = Math.round((CACHE.credits[0] + rng() * (CACHE.credits[1] - CACHE.credits[0])) / 10) * 10;
  const cargo = emptyCargo();
  const res: ResourceId[] = poi.ring >= 2 ? ['titanium', 'copper'] : ['copper', 'iron'];
  for (const r of res) cargo[r] = Math.round(CACHE.resources[0] + rng() * (CACHE.resources[1] - CACHE.resources[0]));
  return { credits, cargo };
}

function openCache(state: SimState, id: string, events: SimEvent[]): void {
  const poi = poisNear(state.seed, state.player.body.pos, 40).find((p): p is CachePoi => p.id === id && p.kind === 'cache');
  if (!poi) return;
  const d = state.discovery;
  d.opened.add(id);
  const loot = cacheLoot(poi);
  state.credits += loot.credits;
  events.push({ type: 'creditsChanged', delta: loot.credits, reason: 'discovery' });
  const cargo = addToCargo(state, loot.cargo);
  events.push({ type: 'cacheOpened', id, credits: loot.credits, cargo, parts: {} });
  fireJournal(state, { on: 'cacheFound' }, events);
  scanAssignment(state, 'cache', events);
  const plan = rollFragment(state, 'cache', id);
  if (plan) awardFragment(state, plan, events);
  // a Rust cache after Echo-1 may also hide a Forge-smith shard
  if (d.scanned.has(echoId(1)) && !d.keyItems.has('shard')) {
    d.keyItems.add('shard');
    events.push({ type: 'keyItemFound', item: 'shard' });
    fireJournal(state, { on: 'shardFound' }, events);
  }
}

/** Reward for helping in distress (~ a 6-minute Rescue). */
export function distressReward(state: SimState, ds: Distress): number {
  const ring = ringIndexAt(length(ds.pos)) as RingIndex;
  // the same reference income as a contract quote (M19): the best ship and the high-water mark
  return contractReward({ type: 'rescue', seconds: DISTRESS.rewardSeconds, risk: 0, bonus: 0, refIncome: quoteRefIncome(state, ring) });
}

function helpDistress(state: SimState, ds: Distress, events: SimEvent[]): void {
  const player = state.player;
  if (ds.kind === 'fuel') {
    if (player.fuel < ds.fuel) {
      events.push({ type: 'interactFailed', contractId: -1, reason: 'notEnoughFuel' });
      return;
    }
    player.fuel -= ds.fuel;
  } else if (ds.kind === 'repair') {
    if (player.cargo.iron + 1e-9 < DISTRESS.iron) {
      events.push({ type: 'interactFailed', contractId: -1, reason: 'notEnoughIron' });
      return;
    }
    player.cargo.iron -= DISTRESS.iron;
  } else return;
  state.discovery.opened.add(ds.id);
  const reward = distressReward(state, ds);
  state.credits += reward;
  events.push({ type: 'creditsChanged', delta: reward, reason: 'discovery' });
  for (const level of addPoints(state.career.rep, 'guild', DISTRESS.rep)) events.push({ type: 'repLevelUp', faction: 'guild', level });
  events.push({ type: 'distressResolved', id: ds.id, reward });
}

export function interactDiscovery(state: SimState, it: DiscoveryInteraction, events: SimEvent[]): void {
  if (it.kind === 'cache') openCache(state, it.id, events);
  else helpDistress(state, it.distress, events);
}

/** Distress signals in range: interception (signal, journal) and a trap on approach. */
export function stepDistress(state: SimState, events: SimEvent[]): void {
  const d = state.discovery;
  const pos = state.player.body.pos;
  for (const ds of distressNear(state.seed, pos, DISTRESS.hearRange, state.tick)) {
    if (d.opened.has(ds.id)) continue;
    if (!d.signals.some((s) => s.id === ds.id) && !d.known.has(ds.id)) {
      d.signals.push({ id: ds.id, kind: 'distress', pos: { ...ds.pos }, radius: DISTRESS.shipRadius * 2, tick: state.tick });
      events.push({ type: 'distressHeard', id: ds.id, kind: ds.kind, pos: { ...ds.pos } });
      fireJournal(state, { on: 'distressHeard' }, events);
    }
    if (ds.kind === 'trap' && length(sub(ds.pos, pos)) <= DISTRESS.ambushRange) springTrap(state, ds, events);
  }
}

function springTrap(state: SimState, ds: Distress, events: SimEvent[]): void {
  const d = state.discovery;
  d.opened.add(ds.id);
  d.signals = d.signals.filter((s) => s.id !== ds.id);
  const ring = ringIndexAt(length(ds.pos));
  const rng = createRng(hash3(0xa3b05, fnv1a32(ds.id), 0));
  for (let i = 0; i < DISTRESS.ambushShips; i++) {
    const a = rng() * TAU;
    const p = { x: ds.pos.x + Math.cos(a) * 45, y: ds.pos.y + Math.sin(a) * 45 };
    state.combat.enemies.push(createEnemy({ id: `amb:${ds.id}:${i}`, kind: 'jackal', tier: ring >= 4 ? 2 : 1, pos: p, angle: a + Math.PI, home: ds.pos, orbit: i % 2 === 0 ? 1 : -1 }));
  }
  events.push({ type: 'distressAmbush', id: ds.id, pos: { ...ds.pos } });
  fireJournal(state, { on: 'distressTrap' }, events);
}

/** A ship in distress by id (UI). */
export const distressOf = (state: SimState, id: string): Distress | null => distressById(state.seed, id);

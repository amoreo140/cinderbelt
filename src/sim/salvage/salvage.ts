// F at a wreck or container (M3.6): loads the nearest object with loot within loading range
// (a towed object takes priority). A big salvageable wreck is not loaded – it has to be cut up.
import { SALVAGE_DATA_PER_PART } from '../../data/salvage';
import { SALVAGE_RANGE, salvageLoot, salvageWreck, wreckGap } from '../combat/wrecks';
import type { Container, Wreck } from '../combat/types';
import { length, sub } from '../math/vec2';
import { CONTAINER_RADIUS, CONTAINER_TTL } from '../../data/salvage';
import type { SimEvent, SimState } from '../Simulation';
import { gainData } from '../discovery/state';
import { onWreckSalvaged } from '../discovery/wrecks';
import { isHulk } from './dismantle';
import { lootEmpty } from '../combat/wrecks';
import { releaseTractor, sameRef } from './tractor';

export type SalvageTarget =
  | { kind: 'wreck'; wreck: Wreck }
  | { kind: 'container'; container: Container }
  /** The nearest one is a big wreck to be dismantled. */
  | { kind: 'hulk'; wreck: Wreck };

const containerGap = (c: Container, pos: { x: number; y: number }, r: number): number => length(sub(c.body.pos, pos)) - CONTAINER_RADIUS - r;

/** What F loads (a towed object first), or null. */
export function salvageAt(state: SimState): SalvageTarget | null {
  const { player, combat } = state;
  const pos = player.body.pos;
  const r = player.props.boundingRadius;
  const towed = player.tractor && !player.tractor.rip ? player.tractor.target : null;
  let best: SalvageTarget | null = null;
  let bestGap = SALVAGE_RANGE + 1e-9;
  let hulk: Wreck | null = null;
  let hulkGap = SALVAGE_RANGE + 1e-9;
  for (const w of combat.wrecks) {
    if (lootEmpty(w.loot)) continue;
    const gap = wreckGap(w, pos, r);
    if (gap > SALVAGE_RANGE) continue;
    if (isHulk(w)) {
      if (gap < hulkGap) {
        hulk = w;
        hulkGap = gap;
      }
      continue;
    }
    const g = sameRef(towed, { kind: 'wreck', id: w.id }) ? -Infinity : gap;
    if (g <= bestGap) {
      bestGap = g;
      best = { kind: 'wreck', wreck: w };
    }
  }
  for (const c of combat.containers) {
    const gap = containerGap(c, pos, r);
    if (gap > SALVAGE_RANGE) continue;
    const g = sameRef(towed, { kind: 'container', id: c.id }) ? -Infinity : gap;
    if (g <= bestGap) {
      bestGap = g;
      best = { kind: 'container', container: c };
    }
  }
  if (best) return best;
  return hulk ? { kind: 'hulk', wreck: hulk } : null;
}

/** Loads an object (F). */
export function salvage(state: SimState, target: SalvageTarget, events: SimEvent[]): void {
  const { player, combat } = state;
  if (target.kind === 'hulk') {
    events.push({ type: 'salvageBlocked', wreckId: target.wreck.id, parts: target.wreck.grid.parts.length });
    return;
  }
  if (target.kind === 'wreck') {
    const w = target.wreck;
    const intact = w.from || w.dismantle ? Object.values(w.loot.parts).reduce((s, n) => s + (n ?? 0), 0) : 0;
    const r = salvageWreck(w, player.cargo, player.props.cargoCapacity, player.salvage);
    // the intact parts are on board now: a later cut must not rebuild them from the grid (C3)
    if (w.dismantle) w.dismantle = { intact: [] };
    // intact parts from a dismantled wreck pay Data too (3.2.2) – the toast says how much (M21)
    const data = intact * SALVAGE_DATA_PER_PART;
    events.push({ type: 'salvaged', wreckId: w.id, ...r, ...(data > 0 ? { data } : {}) });
    // the plan fragment and the Smiths' shard are picked up as key items (M3.5b)
    onWreckSalvaged(state, w, events);
    if (data > 0) gainData(state, data, 'salvage', events);
    // a loaded piece without loot disappears (the tractor beam is released)
    if (lootEmpty(w.loot) && (w.from || w.dismantle) && !w.poi) {
      combat.wrecks = combat.wrecks.filter((x) => x !== w);
      if (sameRef(player.tractor?.target, { kind: 'wreck', id: w.id })) releaseTractor(state, 'loaded', events);
    }
    return;
  }
  const c = target.container;
  const r = salvageLoot(c.loot, player.cargo, player.props.cargoCapacity, player.salvage);
  events.push({ type: 'containerLoaded', containerId: c.id, pos: { ...c.body.pos }, ...r });
  // a POI container is opened by the first load (C2): it never respawns full; what did not fit stays
  // in this container, which now drifts like any dropped one (no despawn by distance, CONTAINER_TTL)
  if (c.poi) {
    state.discovery.opened.add(c.poi);
    c.ttl = Math.min(c.ttl, CONTAINER_TTL);
  }
  if (lootEmpty(c.loot)) {
    combat.containers = combat.containers.filter((x) => x !== c);
    if (sameRef(player.tractor?.target, { kind: 'container', id: c.id })) releaseTractor(state, 'loaded', events);
  }
}

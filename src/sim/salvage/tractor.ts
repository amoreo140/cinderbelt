// Tractor beam (long-term design 5.3.1, M3.6): T locks onto a container, a part or a small wreck under
// the cursor (25 u reach at T1) and pulls it to the ship; on a big wreck it rips the loose part under the
// cursor. A second T releases it. The beam costs energy, breaks beyond its reach, and F loads the object
// by the ship. Archive "Tractor beam+" (`tractorPlus`, M4b): range ×1.5, wrecks 2 parts larger
// (`TRACTOR_PLUS`).
import { TOW_AIM_SLACK, TOW_BREAK, TOW_DAMPING, TOW_GAP, TOW_SPRING, CONTAINER_RADIUS, TRACTOR_PLUS } from '../../data/salvage';
import type { Container, TowRef, Wreck } from '../combat/types';
import { add, length, scale, sub, type Vec2 } from '../math/vec2';
import type { Body } from '../physics/body';
import type { TractorMount } from '../ship/properties';
import type { SimEvent, SimState } from '../Simulation';
import { hasFeature } from '../discovery/archive';
import { NUGGET } from '../../data/ore';
import type { Nugget } from '../mining/nuggets';
import { isHulk, jointParts, partAt, ripPart } from './dismantle';
import type { TractorReleaseReason } from './types';

/** The ship's tractor beams combined: the longest reach and the largest load; pull and energy use add up. */
export interface TractorPower {
  range: number;
  pull: number;
  maxParts: number;
  energyPerSecond: number;
  ripSeconds: number;
  /** The beam the effect comes from (the longest reach). */
  mount: TractorMount;
}

/** `plus` = the Archive node `tractorPlus` is bought: range × `TRACTOR_PLUS.rangeMult`, `maxParts` + `TRACTOR_PLUS.maxPartsBonus`. */
export function tractorPower(mounts: readonly TractorMount[], plus = false): TractorPower | null {
  if (mounts.length === 0) return null;
  let best = mounts[0]!;
  for (const m of mounts) if (m.range > best.range) best = m;
  return {
    range: best.range * (plus ? TRACTOR_PLUS.rangeMult : 1),
    pull: mounts.reduce((s, m) => s + m.pull, 0),
    maxParts: Math.max(...mounts.map((m) => m.maxParts)) + (plus ? TRACTOR_PLUS.maxPartsBonus : 0),
    energyPerSecond: mounts.reduce((s, m) => s + m.energyPerSecond, 0),
    ripSeconds: Math.min(...mounts.map((m) => m.ripSeconds)),
    mount: best,
  };
}

/** The player's tractor power with the Archive upgrade (`tractorPlus`), or null without a beam. */
export const playerTractorPower = (state: SimState): TractorPower | null => tractorPower(state.player.props.tractors, hasFeature(state, 'tractorPlus'));

/** An object the beam can hold. */
export interface Towable {
  ref: TowRef;
  body: Body;
  radius: number;
  /** Number of parts (a container = 1) – a heavier object is pulled slower. */
  parts: number;
  wreck?: Wreck;
  container?: Container;
  /** A rich nugget (Mining 2.0) – the magnet at the hull collects it once the beam pulls it close. */
  nugget?: Nugget;
}

export const towWreck = (w: Wreck): Towable => ({ ref: { kind: 'wreck', id: w.id }, body: w.body, radius: w.props.boundingRadius, parts: w.grid.parts.length, wreck: w });
export const towContainer = (c: Container): Towable => ({ ref: { kind: 'container', id: c.id }, body: c.body, radius: CONTAINER_RADIUS, parts: 1, container: c });
export const towNugget = (n: Nugget): Towable => ({ ref: { kind: 'nugget', id: n.id }, body: n.body, radius: NUGGET.radius, parts: 1, nugget: n });

/** The object by its reference, or null (gone, loaded, stolen). */
export function towable(state: SimState, ref: TowRef): Towable | null {
  if (ref.kind === 'wreck') {
    const w = state.combat.wrecks.find((x) => x.id === ref.id);
    return w ? towWreck(w) : null;
  }
  if (ref.kind === 'nugget') {
    const n = state.mining.nuggets.find((x) => x.id === ref.id);
    return n ? towNugget(n) : null;
  }
  const c = state.combat.containers.find((x) => x.id === ref.id);
  return c ? towContainer(c) : null;
}

export const sameRef = (a: TowRef | null | undefined, b: TowRef | null | undefined): boolean =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

/** The gap between the ship's hull and the object. */
const gapTo = (state: SimState, t: Towable): number =>
  length(sub(t.body.pos, state.player.body.pos)) - state.player.props.boundingRadius - t.radius;

/** The object under the cursor within the beam's reach (the nearest to the cursor), or null. */
export function tractorCandidate(state: SimState, aim: Vec2, range: number): Towable | null {
  let best: Towable | null = null;
  let bestD = Infinity;
  const all = [...state.combat.wrecks.map(towWreck), ...state.combat.containers.map(towContainer), ...state.mining.nuggets.map(towNugget)];
  for (const t of all) {
    const d = length(sub(t.body.pos, aim)) - t.radius;
    if (d > TOW_AIM_SLACK || gapTo(state, t) > range) continue;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function releaseTractor(state: SimState, reason: TractorReleaseReason, events: SimEvent[]): void {
  if (!state.player.tractor) return;
  state.player.tractor = null;
  events.push({ type: 'tractorReleased', reason });
}

/** T: lock onto the object under the cursor, or release the held one. */
export function toggleTractor(state: SimState, aim: Vec2, events: SimEvent[]): void {
  const player = state.player;
  if (player.tractor) {
    releaseTractor(state, 'manual', events);
    return;
  }
  const power = playerTractorPower(state);
  if (!power) {
    events.push({ type: 'tractorFailed', reason: 'noTractor' });
    return;
  }
  if (player.energy < power.energyPerSecond / 10) {
    events.push({ type: 'tractorFailed', reason: 'energy' });
    return;
  }
  const t = tractorCandidate(state, aim, power.range);
  if (!t) {
    events.push({ type: 'tractorFailed', reason: 'noTarget' });
    return;
  }
  if (t.wreck && (t.parts > power.maxParts || isHulk(t.wreck))) {
    // a big wreck: rip the loose part under the cursor (a joint holds the wreck together – cut it); a
    // hulk too big to load is always ripped, even when a stronger beam could pull it whole (I11)
    if (!t.wreck.dismantle) {
      events.push({ type: 'tractorFailed', reason: 'tooHeavy' });
      return;
    }
    const part = partAt(t.wreck, aim);
    if (!part || jointParts(t.wreck.grid).has(part.id)) {
      events.push({ type: 'tractorFailed', reason: 'joint' });
      return;
    }
    player.tractor = { target: t.ref, rip: { partId: part.id, progress: 0 } };
    events.push({ type: 'tractorLocked', target: t.ref, pos: { ...t.body.pos }, rip: true });
    return;
  }
  player.tractor = { target: t.ref, rip: null };
  events.push({ type: 'tractorLocked', target: t.ref, pos: { ...t.body.pos }, rip: false });
}

/** A beam step: energy, reach, ripping a part and pulling the object to the ship (before the wreck step). */
export function stepTractor(state: SimState, dt: number, events: SimEvent[]): void {
  const player = state.player;
  const tractor = player.tractor;
  if (!tractor) return;
  const power = playerTractorPower(state);
  if (!power || player.dock.mode !== 'flying' || player.destroyed) {
    releaseTractor(state, 'lost', events);
    return;
  }
  const t = towable(state, tractor.target);
  if (!t) {
    releaseTractor(state, 'lost', events);
    return;
  }
  const cost = power.energyPerSecond * dt;
  if (player.energy < cost) {
    releaseTractor(state, 'energy', events);
    return;
  }
  if (gapTo(state, t) > power.range * TOW_BREAK) {
    releaseTractor(state, 'range', events);
    return;
  }
  player.energy -= cost;

  if (tractor.rip) {
    const w = t.wreck;
    if (!w || !w.grid.parts.some((p) => p.id === tractor.rip!.partId) || jointParts(w.grid).has(tractor.rip.partId)) {
      releaseTractor(state, 'lost', events);
      return;
    }
    tractor.rip.progress += dt / power.ripSeconds;
    if (tractor.rip.progress >= 1) {
      const piece = ripPart(state, w, tractor.rip.partId, events);
      if (!piece) {
        releaseTractor(state, 'lost', events);
        return;
      }
      tractor.target = { kind: 'wreck', id: piece.id };
      tractor.rip = null;
    }
    return;
  }

  // pull: a spring to a point by the ship + damping against the ship; a heavier object accelerates less
  const hold = player.props.boundingRadius + t.radius + TOW_GAP;
  const d = sub(player.body.pos, t.body.pos);
  const dist = length(d);
  const dir = dist > 1e-9 ? scale(d, 1 / dist) : { x: 0, y: 0 };
  const rel = sub(t.body.vel, player.body.vel);
  let a = sub(scale(dir, TOW_SPRING * (dist - hold)), scale(rel, TOW_DAMPING));
  const max = power.pull / Math.sqrt(Math.max(1, t.parts));
  const mag = length(a);
  if (mag > max) a = scale(a, max / mag);
  const body: Body = { ...t.body, vel: add(t.body.vel, scale(a, dt)), angVel: t.body.angVel * (1 - 0.8 * dt) };
  if (t.wreck) t.wreck.body = body;
  if (t.container) t.container.body = body;
  if (t.nugget) t.nugget.body = body;
}

/** The object the beam pulls (for the UI and the scavenger AI). */
export const towedRef = (state: SimState): TowRef | null => (state.player.tractor && !state.player.tractor.rip ? state.player.tractor.target : null);

/** Is the object a big wreck the beam can only rip parts from? */
export const ripOnly = (w: Wreck): boolean => isHulk(w);

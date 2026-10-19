// Generic relays (M4b plan §2.4, §8) – OWNED BY T3. A relay is `{ id, pos, angle, owner, group }`;
// holding any mining beam (`state.player.beams`) on its receiver circle (`RELAY_LAYOUT.powerTarget`,
// r = `RELAY.targetRadius`, rotated by the relay's angle) charges it; `RELAY.powerSeconds` in total
// powers it, without a beam the charge decays by `RELAY.decayPerSecond`; full = id added to
// `sites.powered` (permanent). One relay charges at a time (`sites.charge`): a beam on another relay
// takes the charge over and the old progress is lost. Several beams on one relay charge it no faster.
// Events: `relayCharging` (start + every quarter), `relayPowered { id, site: group, lit }`.
//
// M4d reuses this module UNCHANGED for the Guild relay (owner 'guild', ids `gr:<lane>`): nothing in
// this file may import or know about derelicts (relays.test.ts checks the imports).
//
// The receiver lens sits on top of the mast (z ≈ 2.8 u), inside the mast's collision circle on the
// plane, so a beam aimed at the lens is stopped by the mast: a beam counts when its segment passes
// within `RELAY.targetRadius` of the receiver, or when it ends on the mast and its line passes that
// close (the beam would have reached the lens).
import { RELAY, RELAY_LAYOUT } from '../../data/sites';
import type { MiningBeam } from '../mining/mining';
import { add, rotate, type Vec2 } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import type { RelaySite } from './types';

/** Charge this close to full counts as full. */
const FULL_EPS = 1e-6;
/** A beam ending this close to a mast circle stopped on it. */
const ON_MAST = 0.05;
/** How far past its end a beam stopped on the mast is followed to the lens (the mast's diameter). */
const MAST_DEPTH = 2 * Math.max(...RELAY_LAYOUT.circles.map((c) => Math.hypot(c.x, c.y) + c.r));

/** World position of a relay's receiver lens on the plane. */
export const receiverPos = (relay: Pick<RelaySite, 'pos' | 'angle'>): Vec2 => add(relay.pos, rotate(RELAY_LAYOUT.powerTarget, relay.angle));

/** Distance from p to the segment a–b. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** The beam ended on one of the relay's mast circles (it was stopped there). */
function endsOnMast(beam: MiningBeam, relay: RelaySite): boolean {
  for (const c of RELAY_LAYOUT.circles) {
    const centre = add(relay.pos, rotate(c, relay.angle));
    if (Math.hypot(beam.to.x - centre.x, beam.to.y - centre.y) <= c.r + ON_MAST) return true;
  }
  return false;
}

/** Does this beam hold the relay's receiver? */
export function beamOnReceiver(beam: MiningBeam, relay: RelaySite): boolean {
  if (beam.asteroidId !== null) return false;
  const lens = receiverPos(relay);
  if (segmentDistance(lens, beam.from, beam.to) <= RELAY.targetRadius) return true;
  if (!endsOnMast(beam, relay)) return false;
  const dx = beam.to.x - beam.from.x;
  const dy = beam.to.y - beam.from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const past = { x: beam.to.x + (dx / len) * MAST_DEPTH, y: beam.to.y + (dy / len) * MAST_DEPTH };
  return segmentDistance(lens, beam.from, past) <= RELAY.targetRadius;
}

/** The relay a beam holds this step: the current charge's relay if any beam holds it, else the first held one. */
function heldRelay(state: SimState, candidates: readonly RelaySite[]): RelaySite | null {
  const { beams } = state.player;
  if (beams.length === 0 || candidates.length === 0) return null;
  const current = state.sites.charge?.id ?? null;
  let first: RelaySite | null = null;
  for (const relay of candidates) {
    if (state.sites.powered.has(relay.id)) continue;
    if (!beams.some((b) => beamOnReceiver(b, relay))) continue;
    if (relay.id === current) return relay;
    first ??= relay;
  }
  return first;
}

/** Quarters of the charge reached (0 at the start … 3 just before full). */
const quarter = (progress: number): number => Math.floor((progress / RELAY.powerSeconds) * 4);

/** One step of relay charging against the candidate relays near the ship. */
export function stepRelays(state: SimState, candidates: readonly RelaySite[], events: SimEvent[], dt: number): void {
  const sites = state.sites;
  const relay = heldRelay(state, candidates);
  if (!relay) {
    if (sites.charge) {
      const progress = sites.charge.progress - RELAY.decayPerSecond * dt;
      sites.charge = progress > 0 ? { id: sites.charge.id, progress } : null;
    }
    return;
  }
  const before = sites.charge?.id === relay.id ? sites.charge.progress : 0;
  const fresh = sites.charge?.id !== relay.id;
  const progress = before + dt;
  // (the steps' dt adds up to a hair under the whole seconds)
  if (progress >= RELAY.powerSeconds - FULL_EPS) {
    sites.charge = null;
    sites.powered.add(relay.id);
    let lit = 0;
    for (const r of candidates) if (r.group === relay.group && sites.powered.has(r.id)) lit++;
    events.push({ type: 'relayPowered', id: relay.id, site: relay.group, lit });
    return;
  }
  sites.charge = { id: relay.id, progress };
  if (fresh || quarter(progress) > quarter(before)) events.push({ type: 'relayCharging', id: relay.id, progress: progress / RELAY.powerSeconds });
}

/** The relay is powered (permanent). */
export const isRelayPowered = (state: SimState, id: string): boolean => state.sites.powered.has(id);

/** Charge share of a relay, 0..1 (1 = powered). */
export function relayCharge(state: SimState, id: string): number {
  if (state.sites.powered.has(id)) return 1;
  const c = state.sites.charge;
  return c && c.id === id ? Math.min(1, c.progress / RELAY.powerSeconds) : 0;
}

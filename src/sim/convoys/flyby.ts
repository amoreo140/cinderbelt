// Convoy flyby – a derived director event (M4d plan §2.5 "Flyby event") – OWNED BY T5.
//
// When a convoy pass will come within `CONVOY.flybyRadius` of the flying player in the next
// `CONVOY.flybyLead` seconds → `eventWarning` + the chip with the ETA and direction, once per pass
// (`director.fired` key `ev:convoy:<pass>`, value = the tick the flyby ends – like the comet flyby). It
// never counts as the director's last event (no quiet window).
//
// The approach is sampled every 5 s of the trader's schedule (the player's position held), the entry and
// exit ticks refined by bisection: `start` = the first tick within range (now, when it is in range
// already), `end` = one tick past the last tick within range of that approach, `pos` = the trader at the
// closest sample. Announced in the step a
// flyby becomes listed (edge-triggered against the ship's pose a tick earlier, like the comet flyby), so
// a reloaded game – whose `prevBody` is its `body` – announces exactly what the original does, and the
// saved `director.fired` keeps a pass from being announced twice (it stays until the pass is over).
import { CONVOY } from '../../data/convoys';
import type { ActiveEvent } from '../events/types';
import type { Vec2 } from '../math/vec2';
import { sectorIdAt } from '../regions/sectors';
import type { SimEvent, SimState } from '../Simulation';
import { boxDistance, convoySlots, slotInFlight, slotTraderInto, type ConvoySlot } from './schedule';

const TICKS = 60;
/** Sampling step of an approach (ticks); the entry and exit ticks are then found by bisection. */
const SAMPLE = 5 * TICKS;
/** An approach is followed at most this long past its start (ticks). */
const MAX_FOLLOW = 15 * 60 * TICKS;
const LEAD = CONVOY.flybyLead * TICKS;
const R2 = CONVOY.flybyRadius * CONVOY.flybyRadius;
/** The trader now farther than this from the player cannot come within range in the lead window. */
const QUICK_REACH = CONVOY.flybyRadius + CONVOY.speed * (CONVOY.flybyLead + 1);

/** One-shot / chip key of a convoy pass. */
export const convoyFlybyKey = (pass: string): string => `ev:convoy:${pass}`;

/** Flybys are announced to a pilot in flight, outside the Guild Training. */
const canAnnounce = (state: SimState): boolean =>
  state.player.dock.mode === 'flying' && !state.player.destroyed && state.career.training.status !== 'active';

/** The first tick of (lo, hi] where `inside` flips from `inside(lo)` (bisection; `hi` when it never does before). */
function edge(lo: number, hi: number, inside: (t: number) => boolean): number {
  const from = inside(lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (inside(mid) === from) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Scratch point of the samples (the flyby runs every step – no allocation per sample). */
const at: Vec2 = { x: 0, y: 0 };

/** Squared distance from the trader of `slot` at tick `t` to `pos` (Infinity when not in flight). */
function d2(slot: ConvoySlot, pos: Vec2, t: number): number {
  const s = slotTraderInto(slot, t, at);
  return s ? (s.x - pos.x) ** 2 + (s.y - pos.y) ** 2 : Infinity;
}

/**
 * The first tick within range of `pos` in the lead window after `tick` (sampled every `SAMPLE`, then
 * bisected; the start of the window when inside already), or -1 – the cheap half of an approach.
 */
function entryTick(slot: ConvoySlot, pos: Vec2, tick: number): number {
  if (slot.end <= tick || slot.depart > tick + LEAD) return -1;
  const first = Math.max(tick, Math.ceil(slot.depart));
  // quick reject: the trader now farther than the range plus what it flies in the lead window
  const now = d2(slot, pos, first);
  if (now !== Infinity && now > QUICK_REACH * QUICK_REACH) return -1;
  const lastTick = Math.min(tick + LEAD, Math.ceil(slot.end) - 1);
  let prev = first;
  for (let t = first; t <= lastTick; t = t === lastTick ? lastTick + 1 : Math.min(lastTick, t + SAMPLE)) {
    if (d2(slot, pos, t) <= R2) return t === first ? t : edgeIn(slot, pos, prev, t);
    prev = t;
  }
  return -1;
}

/** `edge(lo, hi, (t) => d2(slot, pos, t) <= R2)` without the closure (the per-step entry search). */
function edgeIn(slot: ConvoySlot, pos: Vec2, lo: number, hi: number): number {
  const from = d2(slot, pos, lo) <= R2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (d2(slot, pos, mid) <= R2 === from) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The approach of a pass to `pos` within the lead window after `tick`, or null. */
function approach(slot: ConvoySlot, seed: number, pos: Vec2, tick: number): ActiveEvent | null {
  const start = entryTick(slot, pos, tick);
  if (start < 0) return null;
  const inside = (t: number): boolean => d2(slot, pos, t) <= R2;
  // followed while in range: the last tick inside (bisection) and the closest sample
  let last = start;
  let best = start;
  let bestD = d2(slot, pos, start);
  const stop = Math.min(Math.ceil(slot.end) - 1, start + MAX_FOLLOW);
  for (let t = Math.min(stop, start + SAMPLE); t > last; t = Math.min(stop, t + SAMPLE)) {
    const d = d2(slot, pos, t);
    if (d > R2) {
      last = edge(last, t, inside) - 1;
      break;
    }
    last = t;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  const closest = { ...slotTraderInto(slot, best, at)! };
  return {
    key: convoyFlybyKey(slot.pass),
    kind: 'convoyFlyby',
    start,
    end: last + 1,
    dir: Math.atan2(closest.y - pos.y, closest.x - pos.x),
    sector: sectorIdAt(seed, closest.x, closest.y),
    pos: closest,
  };
}

/** The pass may come within range of `pos` in the lead window after `tick` (its route box near, in flight then). */
const candidate = (slot: ConvoySlot, pos: Vec2, tick: number): boolean =>
  slotInFlight(slot, tick, tick + LEAD) && boxDistance(slot.route, pos) <= CONVOY.flybyRadius;

/** Convoy flybys to list now (provider of `activeEvents`). */
export function convoyFlybyEvents(state: SimState): ActiveEvent[] {
  if (!canAnnounce(state)) return [];
  const { seed, tick } = state;
  const pos = state.player.body.pos;
  const out: ActiveEvent[] = [];
  for (const slot of convoySlots(seed, tick, tick + LEAD)) {
    if (!candidate(slot, pos, tick)) continue;
    const a = approach(slot, seed, pos, tick);
    if (a) out.push(a);
  }
  return out;
}

/**
 * One step: announce a new flyby, once per pass. Called by `stepDirector`. A pass already announced
 * (`director.fired`) costs nothing; for the others only the entry tick is sampled (the trader far away
 * is one sample), and the full approach is followed only in the step that announces it.
 */
export function stepConvoyFlyby(state: SimState, events: SimEvent[]): void {
  if (!canAnnounce(state)) return;
  const { seed, tick } = state;
  const fired = state.director.fired;
  const pos = state.player.body.pos;
  const prev = state.player.prevBody.pos;
  for (const slot of convoySlots(seed, tick - 1, tick + LEAD)) {
    if (!candidate(slot, pos, tick)) continue;
    const key = convoyFlybyKey(slot.pass);
    if (fired.has(key) || entryTick(slot, pos, tick) < 0) continue;
    // edge-triggered: listed for the ship's pose a tick earlier already → not announced now
    if (candidate(slot, prev, tick - 1) && entryTick(slot, prev, tick - 1) >= 0) continue;
    const e = approach(slot, seed, pos, tick)!;
    // kept until the pass is over: the way back must not announce the same pass again
    fired.set(key, Math.max(e.end, Math.ceil(slot.end)));
    events.push({ type: 'eventWarning', key, kind: 'convoyFlyby', inSeconds: Math.max(0, (e.start - tick) / TICKS), dir: e.dir });
  }
}

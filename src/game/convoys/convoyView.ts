// Convoys of the Free Traders in the game layer (M4d T9): the published passes on the map
// (the trader's pose, whether its trade is still open, when it comes nearest the ship), the convoy ships
// on the radar (scheduled passes and escort convoys), the flight mark of the nearest open pass and the
// F prompt at a trader's trade port with its approach readout (the link tolerances of `tryConvoyLink`).
// Pure functions of the state; the memo lives in GuildUi.
import { CONVOY } from '../../data/convoys';
import { tx } from '../../i18n';
import { convoyOffer, convoysInFlight, convoysNear } from '../../sim/convoys';
import { escortShips } from '../../sim/convoys/escort';
import { nearestTradePort, pirateNear, type LinkCandidate } from '../../sim/convoys/link';
import { tradeOf } from '../../sim/convoys/trade';
import type { ConvoyPose } from '../../sim/convoys/types';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { formatAmount } from '../../ui/format';
import type { GuildRadarInput } from '../../ui/radar';
import type { DockPrompt } from '../../ui/stationHud';
import type { MapConvoy } from '../map/types';

/** Has the player still something to buy from this pass (not every rare item bought)? */
export function convoyOpen(state: SimState, pass: string): boolean {
  const trade = state.convoys.trades.get(pass);
  if (!trade || trade.bought === 0) return true;
  const offer = convoyOffer(state, pass);
  if (!offer) return false;
  return offer.items.some((i) => (tradeOf(state, pass).bought & (1 << i.slot)) === 0);
}

/**
 * Seconds until a convoy flying with `vel` from `at` is nearest `ship` (a straight-line estimate),
 * when that closest approach lies ahead and within `radius`; else null.
 */
export function closestApproach(at: Vec2, vel: Vec2, ship: Vec2, radius: number): number | null {
  const v2 = vel.x * vel.x + vel.y * vel.y;
  if (v2 < 1e-9) return null;
  const rx = ship.x - at.x;
  const ry = ship.y - at.y;
  const t = (rx * vel.x + ry * vel.y) / v2;
  if (t <= 0) return null;
  const dx = at.x + vel.x * t - ship.x;
  const dy = at.y + vel.y * t - ship.y;
  return dx * dx + dy * dy <= radius * radius ? t : null;
}

/** The passes in flight for the map (the schedule is published): the trader's pose, open, ETA near the ship. */
export function mapConvoys(state: SimState, poses: readonly ConvoyPose[] = convoysInFlight(state.seed, state.tick)): MapConvoy[] {
  const ship = state.player.body.pos;
  return poses.map((p) => {
    const trader = p.ships[0]!;
    const eta = closestApproach(trader.pos, p.vel, ship, CONVOY.flybyRadius);
    return { pass: p.pass, pos: { x: trader.pos.x, y: trader.pos.y }, heading: trader.heading, lane: p.lane, open: convoyOpen(state, p.pass), ...(eta !== null ? { eta } : {}) };
  });
}

/**
 * Convoy ships near `pos` for the radar: every ship of the scheduled passes (the trader first; the
 * cosmetic cutter is a Guild ship – it goes with the Watch) and the escort convoys of active contracts.
 */
export function convoyRadarInput(state: SimState, pos: Vec2, range: number): GuildRadarInput {
  const convoys: { pos: Vec2; angle: number; tanker?: boolean }[] = [];
  const watch: { pos: Vec2; angle: number }[] = [];
  for (const p of convoysNear(state.seed, pos, range + 40, state.tick)) {
    for (const s of p.ships) {
      if (s.kind === 'cutter') watch.push({ pos: s.pos, angle: s.heading });
      else convoys.push({ pos: s.pos, angle: s.heading, ...(s.kind === 'tanker' ? { tanker: true } : {}) });
    }
  }
  if (state.convoys.escorts.size > 0) {
    for (const c of state.career.contracts) {
      if (c.target.kind !== 'escort') continue;
      const e = state.convoys.escorts.get(c.serial);
      if (!e) continue;
      for (const s of escortShips(state, c.serial, e, c.target)) convoys.push({ pos: s.pos, angle: s.heading, ...(s.kind === 'tanker' ? { tanker: true } : {}) });
    }
  }
  return { convoys, watch };
}

/** The nearest pass in flight within `CONVOY.flybyRadius` whose trade is still open (the flight mark), or null. */
export function nearestOpenConvoy(state: SimState): { pass: string; pos: Vec2; distance: number } | null {
  if (state.convoys.link) return null;
  const ship = state.player.body.pos;
  let best: { pass: string; pos: Vec2; distance: number } | null = null;
  for (const p of convoysNear(state.seed, ship, CONVOY.flybyRadius, state.tick)) {
    if (p.leg === 'turn') continue;
    const t = p.ships[0]!.pos;
    const distance = Math.hypot(t.x - ship.x, t.y - ship.y);
    if (best && distance >= best.distance) continue;
    if (!convoyOpen(state, p.pass)) continue;
    best = { pass: p.pass, pos: t, distance };
  }
  return best;
}

/** Why F would not link now (null = it would): the same order as `tryConvoyLink`. */
export function linkBlocker(state: SimState, near: LinkCandidate): 'tooFar' | 'tooFast' | 'pirates' | null {
  if (near.distance > CONVOY.linkRange) return 'tooFar';
  if (near.speed > CONVOY.linkSpeed) return 'tooFast';
  if (pirateNear(state, state.player.body.pos, CONVOY.linkPirateRadius)) return 'pirates';
  return null;
}

/** The F prompt with the approach readout at a trader's trade port (null = no port in play, or linked). */
export function linkPrompt(state: SimState, near: LinkCandidate | null = nearestTradePort(state)): DockPrompt | null {
  if (!near || state.convoys.link) return null;
  const r = tx().docking.readout;
  const l = tx().guild.link;
  const items = [
    { id: 'distance' as const, label: l.port, value: `${formatAmount(near.distance)} ${r.distanceUnit}`, limit: r.limit(`${CONVOY.linkRange} ${r.distanceUnit}`), ok: near.distance <= CONVOY.linkRange + 1e-6 },
    { id: 'speed' as const, label: r.speed, value: `${formatAmount(near.speed)} ${r.speedUnit}`, limit: r.limit(`${formatAmount(CONVOY.linkSpeed)} ${r.speedUnit}`), ok: near.speed <= CONVOY.linkSpeed + 1e-6 },
  ];
  const approach = { items, computer: false, title: l.readout };
  switch (linkBlocker(state, near)) {
    case 'tooFar':
      return { text: l.approach, kind: 'info', approach };
    case 'tooFast':
      return { text: l.slowDown, kind: 'warn', approach };
    case 'pirates':
      return { text: l.pirates, kind: 'warn', approach };
    case null:
      return { text: l.prompt, kind: 'ok', approach };
  }
}

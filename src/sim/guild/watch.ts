// Live Guild Watch ships (M4d plan §2.3 "Live bubble").
//
// Every SPAWN_CHECK_INTERVAL a scheduled ship within `WATCH.liveRadius` of the flying player becomes a
// live sim ship at its scheduled pose and velocity – unless its id is lost (destroyed / retreated, back
// after `WATCH.respawnTicks`), it is live already, `WATCH.maxLive` ships are live, or the AI budget is
// spent (pirates + live Watch + escort convoy ships ≤ `WATCH.aiBudget`, pirates keep priority). A live
// `patrol` ship beyond `WATCH.despawnRadius` returns to the schedule (removed; whole again when it next
// materialises). Docked / berthed / dead player: nothing materialises; live ships fly on and despawn by
// distance. `spawnRelayWatch` brings a relay hold's reinforcement (frigate + 2 cutters, `gw:relay:<lane>|<i>`)
// – it is not on the schedule, so it never materialises by itself.
import { RELAY_CHAIN, WATCH } from '../../data/guild';
import { SPAWN_CHECK_INTERVAL } from '../combat/combat';
import type { GameAction } from '../commands';
import type { Vec2 } from '../math/vec2';
import { npcBudgetLeft } from '../npc/targets';
import type { LaneId } from '../regions/lanes';
import { sectorLanes } from '../regions/sectors';
import type { SimEvent, SimState } from '../Simulation';
import { guildRelaySites } from './relaySites';
import type { WatchShip } from './types';
import { stepWatchAi } from './watchAi';
import { polylineArc, routeById, scheduledAt, scheduledWatchNear, watchId, type ScheduledWatch } from './watchRoutes';

/** A new live ship at a scheduled pose (full hull and shield, guns ready). */
export function createWatchShip(s: Pick<ScheduledWatch, 'id' | 'route' | 'slot' | 'kind' | 'pos' | 'vel' | 'heading'>, tick: number): WatchShip {
  const def = WATCH.ships[s.kind];
  const body = { pos: { ...s.pos }, vel: { ...s.vel }, angle: s.heading, angVel: 0 };
  return {
    id: s.id,
    kind: s.kind,
    body,
    prevBody: body,
    hull: def.hull,
    shield: def.shield,
    shieldDelay: 0,
    cooldowns: def.guns.map(() => 0),
    mode: 'patrol',
    target: null,
    route: s.route,
    slot: s.slot,
    modeTick: tick,
    lastHitBy: -1,
  };
}

/** The player can meet the Watch: flying, alive, not berthed at a derelict. */
const playerAbroad = (state: SimState): boolean => state.player.dock.mode === 'flying' && !state.player.destroyed && state.sites.berth === null;

/** Despawn far patrol ships, then materialise scheduled ships near the player (every SPAWN_CHECK_INTERVAL). */
export function manageWatch(state: SimState): void {
  const g = state.guild;
  const pos = state.player.body.pos;
  g.watch = g.watch.filter((w) => w.mode !== 'patrol' || Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) <= WATCH.despawnRadius);
  if (!playerAbroad(state)) return;
  const live = new Set(g.watch.map((w) => w.id));
  for (const s of scheduledWatchNear(state, pos, WATCH.liveRadius)) {
    if (g.watch.length >= WATCH.maxLive || npcBudgetLeft(state) <= 0) break;
    if (live.has(s.id) || g.lost.has(s.id)) continue;
    g.watch.push(createWatchShip(s, state.tick));
    live.add(s.id);
  }
}

/** One step of the live Watch: respawn timers, the live bubble, then every live ship's AI and guns. */
export function stepWatch(state: SimState, events: SimEvent[], dt: number): void {
  const g = state.guild;
  if (g.lost.size > 0) for (const [id, at] of [...g.lost]) if (state.tick - at >= WATCH.respawnTicks) g.lost.delete(id);
  if (state.tick % SPAWN_CHECK_INTERVAL === 0) manageWatch(state);
  if (g.watch.length === 0) return;
  for (const ship of [...g.watch]) {
    if (stepWatchAi(state, ship, events, dt)) continue;
    g.watch = g.watch.filter((w) => w !== ship);
    // a retreat that got away counts like a loss (back after the respawn time); a vanished route does not
    if (ship.mode === 'retreat') g.lost.set(ship.id, state.tick);
  }
}

/** Arc of the point of a polyline nearest to `p`. */
function nearestArc(points: readonly Vec2[], arc: readonly number[], p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = arc[i - 1]! + Math.sqrt(l2) * t;
    }
  }
  return best;
}

/** Point and unit direction (outbound) of a polyline at arc `s`. */
function laneFrame(points: readonly Vec2[], arc: readonly number[], s: number): { p: Vec2; t: Vec2 } {
  let i = 1;
  while (i < points.length - 1 && arc[i]! < s) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const l = Math.max(1e-9, arc[i]! - arc[i - 1]!);
  const k = Math.max(0, Math.min(1, (s - arc[i - 1]!) / l));
  return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, t: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
}

/**
 * The Guild reinforcement of a relay hold on `lane` (added to `guild.watch`): `RELAY_CHAIN.reinforcement`
 * comes in `RELAY_CHAIN.watchFrom` u down the lane (toward home) from the mast and flies to its circle around
 * the mast (`relay:<lane>` route, mode `return` – it fights the counterattack on the way in). Ignores
 * `maxLive` but not the AI budget; ships already live are kept. Returns the new ships.
 */
export function spawnRelayWatch(state: SimState, lane: LaneId): WatchShip[] {
  const site = guildRelaySites(state.seed).find((s) => s.lane === lane);
  const line = sectorLanes(state.seed).find((l) => l.id === lane);
  const route = routeById(state, `relay:${lane}`);
  if (!site || !line || !route) return [];
  const arc = polylineArc(line.points);
  const s = Math.max(0, nearestArc(line.points, arc, site.pos) - RELAY_CHAIN.watchFrom);
  const { p, t } = laneFrame(line.points, arc, s);
  const g = state.guild;
  const out: WatchShip[] = [];
  route.members.forEach((m, slot) => {
    const id = watchId(route.id, slot);
    if (g.watch.some((w) => w.id === id) || npcBudgetLeft(state) <= 0) return;
    const sched = scheduledAt(route, slot, state.tick);
    // in formation behind the leader, heading up the lane toward the mast
    const pos = { x: p.x - t.x * m.behind + t.y * m.side, y: p.y - t.y * m.behind - t.x * m.side };
    const ship = createWatchShip({ ...sched, pos, vel: { x: t.x * WATCH.ships[m.kind].maxSpeed * 0.5, y: t.y * WATCH.ships[m.kind].maxSpeed * 0.5 }, heading: Math.atan2(t.y, t.x) }, state.tick);
    ship.mode = 'return';
    g.lost.delete(id);
    g.watch.push(ship);
    out.push(ship);
  });
  return out;
}

/** How far beside the Watch ship `debugGuild { what: 'watch' }` puts the player (u). */
const DEBUG_BESIDE = 60;
/** How far `debugGuild { what: 'watch' }` looks for a scheduled ship (u). */
const DEBUG_SEARCH = 6000;

/**
 * Dev only (`debugGuild { what: 'watch' }`): moves the flying player beside the nearest scheduled Watch ship
 * (not lost, not live) and materialises it at once (ignores `maxLive` and the budget). "Unavailable" when
 * the player does not fly or no ship is near.
 */
export function debugWatchNear(state: SimState, action: GameAction): SimEvent[] {
  const fail: SimEvent[] = [{ type: 'actionResult', reqId: action.reqId, ok: false, reason: 'serviceUnavailable' }];
  // dev builds only, like the other debugGuild commands – in production a crafted command would be a free
  // teleport up to DEBUG_SEARCH away (saboteur G4)
  if (action.type !== 'debugGuild' || !import.meta.env.DEV || !playerAbroad(state)) return fail;
  const g = state.guild;
  const pos = state.player.body.pos;
  const s = scheduledWatchNear(state, pos, DEBUG_SEARCH).find((w) => !g.lost.has(w.id) && !g.watch.some((x) => x.id === w.id));
  if (!s) return fail;
  const h = s.heading;
  const at = { x: s.pos.x + Math.sin(h) * DEBUG_BESIDE, y: s.pos.y - Math.cos(h) * DEBUG_BESIDE };
  const player = state.player;
  player.body = { ...player.body, pos: at, vel: { ...s.vel }, angle: h, angVel: 0 };
  player.prevBody = player.body;
  g.watch.push(createWatchShip(s, state.tick));
  return [{ type: 'actionResult', reqId: action.reqId, ok: true }];
}

// The Guild in the game layer (M4d T9): the flight status chips (`GuildStatusData`
// – the escort convoy's hull, state, distance and next step; the relay contract's stage and hint), the
// Guild relay sites the player knows (map) and sees (radar), and the Watch ships near the ship (radar,
// map). Pure functions of the state; GuildUi memoises them. No friendly fire (user decision
// 2026-10-16): no hostility, warning or fine.
import { ESCORT } from '../../data/convoys';
import type { Contract } from '../../sim/career/types';
import { escortHasTanker, escortShips } from '../../sim/convoys/escort';
import { guildRelaySites } from '../../sim/guild';
import { relayStage } from '../../sim/guild/relayChain';
import type { GuildRelaySite } from '../../sim/guild/types';
import { scheduledWatchNear } from '../../sim/guild/watchRoutes';
import type { Vec2 } from '../../sim/math/vec2';
import { sectorKnowledge } from '../../sim/regions/knowledge';
import type { SimState } from '../../sim/Simulation';
import { escortNext, relayStageView } from '../board/slipView';
import type { MapRelay, MapWatch } from '../map/types';
import type { GuildEscortStatus, GuildRelayStatus, GuildStatusData } from './types';

type EscortContract = Contract & { target: Extract<Contract['target'], { kind: 'escort' }> };
type RelayContract = Contract & { target: Extract<Contract['target'], { kind: 'relay' }> };

const isEscort = (c: Contract): c is EscortContract => c.target.kind === 'escort';
const isRelay = (c: Contract): c is RelayContract => c.target.kind === 'relay';

/** The share 0..1 of a convoy ship's hull (index 0 = the trader). */
const hullShare = (hp: number, index: number): number => Math.max(0, Math.min(1, hp / (index === 0 ? ESCORT.traderHull : ESCORT.tankerHull)));

/** The trader of an escort contract now: its pose once its record exists, else the meeting point. */
export function escortTraderPos(state: SimState, c: EscortContract): Vec2 {
  const e = state.convoys.escorts.get(c.serial);
  if (!e) return c.target.meet;
  const trader = escortShips(state, c.serial, e, c.target).find((s) => s.index === 0);
  return trader?.pos ?? c.target.end;
}

/** The escort chip of the first escort contract (null = none). */
export function escortStatus(state: SimState): GuildEscortStatus | null {
  const c = state.career.contracts.find(isEscort);
  if (!c) return null;
  const e = state.convoys.escorts.get(c.serial) ?? null;
  const hull = e ? e.hulls.map(hullShare) : escortHasTanker(state.seed, c.id) ? [1, 1] : [1];
  const at = escortTraderPos(state, c);
  const p = state.player.body.pos;
  return { hull, state: e?.state ?? 'waiting', distance: Math.hypot(at.x - p.x, at.y - p.y), next: escortNext(state, c.target.meet, e?.state ?? null) };
}

/** The relay chip of the relay contract (null = none). */
export function relayStatus(state: SimState): GuildRelayStatus | null {
  const c = state.career.contracts.find(isRelay);
  if (!c) return null;
  const v = relayStageView(state, c.target.lane, c.target.sector);
  return { lane: c.target.lane, stage: v.stage, hint: v.hint };
}

/** The flight HUD's Guild chips; null when there is nothing to show. */
export function guildStatus(state: SimState): GuildStatusData | null {
  const escort = escortStatus(state);
  const relay = relayStatus(state);
  return escort || relay ? { escort, relay } : null;
}

/** The lane of the active relay contract (its mast already has the objective arrow), or null. */
export const relayContractLane = (state: SimState): string | null => state.career.contracts.find(isRelay)?.target.lane ?? null;

/**
 * Does the player know a Guild relay site? Its chain has a stage, a relay contract for it is active or
 * on a board the player saw, or its sector is Charted.
 */
export function relayKnown(state: SimState, site: GuildRelaySite): boolean {
  if (state.guild.relays.has(site.lane)) return true;
  if (state.career.contracts.some((c) => c.target.kind === 'relay' && c.target.lane === site.lane)) return true;
  for (const board of state.career.boards.values()) {
    if (board.offers.some((o) => o.target.kind === 'relay' && o.target.lane === site.lane)) return true;
  }
  return sectorKnowledge(state, site.sector) === 'charted';
}

/** Every Guild relay site of the seed with its stage and whether the player knows it (map; unknown ones are not drawn). */
export function mapRelays(state: SimState): MapRelay[] {
  return guildRelaySites(state.seed).map((s) => ({ pos: s.pos, lane: s.lane, stage: relayStage(state, s.lane), known: relayKnown(state, s) }));
}

/** Guild relay masts within `range` of `pos` for the radar (a site is a contact in range, known or not; lit = powered or secured). */
export function relayRadarInput(state: SimState, pos: Vec2, range: number): { pos: Vec2; lit: boolean }[] {
  const out: { pos: Vec2; lit: boolean }[] = [];
  for (const s of guildRelaySites(state.seed)) {
    if (Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) > range) continue;
    const stage = relayStage(state, s.lane);
    out.push({ pos: s.pos, lit: stage === 'powered' || stage === 'secured' });
  }
  return out;
}

/**
 * Guild Watch ships within `range` of `pos`: the live ones (simulated near the player) and the
 * scheduled patrol ships that are not live (the renderer draws them on their routes too).
 */
export function watchNear(state: SimState, pos: Vec2, range: number): { pos: Vec2; angle: number; kind: MapWatch['kind'] }[] {
  const out: { pos: Vec2; angle: number; kind: MapWatch['kind'] }[] = [];
  const live = new Set<string>();
  for (const w of state.guild.watch) {
    live.add(w.id);
    if (Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) <= range) out.push({ pos: w.body.pos, angle: w.body.angle, kind: w.kind });
  }
  for (const s of scheduledWatchNear(state, pos, range)) {
    // a lost ship is off its route until it respawns
    if (!live.has(s.id) && !state.guild.lost.has(s.id)) out.push({ pos: s.pos, angle: s.heading, kind: s.kind });
  }
  return out;
}

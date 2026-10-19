// Guild relay sites (M4d plan §2.2 "Relay sites") – OWNED BY T2.
//
// `guildRelaySites(seed)` (pure, cached per seed): per lane (A, B) walk the lane line from home and cut it
// into runs – stretches that lie in one sector. The first run whose sector is statically Contested, not
// fixed, of depth 2 (lane A may fall back to depth 3 when it has no depth-2 run) and at least
// `lanes.laneMin` long carries the relay: the mast stands at the middle of the run, `RELAY_CHAIN.sides`
// to the right of / left of the outbound direction, the run's middle shifted by `RELAY_CHAIN.along`; the
// first candidate that stays in the sector and keeps clear of stations, M4b sites, rocks, fortresses,
// survey points, Echo sites and POIs wins. No run or no candidate → the lane has no relay (never offered).
// A sector already taken by lane A is skipped by lane B (one relay per sector).
//
// `guildRelayCandidates(state)` lists `gr:<lane>` for `stepRelays` only while the lane's stage is
// `repaired` (placement.ts `relayCandidates` appends it). The mast collides and stops shots like a
// derelict relay (`GUILD_RELAY_LAYOUT`), whatever its stage.
import { ECHO_RADIUS } from '../../data/echoes';
import { GUILD_RELAY_LAYOUT, RELAY_CHAIN } from '../../data/guild';
import { DERELICT_LAYOUTS, GRAVEYARD, RELAY_LAYOUT } from '../../data/sites';
import { echoSites, poiRadius, poisInChunk } from '../discovery/poi';
import { hypot, type Vec2 } from '../math/vec2';
import type { NpcHitTarget } from '../npc/types';
import type { Circle } from '../physics/collide';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import { REGION_GEN, type Depth } from '../regions/constants';
import type { GuildLane, LaneId } from '../regions/lanes';
import { sectorInfo, sectorLanes } from '../regions/sectors';
import { surveyPointsNear } from '../regions/survey';
import { regionWorld } from '../regions/world';
import { STRUCTURE_HIT_RANGE } from '../sites/colliders';
import { sitesNear } from '../sites/placement';
import type { RelaySite } from '../sites/types';
import type { SimState } from '../Simulation';
import { CHUNK_SIZE, chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { stationsInArea } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import type { GuildRelaySite } from './types';

/** The Guild relay id of a lane. */
export const guildRelayId = (lane: LaneId): string => `gr:${lane}`;

/** The mast's collision radius on the plane (the layout's single circle). */
export const MAST_RADIUS = Math.max(...GUILD_RELAY_LAYOUT.circles.map((c) => hypot(c.x, c.y) + c.r));

/** Lane line samples (u) – the same step the region world measures the lane runs with. */
const SAMPLE = 25;

/** A stretch of a lane line inside one sector (arc lengths from home). */
export interface LaneRun {
  sector: string;
  from: number;
  to: number;
}

/** Cumulative arc length of every lane point. */
function arcs(points: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  return out;
}

/** The lane cut into runs of consecutive samples in one sector, in order from home. */
export function laneRuns(seed: number, lane: GuildLane): LaneRun[] {
  const field = regionWorld(seed).field;
  const runs: LaneRun[] = [];
  let at = 0;
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1]!;
    const b = lane.points[i]!;
    const len = hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / SAMPLE));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const id = field.regionAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t).id;
      const from = at + (len * k) / n;
      const to = at + (len * (k + 1)) / n;
      const last = runs[runs.length - 1];
      if (last && last.sector === id) last.to = to;
      else runs.push({ sector: id, from, to });
    }
    at += len;
  }
  return runs;
}

/** The lane point at arc length `s` (clamped) and the outbound unit direction there. */
function laneAt(points: readonly Vec2[], cum: readonly number[], s: number): { pos: Vec2; dir: Vec2 } {
  const total = cum[cum.length - 1]!;
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < points.length - 1 && cum[i]! < d) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const len = cum[i]! - cum[i - 1]!;
  const t = len > 0 ? (d - cum[i - 1]!) / len : 0;
  const l = hypot(b.x - a.x, b.y - a.y) || 1;
  return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
}

const far = (a: Vec2, b: Vec2, r: number): boolean => hypot(a.x - b.x, a.y - b.y) >= r;

/** Does a mast at `pos` keep clear of everything else in the world (plan §2.2 clearances)? */
export function relaySpotClear(seed: number, pos: Vec2): boolean {
  const C = RELAY_CHAIN.clear;
  const own = GUILD_RELAY_LAYOUT.clearRadius;
  const cx = chunkCoord(pos.x);
  const cy = chunkCoord(pos.y);
  // stations of both world generations (they differ only near the guaranteed stations)
  for (const gen of WORLD_GENS) {
    for (const s of stationsInArea(seed, cx - 2, cx + 2, cy - 2, cy + 2, gen)) if (!far(pos, s.pos, s.clearRadius + C.station + own)) return false;
  }
  // fortresses
  for (const f of fortressSites(seed)) if (!far(pos, f.pos, FORTRESS_LAYOUT.clearRadius + C.fortress + own)) return false;
  // Echo sites (their beacon and light column)
  for (const e of echoSites(seed)) if (!far(pos, e.pos, ECHO_RADIUS + 60 + own)) return false;
  // M4b sites: a derelict's hull and its relays, a graveyard's whole field
  for (const s of sitesNear(seed, pos, GRAVEYARD.radius + 2 * CHUNK_SIZE)) {
    if (s.kind === 'graveyard') {
      if (!far(pos, s.pos, GRAVEYARD.radius + C.site + own)) return false;
    } else {
      if (!far(pos, s.pos, DERELICT_LAYOUTS[s.model].clearRadius + C.site + own)) return false;
      for (const r of s.relays) if (!far(pos, r.pos, RELAY_LAYOUT.clearRadius + C.site + own)) return false;
    }
  }
  // survey points
  if (surveyPointsNear(seed, pos, C.survey + own).some((p) => !far(pos, p.pos, C.survey + own))) return false;
  // asteroids (both world generations) and POIs of the chunk and its neighbours
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const p of poisInChunk(seed, cx + dx, cy + dy)) if (!far(pos, p.pos, poiRadius(p) + C.poi + own)) return false;
      for (const gen of WORLD_GENS) {
        for (const a of generateChunk(seed, cx + dx, cy + dy, gen).asteroids) if (!far(pos, a.pos, a.baseRadius + C.rock + own)) return false;
      }
    }
  }
  return true;
}

/** The mast spot of a run: the first candidate (along × side) inside the run's sector that keeps clear, or null. */
function siteOfRun(seed: number, lane: GuildLane, cum: readonly number[], run: LaneRun): { pos: Vec2; angle: number } | null {
  const field = regionWorld(seed).field;
  const mid = (run.from + run.to) / 2;
  for (const along of RELAY_CHAIN.along) {
    const { pos: on, dir } = laneAt(lane.points, cum, mid + along);
    // right of the outbound direction (+y = north): (dir.y, -dir.x)
    const right = { x: dir.y, y: -dir.x };
    for (const side of RELAY_CHAIN.sides) {
      const pos = { x: on.x + right.x * side, y: on.y + right.y * side };
      if (field.regionAt(pos.x, pos.y).id !== run.sector) continue;
      if (!relaySpotClear(seed, pos)) continue;
      // the receiver (+x of the layout) faces the lane
      return { pos, angle: Math.atan2(on.y - pos.y, on.x - pos.x) };
    }
  }
  return null;
}

/** Depths a lane's relay sector may have, in order of preference (lane A may fall back to depth 3). */
const laneDepths = (lane: LaneId): readonly Depth[] => (lane === 'A' ? RELAY_CHAIN.depths : RELAY_CHAIN.depths.slice(0, 1));

/** Build the sites of a seed (uncached – tests check the cache against it). */
export function buildGuildRelaySites(seed: number): GuildRelaySite[] {
  const out: GuildRelaySite[] = [];
  const taken = new Set<string>();
  for (const lane of sectorLanes(seed)) {
    const runs = laneRuns(seed, lane);
    const cum = arcs(lane.points);
    let found: GuildRelaySite | null = null;
    for (const depth of laneDepths(lane.id)) {
      const run = runs.find((r) => {
        if (r.to - r.from < REGION_GEN.lanes.laneMin || taken.has(r.sector)) return false;
        const info = sectorInfo(seed, r.sector);
        return info !== null && info.depth === depth && info.security === 'contested' && info.fixed === null;
      });
      if (!run) continue;
      // the first eligible sector carries the relay – no spot there means no relay for the lane
      const spot = siteOfRun(seed, lane, cum, run);
      if (spot) {
        const id = guildRelayId(lane.id);
        const relay: RelaySite = { id, pos: spot.pos, angle: spot.angle, owner: 'guild', group: id };
        found = { lane: lane.id, id, sector: run.sector, depth, pos: spot.pos, angle: spot.angle, relay };
      }
      break;
    }
    if (found) {
      out.push(found);
      taken.add(found.sector);
    }
  }
  return out;
}

const siteCache = new Map<number, readonly GuildRelaySite[]>();

/** The Guild relay site of each lane that has one (A before B). Pure, cached per seed. */
export function guildRelaySites(seed: number): readonly GuildRelaySite[] {
  const hit = siteCache.get(seed);
  if (hit) return hit;
  if (siteCache.size >= 16) siteCache.clear();
  const sites = buildGuildRelaySites(seed);
  siteCache.set(seed, sites);
  return sites;
}

/** The Guild relay site of a lane, or null. */
export const guildRelaySite = (seed: number, lane: LaneId): GuildRelaySite | null => guildRelaySites(seed).find((s) => s.lane === lane) ?? null;

/** The Guild relay site with this id (`gr:<lane>`) of this seed, or null. */
export const guildRelayById = (seed: number, id: string): GuildRelaySite | null => guildRelaySites(seed).find((s) => s.id === id) ?? null;

const NO_RELAYS: readonly RelaySite[] = [];
const NO_CIRCLES: readonly Circle[] = [];
const NO_TARGETS: readonly NpcHitTarget[] = [];

/** Guild relays the player's beams could charge this step (input of `stepRelays`, via `relayCandidates`). */
export function guildRelayCandidates(state: SimState): readonly RelaySite[] {
  const relays = state.guild.relays;
  if (relays.size === 0) return NO_RELAYS;
  const { player } = state;
  let reach = 0;
  for (const l of player.props.lasers) reach = Math.max(reach, l.range);
  reach += player.props.boundingRadius + GUILD_RELAY_LAYOUT.clearRadius;
  let out: RelaySite[] | null = null;
  for (const site of guildRelaySites(state.seed)) {
    if (relays.get(site.lane)?.stage !== 'repaired' || state.sites.powered.has(site.id)) continue;
    if (!far(player.body.pos, site.pos, reach)) (out ??= []).push(site.relay);
  }
  return out ?? NO_RELAYS;
}

const circleCache = new WeakMap<GuildRelaySite, readonly Circle[]>();
const targetCache = new WeakMap<GuildRelaySite, NpcHitTarget>();

/** World circles of a mast (cached per site object). */
function mastCircles(site: GuildRelaySite): readonly Circle[] {
  let hit = circleCache.get(site);
  if (!hit) {
    const c = Math.cos(site.angle);
    const s = Math.sin(site.angle);
    hit = GUILD_RELAY_LAYOUT.circles.map((k) => ({ pos: { x: site.pos.x + k.x * c - k.y * s, y: site.pos.y + k.x * s + k.y * c }, radius: k.r }));
    circleCache.set(site, hit);
  }
  return hit;
}

/** Guild relay mast circles within `reach` of `pos` (hard obstacles; mining beams stop at them). */
export function relayMastColliders(state: SimState, pos: Vec2, reach: number): readonly Circle[] {
  let out: Circle[] | null = null;
  for (const site of guildRelaySites(state.seed)) {
    if (far(pos, site.pos, reach + MAST_RADIUS)) continue;
    for (const circle of mastCircles(site)) if (!far(pos, circle.pos, reach + circle.radius)) (out ??= []).push(circle);
  }
  return out ?? NO_CIRCLES;
}

/** Guild relay masts near the player that stop projectiles (kind 'relay', a spent hit). */
export function relayMastHitTargets(state: SimState): readonly NpcHitTarget[] {
  let out: NpcHitTarget[] | null = null;
  for (const site of guildRelaySites(state.seed)) {
    if (far(state.player.body.pos, site.pos, STRUCTURE_HIT_RANGE)) continue;
    let t = targetCache.get(site);
    if (!t) {
      t = { id: site.id, kind: 'relay', pos: site.pos, radius: MAST_RADIUS, shield: 0, damageable: false };
      targetCache.set(site, t);
    }
    (out ??= []).push(t);
  }
  return out ?? NO_TARGETS;
}

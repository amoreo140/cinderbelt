// Static collision and projectile circles of derelicts and relays (M4b plan §2.4) – OWNED BY T3.
// Circles from `DERELICT_LAYOUTS` / `RELAY_LAYOUT` (data/sites.ts) rotated by the site's angle. Ships
// (player and pirates), wrecks and containers collide with them (`siteColliders` in index.ts);
// projectiles stop at them (`siteHitTargets`, kind 'structure'); mining beams stop at them (Simulation's
// mining blockers – a relay's receiver is charged by the beam on the mast, relays.ts).
//
// Hot path: asked for every ship, wreck and container every step. The world circles of a site are built
// once per site object (the placement memo hands out the same objects) and an empty answer allocates
// nothing.
import { clearList } from '../scratch';
import { DERELICT_LAYOUTS, RELAY_LAYOUT } from '../../data/sites';
import { add, hypot, rotate, type Vec2 } from '../math/vec2';
import type { Circle } from '../physics/collide';
import type { SimEvent, SimState } from '../Simulation';
import { DERELICT_EXTENT, sitesNearInto } from './placement';
import type { DerelictSite, Site, SiteHit, SiteHitTarget } from './types';

/** A structure circle with the id of what it belongs to (the derelict or one of its relays). */
interface StructureCircle {
  id: string;
  circle: Circle;
}

const circleCache = new WeakMap<DerelictSite, readonly StructureCircle[]>();

/** World circles of a derelict and its relays (cached per site object). */
export function derelictCircles(site: DerelictSite): readonly StructureCircle[] {
  const hit = circleCache.get(site);
  if (hit) return hit;
  const out: StructureCircle[] = [];
  for (const c of DERELICT_LAYOUTS[site.model].circles) out.push({ id: site.id, circle: { pos: add(site.pos, rotate(c, site.angle)), radius: c.r } });
  for (const relay of site.relays) {
    for (const c of RELAY_LAYOUT.circles) out.push({ id: relay.id, circle: { pos: add(relay.pos, rotate(c, relay.angle)), radius: c.r } });
  }
  circleCache.set(site, out);
  return out;
}

/** Derelict and relay circles within `reach` of `pos` (hard obstacles, not `safe`). */
export function structureColliders(state: SimState, pos: Vec2, reach: number): Circle[] {
  return structureCollidersInto(state, pos, reach, []);
}

/** Scratch of `structureCollidersInto` (filled and read within the call). */
const nearSites: Site[] = [];

/** `structureColliders` appended to `out` (same order) – no closure or list per call (perf audit 2026-10-17, P4). */
export function structureCollidersInto(state: SimState, pos: Vec2, reach: number, out: Circle[]): Circle[] {
  const sites = sitesNearInto(state.seed, pos, reach + DERELICT_EXTENT, nearSites);
  for (const site of sites) {
    if (site.kind !== 'derelict') continue;
    for (const { circle } of derelictCircles(site)) {
      if (hypot(circle.pos.x - pos.x, circle.pos.y - pos.y) <= reach + circle.radius) out.push(circle);
    }
  }
  clearList(sites);
  return out;
}

/** Projectiles near the player that can meet a structure: the active combat area. */
export const STRUCTURE_HIT_RANGE = 700;

const targetCache = new WeakMap<DerelictSite, readonly SiteHitTarget[]>();

function derelictTargets(site: DerelictSite): readonly SiteHitTarget[] {
  const hit = targetCache.get(site);
  if (hit) return hit;
  const out = derelictCircles(site).map(({ id, circle }): SiteHitTarget => ({ id, kind: 'structure', pos: circle.pos, radius: circle.radius }));
  targetCache.set(site, out);
  return out;
}

/** Derelict / relay circles projectiles stop at (near the player). */
export function structureHitTargets(state: SimState): SiteHitTarget[] {
  return structureHitTargetsInto(state, []);
}

/** `structureHitTargets` appended to `out` (same order, no closure or list per call). Returns `out`. */
export function structureHitTargetsInto(state: SimState, out: SiteHitTarget[]): SiteHitTarget[] {
  const sites = sitesNearInto(state.seed, state.player.body.pos, STRUCTURE_HIT_RANGE, hitSites);
  for (const site of sites) if (site.kind === 'derelict') for (const t of derelictTargets(site)) out.push(t);
  clearList(sites);
  return out;
}

/** Scratch of `structureHitTargetsInto`. */
const hitSites: Site[] = [];

/** A projectile hit a derelict or relay: a spent shot (`projectileHit` target 'station', `site` = id). */
export function onStructureHit(_state: SimState, target: SiteHitTarget, hit: SiteHit, events: SimEvent[]): void {
  events.push({ type: 'projectileHit', target: 'station', owner: hit.owner, ref: null, pos: { ...hit.pos }, damage: hit.damage, from: { ...hit.from }, site: target.id });
}

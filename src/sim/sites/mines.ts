// Live mines of the graveyards (M4b plan §2.5) – OWNED BY T5.
//
// Mine i of a graveyard (`gy:<cx>,<cy>:m<i>`) sits at `site.mines[i]` (placement.ts). A ship – the player
// or any pirate – whose hull comes within `MINE.armRange` arms it (`mineArmed`); after `MINE.fuseSeconds`
// of fast blink it blows (`mineExploded`) wherever the ship is by then. The blast hits every ship whose
// hull lies within `MINE.blastRadius`: `MINE.damage` at the centre, falling linearly to 0 at the edge, on
// the part nearest to the blast (the CUT_BLAST path: `applyRam`, cause 'hazard', no shield). A projectile
// hit (`onMineHit`, any owner) blows it at once – shooting a mine from range is safe. A blast wakes an
// asleep sleeping party within `GRAVEYARD.wakeWreckRange` (graveyard.ts).
//
// Saved: the gone mines (bitmask `GraveyardState.mines`). The fuse of an armed mine (≤ 1.5 s) lives beside
// the state (`armedMines`, keyed by the `SitesState` object); save V17 stores it through `armedMineList` /
// `restoreArmedMines`, so a fuse burning at the save blows on the same tick after a load.
import { clearList } from '../scratch';
import { GRAVEYARD, MINE } from '../../data/sites';
import { applyRam } from '../combat/combat';
import { worldToGrid } from '../combat/geometry';
import { PLAYER_REF, type CombatShip, type Enemy, type ShipRef } from '../combat/types';
import { hypot, type Vec2 } from '../math/vec2';
import { partCenter } from '../ship/grid';
import type { SimEvent, SimState } from '../Simulation';
import { wakeGraveyardsNear } from './graveyard';
import { mineId, parseMineId } from './graveyardKeys';
import { touchGraveyard } from './graveyardState';
import { forSitesNear, siteById, sitesNearInto } from './placement';
import type { GraveyardSite, Site, SiteHit, SiteHitTarget, SitesState } from './types';

const TICKS_PER_SECOND = 60;
/** Steps from arming to the blast. */
export const MINE_FUSE_TICKS = Math.round(MINE.fuseSeconds * TICKS_PER_SECOND);
/**
 * Mines of graveyards whose centre lies this close to the player are live (pirates exist only within the
 * combat despawn radius; beyond the spawn radius nothing can reach a mine that matters).
 */
const MINE_REACH = 450 + GRAVEYARD.radius;

/** Armed mines (id → arming tick) beside the sites state – the fuse is not saved (see the header). */
const armedBySites = new WeakMap<SitesState, Map<string, number>>();

function armedMines(state: SimState): Map<string, number> {
  let m = armedBySites.get(state.sites);
  if (!m) {
    m = new Map();
    armedBySites.set(state.sites, m);
  }
  return m;
}

/** The armed mines of a sites state as [mine id, arming tick], sorted by id (save V17). */
export function armedMineList(sites: SitesState): [string, number][] {
  const armed = armedBySites.get(sites);
  if (!armed) return [];
  return [...armed].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, at]) => [id, at]);
}

/** Puts the saved armed mines beside a restored sites state (save V17; before the first step). */
export function restoreArmedMines(sites: SitesState, list: readonly (readonly [string, number])[]): void {
  if (list.length === 0) {
    armedBySites.delete(sites);
    return;
  }
  armedBySites.set(sites, new Map(list.map(([id, at]) => [id, at])));
}

/** Mine i of a graveyard is gone (`graveyardState(…).mines` – an untouched graveyard has none gone – without the fresh state object). */
const mineGone = (state: SimState, site: GraveyardSite, i: number): boolean => ((state.sites.graveyards.get(site.id)?.mines ?? 0) & (1 << i)) !== 0;

/** The mine ids of a graveyard (`mineId`), built once per site object. */
const idsBySite = new WeakMap<GraveyardSite, readonly string[]>();

function mineIds(site: GraveyardSite): readonly string[] {
  let ids = idsBySite.get(site);
  if (!ids) {
    ids = site.mines.map((_, i) => mineId(site.id, i));
    idsBySite.set(site, ids);
  }
  return ids;
}

/** The mines of a graveyard as projectile targets (constant per site object; read-only). */
const targetsBySite = new WeakMap<GraveyardSite, readonly SiteHitTarget[]>();

function mineTargets(site: GraveyardSite): readonly SiteHitTarget[] {
  let t = targetsBySite.get(site);
  if (!t) {
    const ids = mineIds(site);
    t = site.mines.map((pos, i): SiteHitTarget => ({ id: ids[i]!, kind: 'mine', pos, radius: MINE.radius }));
    targetsBySite.set(site, t);
  }
  return t;
}

/** A live mine near the player (render, radar, map). `fuse` = 0..1 of the fuse after arming, null = not armed. */
export interface MineView {
  id: string;
  /** The graveyard id. */
  site: string;
  index: number;
  pos: Vec2;
  fuse: number | null;
}

/** Live (not blown) mines of the graveyards whose centre lies within `radius` of `pos`. */
export function liveMines(state: SimState, pos: Vec2, radius: number = MINE_REACH): MineView[] {
  const armed = armedBySites.get(state.sites);
  const out: MineView[] = [];
  forSitesNear(state.seed, pos, radius, (site) => {
    if (site.kind !== 'graveyard') return;
    site.mines.forEach((p, i) => {
      if (mineGone(state, site, i)) return;
      const id = mineId(site.id, i);
      const at = armed?.get(id);
      out.push({ id, site: site.id, index: i, pos: p, fuse: at === undefined ? null : Math.min(1, (state.tick - at) / MINE_FUSE_TICKS) });
    });
  });
  return out;
}

/** Ships that can arm a mine or be hit by its blast: the flying player and every pirate. */
function ships(state: SimState): { ref: ShipRef; ship: CombatShip }[] {
  const { player, combat } = state;
  const out: { ref: ShipRef; ship: CombatShip }[] = [];
  if (player.dock.mode === 'flying' && !player.destroyed) out.push({ ref: PLAYER_REF, ship: player });
  for (const e of combat.enemies) out.push({ ref: e.id, ship: e });
  return out;
}

/** Distance from a point to a ship's hull (its bounding circle). */
const hullDistance = (ship: CombatShip, p: Vec2): number => Math.max(0, hypot(ship.body.pos.x - p.x, ship.body.pos.y - p.y) - ship.props.boundingRadius);

/** The part of a ship nearest to a world point (like the cut blast), or null for an empty grid. */
function nearestPart(ship: CombatShip, p: Vec2): number | null {
  const local = worldToGrid(ship.body, ship.props.centerOfMass, p);
  let best: number | null = null;
  let bestD = Infinity;
  for (const part of ship.grid.parts) {
    const c = partCenter(part);
    const d = hypot(c.x - local.x, c.y - local.y);
    if (d < bestD) {
      bestD = d;
      best = part.id;
    }
  }
  return best;
}

/** Damage of a blast to a ship whose hull lies `d` from its centre. */
export const mineBlastDamage = (d: number): number => (d >= MINE.blastRadius ? 0 : Math.round(MINE.damage * (1 - d / MINE.blastRadius)));

/** Mine i of a graveyard blows: gone for good, ships in the blast hit, a sleeping party near it wakes. */
function blow(state: SimState, site: GraveyardSite, i: number, events: SimEvent[]): void {
  if (mineGone(state, site, i)) return;
  const pos = site.mines[i]!;
  const id = mineId(site.id, i);
  touchGraveyard(state, site.id).mines |= 1 << i;
  armedMines(state).delete(id);
  events.push({ type: 'mineExploded', id, pos: { ...pos } });
  for (const { ref, ship } of ships(state)) {
    const damage = mineBlastDamage(hullDistance(ship, pos));
    if (damage <= 0) continue;
    // the ship may be gone already (destroyed by an earlier hit of this blast)
    if (ref !== PLAYER_REF && !state.combat.enemies.includes(ship as Enemy)) continue;
    if (ref === PLAYER_REF && state.player.destroyed) continue;
    applyRam(state, ref, ship, nearestPart(ship, pos), damage, events, 'hazard');
  }
  wakeGraveyardsNear(state, pos, events);
}

/** One step: arm mines near ships, blow armed mines whose fuse ran out. */
export function stepMines(state: SimState, events: SimEvent[], _dt: number): void {
  const armed = armedMines(state);
  // the mines seen this step – only needed to forget stale fuses, so only while some fuse burns (a mine
  // armed during this step is seen anyway)
  const seen = armed.size > 0 ? SEEN : null;
  seen?.clear();
  // the ships as they are before the first blast of the step (taken at the first graveyard with mines –
  // nothing changes them before it)
  let list: { ref: ShipRef; ship: CombatShip }[] | null = null;
  const sites = sitesNearInto(state.seed, state.player.body.pos, MINE_REACH, STEP_SITES);
  for (const site of sites) {
    if (site.kind !== 'graveyard' || site.mines.length === 0) continue;
    list ??= ships(state);
    const ids = mineIds(site);
    for (let i = 0; i < site.mines.length; i++) {
      if (mineGone(state, site, i)) continue;
      const id = ids[i]!;
      const at = armed.get(id);
      seen?.add(id);
      if (at === undefined) {
        const pos = site.mines[i]!;
        if (list.some(({ ship }) => hullDistance(ship, pos) <= MINE.armRange)) {
          armed.set(id, state.tick);
          events.push({ type: 'mineArmed', id, pos: { ...pos } });
        }
      } else if (state.tick - at >= MINE_FUSE_TICKS) {
        blow(state, site, i, events);
      }
    }
  }
  clearList(sites);
  // a fuse of a mine left far behind is forgotten (it re-arms when a ship comes back)
  if (seen) for (const id of [...armed.keys()]) if (!seen.has(id)) armed.delete(id);
}

/** Scratch of `stepMines` (its own: a blast in the loop may walk other site lists). */
const STEP_SITES: Site[] = [];
const SEEN = new Set<string>();
/** Scratch of `mineHitTargets`. */
const HIT_SITES: Site[] = [];

/** Live mines near the player as projectile targets (kind 'mine'). */
export function mineHitTargets(state: SimState): SiteHitTarget[] {
  return mineHitTargetsInto(state, []);
}

/** `mineHitTargets` appended to `out` (same order). Returns `out`. */
export function mineHitTargetsInto(state: SimState, out: SiteHitTarget[]): SiteHitTarget[] {
  const sites = sitesNearInto(state.seed, state.player.body.pos, MINE_REACH, HIT_SITES);
  for (const site of sites) {
    if (site.kind !== 'graveyard') continue;
    const targets = mineTargets(site);
    for (let i = 0; i < targets.length; i++) if (!mineGone(state, site, i)) out.push(targets[i]!);
  }
  clearList(sites);
  return out;
}

/** A projectile hit a live mine: it blows at once. */
export function onMineHit(state: SimState, target: SiteHitTarget, _hit: SiteHit, events: SimEvent[]): void {
  const m = parseMineId(target.id);
  if (!m) return;
  const site = siteById(state.seed, m.site);
  if (site?.kind !== 'graveyard' || m.index >= site.mines.length) return;
  blow(state, site, m.index, events);
}

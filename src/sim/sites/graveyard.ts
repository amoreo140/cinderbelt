// Ship graveyards (M4b plan §2.5, long-term design §5.3) – OWNED BY T5.
//
// A graveyard (placed by placement.ts, T3) is a 200 u field of `site.wrecks` (10–20) dismantlable wrecks,
// live mines (mines.ts) and maybe a sleeping pirate party. Everything about it is a pure function of the
// seed (`graveyardLayout`); only what the player changed is saved:
//
// - Wrecks `gy:<cx>,<cy>#<i>`: class (pirate 0.4 / freighter 0.35 / miner 0.25), size (0 30 % / 1 45 % /
//   2 25 %), angle and position from the key's own hash; T2 from depth 3 (ring = depth, the POI wreck
//   rule). They are built by the POI wreck rules (`seedWreck`, discovery/wrecks.ts – hulks, intact parts,
//   scrap, cutting, the tractor) and remember their dismantling in `discovery.cut / opened / scanned`
//   under their key – no new wreck state. Containers by the usual per-size rule, at most
//   `GRAVEYARD.containersMax` per graveyard (the first wrecks by index get them). A wreck keeps clear of
//   the mines (its hull and containers outside a mine's arm range), of the field's rocks and POIs and of
//   the other wrecks; a wreck with no free spot among its tries is left out. They spawn within
//   `GRAVEYARD.spawnRadius` (300 u) of the player – the render budget – and go beyond it + 80 u.
// - Data: the first analysis of any wreck of a graveyard pays `GRAVEYARD.data` once, the other wrecks
//   0 D (`graveyardWreckData`, called by the scanner). Fragments: at most `GRAVEYARD.fragmentRolls`
//   rolls – the first wrecks loaded (discovery/wrecks.ts).
// - Sleeping party (`site.sleepers`): ids `gs:<cx>,<cy>:<i>`, spawned dormant (combat/ai.ts
//   `makeDormant`: no thrust, no fire, shield 0) among the wrecks while the player is within 300 u and
//   the AI budget allows (≤ `AI_BUDGET` enemies with the party). They wake (`sleepersWoke`, combat/ai.ts
//   `wakeEnemy` → attack) when the player comes within `GRAVEYARD.wakeRange` of one, a wreck within
//   `GRAVEYARD.wakeWreckRange` of one is cut, ripped or taken by the tractor, a sleeper is hit, or a mine
//   blows within `wakeWreckRange` of one (mines.ts). Once per graveyard: asleep → awake → cleared (no
//   member left – destroyed or gone beyond the despawn radius). An asleep party is not saved as ships
//   beyond what the combat state holds; it despawns with the player away and respawns untouched.
import type { RingIndex } from '../../data/economy';
import type { Tier } from '../../data/parts';
import { type WreckClass } from '../../data/poi';
import { WRECK_CONTAINERS } from '../../data/salvage';
import { GRAVEYARD, MINE } from '../../data/sites';
import { aimSkill } from '../combat/aim';
import { makeDormant, wakeEnemy } from '../combat/ai';
import { createEnemy, ENEMY_TEMPLATES } from '../combat/enemies';
import type { Enemy, EnemyKind } from '../combat/types';
import { poiRadius, poisInChunk } from '../discovery/poi';
import { poiWreckId, seedContainers, seedWreck, wreckGrid, type SeedWreckDef } from '../discovery/wrecks';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng, type Rng } from '../math/rng';
import { length, sub, type Vec2 } from '../math/vec2';
import { poiContainerId } from '../salvage/containers';
import { computeProperties } from '../ship/properties';
import type { SimEvent, SimState } from '../Simulation';
import { chunkCoord } from '../world/chunks';
import { generateChunk } from '../world/generate';
import { hash3 } from '../world/hash';
import { WORLD_GENS } from '../world/worldGen';
import { graveyardWreckKey, isGraveyardWreckKey, parseGraveyardWreckKey, sleeperId, sleeperPrefix } from './graveyardKeys';
import { graveyardState, touchGraveyard } from './graveyardState';
import { forSitesNear } from './placement';
import type { GraveyardSite } from './types';

export { graveyardState } from './graveyardState';

// ---------------------------------------------------------------------------
// layout constants of this module (the tunable numbers live in data/sites.ts)

/** Salt of the graveyard wreck / sleeper stream: fnv1a32("m4gyard") – keyed by the object's own key. */
const GRAVEYARD_SALT = 0x5c1d_e2a7;
/** Positions tried per wreck / sleeper (always drawn in full); none free = the object is left out. */
const TRIES = 8;
/** A wreck's hull keeps this far inside the field's edge (u). */
const EDGE = 15;
/** A wreck's hull keeps this far from a mine: the mine's arm range plus room for its containers (u). */
const WRECK_MINE_GAP = MINE.armRange + 16;
/** Gap between two wrecks' hulls, and a wreck's hull and a rock or a POI (u). */
const WRECK_GAP = 4;
/** Sleepers lie this far from the centre (u) – among the wrecks, never at the very edge. */
const SLEEPER_BAND: readonly [number, number] = [40, GRAVEYARD.radius - 40];
/** A sleeper's hull keeps this far from a mine (u) – it never arms one by lying there. */
const SLEEPER_MINE_GAP = MINE.armRange + 10;
/** Wrecks and asleep sleepers go when the player is this much beyond the spawn radius (u, hysteresis). */
export const GRAVEYARD_DESPAWN_MARGIN = 80;
/** DH §12.4: at most this many AI ships at a time – an asleep party waits until it fits. */
export const AI_BUDGET = 10;

// ---------------------------------------------------------------------------
// layout (pure, memoised)

export interface GraveyardWreck extends SeedWreckDef {
  /** `gy:<cx>,<cy>#<i>` */
  id: string;
  index: number;
  /** Bounding radius of the full wreck (u). */
  radius: number;
  /** Containers by it (the per-size rule, capped per graveyard). */
  containers: number;
}

export interface GraveyardSleeper {
  /** `gs:<cx>,<cy>:<i>` */
  id: string;
  index: number;
  kind: EnemyKind;
  tier: Tier;
  pos: Vec2;
  angle: number;
}

export interface GraveyardLayout {
  site: GraveyardSite;
  /** The wrecks that found a spot, by index (an index may be missing). */
  wrecks: readonly GraveyardWreck[];
  sleepers: readonly GraveyardSleeper[];
}

interface Blocker {
  pos: Vec2;
  r: number;
}

/** Picks a key by cumulative weights from one uniform number. */
function pickKey<K extends string>(u: number, weights: Readonly<Record<K, number>>): K {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = u * total;
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return keys[keys.length - 1]!;
}

function pickIndex(u: number, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = u * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Rocks (both world generations) and POIs whose clear circle reaches into the field. */
function fieldBlockers(seed: number, site: GraveyardSite): Blocker[] {
  const reach = GRAVEYARD.radius + 60;
  const x0 = chunkCoord(site.pos.x - reach);
  const x1 = chunkCoord(site.pos.x + reach);
  const y0 = chunkCoord(site.pos.y - reach);
  const y1 = chunkCoord(site.pos.y + reach);
  const byKey = new Map<string, Blocker>();
  const near = (p: Vec2): boolean => Math.hypot(p.x - site.pos.x, p.y - site.pos.y) <= reach;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (const gen of WORLD_GENS) {
        for (const a of generateChunk(seed, cx, cy, gen).asteroids) if (near(a.pos)) byKey.set(`${a.id}@${a.pos.x},${a.pos.y}`, { pos: a.pos, r: a.baseRadius });
      }
      for (const p of poisInChunk(seed, cx, cy)) if (near(p.pos)) byKey.set(p.id, { pos: p.pos, r: poiRadius(p) });
    }
  }
  return [...byKey.values()];
}

const clear = (p: Vec2, r: number, list: readonly Blocker[], gap: number): boolean => list.every((b) => Math.hypot(b.pos.x - p.x, b.pos.y - p.y) >= b.r + r + gap);

/** `TRIES` positions uniform over the band's area around `centre` (all drawn). */
function drawSpots(rng: Rng, centre: Vec2, r0: number, r1: number): Vec2[] {
  return Array.from({ length: TRIES }, () => {
    const a = rng() * TAU;
    const r = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
    return { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
  });
}

/** Builds a graveyard's layout (no memo – `graveyardLayout` is the cached entry; tests compare both). */
export function buildGraveyardLayout(seed: number, site: GraveyardSite): GraveyardLayout {
  const blockers = fieldBlockers(seed, site);
  const mines: Blocker[] = site.mines.map((pos) => ({ pos, r: 0 }));
  const ring = site.depth as RingIndex;
  const wrecks: GraveyardWreck[] = [];
  let containersLeft = GRAVEYARD.containersMax;
  for (let i = 0; i < site.wrecks; i++) {
    const id = graveyardWreckKey(site.id, i);
    const rng = createRng(hash3(seed ^ GRAVEYARD_SALT, fnv1a32(id), 0));
    const cls = pickKey<WreckClass>(rng(), GRAVEYARD.classWeights);
    const size = pickIndex(rng(), GRAVEYARD.sizeWeights) as 0 | 1 | 2;
    const angle = rng() * TAU;
    // wreckGrid gives T2 from ring 3 = GRAVEYARD.wreckT2FromDepth
    const radius = computeProperties(wreckGrid({ id, cls, size, ring })).boundingRadius;
    const spots = drawSpots(rng, site.pos, 0, GRAVEYARD.radius - EDGE - radius);
    const pos = spots.find(
      (p) =>
        clear(p, radius, mines, WRECK_MINE_GAP) &&
        clear(p, radius, blockers, WRECK_GAP) &&
        wrecks.every((w) => Math.hypot(w.pos.x - p.x, w.pos.y - p.y) >= w.radius + radius + WRECK_GAP),
    );
    if (!pos) continue;
    const containers = Math.min(WRECK_CONTAINERS[size], containersLeft);
    containersLeft -= containers;
    wrecks.push({ id, index: i, cls, size, ring, pos, angle, radius, containers });
  }
  const sleepers: GraveyardSleeper[] = [];
  const placed: Blocker[] = [];
  site.sleepers.forEach((kind, i) => {
    const id = sleeperId(site.id, i);
    const rng = createRng(hash3(seed ^ GRAVEYARD_SALT, fnv1a32(id), 0));
    const angle = rng() * TAU;
    const tier: Tier = site.depth >= GRAVEYARD.sleeperT2FromDepth ? 2 : 1;
    const radius = computeProperties(ENEMY_TEMPLATES[kind](tier)).boundingRadius;
    const spots = drawSpots(rng, site.pos, SLEEPER_BAND[0], SLEEPER_BAND[1]);
    const pos = spots.find(
      (p) =>
        clear(p, radius, mines, SLEEPER_MINE_GAP) &&
        clear(p, radius, blockers, WRECK_GAP) &&
        wrecks.every((w) => Math.hypot(w.pos.x - p.x, w.pos.y - p.y) >= w.radius + radius + WRECK_GAP) &&
        clear(p, radius, placed, WRECK_GAP),
    );
    if (!pos) return;
    placed.push({ pos, r: radius });
    sleepers.push({ id, index: i, kind, tier, pos, angle });
  });
  return { site, wrecks, sleepers };
}

const layoutCache = new Map<string, GraveyardLayout>();
const LAYOUT_CACHE_MAX = 256;

/** The wrecks and sleepers of a graveyard – a pure function of the seed and the site (memoised). */
export function graveyardLayout(seed: number, site: GraveyardSite): GraveyardLayout {
  const key = `${seed}|${site.id}`;
  const hit = layoutCache.get(key);
  if (hit && hit.site.pos.x === site.pos.x && hit.site.pos.y === site.pos.y) return hit;
  if (layoutCache.size >= LAYOUT_CACHE_MAX) layoutCache.clear();
  const out = buildGraveyardLayout(seed, site);
  layoutCache.set(key, out);
  return out;
}

/** Graveyards whose centre lies within `radius` of `pos`. */
function forGraveyardsNear(state: SimState, pos: Vec2, radius: number, visit: (site: GraveyardSite) => void): void {
  forSitesNear(state.seed, pos, radius, (s) => {
    if (s.kind === 'graveyard') visit(s);
  });
}

// ---------------------------------------------------------------------------
// wrecks

const dist = (a: Vec2, b: Vec2): number => length(sub(a, b));
const isGraveyardContainer = (key: string | undefined): boolean => !!key && key.startsWith('ct:gy:');

/** Is a container of the wreck (`seedContainers`' keys, the opened ones skipped) not in the combat state? */
function containersMissing(state: SimState, def: GraveyardWreck, present: ReadonlySet<number>): boolean {
  for (let i = 0; i < def.containers; i++) {
    const key = `ct:${def.id}:${i}`;
    if (!state.discovery.opened.has(key) && !present.has(poiContainerId(key))) return true;
  }
  return false;
}

/** Spawn / despawn graveyard wrecks and their containers near the player (beside `managePoiWrecks`, discovery step). */
export function manageSiteWrecks(state: SimState): void {
  const { combat, player } = state;
  const pos = player.body.pos;
  const keep = GRAVEYARD.spawnRadius + GRAVEYARD_DESPAWN_MARGIN;
  combat.wrecks = combat.wrecks.filter((w) => !isGraveyardWreckKey(w.poi) || dist(w.body.pos, pos) <= keep);
  // an opened container (partly loaded) stays until its ttl runs out, like a POI one
  combat.containers = combat.containers.filter((c) => !isGraveyardContainer(c.poi) || state.discovery.opened.has(c.poi!) || dist(c.body.pos, pos) <= keep);
  let present: Set<number> | null = null;
  let presentContainers: Set<number> | null = null;
  forGraveyardsNear(state, pos, GRAVEYARD.spawnRadius + GRAVEYARD.radius, (site) => {
    for (const def of graveyardLayout(state.seed, site).wrecks) {
      if (dist(def.pos, pos) > GRAVEYARD.spawnRadius) continue;
      present ??= new Set(combat.wrecks.map((w) => w.id));
      presentContainers ??= new Set(combat.containers.map((c) => c.id));
      // the ids derive from the keys: only what is missing is built from the seed (a wreck rebuild is
      // its grid + properties – every wreck every 30 ticks was the graveyard's p99, audit P2.4)
      if (containersMissing(state, def, presentContainers)) {
        for (const c of seedContainers(state, def, def.containers)) {
          if (presentContainers.has(c.id)) continue;
          combat.containers.push(c);
          presentContainers.add(c.id);
        }
      }
      if (present.has(poiWreckId(def.id))) continue;
      const w = seedWreck(state, def);
      if (!w || present.has(w.id)) continue;
      combat.wrecks.push(w);
      present.add(w.id);
    }
  });
}

/**
 * Data of the first analysis of a wreck (the scanner's `firstData`): a graveyard wreck pays
 * `GRAVEYARD.data` for the first analysed wreck of its graveyard, 0 for the others; null = not a
 * graveyard wreck (the usual rule applies). Marks the graveyard's Data as given.
 */
export function graveyardWreckData(state: SimState, w: { poi?: string }): number | null {
  const g = parseGraveyardWreckKey(w.poi);
  if (!g) return null;
  if (graveyardState(state, g.site).data) return 0;
  touchGraveyard(state, g.site).data = true;
  return GRAVEYARD.data;
}

// ---------------------------------------------------------------------------
// the sleeping party

/** A dormant sleeper not analysed yet looks like a wreck (radar, render, map); analysed = "active reactor". */
export const sleeperDisguised = (state: SimState, e: Pick<Enemy, 'id' | 'ai'>): boolean =>
  e.ai.mode === 'dormant' && e.id.startsWith('gs:') && !state.discovery.scanned.has(e.id);

/** Members of a graveyard's party present in the combat state. */
const membersOf = (state: SimState, site: GraveyardSite): Enemy[] => {
  const prefix = sleeperPrefix(site.id);
  return state.combat.enemies.filter((e) => e.id.startsWith(prefix));
};

/** Wakes the party of an asleep graveyard (once): every member attacks, `sleepersWoke`. */
export function wakeParty(state: SimState, site: GraveyardSite, events: SimEvent[]): void {
  const g = graveyardState(state, site.id);
  if (g.party !== 'asleep' || site.sleepers.length === 0) return;
  touchGraveyard(state, site.id).party = 'awake';
  const skill = aimSkill(state.settings.deathPenalty);
  for (const e of membersOf(state, site)) wakeEnemy(e, skill);
  events.push({ type: 'sleepersWoke', id: site.id, pos: { ...site.pos } });
}

/**
 * Something loud at `pos` (a mine blast): wakes the asleep party of every graveyard with a present member
 * within `GRAVEYARD.wakeWreckRange` of it.
 */
export function wakeGraveyardsNear(state: SimState, pos: Vec2, events: SimEvent[]): void {
  forGraveyardsNear(state, pos, GRAVEYARD.radius + GRAVEYARD.wakeWreckRange, (site) => {
    if (graveyardState(state, site.id).party !== 'asleep') return;
    if (membersOf(state, site).some((e) => dist(e.body.pos, pos) <= GRAVEYARD.wakeWreckRange)) wakeParty(state, site, events);
  });
}

/** Positions of this step's wreck work: cuts, ripped parts and tractor locks on wrecks; plus the wreck the beam holds now. */
function wreckWork(state: SimState, events: readonly SimEvent[]): Vec2[] {
  const out: Vec2[] = [];
  for (const e of events) {
    if (e.type === 'wreckCut' || e.type === 'partRipped') out.push(e.pos);
    else if (e.type === 'tractorLocked' && e.target.kind === 'wreck') out.push(e.pos);
  }
  const t = state.player.tractor;
  if (t?.target.kind === 'wreck') {
    const id = t.target.id;
    const w = state.combat.wrecks.find((x) => x.id === id);
    if (w) out.push(w.body.pos);
  }
  return out;
}

function shouldWake(state: SimState, site: GraveyardSite, members: readonly Enemy[], work: readonly Vec2[]): boolean {
  const { player, combat } = state;
  // a sleeper killed in one step is gone from the enemies but listed as defeated
  if (site.sleepers.some((_, i) => combat.defeated.has(sleeperId(site.id, i)))) return true;
  const flying = player.dock.mode === 'flying' && !player.destroyed;
  for (const e of members) {
    // hit: its shield is down, so any hit shows on the hull (or took a part)
    if (e.hp.size > 0 || e.gridVersion > 0) return true;
    if (flying && dist(e.body.pos, player.body.pos) <= GRAVEYARD.wakeRange) return true;
    if (work.some((p) => dist(p, e.body.pos) <= GRAVEYARD.wakeWreckRange)) return true;
  }
  return false;
}

function stepParty(state: SimState, site: GraveyardSite, work: readonly Vec2[], events: SimEvent[]): void {
  const g = graveyardState(state, site.id);
  if (g.party === 'cleared') return;
  const members = membersOf(state, site);
  if (g.party === 'awake') {
    if (members.length === 0) touchGraveyard(state, site.id).party = 'cleared';
    return;
  }
  if (shouldWake(state, site, members, work)) {
    wakeParty(state, site, events);
    return;
  }
  const { player, combat } = state;
  const d = dist(site.pos, player.body.pos);
  if (d > GRAVEYARD.spawnRadius + GRAVEYARD_DESPAWN_MARGIN) {
    // untouched asleep sleepers go with the player away (render and AI budget) and come back the same
    if (members.length > 0) combat.enemies = combat.enemies.filter((e) => !members.includes(e));
    return;
  }
  if (d > GRAVEYARD.spawnRadius || player.dock.mode !== 'flying' || player.destroyed) return;
  const layout = graveyardLayout(state.seed, site);
  const missing = layout.sleepers.filter((s) => !members.some((e) => e.id === s.id));
  if (missing.length === 0 || combat.enemies.length + missing.length > AI_BUDGET) return;
  for (const s of missing) {
    const e = createEnemy({ id: s.id, kind: s.kind, tier: s.tier, pos: s.pos, angle: s.angle, home: s.pos, orbit: 1 });
    combat.enemies.push(makeDormant(e));
  }
}

/** One step: the sleeping parties of the graveyards near the player (spawn, wake rules, party state). */
export function stepGraveyards(state: SimState, events: SimEvent[], _dt: number): void {
  const pos = state.player.body.pos;
  let work: Vec2[] | null = null;
  forGraveyardsNear(state, pos, GRAVEYARD.spawnRadius + GRAVEYARD_DESPAWN_MARGIN + GRAVEYARD.radius, (site) => {
    if (site.sleepers.length === 0) return;
    work ??= wreckWork(state, events);
    stepParty(state, site, work, events);
  });
}

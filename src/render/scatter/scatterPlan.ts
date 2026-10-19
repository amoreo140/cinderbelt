// Scatter planner (art batch B3–B5): which clutter props and wreck fragments dress a world chunk, where
// and how they move. Pure and deterministic – seeded by (world seed, chunk), so a chunk always looks
// the same, nothing goes to the save, and the simulation never knows (render-only scenery).
//
// Sites per chunk (200 × 200 u), each optional:
//   station   – around a station: two nav beacons flanking the dock approach (approach lights), a
//               comm satellite behind it, a small drift of cargo pods / pallets / fuel canisters.
//   field     – asteroid fields: Guild claim markers stuck on big rocks (they turn with the rock),
//               ore canisters next to a rock with the window tinted by its resource, a survey sat.
//   wreck     – around a wreck POI (the derelict wrecks): weathered hull sections, girders, an
//               engine block, a container spill, plus a few cargo props – the wreck field.
//   pirate    – dangerous space: a dormant mine field, a stash crate, sometimes a scrap raft
//               (decoration only – no hazard mechanics).
//   graveyard – rare dead-ship graveyards in dangerous space (the manifest's ring-2 context): decorative
//               ones, and the dressing of the real M4b ship graveyards (their wrecks are sim wrecks;
//               the pieces lie scattered under them). A chunk with a real graveyard field skips the
//               decorative one (its stream is still drawn, so nothing else moves).
//   open      – sometimes a lone satellite, drifting solar wing or escape pod in empty space.
// Danger comes in as a `ScatterSecurity` – the security of the chunk's sector (scatterInput.ts; the
// old ring rule `securityForRing` stays for comparisons).
//
// Collision – decided: none. The wreckage manifest offers collision circles, but using them would put
// the pieces into the simulation (world generation, physics, the flight-assist collision warning and
// the determinism tests), which is not trivial. So the scenery is purely visual and everything floats
// a little BELOW the gameplay plane (2–10 u): the ship visibly passes over it and the flight-path
// markers (drawn on the plane) stay on top. Pieces that have circles never tumble (yaw only), so a
// later sim collision could adopt them unchanged. The only pieces on the plane are the claim markers,
// which sit on the rocks themselves. Wreck fields dress the wreck POIs (the derelict wrecks); combat
// wrecks get none – their explosion already throws the faction debris. Density stays low – the
// research asks for less empty space, but clutter must stay calmer than gameplay objects.
import type { ResourceId } from '../../data/resources';
import { createRng, type Rng } from '../../sim/math/rng';
import type { Vec2 } from '../../sim/math/vec2';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { hash3 } from '../../sim/world/hash';
import type { MotionKind, ScatterCatalog, ScatterModelDef } from './scatterManifest';

/** Danger of a place: the four sector securities (sectors design §2.4). */
export type ScatterSecurity = 'quiet' | 'guarded' | 'contested' | 'pirate';

/** Security until sectors exist: ring 1 is guarded, ring 2 contested, rings 3+ pirate space. */
export function securityForRing(ring: number): ScatterSecurity {
  return ring <= 1 ? 'guarded' : ring === 2 ? 'contested' : 'pirate';
}

/** Pirate dressing and graveyards appear only where pirates roam. */
export const dangerous = (s: ScatterSecurity): boolean => s === 'contested' || s === 'pirate';

export type ScatterSite = 'station' | 'field' | 'wreck' | 'pirate' | 'graveyard' | 'open';

export interface ScatterStation {
  id: string;
  pos: Vec2;
  radius: number;
  /** Direction of the dock port (sim angle). */
  portAngle: number;
}

export interface ScatterRock {
  id: string;
  pos: Vec2;
  baseRadius: number;
  resource: ResourceId;
}

export interface ScatterPoi {
  id: string;
  kind: string;
  pos: Vec2;
  radius: number;
}

export interface ScatterChunkInput {
  seed: number;
  cx: number;
  cy: number;
  /** Depth of the place (ring 1–4) – the manifests' `rings`. */
  ring: number;
  security: ScatterSecurity;
  /** Stations owned by this chunk (placement anchors) – and any close enough to keep clear of. */
  stations: readonly ScatterStation[];
  /** The chunk's generated asteroids. */
  rocks: readonly ScatterRock[];
  /**
   * Places of interest in the chunk (wreck POIs get a wreck field, the rest are kept clear), then the M4b
   * sites that reach into it (scatterInput `sitePois`): 'graveyard' fields (the chunk's own get dressed),
   * 'derelict' and 'relay' discs (kept clear).
   */
  pois: readonly ScatterPoi[];
  /** Other render-only scenery whose disc stays clear (the Guild pickets on the lanes). */
  keepClear?: readonly { pos: Vec2; radius: number }[];
}

export interface ScatterPiece {
  model: string;
  site: ScatterSite;
  pos: Vec2;
  /** Height above the plane (negative = below). */
  height: number;
  /** Base orientation, Euler XYZ (rad, three.js order). */
  rot: [number, number, number];
  scale: number;
  motion: MotionKind;
  /** rad/s (sign = direction). */
  rate: number;
  /** Unit axis of a tumble (three.js frame). */
  axis: [number, number, number];
  /** 0..1 – phase of bobbing, lamps and spinning nodes. */
  phase: number;
  /** 0..1 – shown when `rank < density` (graphics quality); 0 = always shown. */
  rank: number;
  /** Resource colour of the tinted node (ore canister window). */
  tint: ResourceId | null;
  /** Stuck on an asteroid: its id and the direction out of the rock in the rock's model frame. */
  attach: { asteroid: string; dir: [number, number, number] } | null;
}

/** Pieces dressing a real graveyard field [min, max] and the band of distances from its centre (u). */
export const GRAVEYARD_DRESSING = { count: [8, 11] as const, inner: 12, outer: 160 } as const;

/** Hard cap of pieces one chunk can hold (all sites together). */
export const MAX_PIECES_PER_CHUNK = 28;
/** Below-plane heights: props and wreck pieces sink this far (top stays under the plane). */
export const SCATTER_DEPTH = { min: 2, max: 10 } as const;
/** Margin of open-space / pirate sites from the chunk edges (neighbour rocks are not checked). */
const EDGE = 25;

const SALT = 0x5ca7_7e12;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Site chances per chunk. */
export const SITE_CHANCE = {
  open: 0.28,
  pirate: { contested: 0.2, pirate: 0.4 } as Record<'contested' | 'pirate', number>,
  graveyard: 0.06,
  oreCanisters: 0.5,
  claimPerRock: 0.18,
  maxClaims: 2,
  fieldSurvey: 0.15,
  stationSurvey: 0.35,
  secondBeaconPair: 0.5,
} as const;

/** Planner context – the rolled pieces and what has to stay clear. */
class Planner {
  readonly pieces: ScatterPiece[] = [];
  constructor(
    readonly input: ScatterChunkInput,
    readonly catalog: ScatterCatalog,
    readonly rng: Rng,
  ) {}

  model(name: string): ScatterModelDef | null {
    const d = this.catalog.get(name);
    return d && d.rings.includes(this.input.ring) ? d : null;
  }

  /** Is a disc at `pos` clear of rocks, stations, other POIs and the pieces placed so far? */
  free(pos: Vec2, radius: number, ownPoi: string | null = null): boolean {
    for (const r of this.input.rocks) if (Math.hypot(pos.x - r.pos.x, pos.y - r.pos.y) < r.baseRadius + radius + 2) return false;
    for (const s of this.input.stations) if (Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y) < s.radius + radius + 12) return false;
    for (const k of this.input.keepClear ?? []) if (Math.hypot(pos.x - k.pos.x, pos.y - k.pos.y) < k.radius + radius) return false;
    for (const p of this.input.pois) {
      if (p.id === ownPoi) continue;
      if (Math.hypot(pos.x - p.pos.x, pos.y - p.pos.y) < p.radius + radius + 8) return false;
    }
    for (const q of this.pieces) {
      if (q.attach) continue;
      const qr = (this.catalog.get(q.model)?.radius ?? 1) * q.scale;
      if (Math.hypot(pos.x - q.pos.x, pos.y - q.pos.y) < qr + radius + 1) return false;
    }
    return true;
  }

  /** A random point inside the chunk (away from its edges). */
  inChunk(): Vec2 {
    const { cx, cy } = this.input;
    return { x: cx * CHUNK_SIZE + EDGE + this.rng() * (CHUNK_SIZE - 2 * EDGE), y: cy * CHUNK_SIZE + EDGE + this.rng() * (CHUNK_SIZE - 2 * EDGE) };
  }

  /**
   * Places one piece of `def` at the first free spot `spot()` offers (a few tries); returns it, or
   * null when there was no room. The piece's own numbers are drawn before the tries.
   */
  place(def: ScatterModelDef, site: ScatterSite, spot: () => Vec2, opts: { rank?: number; height?: [number, number]; tint?: ResourceId | null; ownPoi?: string | null } = {}): ScatterPiece | null {
    const r = this.rng;
    const scale = def.scale[0] + r() * (def.scale[1] - def.scale[0]);
    const rate = (def.motion.rate[0] + r() * (def.motion.rate[1] - def.motion.rate[0])) * DEG * (r() < 0.5 ? -1 : 1);
    const axis = randomAxis(r);
    const yaw = r() * TAU;
    const tilt: [number, number] = [r() * TAU, r() * TAU];
    const phase = r();
    const rank = opts.rank ?? r();
    const [h0, h1] = opts.height ?? defaultHeight(def, scale);
    const height = -(h0 + r() * (h1 - h0));
    for (let i = 0; i < 6; i++) {
      const pos = spot();
      if (!this.free(pos, def.radius * scale, opts.ownPoi ?? null)) continue;
      const upright = def.motion.kind === 'yaw' || def.motion.kind === 'bob' || def.set === 'wreck';
      const piece: ScatterPiece = {
        model: def.name,
        site,
        pos,
        height,
        // upright props keep +Y up; wreck pieces keep their authored roll/tilt; the rest any way round
        rot: upright ? [0, yaw, 0] : [tilt[0], yaw, tilt[1]],
        scale,
        motion: def.motion.kind,
        rate: def.motion.kind === 'tumble' || def.motion.kind === 'yaw' ? rate : 0,
        axis: def.motion.kind === 'yaw' ? [0, 1, 0] : axis,
        phase,
        rank,
        tint: opts.tint ?? null,
        attach: null,
      };
      this.pieces.push(piece);
      return piece;
    }
    return null;
  }
}

/** Depth below the plane: the piece's top stays under the plane (wreck pieces), props float 2.5–8 u down. */
function defaultHeight(def: ScatterModelDef, scale: number): [number, number] {
  if (def.set === 'wreck') {
    const top = (def.size[1] / 2) * scale + SCATTER_DEPTH.min;
    return [top, Math.min(SCATTER_DEPTH.max, top + 3)];
  }
  return [2.5, 8];
}

function randomAxis(r: Rng): [number, number, number] {
  const z = r() * 2 - 1;
  const a = r() * TAU;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), z, s * Math.sin(a)];
}

const pickOne = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

/** A point at distance `d` and angle `a` from `c`. */
const polar = (c: Vec2, a: number, d: number): Vec2 => ({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d });

// ---------------------------------------------------------------------------
// sites

function stationSite(p: Planner, s: ScatterStation): void {
  const r = p.rng;
  const port = s.portAngle;
  const R = s.radius;
  // approach lights: a pair of nav beacons flanking the dock axis (always), a second pair further out
  const beacon = p.model('nav_beacon') ?? p.catalog.get('nav_beacon') ?? null;
  const second = r() < SITE_CHANCE.secondBeaconPair;
  if (beacon) {
    const pairs = second ? [R + 16, R + 32] : [R + 16];
    pairs.forEach((d, k) => {
      for (const side of [-1, 1]) {
        const c = polar(s.pos, port, d);
        const at = polar(c, port + (side * Math.PI) / 2, 8);
        p.place(beacon, 'station', () => at, { rank: k === 0 ? 0 : undefined, height: [3, 3.5] });
      }
    });
  }
  // a comm satellite behind the station (ring 3+: a survey sat instead)
  const sat = p.model('sat_comm') ?? p.model('sat_survey');
  if (sat) p.place(sat, 'station', () => polar(s.pos, port + Math.PI + (r() - 0.5) * 2.4, R + 25 + r() * 20), { height: [5, 8] });
  // a little drift of cargo off to one side of the dock axis
  const cargo = ['cargo_pod_small', 'cargo_pallet', 'fuel_canister'].map((n) => p.model(n)).filter((d): d is ScatterModelDef => d !== null);
  if (cargo.length > 0) {
    const side = r() < 0.5 ? -1 : 1;
    const center = polar(s.pos, port + side * (1.2 + r()), R + 24 + r() * 16);
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) p.place(pickOne(r, cargo), 'station', () => polar(center, r() * TAU, 1.5 + r() * 5), { height: [2.5, 6] });
  }
  const survey = p.model('sat_survey');
  if (survey && sat?.name !== 'sat_survey' && r() < SITE_CHANCE.stationSurvey) {
    p.place(survey, 'station', () => polar(s.pos, port + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 2), R + 30 + r() * 25), { height: [5, 9] });
  }
}

function fieldSite(p: Planner): void {
  const r = p.rng;
  const rocks = p.input.rocks;
  if (rocks.length === 0) return;
  // claim markers on the big rocks (they turn with the rock, so they need no free spot)
  const claim = p.model('claim_marker');
  let claims = 0;
  for (const rock of rocks) {
    const roll = r();
    const tiltA = r() * TAU;
    const tilt = r() * 25 * DEG;
    const rank = r();
    if (!claim || rock.baseRadius < 1.8 || roll >= SITE_CHANCE.claimPerRock || claims >= SITE_CHANCE.maxClaims) continue;
    claims++;
    // the spike points along ±Y of the rock model (the render keeps it on the side facing up)
    p.pieces.push({
      model: claim.name,
      site: 'field',
      pos: rock.pos,
      height: 0,
      rot: [0, 0, 0],
      scale: claim.scale[0] + rank * (claim.scale[1] - claim.scale[0]),
      motion: 'attached',
      rate: 0,
      axis: [0, 1, 0],
      phase: roll / SITE_CHANCE.claimPerRock,
      rank,
      tint: null,
      attach: { asteroid: rock.id, dir: [Math.sin(tilt) * Math.cos(tiltA), Math.cos(tilt), Math.sin(tilt) * Math.sin(tiltA)] },
    });
  }
  // ore canisters drifting by a rock, the window in its resource colour
  const canister = p.model('ore_canister');
  const canisterRoll = r();
  const anchor = rocks[Math.floor(r() * rocks.length)]!;
  if (canister && canisterRoll < SITE_CHANCE.oreCanisters) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      p.place(canister, 'field', () => polar(anchor.pos, r() * TAU, anchor.baseRadius + 3 + r() * 6), { height: [2, 4.5], tint: anchor.resource });
    }
  }
  // now and then a survey satellite watching the field
  const survey = p.model('sat_survey');
  if (survey && r() < SITE_CHANCE.fieldSurvey) {
    let cx = 0;
    let cy = 0;
    for (const rock of rocks) {
      cx += rock.pos.x;
      cy += rock.pos.y;
    }
    const c = { x: cx / rocks.length, y: cy / rocks.length };
    p.place(survey, 'field', () => polar(c, r() * TAU, 20 + r() * 18), { height: [5, 9] });
  }
}

/** Weighted pick of a wreck piece by its max suggested count (the list shrinks as models run out). */
function pickWreck(r: Rng, pool: ScatterModelDef[], used: Map<string, number>): ScatterModelDef | null {
  const open = pool.filter((d) => (used.get(d.name) ?? 0) < Math.max(1, d.count[1]));
  if (open.length === 0) return null;
  const total = open.reduce((s, d) => s + Math.max(1, d.count[1]), 0);
  let x = r() * total;
  for (const d of open) {
    x -= Math.max(1, d.count[1]);
    if (x < 0) return d;
  }
  return open[open.length - 1]!;
}

function wreckPieces(p: Planner, site: 'wreck' | 'graveyard', center: Vec2, inner: number, outer: number, count: number, ownPoi: string | null): void {
  const r = p.rng;
  const pool = [...p.catalog.values()].filter((d) => d.set === 'wreck' && d.contexts.includes(site) && d.rings.includes(p.input.ring));
  const used = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const def = pickWreck(r, pool, used);
    if (!def) break;
    used.set(def.name, (used.get(def.name) ?? 0) + 1);
    // the first piece of a field always shows (even at Low)
    p.place(def, site, () => polar(center, r() * TAU, inner + def.radius * 0.6 + r() * (outer - inner)), { rank: i === 0 ? 0 : undefined, ownPoi });
  }
  // loose cargo from the dead ship
  const props = [...p.catalog.values()].filter((d) => d.set === 'B4' && d.contexts.includes('wreck') && d.rings.includes(p.input.ring));
  const n = site === 'wreck' ? 1 + Math.floor(r() * 2) : Math.floor(r() * 2);
  for (let i = 0; i < n && props.length > 0; i++) {
    const def = pickOne(r, props);
    const tint = def.tintNode ? pickOne(r, ['iron', 'copper', 'ice'] as const) : null;
    p.place(def, site, () => polar(center, r() * TAU, inner + r() * (outer - inner)), { ownPoi, tint });
  }
}

/** Pirate sites keep this far from any station (no mine field at a Guild outpost). */
export const PIRATE_STATION_CLEAR = 120;

function pirateSite(p: Planner): void {
  const r = p.rng;
  let center = p.inChunk();
  for (let i = 0; i < 4 && p.input.stations.some((s) => Math.hypot(center.x - s.pos.x, center.y - s.pos.y) < PIRATE_STATION_CLEAR); i++) center = p.inChunk();
  if (p.input.stations.some((s) => Math.hypot(center.x - s.pos.x, center.y - s.pos.y) < PIRATE_STATION_CLEAR)) return;
  const mine = p.model('pirate_mine');
  if (mine) {
    const n = Math.max(mine.count[0], 3) + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) p.place(mine, 'pirate', () => polar(center, r() * TAU, 3 + r() * 14), { height: [2, 4] });
  }
  const stash = p.model('pirate_stash');
  if (stash && r() < 0.5) p.place(stash, 'pirate', () => polar(center, r() * TAU, 6 + r() * 8), { height: [3, 5] });
  const raft = p.model('scrap_raft');
  if (raft && r() < 0.3) p.place(raft, 'pirate', () => polar(center, r() * TAU, 18 + r() * 8), { height: [4, 6] });
}

function openSite(p: Planner): void {
  const r = p.rng;
  const choices: Array<[string, number]> = [
    ['sat_comm', 0.35],
    ['sat_survey', 0.25],
    ['solar_wing_drift', 0.3],
    ['escape_pod', 0.1],
  ];
  const available = choices.filter(([n]) => p.model(n));
  const total = available.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  let name: string | null = null;
  for (const [n, w] of available) {
    x -= w;
    if (x < 0) {
      name = n;
      break;
    }
  }
  if (!name) return;
  const def = p.model(name)!;
  const at = p.inChunk();
  const n = name === 'solar_wing_drift' ? 1 + Math.floor(r() * 2) : 1;
  for (let i = 0; i < n; i++) p.place(def, 'open', () => (i === 0 ? at : polar(at, r() * TAU, 4 + r() * 6)), { height: [4, 10] });
}

/**
 * The scenery of one chunk. Every site draws its random numbers from its own stream, so one site
 * never shifts another (e.g. a POI appearing does not move the open-space satellite).
 */
export function planChunk(input: ScatterChunkInput, catalog: ScatterCatalog): ScatterPiece[] {
  const stream = (k: number): Rng => createRng(hash3(hash3(input.seed ^ SALT, input.cx, input.cy), k, 0x5ca7));
  const all: ScatterPiece[] = [];
  const run = (k: number, fn: (p: Planner) => void) => {
    const p = new Planner(input, catalog, stream(k));
    // earlier sites stay clear of later ones
    p.pieces.push(...all);
    const before = all.length;
    fn(p);
    all.push(...p.pieces.slice(before));
  };
  const own = input.stations.filter((s) => Math.floor(s.pos.x / CHUNK_SIZE) === input.cx && Math.floor(s.pos.y / CHUNK_SIZE) === input.cy);
  for (const s of own) run(1, (p) => stationSite(p, s));
  input.pois.forEach((poi, i) => {
    if (poi.kind !== 'wreck') return;
    run(10 + i, (p) => wreckPieces(p, 'wreck', poi.pos, poi.radius + 3, 20, 4 + Math.floor(p.rng() * 3), poi.id));
  });
  // the real ship graveyards this chunk owns (M4b): wreck pieces among the sim wrecks
  const inChunk = (p: Vec2) => Math.floor(p.x / CHUNK_SIZE) === input.cx && Math.floor(p.y / CHUNK_SIZE) === input.cy;
  input.pois.forEach((poi, i) => {
    if (poi.kind !== 'graveyard' || !inChunk(poi.pos)) return;
    const [lo, hi] = GRAVEYARD_DRESSING.count;
    run(40 + i, (p) => wreckPieces(p, 'graveyard', poi.pos, GRAVEYARD_DRESSING.inner, GRAVEYARD_DRESSING.outer, lo + Math.floor(p.rng() * (hi - lo + 1)), poi.id));
  });
  const realGraveyard = input.pois.some((poi) => poi.kind === 'graveyard');
  run(2, fieldSite);
  if (dangerous(input.security)) {
    run(3, (p) => {
      if (p.rng() < SITE_CHANCE.pirate[input.security as 'contested' | 'pirate']) pirateSite(p);
    });
    run(4, (p) => {
      // a chunk with a real graveyard field has no decorative one (the roll is still drawn)
      if (p.rng() < SITE_CHANCE.graveyard && !realGraveyard) wreckPieces(p, 'graveyard', p.inChunk(), 2, 30, 3 + Math.floor(p.rng() * 3), null);
    });
  }
  run(5, (p) => {
    if (p.rng() < SITE_CHANCE.open) openSite(p);
  });
  return all.slice(0, MAX_PIECES_PER_CHUNK);
}

/** The pieces shown at a density (graphics quality, 0..1). Lower densities show a subset of higher. */
export function visiblePieces(pieces: readonly ScatterPiece[], density: number): ScatterPiece[] {
  if (density <= 0) return [];
  return pieces.filter((p) => p.rank === 0 || p.rank < density);
}

/** Scenery density for a quality preset's particle multiplier: Low ≈ 0.4, Medium ≈ 0.75, High 1, software Low 0. */
export const scatterDensity = (particles: number): number => (particles <= 0 ? 0 : Math.min(1, particles * 1.15));

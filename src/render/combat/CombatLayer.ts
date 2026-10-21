// Combat layer of the scene (M3a): pirates built from their clan's part set (plan 2026-10-18 §3;
// turrets aim at the player, engine flames), wrecks in the dead `derelict` livery (a pirate wreck
// keeps its clan's shapes; a blinking beacon while it holds loot), projectiles, shield bubbles and
// the effects of simulation events (shots, hits, explosions with debris in the victim's set,
// asteroid breakup, loading loot). Hulls show damage decals by part HP (wrecks always).
// M4b looks (T14, enemyLooks.ts): a Gunner's cannons charge up before every salvo (a glow at each
// muzzle and a ring closing in) and fire with a heavier flash; a derelict's sentry drone wears the
// dead livery with a lit red sensor eye and sweeps its turret while idle; a dormant sleeper is drawn
// powered down (derelict shades, no engines, a faint standby blink) and flares up when it wakes.
// Graveyard wrecks that lie still and dormant sleepers draw from static batches (sites/wreckBatch.ts, one
// per 100 u cell) instead of their live views: one mesh per base material (the derelict shades go per
// vertex) + 1 decal mesh per cell, whatever its ships; past the far-tier switch the batches draw a meshopt
// LOD1 (`setViewDistance`). A sleeper that wakes leaves its batch the same frame.
// Graveyard wrecks, their batches and dormant sleepers are far-lite (env/ShadowRig.ts): with the camera far
// out they cast no shadow and skip the AO pre-pass.
// Hull shell (SL2 E1 T6): enemies and wrecks remember the cells of their first build (a wreck of a
// pirate seen moments ago: the pirate's cells), so a shot-off or cut part leaves torn edges with soot;
// their rebuilds go through the rebuild queue – at most one per frame, nearest first, the old view
// drawn until its turn. The enemies' nav lights are fed to the renderer's NavLights layer (`navShips`).
// M4d (T13, watchFx.ts): Guild Watch shots are blue-white bolts; the live Watch ships themselves are drawn
// by the border layer, their shield bubbles, hits, damage smoke and explosions here. The escort contract
// convoys (T6) are drawn by the convoy layer; their hull sparks, damage smoke and explosions are here too
// (no shields) – `npcHit` / `npcDestroyed` handle any NPC ship.
import { BufferGeometry, Color, Group, Mesh, Vector3, type Material, type Object3D } from 'three';
import { PLAYER_REF, type Enemy, type Wreck } from '../../sim/combat/types';
import { partCenter } from '../../sim/ship/grid';
import { gridCellKeys } from '../../sim/ship/outline';
import type { ShipGrid } from '../../sim/ship/types';
import type { ShipProperties } from '../../sim/ship/properties';
import { shieldRadius } from '../../sim/combat/projectiles';
import { lootEmpty, WRECK_FADE_TICKS, WRECK_TTL } from '../../sim/combat/wrecks';
import { lerpAngle } from '../../sim/math/angle';
import { fnv1a32 } from '../../sim/math/fnv1a';
import { lerp, rotate, sub, type Vec2 } from '../../sim/math/vec2';
import { clanAt, enemyClan } from '../../sim/pirates/clans';
import { CAPTAIN_CLANS } from '../../data/captains';
import type { FactionId } from '../../data/factions';
import type { ResourceId } from '../../data/resources';
import type { SimEvent, SimState } from '../../sim/Simulation';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { simToWorld } from '../coords';
import { Effects, FX_COLORS, FX_HEIGHT } from '../fx/Effects';
import { debrisSetFor, FxModels, type DebrisSet } from '../fx/fxModels';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import { ShipView, type ShellInfo, type ShipViewOptions } from '../ShipView';
import { applyDerelict, applyLivery, disposeLiveries, preloadDerelictLivery } from './livery';
import { enemyLook, idleSweep, salvoTell, standbyBlink, type EnemyLook } from './enemyLooks';
import { ShieldBubbles } from './ShieldBubbles';
import { hullShellVersion } from '../hull/setting';
import { ShipRebuildQueue } from '../hull/rebuildQueue';
import type { NavLightShip } from '../hull/NavLights';
import { disposeShadedMaterials, shadeColorAttribute, shadedMaterial, WreckBatcher } from '../sites/wreckBatch';
import { setFarLite } from '../env/ShadowRig';
import { boltSide, hullSpan, isConvoyHull, npcBulkRadius, npcSmokeLift, smokeRate, watchHullShare, watchShieldRadius } from './watchFx';
import { escortShipsNow, type EscortShipView } from '../convoys/escortLook';
import type { WarmUpZoo } from '../warmup';

/** Height of the bolts (the cannon muzzle is ~0.4 above the plane). */
const BOLT_HEIGHT = 0.35;
const SIM_DT = 1 / 60;
/** The loot beacon shows only after the explosion burns out. */
const BEACON_DELAY_TICKS = 120;
/** How long a pirate's last pose is remembered – its wreck (same step or a piece later) takes its clan. */
const SEEN_MEMORY = 3;
/** Lamps on the hull (sentry eye, standby blink, salvo charge) sit this high above the plane. */
const LAMP_HEIGHT = 0.75;
const SENTRY_EYE = new Color(3.2, 0.32, 0.18);
const STANDBY = new Color(2.2, 0.55, 0.2);
const CHARGE = new Color(3.4, 1.1, 0.4);

/** A ship's slot in the nav light layer (rewritten every frame, no allocation). */
type NavSlot = { -readonly [K in keyof NavLightShip]: NavLightShip[K] };

interface ShipEntry {
  view: ShipView;
  /** Queued rebuild of this entry: rebuilds the view and dresses it again (the rebuild queue's item). */
  rebuild(grid: ShipGrid, props: ShipProperties): void;
  /** Enemies: the nav lights (wrecks have none). */
  nav?: NavSlot;
  /** Enemies: a Gunner (its cannons get the salvo tell). */
  gunner?: boolean;
  gridVersion: number;
  /** Wreck grid the view was built from (a dismantled wreck gets a new grid, M3.6). */
  grid?: Wreck['grid'];
  /** Clan part set the view wants (null = the player's parts). */
  clan: FactionId | null;
  /** The view was built with the clan's set loaded (otherwise it rebuilds once it is). */
  clanBuilt: boolean;
  /** Enemies (M4b): the dress the view wears – a change (a sleeper waking) rebuilds it. */
  look?: EnemyLook;
  /** Cockpit centre in the ship frame (from the centre of mass): the sentry eye, the standby blink. */
  eye?: Vec2;
  /** Cannon part ids (the Gunner's salvo tell at their muzzles). */
  cannons?: number[];
  /** Own phase of the idle animations (s). */
  phase?: number;
}

/** Last pose of a pirate (wreck → clan, torn edges). */
interface SeenShip {
  pos: Vec2;
  radius: number;
  /** null = a sentry drone (the player's parts in the dead livery – its wreck keeps them). */
  clan: FactionId | null;
  /** The grid at first sight and its cells: a wreck broken off it shows torn edges where it parted. */
  grid: ShipGrid;
  cells: ReadonlySet<string>;
  time: number;
}

/**
 * Did the wreck break off this ship? Its parts are the ship's own (same ids, kinds and places – the sim
 * copies them), so both grids share one frame and the ship's cells tell where the wreck was torn.
 */
function brokeOff(w: Wreck, ship: SeenShip): boolean {
  const parts = ship.grid.parts;
  return w.grid.parts.every((p) => parts.some((q) => q.id === p.id && q.partId === p.partId && q.x === p.x && q.y === p.y && q.rot === p.rot));
}

/** One ship view of the layer (tests): its clan and how many parts use the clan's own models. */
export interface CombatShipStats {
  id: string;
  wreck: boolean;
  clan: FactionId | null;
  clanParts: number;
  /** The hull shell of the view's last build (timing, torn edges). */
  shell: ShellInfo;
  /** Nav lights of the view (0 for wrecks). */
  navPoints: number;
}

/** Hull shell options of enemy and wreck views: flight look, torn edges against the first build. */
const COMBAT_VIEW: ShipViewOptions = { mode: 'flight', tornFrom: 'firstBuild' };

/**
 * A wreck that may draw from the static batch now: a graveyard wreck (`gy:`) lying still – not moving,
 * not being cut, not held by the tractor beam (towed or a part being ripped), not fading out.
 */
export function stillWreck(w: Wreck, held: number | null): boolean {
  if (w.poi?.startsWith('gy:') !== true || w.cutting || held === w.id || w.ttl <= WRECK_FADE_TICKS) return false;
  const { body, prevBody } = w;
  return (
    body.vel.x === 0 &&
    body.vel.y === 0 &&
    body.angVel === 0 &&
    body.pos.x === prevBody.pos.x &&
    body.pos.y === prevBody.pos.y &&
    body.angle === prevBody.angle
  );
}

/**
 * A dormant sleeper that may draw from the static batch now: powered down (`look` 'dormant') and lying
 * still - a sleeper that is nudged, hit or woken leaves it.
 */
export function stillSleeper(e: Enemy, look: EnemyLook): boolean {
  if (look !== 'dormant') return false;
  const { body, prevBody } = e;
  return (
    body.vel.x === 0 &&
    body.vel.y === 0 &&
    body.angVel === 0 &&
    body.pos.x === prevBody.pos.x &&
    body.pos.y === prevBody.pos.y &&
    body.angle === prevBody.angle
  );
}

/** Dead hull: every part in its own shade, stable for the wreck (a place of interest by its key). */
const wreckShade = (w: Wreck): number => (w.poi ? fnv1a32(w.poi) : w.id);

/**
 * An enemy's dress by its look (M4b): pirates keep the old tint on fallback parts (clan parts are left
 * alone, livery.ts); a sentry drone and a powered-down sleeper wear the dead livery, each part in its
 * own shade – a sleeper reads as one more wreck of its graveyard until it wakes.
 */
function dressEnemy(view: ShipView, id: string, look: EnemyLook): void {
  if (look === 'pirate') applyLivery(view.group, 'pirate');
  else applyDerelict(view.group, fnv1a32(id));
}

/** The cockpit (eye, standby blink) and the cannons of an enemy's grid, for its lamps. */
function hullMarks(entry: ShipEntry, grid: ShipGrid, props: ShipProperties): void {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  if (cockpit) {
    const c = partCenter(cockpit);
    entry.eye = { x: c.x - props.centerOfMass.x, y: c.y - props.centerOfMass.y };
  } else entry.eye = undefined;
  entry.cannons = entry.gunner === true ? grid.parts.filter((p) => p.partId === 'cannon').map((p) => p.id) : undefined;
}

export interface PlayerPose {
  pos: Vec2;
  angle: number;
}

export class CombatLayer {
  readonly object = new Group();
  /** Effect models – shared (RenderContext) or own (released by dispose). */
  private readonly models: FxModels;
  private readonly ownsModels: boolean;
  private readonly effects: Effects;
  private readonly shields = new ShieldBubbles();
  private readonly enemies = new Map<string, ShipEntry>();
  private readonly wrecks = new Map<number, ShipEntry>();
  /** Still graveyard wrecks and dormant sleepers merged into static batches (their live views out of the scene). */
  private readonly wreckBatch = new WreckBatcher();
  private readonly bolts = new SpriteBatch({ texture: vfxTexture('bolt'), additive: true, max: 512, renderOrder: 13 });
  private readonly boltGlow = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 512, renderOrder: 12 });
  private readonly beacons = new SpriteBatch({ texture: vfxTexture('shockwave_ring'), additive: true, max: 64, renderOrder: 12 });
  /** Hull lamps of the M4b enemies: sentry eyes, standby blinks, the salvo charge glow. */
  private readonly lamps = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 128, renderOrder: 13 });
  private readonly lampColor = new Color();
  private readonly sweep: Vec2 = { x: 0, y: 0 };
  private readonly tell = { charge: 0, firing: false };
  private readonly v = new Vector3();
  private readonly axis = new Vector3();
  private readonly beaconColor = new Color(0.35, 1.2, 1.8);
  /** Clan of every pirate id seen (fixed at first sight – a ship never changes colours mid-fight). */
  private readonly clanOf = new Map<string, FactionId>();
  private readonly seen = new Map<string, SeenShip>();
  /** Enemy and wreck rebuilds (hull shell): at most one per frame, nearest to the player first. */
  readonly rebuilds = new ShipRebuildQueue<ShipEntry>();
  /** The player's world position this frame (the queue's order). */
  private refX = 0;
  private refZ = 0;
  private readonly distanceSq = (entry: ShipEntry): number => {
    const p = entry.view.group.position;
    const dx = p.x - this.refX;
    const dz = p.z - this.refZ;
    return dx * dx + dz * dz;
  };
  /** Nav lights of the enemies (the renderer appends them to the player's). */
  readonly navShips: NavLightShip[] = [];
  private derelictPreloaded = false;
  /** Smoke owed per damaged live NPC ship – Watch and escort convoy ships (puffs; M4d). */
  private readonly npcSmoke = new Map<string, number>();
  private readonly smokeAlive = new Set<string>();
  /** The escort convoy ships of the last frame (an explosion takes the pose of the ship that just died). */
  private escortsNow: EscortShipView[] = [];
  private escortsBefore: EscortShipView[] = [];
  private time = 0;
  /** Time scale of the effects (1 = normal; e2e screenshots slow it down). */
  timeScale = 1;

  constructor(
    private readonly library: ModelLibrary,
    models?: FxModels,
  ) {
    this.ownsModels = !models;
    this.models = models ?? new FxModels();
    this.effects = new Effects(this.models);
    this.object.add(this.effects.object, this.shields.object, this.bolts.mesh, this.boltGlow.mesh, this.beacons.mesh, this.lamps.mesh, this.wreckBatch.object);
  }

  /**
   * Shader warm-up: the shield bubble (ships, wrecks and debris come from the model templates) and the
   * graveyard batches' vertex-shaded twin of every derelict template material (`templates` = the part
   * and clan part templates).
   */
  warmUp(zoo: WarmUpZoo, templates: Iterable<Object3D> = []): void {
    this.shields.warmUp(zoo);
    const seen = new Set<Material>();
    for (const t of templates) {
      const copy = t.clone();
      applyDerelict(copy, 0);
      copy.traverse((o) => {
        if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
        const twin = shadedMaterial(o.material as Material);
        const position = o.geometry.getAttribute('position');
        if (!twin || seen.has(twin) || !position) return;
        seen.add(twin);
        // the merged batch geometry: the part's attributes plus the shade colour
        const g = zoo.geometry(new BufferGeometry());
        for (const name of Object.keys(o.geometry.attributes)) if (name !== 'color') g.setAttribute(name, o.geometry.getAttribute(name));
        g.setIndex(o.geometry.index);
        g.setAttribute('color', shadeColorAttribute(position.count, (o.material as { color: Color }).color));
        zoo.add(new Mesh(g, twin));
      });
    }
  }

  /** The camera's view distance this frame: graveyard batches draw their LOD1 in the far band. */
  setViewDistance(distance: number): void {
    this.wreckBatch.setViewDistance(distance);
  }

  // ---------------------------------------------------------------------------
  // events

  /** Effects of the events of a simulation step (called after every step). */
  onEvents(events: readonly SimEvent[], state: SimState): void {
    for (const e of events) {
      switch (e.type) {
        case 'shotFired': {
          const at = simToWorld(e.pos, BOLT_HEIGHT, new Vector3());
          const dir = new Vector3(e.dir.x, 0, -e.dir.y);
          this.effects.muzzleFlash(at, dir, boltSide(e.owner));
          // a Gunner's salvo is heavier than a plain shot (M4b)
          if (e.owner !== PLAYER_REF && state.combat.enemies.find((x) => x.id === e.owner)?.kind === 'gunner') this.effects.salvoFlash(at, dir);
          break;
        }
        // a grain the shield took lights the bubble (Micrometeors draws the sparks)
        case 'micrometeorHit':
          if (e.shielded && !state.player.destroyed) {
            const at = simToWorld(e.pos, FX_HEIGHT, new Vector3());
            this.shields.place(PLAYER_REF, simToWorld(state.player.body.pos, FX_HEIGHT, this.v), shieldRadius(state.player.props), state.player.body.angle);
            this.shields.hit(PLAYER_REF, at);
          }
          break;
        case 'projectileHit': {
          const pos = simToWorld(e.pos, FX_HEIGHT, new Vector3());
          const incoming = new Vector3(e.pos.x - e.from.x, 0, -(e.pos.y - e.from.y));
          if (e.target === 'shield' && e.ref) {
            const ship = e.ref === PLAYER_REF ? state.player : state.combat.enemies.find((x) => x.id === e.ref);
            if (ship) this.shields.place(e.ref, simToWorld(ship.body.pos, FX_HEIGHT, this.v), shieldRadius(ship.props), ship.body.angle);
            this.shields.hit(e.ref, pos);
            this.effects.shieldImpact(pos);
          } else {
            this.effects.impact(pos, incoming, e.target === 'shield' ? 'ship' : e.target);
          }
          break;
        }
        // an NPC ship hit by a pirate (M4d): a shielded Watch ship lights its bubble, anything else (a
        // Watch hull, an escorted trader / tanker – no shields) throws hull sparks
        case 'npcHit': {
          const pos = simToWorld(e.pos, FX_HEIGHT, new Vector3());
          const shielded = e.shielded ? state.guild.watch.find((w) => w.id === e.id) : undefined;
          if (shielded) {
            this.shields.place(e.id, simToWorld(shielded.body.pos, FX_HEIGHT, this.v), watchShieldRadius(shielded), shielded.body.angle);
            this.shields.hit(e.id, pos);
            this.effects.shieldImpact(pos);
          } else this.effects.impact(pos, null, 'ship');
          break;
        }
        // an NPC ship destroyed: an explosion, no wreck; a long convoy hull also bursts at bow and stern
        case 'npcDestroyed':
          this.npcExplosion(e.id, e.kind, e.pos);
          break;
        case 'partDestroyed': {
          const ship = e.ref === PLAYER_REF ? state.player : state.combat.enemies.find((x) => x.id === e.ref);
          const vel = ship ? new Vector3(ship.body.vel.x, 0, -ship.body.vel.y) : new Vector3();
          this.effects.partExplosion(simToWorld(e.pos, FX_HEIGHT, new Vector3()), vel, this.debrisOf(e.ref, state));
          break;
        }
        // a large reactor blew up (M4c): shockwave and debris at its centre (fx/Effects.ts)
        case 'partBlast': {
          const ship = e.ref === PLAYER_REF ? state.player : state.combat.enemies.find((x) => x.id === e.ref);
          const vel = ship ? new Vector3(ship.body.vel.x, 0, -ship.body.vel.y) : new Vector3();
          this.effects.reactorBlast(simToWorld(e.pos, FX_HEIGHT, new Vector3()), vel, this.debrisOf(e.ref, state));
          break;
        }
        case 'shipDestroyed':
        case 'playerDestroyed':
          this.effects.shipExplosion(simToWorld(e.pos, FX_HEIGHT, new Vector3()), new Vector3(e.vel.x, 0, -e.vel.y), e.radius, e.type === 'shipDestroyed' ? this.debrisOf(e.ref, state) : 'human');
          break;
        case 'asteroidDepleted': {
          const a = state.world.findAsteroid(e.id);
          if (a) this.effects.asteroidBreakup(simToWorld(a.pos, 0, new Vector3()), a.baseRadius * 0.5, a.resource);
          break;
        }
        case 'asteroidCracked':
          this.effects.iceCrack(simToWorld(e.pos, 0, new Vector3()), e.radius);
          break;
        // a hard knock on a rock or a station scrapes sparks off the hull (M3.8) – more at speed
        case 'collision':
          if (e.pos && e.speed > 2.5) this.effects.scrape(simToWorld(e.pos, FX_HEIGHT, new Vector3()), Math.min(1, (e.speed - 2.5) / 25));
          break;
        case 'salvaged': {
          const w = state.combat.wrecks.find((x) => x.id === e.wreckId);
          if (w) this.effects.shieldImpact(simToWorld(w.body.pos, FX_HEIGHT, new Vector3()));
          break;
        }
        // --- salvage and fortress (M3.6) ---
        case 'wreckCut': {
          const at = simToWorld(e.pos, FX_HEIGHT, new Vector3());
          const cut = state.combat.wrecks.find((w) => w.id === e.wreckId);
          const set: DebrisSet = cut?.livery === 'pirate' ? 'pirate' : 'human';
          if (e.blast > 0) this.effects.shipExplosion(at, new Vector3(), 2.6, set);
          else this.effects.partExplosion(at, new Vector3(), set);
          break;
        }
        case 'partRipped':
        case 'containerLoaded':
          this.effects.shieldImpact(simToWorld(e.pos, FX_HEIGHT, new Vector3()));
          break;
        case 'scavengerStole':
          this.effects.shieldImpact(simToWorld(e.pos, FX_HEIGHT, new Vector3()));
          break;
        case 'fortressPartDestroyed': {
          const at = simToWorld(e.pos, FX_HEIGHT + 1.5, new Vector3());
          this.effects.shipExplosion(at, new Vector3(), e.part === 'generator' ? 4 : 3, 'pirate');
          break;
        }
        case 'fortressDestroyed': {
          const at = simToWorld(e.pos, FX_HEIGHT + 2, new Vector3());
          this.effects.shipExplosion(at, new Vector3(), 14, 'pirate');
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this.effects.partExplosion(new Vector3(at.x + Math.cos(a) * 6, at.y, at.z + Math.sin(a) * 6), new Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3), 'pirate');
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Debris set of a ship by its ref (art batch B2): the player → human; a pirate → its clan's set
   * (the clan it was first seen with, or the one it would get now).
   */
  private debrisOf(ref: string, state: SimState): DebrisSet {
    if (ref === PLAYER_REF) return 'human';
    // a sentry drone is built from the player's parts
    if (this.seen.get(ref)?.clan === null || state.combat.enemies.find((x) => x.id === ref)?.kind === 'sentry') return 'human';
    const known = this.clanOf.get(ref);
    if (known) return debrisSetFor(known);
    const enemies = state.combat.enemies;
    const enemy = enemies.find((x) => x.id === ref);
    return debrisSetFor(enemy ? enemyClan(state.seed, enemy, enemies) : 'rust');
  }

  /** Sparks on the active stretch of a vein (the renderer calls it for a beam with a bonus). */
  veinSparks(pos: Vector3, resource: ResourceId): void {
    this.effects.veinSparks(pos, resource);
  }

  // ---------------------------------------------------------------------------
  // frame

  /** `alpha` = interpolation between steps, `player` = the interpolated player pose. */
  update(state: SimState, alpha: number, frameDt: number, player: PlayerPose): void {
    const dt = frameDt * this.timeScale;
    this.time += dt;
    const { combat } = state;
    // hull changes queue their rebuilds; this frame's turn runs before the views are posed and baked
    this.requestRebuilds(combat.enemies, combat.wrecks);
    simToWorld(player.pos, 0, this.v);
    this.refX = this.v.x;
    this.refZ = this.v.z;
    this.rebuilds.flush(this.distanceSq);
    this.beacons.begin();
    this.lamps.begin();
    this.syncEnemies(state.seed, combat.enemies, alpha, dt, player, state.player.destroyed);
    const tow = state.player.tractor?.target;
    this.syncWrecks(state.seed, combat.wrecks, alpha, tow?.kind === 'wreck' ? tow.id : null);
    this.beacons.end();
    this.lamps.end();
    this.drawProjectiles(state, alpha);

    // shield bubbles follow the ships
    const alive = new Set<string>([PLAYER_REF]);
    if (!state.player.destroyed) {
      this.shields.place(PLAYER_REF, simToWorld(player.pos, FX_HEIGHT, this.v), shieldRadius(state.player.props), player.angle);
    }
    for (const e of combat.enemies) {
      if (e.props.shield.capacity <= 0) continue;
      alive.add(e.id);
      const pos = lerp(e.prevBody.pos, e.body.pos, alpha);
      this.shields.place(e.id, simToWorld(pos, FX_HEIGHT, this.v), shieldRadius(e.props), lerpAngle(e.prevBody.angle, e.body.angle, alpha));
    }
    this.updateNpcShips(state, alpha, dt, alive);
    this.shields.update(dt, alive);
    this.effects.update(dt);
  }

  /**
   * Live NPC ships (M4d): the Watch ships' shield bubbles follow them; a Watch or escort convoy hull below
   * half trails smoke.
   */
  private updateNpcShips(state: SimState, alpha: number, dt: number, alive: Set<string>): void {
    const live = state.guild.watch;
    const swap = this.escortsBefore;
    this.escortsBefore = this.escortsNow;
    swap.length = 0;
    this.escortsNow = escortShipsNow(state, alpha, swap);
    if (live.length === 0 && this.escortsNow.length === 0 && this.npcSmoke.size === 0) return;
    const smoking = this.smokeAlive;
    smoking.clear();
    for (const w of live) {
      alive.add(w.id);
      const pos = simToWorld(lerp(w.prevBody.pos, w.body.pos, alpha), FX_HEIGHT, this.v);
      const angle = lerpAngle(w.prevBody.angle, w.body.angle, alpha);
      this.shields.place(w.id, pos, watchShieldRadius(w), angle);
      if (this.smoke(w.id, pos, w.body.vel, angle, w.kind, smokeRate(watchHullShare(w)), dt)) smoking.add(w.id);
    }
    for (const s of this.escortsNow) {
      if (this.smoke(s.id, simToWorld(s.pos, FX_HEIGHT, this.v), s.vel, s.heading, s.kind, smokeRate(s.hull), dt)) smoking.add(s.id);
    }
    for (const id of this.npcSmoke.keys()) if (!smoking.has(id)) this.npcSmoke.delete(id);
  }

  /**
   * Damage smoke of one NPC ship at `rate` puffs/s (none: false): from points on the hull – a little
   * behind the centre of a Watch ship, anywhere along a convoy hull.
   */
  private smoke(id: string, pos: Vector3, vel: Vec2, angle: number, kind: Parameters<typeof npcBulkRadius>[0], rate: number, dt: number): boolean {
    if (rate <= 0) return false;
    let owed = (this.npcSmoke.get(id) ?? Math.random()) + rate * dt;
    if (owed >= 1) {
      const v = new Vector3(vel.x, 0, -vel.y);
      const r = npcBulkRadius(kind);
      const [stern, bow] = hullSpan(kind);
      const lift = npcSmokeLift(kind);
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      for (; owed >= 1; owed--) {
        const a = Math.random() * Math.PI * 2;
        const lx = (bow > stern ? stern + Math.random() * (bow - stern) : -r * 0.3) + Math.cos(a) * r * 0.35;
        const ly = Math.sin(a) * r * 0.35;
        this.effects.damageSmoke(new Vector3(pos.x + lx * c - ly * sn, pos.y + lift, pos.z - (lx * sn + ly * c)), v, r);
      }
    }
    this.npcSmoke.set(id, owed);
    return true;
  }

  /** A destroyed NPC ship: a fireball at its centre; a convoy hull also bursts at its bow and stern. */
  private npcExplosion(id: string, kind: Parameters<typeof npcBulkRadius>[0], at: Vec2): void {
    const ship = this.escortsNow.find((s) => s.id === id) ?? this.escortsBefore.find((s) => s.id === id);
    const vel = ship ? new Vector3(ship.vel.x, 0, -ship.vel.y) : new Vector3();
    this.effects.shipExplosion(simToWorld(at, FX_HEIGHT, new Vector3()), vel, npcBulkRadius(kind), 'human');
    if (!isConvoyHull(kind) || !ship) return;
    const c = Math.cos(ship.heading);
    const sn = Math.sin(ship.heading);
    for (const x of hullSpan(kind)) this.effects.partExplosion(simToWorld({ x: at.x + x * c, y: at.y + x * sn }, FX_HEIGHT, new Vector3()), vel, 'human');
  }

  /** Clan of a pirate, fixed at first sight; starts loading the clan's part set. */
  private enemyClan(seed: number, e: Enemy, enemies: readonly Enemy[]): FactionId {
    let clan = this.clanOf.get(e.id);
    if (!clan) {
      clan = enemyClan(seed, e, enemies);
      this.clanOf.set(e.id, clan);
      // the first pirate pulls in its clan's set; the other clans follow in the background, so a
      // later clan shows up with its own models right away (no fallback → clan rebuild)
      void this.library.clans.ensure(clan).then(() => {
        for (const other of CAPTAIN_CLANS) void this.library.clans.ensure(other);
      });
    }
    return clan;
  }

  /** The view waits for its clan's set, which has loaded by now. */
  private clanArrived(entry: ShipEntry): boolean {
    return !entry.clanBuilt && entry.clan !== null && this.library.clans.ready(entry.clan);
  }

  /** Rebuilds a ship view's hull now (the clan's set is used if it has loaded) and dresses it. */
  private rebuildView(entry: ShipEntry, grid: ShipGrid, props: ShipProperties, dress: (view: ShipView) => void): void {
    entry.clanBuilt = entry.clan === null || this.library.clans.ready(entry.clan);
    entry.view.rebuild(grid, props);
    dress(entry.view);
  }

  /** Removes a view of the layer (gone from the sim, or the layer is disposed). */
  private drop(entry: ShipEntry): void {
    this.rebuilds.cancel(entry);
    this.object.remove(entry.view.group);
    entry.view.dispose();
    if (entry.nav) {
      const i = this.navShips.indexOf(entry.nav);
      if (i >= 0) this.navShips.splice(i, 1);
    }
  }

  /**
   * Queues the rebuilds of views whose hull changed: an enemy lost a part, a sleeper woke, a wreck was
   * cut or ripped apart (M3.6), or a clan's set finished loading. A view keeps its old hull until its
   * turn (the explosion covers the lost part); a second change while it waits only updates the grid.
   */
  private requestRebuilds(enemies: readonly Enemy[], wrecks: readonly Wreck[]): void {
    for (const e of enemies) {
      const entry = this.enemies.get(e.id);
      if (!entry) continue;
      const look = enemyLook(e);
      if (entry.gridVersion === e.gridVersion && entry.look === look && !(this.clanArrived(entry) && !this.rebuilds.has(entry))) continue;
      const woke = entry.look === 'dormant' && look !== 'dormant';
      entry.look = look;
      entry.gridVersion = e.gridVersion;
      this.rebuilds.request(entry, e.grid, e.props);
      if (woke) this.effects.wakeFlare(simToWorld(e.body.pos, FX_HEIGHT, new Vector3()), e.props.boundingRadius);
    }
    for (const w of wrecks) {
      const entry = this.wrecks.get(w.id);
      if (!entry || (entry.grid === w.grid && !(this.clanArrived(entry) && !this.rebuilds.has(entry)))) continue;
      entry.grid = w.grid;
      this.rebuilds.request(entry, w.grid, w.props);
    }
  }

  private syncEnemies(seed: number, enemies: readonly Enemy[], alpha: number, dt: number, player: PlayerPose, playerDown: boolean): void {
    const seen = new Set<string>();
    const shell = hullShellVersion();
    if (enemies.length > 0 && !this.derelictPreloaded) {
      this.derelictPreloaded = true;
      preloadDerelictLivery();
    }
    for (const e of enemies) {
      seen.add(e.id);
      let entry = this.enemies.get(e.id);
      const look = enemyLook(e);
      const dress = (view: ShipView) => dressEnemy(view, e.id, look);
      if (!entry) {
        // a sentry drone is the station's own make: the player's parts in the dead livery
        const clan = look === 'sentry' ? null : this.enemyClan(seed, e, enemies);
        const view = new ShipView(e.grid, e.props, this.library, clan, { ...COMBAT_VIEW });
        dress(view);
        this.object.add(view.group);
        const id = e.id;
        const created: ShipEntry = {
          view,
          gridVersion: e.gridVersion,
          clan,
          clanBuilt: clan === null || this.library.clans.ready(clan),
          look,
          gunner: e.kind === 'gunner',
          phase: (fnv1a32(id) % 1000) / 100,
          nav: { object: view.group, points: view.navPoints(), pirate: true, visible: false },
          // run by the queue later: dressed by the look of that moment (a sleeper may have woken)
          rebuild: (grid, props) => {
            this.wreckBatch.release(id, view.group);
            this.rebuildView(created, grid, props, (v) => dressEnemy(v, id, created.look ?? 'pirate'));
            hullMarks(created, grid, props);
          },
        };
        entry = created;
        hullMarks(entry, e.grid, e.props);
        this.enemies.set(id, entry);
        this.navShips.push(created.nav!);
      }
      const pos = lerp(e.prevBody.pos, e.body.pos, alpha);
      const before = this.seen.get(e.id);
      const first = before?.grid ?? e.grid;
      this.seen.set(e.id, { pos, radius: e.props.boundingRadius, clan: entry.clan, grid: first, cells: before?.cells ?? gridCellKeys(first), time: this.time });
      const angle = lerpAngle(e.prevBody.angle, e.body.angle, alpha);
      const nav = entry.nav!;
      // a dormant sleeper lying still draws from its cell's static batch, like a wreck (its lamps go on)
      const still = stillSleeper(e, look);
      if (this.wreckBatch.batched(e.id, entry.view.group, still, shell)) {
        nav.visible = false;
        this.drawLamps(entry, e, pos, angle, look, alpha, player, playerDown);
        continue;
      }
      simToWorld(pos, 0, entry.view.group.position);
      entry.view.group.rotation.y = angle;
      // turrets aim at the player; an idle sentry sweeps its arc; a sleeper's machinery stands still
      const idleSentry = look === 'sentry' && e.ai.mode !== 'attack';
      const aimLocal = idleSentry ? idleSweep(this.time, entry.phase ?? 0, this.sweep) : look === 'dormant' ? null : rotate(sub(player.pos, pos), -angle);
      entry.view.update(look === 'dormant' ? 0 : dt, e.lastLocalForce, e.props, aimLocal, e.body.angVel);
      // a sleeper lies among the wrecks like one: the far tier drops its shadow and AO with theirs
      setFarLite(entry.view.group, look === 'dormant');
      entry.view.setDamage(e.hp, dt, fnv1a32(e.id));
      // a powered-down sleeper shows no lights
      nav.points = entry.view.navPoints();
      nav.visible = look !== 'dormant' && entry.view.group.visible;
      this.drawLamps(entry, e, pos, angle, look, alpha, player, playerDown);
      if (look === 'dormant') this.wreckBatch.settle(e.id, entry.view.group, still, shell);
    }
    for (const [id, entry] of this.enemies) {
      if (seen.has(id)) continue;
      this.wreckBatch.release(id);
      this.drop(entry);
      this.enemies.delete(id);
      this.clanOf.delete(id);
    }
    for (const [id, s] of this.seen) if (!seen.has(id) && this.time - s.time > SEEN_MEMORY) this.seen.delete(id);
  }

  /**
   * Clan of a pirate wreck: the pirate it broke off (`source`), otherwise – a wreck from a save or a
   * place of interest – the clan of the territory it lies in.
   */
  private wreckClan(seed: number, w: Wreck, source: SeenShip | null): FactionId | null {
    if (w.livery !== 'pirate') return null;
    return source ? source.clan : clanAt(seed, w.body.pos);
  }

  /** The enemy a wreck broke off: the nearest one last seen right there, or null. */
  private wreckSource(w: Wreck): SeenShip | null {
    let best: SeenShip | null = null;
    let bestD = Infinity;
    for (const s of this.seen.values()) {
      const d = Math.hypot(s.pos.x - w.body.pos.x, s.pos.y - w.body.pos.y);
      if (d <= s.radius + 6 && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Hull lamps of one enemy: the sentry eye, a sleeper's standby blink, the Gunner's salvo charge. */
  private drawLamps(entry: ShipEntry, e: Enemy, pos: Vec2, angle: number, look: EnemyLook, alpha: number, player: PlayerPose, playerDown: boolean): void {
    const eye = entry.eye;
    const phase = entry.phase ?? 0;
    if (eye && look === 'sentry') {
      // alive: a steady red eye, brighter and quicker while it fights
      const fighting = e.ai.mode === 'attack';
      const pulse = fighting ? 0.75 + 0.25 * Math.sin(this.time * 9 + phase) : 0.6 + 0.15 * Math.sin(this.time * 2 + phase);
      const at = this.lampAt(pos, angle, eye.x + 0.3, eye.y);
      const size = fighting ? 1.15 : 0.85;
      this.lamps.add(at, null, size, size, 0, SENTRY_EYE, pulse);
      this.lamps.add(at, null, 0.3, 0.3, 0, this.lampColor.setRGB(3.5, 2.2, 2.0), 0.9);
    } else if (eye && look === 'dormant') {
      // powered down: only a faint standby blink
      const blink = standbyBlink(this.time, phase);
      if (blink > 0) this.lamps.add(this.lampAt(pos, angle, eye.x, eye.y), null, 0.9, 0.9, 0, STANDBY, 0.55 * blink);
    }
    if (e.kind !== 'gunner' || !entry.cannons || look === 'dormant') return;
    const range = e.props.weapons[0]?.range ?? 0;
    const inReach = !playerDown && Math.hypot(player.pos.x - pos.x, player.pos.y - pos.y) < range;
    const tell = salvoTell(e, inReach, alpha, this.tell);
    if (tell.charge <= 0) {
      // pilot lights: the battery of three reads as one at the game camera, and the tell grows from them
      for (const id of entry.cannons) {
        const m = entry.view.cannonMuzzleWorld(id, this.v);
        if (m) this.lamps.add(m.setY(m.y + 0.25), null, 0.75, 0.75, 0, CHARGE, 0.55);
      }
      return;
    }
    // the cannons glow up to the salvo, a ring closes in on the hull; while it fires the muzzles stay hot
    const k = tell.firing ? 0.7 : tell.charge * tell.charge;
    for (const id of entry.cannons) {
      const m = entry.view.cannonMuzzleWorld(id, this.v);
      if (!m) continue;
      const flicker = tell.firing ? 1 : 0.85 + 0.15 * Math.sin(this.time * 40 + id);
      const size = 0.45 + 0.9 * k;
      this.lamps.add(m, null, size, size, 0, CHARGE, (0.35 + 0.65 * k) * flicker);
      // a white-hot core once the charge is nearly full
      if (k > 0.3) this.lamps.add(m, null, 0.35 * k, 0.35 * k, 0, this.lampColor.setRGB(3.2, 2.6, 2.2), k * flicker);
    }
    if (!tell.firing) {
      const r = e.props.boundingRadius * (3.2 - 1.7 * tell.charge);
      this.beacons.add(simToWorld(pos, 0.5, this.v), null, r * 2, r * 2, 0, CHARGE, 0.1 + 0.3 * tell.charge);
    }
  }

  /** World position of a hull lamp at ship-frame (x, y) (reuses `this.v`). */
  private lampAt(pos: Vec2, angle: number, x: number, y: number): Vector3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return this.v.set(pos.x + x * c - y * s, LAMP_HEIGHT, -(pos.y + x * s + y * c));
  }

  /** `held` = the wreck the tractor beam holds (towed, or a part being ripped off), null = none. */
  private syncWrecks(seed: number, wrecks: readonly Wreck[], alpha: number, held: number | null): void {
    const seen = new Set<number>();
    const shell = hullShellVersion();
    for (const w of wrecks) {
      seen.add(w.id);
      let entry = this.wrecks.get(w.id);
      if (!entry) {
        const source = this.wreckSource(w);
        const clan = this.wreckClan(seed, w, source);
        if (clan) void this.library.clans.ensure(clan);
        // a piece of a ship seen moments ago is torn where it parted from the rest (same grid frame)
        const torn = source && brokeOff(w, source) ? source.cells : 'firstBuild';
        const view = new ShipView(w.grid, w.props, this.library, clan, { ...COMBAT_VIEW, tornFrom: torn });
        const id = w.id;
        const shade = wreckShade(w);
        applyDerelict(view.group, shade);
        // graveyard wrecks (live or batched) are far-lite: no shadow casting and no AO far out (ShadowRig)
        if (w.poi?.startsWith('gy:') === true) setFarLite(view.group, true);
        this.object.add(view.group);
        const created: ShipEntry = {
          view,
          gridVersion: 0,
          grid: w.grid,
          clan,
          clanBuilt: clan === null || this.library.clans.ready(clan),
          rebuild: (grid, props) => {
            this.wreckBatch.release(id, view.group);
            this.rebuildView(created, grid, props, (v) => applyDerelict(v.group, shade));
          },
        };
        entry = created;
        this.wrecks.set(id, entry);
      }
      const pos = lerp(w.prevBody.pos, w.body.pos, alpha);
      const g = entry.view.group;
      simToWorld(pos, 0, g.position);
      g.rotation.y = lerpAngle(w.prevBody.angle, w.body.angle, alpha);
      g.scale.setScalar(Math.min(1, w.ttl / WRECK_FADE_TICKS));
      const still = stillWreck(w, held);
      if (!this.wreckBatch.batched(w.id, g, still, shell)) {
        // a dead hull is always scarred (2–3 decals per part)
        entry.view.setDamage('wreck', 0, wreckShade(w));
        this.wreckBatch.settle(w.id, g, still, shell);
      }
      // loot: an expanding cyan ring (only after the explosion burns out)
      if (!lootEmpty(w.loot) && WRECK_TTL - w.ttl > BEACON_DELAY_TICKS) {
        const phase = (this.time * 0.8 + w.id * 0.37) % 1;
        const size = w.props.boundingRadius * (1.2 + 1.4 * phase);
        this.beacons.add(simToWorld(pos, 0.6, this.v), null, size, size, 0, this.beaconColor, 0.55 * (1 - phase));
      }
    }
    for (const [id, entry] of this.wrecks) {
      if (seen.has(id)) continue;
      this.wreckBatch.release(id);
      this.drop(entry);
      this.wrecks.delete(id);
    }
    this.wreckBatch.flush();
  }

  private drawProjectiles(state: SimState, alpha: number): void {
    this.bolts.begin();
    this.boltGlow.begin();
    for (const p of state.combat.projectiles) {
      // the state is after the step – interpolate back by (1 − alpha) of a step
      const back = (1 - alpha) * SIM_DT;
      const pos = { x: p.pos.x - p.vel.x * back, y: p.pos.y - p.vel.y * back };
      const side = boltSide(p.owner);
      const color = side === 'player' ? FX_COLORS.playerBolt : side === 'guild' ? FX_COLORS.guildBolt : FX_COLORS.pirateBolt;
      const c = simToWorld(pos, BOLT_HEIGHT, this.v);
      this.axis.set(p.vel.x, 0, -p.vel.y);
      const len = p.tier === 2 ? 2.1 : 1.8;
      this.bolts.add(c, this.axis, len, len * 0.17, 0, color, 1);
      this.boltGlow.add(c, null, 1.0, 1.0, 0, color, 0.22);
    }
    this.bolts.end();
    this.boltGlow.end();
  }

  /** Counts for tests and debugging; `ships` = which clan set each pirate / wreck view uses. */
  stats(): { enemies: number; wrecks: number; batchedWrecks: number; effects: number; rebuildsPending: number; rebuildsDone: number; ships: CombatShipStats[] } {
    const ships: CombatShipStats[] = [];
    for (const [id, e] of this.enemies) ships.push({ id, wreck: false, clan: e.clan, clanParts: e.view.clanPartCount, shell: e.view.shellInfo, navPoints: e.view.navPoints().length });
    for (const [id, e] of this.wrecks) ships.push({ id: `wreck#${id}`, wreck: true, clan: e.clan, clanParts: e.view.clanPartCount, shell: e.view.shellInfo, navPoints: 0 });
    return {
      enemies: this.enemies.size,
      wrecks: this.wrecks.size,
      batchedWrecks: this.wreckBatch.size,
      effects: this.effects.active,
      rebuildsPending: this.rebuilds.pending,
      rebuildsDone: this.rebuilds.flushed,
      ships,
    };
  }

  dispose(): void {
    for (const e of [...this.enemies.values(), ...this.wrecks.values()]) this.drop(e);
    this.rebuilds.clear();
    this.enemies.clear();
    this.wrecks.clear();
    this.wreckBatch.dispose();
    disposeShadedMaterials();
    this.clanOf.clear();
    this.seen.clear();
    this.effects.dispose();
    this.shields.dispose();
    this.bolts.dispose();
    this.boltGlow.dispose();
    this.beacons.dispose();
    this.lamps.dispose();
    if (this.ownsModels) this.models.dispose();
    disposeLiveries();
  }
}

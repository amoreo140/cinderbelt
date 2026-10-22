import {
  BatchedMesh,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { lerpAngle } from '../sim/math/angle';
import { lerp, rotate, sub, type Vec2 } from '../sim/math/vec2';
import { SIM_DT, type Simulation } from '../sim/Simulation';
import type { MiningBeam } from '../sim/mining/mining';
import { veinPointAt, veinsOf } from '../sim/mining/veins';
import type { ModelLibrary } from './assets/ModelLibrary';
import { prefetchesPending, releasePrefetched } from './assets/prefetch';
import { AsteroidField } from './AsteroidField';
import { CameraRig, COMBAT_MARGIN, combatLean, frameDistance, lookAheadOffset } from './CameraRig';
import { EnemyMarkers, type EnemyMarkerStats } from './EnemyMarkers';
import { combatFrame, hostilesNear } from '../game/hostiles';
import { HangarView } from './HangarView';
import type { HangarScene } from '../game/shipyardEditor';
import { simToWorld } from './coords';
import type { ScanView } from '../game/discovery/scanFeedback';
import { LaserView, type LaserSlotInfo } from './LaserView';
import { NuggetLayer } from './mining/NuggetLayer';
import { heatFraction } from '../sim/mining/heat';
import { CombatLayer } from './combat/CombatLayer';
import { ContractLayer } from './contracts/ContractLayer';
import { DiscoveryLayer } from './discovery/DiscoveryLayer';
import { SurveyMarkers } from './discovery/SurveyMarkers';
import { SalvageLayer } from './salvage/SalvageLayer';
import { FortressLayer } from './pirates/FortressLayer';
import { SiteLayer } from './sites/SiteLayer';
import { CometLayer } from './sites/CometLayer';
import { Micrometeors } from './fx/Micrometeors';
import { towable } from '../sim/salvage/tractor';
import type { SimEvent } from '../sim/Simulation';
import { RenderContext } from './RenderContext';
import { ShipView } from './ShipView';
import { gridCellKeys } from '../sim/ship/outline';
import type { ShipGrid } from '../sim/ship/types';
import type { FactionId } from '../data/factions';
import { HOME_MODULES, type HomeModuleId, type HomeSlot } from '../data/home';
import { dockView, insetShift, mixDockView, moduleFocusView, stepFocusBlend } from './stationAnim';
import { StationLayer } from './StationView';
import { HomeModules } from './home/HomeModules';
import { TrophyShelf } from './home/TrophyShelf';
import { HOME_STATION_ID } from '../sim/world/stations';
import { SectorZoneTracker, zoneKey } from '../game/sectorZone';
import { SKY_DRIFT } from './skybox';
import { ZoneSky } from './ZoneSky';
import { SpaceDust } from './SpaceDust';
import { FlightMarkers } from './FlightMarkers';
import { DockMarker, type DockMarkerStats } from './DockMarker';
import { shakeFor } from './shake';
import { stoppingPoint, type CollisionWarning } from '../game/flightAssist';
import { cargoMass } from '../data/resources';
import { Starfield } from './Starfield';
import { PostStack } from './post/PostStack';
import { ZoneEnvironment } from './env/ZoneEnvironment';
import { ShadowRig, viewDistanceOf } from './env/ShadowRig';
import { ShadowCadence } from './env/shadowCadence';
import { AsteroidDust } from './env/AsteroidDust';
import { StationTraffic } from './traffic/StationTraffic';
import { ConvoyLayer } from './convoys/ConvoyLayer';
import { SHIP_TRAILS } from './ShipView';
import { NavLights, type NavLightShip } from './hull/NavLights';
import { hullShellVersion, setHullShellQuality } from './hull/setting';
import type { PaintId } from '../data/paints';
import { paintOf } from '../sim/fleet/state';
import { applyPaint, disposePaints, paintWarmUpSamples, preloadPaints } from './paint';
import { measureShellBuild, type ShellBuildTiming } from './hull/perfHook';
import { shellWarmUpSamples } from './hull/shellWarmup';
import { DynamicResolution, dynamicResolutionEnabled } from './dynamicResolution';
import { GpuTimer } from './gpuTimer';
import { AutoQuality, isSoftwareGpu, presetFor, qualityForGpu, type GraphicsQuality, type GraphicsSetting, type QualityPreset } from './quality';
import { BACKGROUND_BRIGHTNESS_DEFAULT, backdropLook } from './env/backdrop';
import { RimLight } from './rimLight';
import { ScatterLayer } from './scatter/ScatterLayer';
import { BorderLayer } from './borders/BorderLayer';
import { sceneryReady } from './env/sceneryAssets';
import { hullDecalSample } from './decals/HullDecals';
import { coloredBatchSample, compileDraws, compileScene, compileUncompiled, delay, lightsOf, drawTwins, gpuIdle, primeProgramsSliced, programCount, ShaderZoo, uploadTexturesSliced, within } from './warmup';
import { blastShake } from './parts/workshopAnim';

/** Faint counter-light (nebula bounce) so the shadow sides of rocks are not black; colour per zone. */
const FILL_OFFSET = new Vector3(-35, 20, 30);
/** Distance of the sun light from the point it shines at (without shadows). */
const SUN_DISTANCE = 100;
/** Hemisphere light before the skybox loads (afterwards the zone look sets it). */
const HEMI_INTENSITY = 0.6;
/** Code-drawn stars above the panorama – sharper than the stars in the texture, but fainter. */
const STARS_OVER_SKYBOX = 0.6;
/** Speed of the camera transition between flight and the "dock" view (1/s). */
const DOCK_VIEW_RATE = 2.5;
/**
 * Docked (the hub covers the right part of the screen, the camera stands still) the sun's shadow map is
 * drawn every this many frames, and at once when the view moves (render/env/shadowCadence.ts, perf audit
 * 2026-10-17, P3).
 */
const DOCKED_SHADOW_EVERY = 2;

/** End of the beam on the rock's surface: height ≈ a sphere with the rock's radius × this (a rock is not a sphere). */
const ROCK_SURFACE = 0.92;

/** What the game tells the renderer about flight assist (M3.8). */
export interface FlightAssistView {
  /** Flight-path marker and stopping point (setting). */
  marker: boolean;
  /** Camera shake (setting; off with reduced motion). */
  shake: boolean;
  reducedMotion: boolean;
  collision: CollisionWarning | null;
  /** Combat zoom-out (setting, readability R1); default on. */
  combatZoom?: boolean;
}

/** How often the number of draw calls is logged in DEV (s). */
const STATS_INTERVAL = 5;
/** The shader warm-up waits this long at most for its downloads, and as long again for the compile (ms). */
const WARMUP_ASSETS_MS = 5000;
const WARMUP_COMPILE_MS = 6000;
/** The hidden warm-up frame sliced (audit 2026-10-17, P10): texture bytes and programs per task before it. */
const WARMUP_SLICE_BYTES = 8 * 1024 * 1024;
const WARMUP_SLICE_PROGRAMS = 16;
/** How often the warm-up looks for new samples to compile while the start's files download (ms). */
const WARMUP_POLL_MS = 120;

/** What the shader warm-up did (the loading log, tests). */
export interface WarmUpReport {
  ms: number;
  /** Shader programs after the warm-up. */
  programs: number;
  /** Sample objects of the zoo. */
  samples: number;
  /** Every download arrived and every program compiled within the time limits. */
  complete: boolean;
}

/** Render stats are logged only in dev and only with `?stats` in the URL. */
const LOG_STATS = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('stats');

/** A ship's mutable entry in the nav light list (rewritten every frame instead of allocated). */
type NavLightSlot = { -readonly [K in keyof NavLightShip]: NavLightShip[K] };
const NO_NAV_POINTS: NavLightShip['points'] = [];

export class GameRenderer {
  readonly rig: CameraRig;
  private readonly renderer: WebGLRenderer;
  /** Renderer and caches – shared by the application (they outlive a game), or its own (freed by dispose). */
  private readonly context: RenderContext;
  private readonly ownsContext: boolean;
  private readonly scene = new Scene();
  // far: the landmarks and the world-anchored gas giant lie up to ~6 000 u away, deep below the plane
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 9000);
  private readonly starfield: Starfield;
  private readonly dust: SpaceDust;
  /** Flight-path marker, stopping point, collision ring (M3.8). */
  private readonly markers = new FlightMarkers();
  /** The dock clamp marker: tolerance ring, latch (docking manoeuvre). */
  private readonly dockMarker = new DockMarker();
  /** Red brackets with HP and shield bars under pirate ships (readability R3). */
  private readonly enemyMarkers = new EnemyMarkers();
  private assist: FlightAssistView = { marker: true, shake: true, reducedMotion: false, collision: null };
  private readonly velWorld = new Vector3();
  private readonly shipView: ShipView;
  /** Paint shop preview on the active ship (M4c, render-only), null = the record's paint. */
  private paintPreview: PaintId | null = null;
  /** Paint the player view wears (null = rebuilt, not painted yet) and the shell setting it was put on with. */
  private paintShown: PaintId | null = null;
  private paintShell = hullShellVersion();
  /** Nav lights of every ship (SL2 E1 T5): one global instanced layer. */
  private readonly navLights: NavLights;
  /** The player's entry in `navShips` (rewritten every frame, no allocation). */
  private readonly playerNav: NavLightSlot;
  /** Ships whose nav lights are drawn: the player first, then the enemies of CombatLayer (plan T6). */
  private readonly navShips: NavLightShip[];
  private readonly asteroids: AsteroidField;
  private readonly lasers = new LaserView();
  /** Rich nuggets (Mining 2.0). */
  private readonly nuggets: NuggetLayer;
  /** Pirates, wrecks, projectiles, shields and combat effects (M3a). */
  private readonly combat: CombatLayer;
  private readonly stations: StationLayer;
  /** Buoys, markers and stranded ships of contracts (M3.5a). */
  private readonly contracts = new ContractLayer();
  /** Anomalies, giants, Echo beacons, ships in distress, the scanner pulse (M3.5b). */
  private readonly discovery = new DiscoveryLayer();
  /** Survey points of uncharted sectors near the ship (sectors stage 2). */
  private readonly survey = new SurveyMarkers();
  /** Containers, tractor beams, hulk markers (M3.6). */
  private readonly salvage = new SalvageLayer();
  /** Rust fortresses and clan beacons (M3.6). */
  private readonly fortresses: FortressLayer;
  /** M4b world sites: derelicts, relays, live mines, graveyard dressing; comets; micrometeor FX. */
  private readonly sites: SiteLayer;
  private readonly comets: CometLayer;
  private readonly micrometeors: Micrometeors;
  /** Home station modules and the trophy shelf (M4c). */
  private readonly homeModules: HomeModules;
  private readonly trophyShelf: TrophyShelf;
  /** Home module the dock camera frames ("Show", M4c), or null = the plain dock view. */
  private homeFocus: HomeModuleId | null = null;
  /** The focus camera's blend 0 = dock view .. 1 = module view, and the slot it flies to / from. */
  private homeFocusBlend = 0;
  private homeFocusSlot: HomeSlot | null = null;
  private readonly emitter = new Vector3();
  /** 0 = flight view, 1 = "dock" view (smooth transition). */
  private dockBlend = 0;
  /** Width of the panel on the right (px) that covers the scene – the dock view shifts to the left. */
  private viewInset = 0;
  private readonly dockTarget = new Vector3();
  private readonly sun = new DirectionalLight(0xfff0d8, 2.2);
  private readonly fill = new DirectionalLight(0x7fa0ff, 0.6);
  private readonly hemisphere = new HemisphereLight(0x8fa8ff, 0x1a1030, HEMI_INTENSITY);
  private readonly focus = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly lead = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly resizeObserver: ResizeObserver;
  /** Multiplier of the wheel step when zooming in (Settings → Zoom sensitivity). */
  wheelScale = 1;
  /** The player holds the mining button (Game sets it every frame) – an empty battery sputters the beams. */
  miningHeld = false;
  /** The approach readout shows (Game sets it every frame) – the clamp marker hides with it while departing. */
  dockReadout = true;
  /** Post chain: AO, bloom, output, grade (visual polish). */
  private readonly post: PostStack;
  /** Sun, planets, silhouette and fog layers, light and grade per zone (visual polish). */
  private readonly env: ZoneEnvironment;
  private readonly shadows: ShadowRig;
  private readonly shadowCadence = new ShadowCadence();
  private readonly traffic = new StationTraffic();
  /** Free Traders convoys (M4d, T14). */
  private readonly convoys = new ConvoyLayer();
  private readonly rockDust = new AsteroidDust();
  /** Space clutter and wreck-field fragments (art batch B, render-only scenery). */
  private readonly scatter: ScatterLayer;
  /** Sector border markers, fences, Guild Lane buoys, pickets and the Guild Watch (sectors stage 2, render-only). */
  private readonly borders: BorderLayer;
  /** Edge highlight on gameplay objects and the background brightness (readability, R4). */
  private readonly rim = new RimLight();
  private backgroundBrightness = BACKGROUND_BRIGHTNESS_DEFAULT;
  private graphicsSetting: GraphicsSetting = 'auto';
  private quality: GraphicsQuality = 'medium';
  private preset: QualityPreset = presetFor('medium');
  private autoQuality: AutoQuality | null = null;
  /**
   * Dynamic resolution (optimisation research R3): the render scale from the GPU time per frame, the
   * first reaction before `auto` steps a preset down. Off without GPU timer queries, on a software
   * rasterizer and by the setting (Settings → Display).
   */
  private readonly drs = new DynamicResolution();
  /** The draws the warm-up compiled ahead (compileDraws). */
  private readonly warmUpDraws = new Set<string>();
  /** The warm-up compiled and drew the shipyard hangar. */
  private hangarWarm = false;
  private readonly gpuTimer: GpuTimer | null;
  private drsActive = false;
  /** The render scale in effect (the scene and post targets) and the one waiting for a gap. */
  private renderScale = 1;
  private renderScaleWanted = 1;
  /** GPU guess of the auto mode (from the WebGL renderer string). */
  readonly gpuQuality: GraphicsQuality;
  /** Software rasterizer (no GPU) – the lowest level also drops the planets. */
  private readonly softwareGpu: boolean;
  /** Ship editor hangar – drawn instead of space while the shipyard is open. */
  readonly hangar: HangarView;
  private hangarScene: HangarScene | null = null;
  private readonly sky: ZoneSky;
  /** The player's sector zone (depth + environment, with hysteresis): sky, zone light, dust, layers. */
  private readonly zone = new SectorZoneTracker();
  private lastDockDistance = 60;
  private disposed = false;
  private statsTime = 0;
  private statsFrames = 0;
  private time = 0;
  private gridVersion: number;
  /** The blueprint whose cells are the player's torn-edge memory (hull shell, spec §3.7) and those cells. */
  private blueprint: ShipGrid | null = null;
  private blueprintCells: ReadonlySet<string> | null = null;
  /** Simulation time (s) interpolated for the frame – asteroid rotation and the position of the veins. */
  private simTime = 0;
  private readonly muzzle = (laser: number, out: Vector3) => this.shipView.muzzleWorld(laser, out);
  /**
   * End of a beam: on a vein at its 3D point, on a rock on its surface (the beam aims at the cursor),
   * at the rim of a rock when the cursor is beyond it; `normal` = the surface normal there.
   */
  private readonly beamEnd = (beam: MiningBeam, out: Vector3, normal: Vector3): Vector3 | null => {
    if (beam.mover) return this.comets.beamEnd(beam, out, normal);
    if (!beam.asteroidId) return null;
    const world = this.sim.state.world;
    const a = world.findAsteroid(beam.asteroidId);
    const r = a ? world.radiusOf(a) : 0;
    if (!a || r <= 0) return null;
    const vein = beam.vein ? veinsOf(a)[beam.vein.index] : undefined;
    if (vein && beam.vein) {
      const p = veinPointAt(a, vein, r, this.simTime, beam.vein.u);
      out.set(p.pos.x, p.height + 0.04, -p.pos.y);
    } else {
      const d = Math.hypot(beam.to.x - a.pos.x, beam.to.y - a.pos.y);
      // at the rim (cursor beyond the rock): the side of the rock facing the ship, a little up
      const h = d >= r * 0.98 ? r * 0.25 : Math.sqrt(r * r - d * d) * ROCK_SURFACE;
      out.set(beam.to.x, h, -beam.to.y);
    }
    normal.set(out.x - a.pos.x, out.y * 1.4, out.z + a.pos.y).normalize();
    return out;
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: Simulation,
    private readonly library: ModelLibrary,
    signal?: AbortSignal,
    context?: RenderContext,
  ) {
    this.ownsContext = !context;
    this.context = context ?? new RenderContext();
    this.renderer = this.context.renderer;
    container.appendChild(this.renderer.domElement);

    this.post = new PostStack(this.renderer, this.scene, this.camera);
    this.gpuTimer = GpuTimer.create(this.renderer.getContext() as WebGL2RenderingContext);

    this.scene.background = new Color(0x04050c);
    this.rig = new CameraRig(this.camera);

    this.asteroids = new AsteroidField(library);
    // far out a rock's crevices are a few pixels: no AO pre-pass draws (the far tier, env/ShadowRig.ts)
    this.asteroids.object.userData.farLite = 'ao';
    this.starfield = new Starfield(sim.state.seed);
    this.dust = new SpaceDust(sim.state.seed);
    this.stations = new StationLayer(library);
    this.homeModules = new HomeModules(library, this.stations);
    this.trophyShelf = new TrophyShelf(library, this.homeModules);
    this.scene.add(this.starfield.object, this.dust.object, this.asteroids.object, this.lasers.object, this.stations.object, this.markers.object);
    this.scene.add(this.homeModules.object, this.trophyShelf.object);
    this.scene.add(this.dockMarker.object);
    this.scene.add(this.enemyMarkers.object);

    this.scene.add(this.hemisphere);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.fill, this.fill.target);

    const player = sim.state.player;
    this.shipView = new ShipView(player.grid, player.props, library, null, { mode: 'flight', tornFrom: this.tornFrom() });
    this.gridVersion = player.gridVersion;
    this.scene.add(this.shipView.group);
    this.navLights = new NavLights(this.scene, library.hasSwatches ? library.swatchUv : null);
    this.playerNav = { object: this.shipView.group, points: NO_NAV_POINTS, pirate: false, visible: true };
    this.navShips = [this.playerNav];
    this.combat = new CombatLayer(library, this.context.fxModels);
    this.scene.add(this.combat.object);
    this.nuggets = new NuggetLayer(this.context.fxModels);
    this.scene.add(this.nuggets.object);
    this.scene.add(this.contracts.object);
    this.scene.add(this.discovery.object);
    this.scene.add(this.survey.object);
    this.scene.add(this.salvage.object);
    // containers are ~2 u: no shadow, no AO with the camera far out (the far tier, env/ShadowRig.ts)
    this.salvage.object.userData.farLite = true;
    this.fortresses = new FortressLayer(library);
    this.scene.add(this.fortresses.object);
    this.sites = new SiteLayer(library, this.context.fxModels);
    this.comets = new CometLayer(this.context.fxModels);
    this.micrometeors = new Micrometeors(this.context.fxModels);
    this.scene.add(this.sites.object, this.comets.object, this.micrometeors.object);

    this.hangar = new HangarView(library);

    this.sky = new ZoneSky(this.context.skyboxes, this.scene, (applied) => {
      if (applied.background) this.starfield.setBrightness(STARS_OVER_SKYBOX);
    });

    this.env = new ZoneEnvironment(sim.state.seed, {
      sun: this.sun,
      fill: this.fill,
      hemisphere: this.hemisphere,
    });
    this.scene.add(this.env.object, this.traffic.object, this.convoys.object, this.rockDust.object);
    this.scatter = new ScatterLayer(sim.state.seed, library);
    // small casters (scatter rocks, rubble chips): no shadow, no AO with the camera far out (the far
    // tier, env/ShadowRig.ts)
    this.scatter.object.userData.farLite = true;
    this.rockDust.object.userData.farLite = true;
    this.scene.add(this.scatter.object);
    this.borders = new BorderLayer(sim.state.seed);
    this.scene.add(this.borders.object);
    this.shadows = new ShadowRig(this.renderer, this.sun);
    const gpu = gpuName(this.renderer);
    this.gpuQuality = qualityForGpu(gpu);
    this.softwareGpu = isSoftwareGpu(gpu);
    this.setGraphicsQuality('auto');
    this.setBackgroundBrightness(BACKGROUND_BRIGHTNESS_DEFAULT);
    this.rim.watch(this.shipView.group, this.asteroids.object, this.stations.object, this.combat.object, this.nuggets.object, this.contracts.object, this.discovery.object, this.salvage.object, this.fortresses.object, this.traffic.object);
    this.rim.watch(this.sites.object, this.comets.object, this.convoys.object);
    this.rim.watch(this.homeModules.object, this.trophyShelf.object);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.onWheel(e.deltaY * this.wheelScale);
      },
      { passive: false, signal },
    );
  }

  /** The editor's hangar (the scene from ShipyardEditor) instead of space; null = back to space. */
  showHangar(scene: HangarScene | null): void {
    if (scene && !this.hangarScene) this.hangar.frameOnOpen();
    this.hangarScene = scene;
  }

  get hangarActive(): boolean {
    return this.hangarScene !== null;
  }

  /**
   * Paint shop preview (M4c, render-only): the active ship wears `paint` until the preview ends (null =
   * its record's paint again). Never touches the simulation or the save.
   */
  setPaintPreview(paint: PaintId | null): void {
    this.paintPreview = paint;
  }

  /** The dock camera frames this home module (M4c "Show"), null = back to the dock view. */
  setHomeFocus(module: HomeModuleId | null): void {
    this.homeFocus = module;
  }

  /** Free area of the editor in window pixels – the hangar camera centres it. */
  setHangarViewport(rect: { left: number; top: number; width: number; height: number }): void {
    this.hangar.setViewport(rect, this.renderer.domElement.getBoundingClientRect());
  }

  /** Hangar grid cell under a window pixel. */
  hangarCellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return this.hangar.cellAt(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Window pixel above the centre of a hangar cell (the ghost's label, tests). */
  hangarCellToScreen(x: number, y: number, height?: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = this.hangar.cellToCanvas(x, y, height);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  /** A hangar cell's floor centre and half-cell axes in window px (the training's suggested cells). */
  hangarCellQuad(x: number, y: number): { x: number; y: number; ax: number; ay: number; bx: number; by: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const q = this.hangar.cellQuad(x, y);
    return { ...q, x: rect.left + q.x, y: rect.top + q.y };
  }

  /** GPU resource counts (leak tests when the ship is rebuilt in the editor). */
  memoryInfo(): { geometries: number; textures: number } {
    return { ...this.renderer.info.memory };
  }

  /** Flight assist from the game (M3.8): settings and the current collision warning. */
  setFlightAssist(view: FlightAssistView): void {
    this.assist = view;
    this.rig.shakeEnabled = view.shake && !view.reducedMotion;
  }

  /** Effects from the events of a simulation step (shots, hits, explosions, asteroid break-ups). */
  onSimEvents(events: readonly SimEvent[]): void {
    if (events.length > 0) {
      // hits and impacts jolt the camera (M3.8)
      let shake = 0;
      const at = this.sim.state.player.body.pos;
      // a large reactor's blast (M4c) shakes by its distance from the player
      for (const e of events) shake = Math.max(shake, e.type === 'partBlast' ? blastShake(Math.hypot(e.pos.x - at.x, e.pos.y - at.y)) : shakeFor(e));
      if (shake > 0) this.rig.shake(shake);
      this.combat.onEvents(events, this.sim.state);
      this.nuggets.onEvents(events);
      this.discovery.onEvents(events);
      this.fortresses.onEvents(events);
      this.sites.onEvents(events);
      this.comets.onEvents(events);
      this.micrometeors.onEvents(events);
      this.homeModules.onEvents(events);
    }
  }

  /** Flight markers on screen (M3.8, tests). */
  flightMarkerStats(): { prograde: boolean; stop: boolean; obstacle: boolean; bow: boolean; bowOpacity: number } {
    return this.markers.stats();
  }

  /** The dock clamp marker (tests). */
  dockMarkerStats(): DockMarkerStats {
    return this.dockMarker.stats();
  }

  /** Enemy brackets and the combat zoom-out (readability R1, R3; tests). */
  enemyMarkerStats(): EnemyMarkerStats & { viewDistance: number; combatZoom: boolean } {
    return { ...this.enemyMarkers.stats(), viewDistance: this.rig.viewDistance, combatZoom: this.rig.combatZoomActive };
  }

  /** Counts of the M3.6 layers (tests). */
  salvageStats(): { containers: number; beams: number; markers: number; fortresses: number; beacons: number } {
    return { ...this.salvage.stats(), ...this.fortresses.stats() };
  }

  /** Object counts of the discovery layer (tests). */
  discoveryStats(): { places: number; pulses: number; finds: number } {
    return this.discovery.stats();
  }

  /** The scanner pulse wave and the finds' rings this frame (readability R6; null = none). */
  setScanView(view: ScanView | null): void {
    this.discovery.setScan(view);
  }

  /** Object counts of the combat layer (tests and debugging). */
  combatStats(): { enemies: number; wrecks: number; effects: number } {
    return this.combat.stats();
  }

  /** The UI panel covers `px` pixels on the right (0 = nothing). */
  setViewInset(px: number): void {
    this.viewInset = px;
  }

  /**
   * The canvas rect for the per-frame pointer and label math (screenToSim, projectToScreen): read once
   * after a resize instead of a getBoundingClientRect per call (audit 2026-10-17 P8) – the container's
   * ResizeObserver calls resize(), which drops it.
   */
  private canvasRectCache: DOMRect | null = null;

  private canvasRect(): DOMRect {
    return (this.canvasRectCache ??= this.renderer.domElement.getBoundingClientRect());
  }

  resize(): void {
    this.canvasRectCache = null;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // DPR can change (moving the window to another monitor, browser zoom); capped by the graphics quality
    const dpr = Math.min(window.devicePixelRatio, this.preset.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Point of the game plane under a window pixel, or null (the camera looks away from the plane). */
  screenToSim(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvasRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return { x: this.hit.x, y: -this.hit.z };
  }

  /** Window pixel where a game-plane point is (for tests and the UI). */
  worldToScreen(p: Vec2): { x: number; y: number } {
    const v = simToWorld(p).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Window pixel for a game-plane point; behind = the point is behind the camera (for edge arrows). */
  projectToScreen(p: Vec2): { x: number; y: number; behind: boolean } {
    const v = simToWorld(p).project(this.camera);
    const rect = this.canvasRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  }

  /** Point of the game plane under the muzzle of laser number `index` (from the model), or null – for tests. */
  muzzleSim(index: number): Vec2 | null {
    const p = this.shipView.muzzleWorld(index, this.hit);
    return p ? { x: p.x, y: -p.z } : null;
  }

  /**
   * alpha = share between the last and the next simulation step,
   * aim = point of the plane under the cursor (where the laser heads aim), or null.
   */
  render(alpha: number, frameDt: number, aim: Vec2 | null = null, draw = true): void {
    this.time += frameDt;
    this.simTime = Math.max(0, (this.sim.state.tick - 1 + alpha) * SIM_DT);
    const player = this.sim.state.player;
    const tornFrom = this.tornFrom();
    if (player.gridVersion !== this.gridVersion || tornFrom !== this.shipView.options.tornFrom) {
      this.gridVersion = player.gridVersion;
      this.shipView.options.tornFrom = tornFrom;
      this.shipView.rebuild(player.grid, player.props);
      this.paintShown = null;
    }
    // the record's paint (`shipPainted` paints it in place) or the paint shop preview
    const paint = this.paintPreview ?? paintOf(this.sim.state.fleet.active);
    if (paint !== this.paintShown) this.paintShip(paint);
    if (this.hangarScene) {
      this.rim.off();
      this.renderHangar(this.hangarScene, frameDt);
      return;
    }
    const pos = lerp(player.prevBody.pos, player.body.pos, alpha);
    const angle = lerpAngle(player.prevBody.angle, player.body.angle, alpha);

    simToWorld(pos, 0, this.focus);
    this.shipView.group.position.copy(this.focus);
    this.shipView.group.rotation.y = angle;
    const aimLocal = aim ? rotate(sub(aim, pos), -angle) : null;
    // the tractor head turns to the held object (M3.6)
    const towed = player.tractor ? towable(this.sim.state, player.tractor.target) : null;
    const tractorLocal = towed ? rotate(sub(towed.body.pos, pos), -angle) : null;
    // the on-board workshop's crusher, plasma and repair arms (M4c, parts/workshopAnim.ts)
    this.shipView.setWorkshop(player.destroyed ? null : player.workshop);
    this.shipView.update(frameDt, player.lastLocalForce, player.props, aimLocal, player.body.angVel, tractorLocal);
    this.shipView.setDamage(player.hp, frameDt);
    // a hull shell self-rebuild puts back the paint worn at bake time
    if (this.paintShell !== hullShellVersion()) this.paintShip(paint);
    // comets first: a mining beam's end sticks to the drawn (interpolated) comet
    this.comets.update(this.sim.state, alpha, frameDt, this.assist.reducedMotion);
    this.lasers.update({
      beams: player.beams,
      lasers: player.props.lasers.map((l): LaserSlotInfo => {
        const h = player.heat.get(l.partId);
        return { heat: h ? heatFraction(h) : 0, cooling: (h?.cooling ?? 0) > 0, heavy: l.heavy };
      }),
      // mining held but the battery cannot pay the lasers: they sputter
      starved: this.miningHeld && player.dock.mode === 'flying' && player.energy < player.props.lasers.reduce((s, l) => s + l.energyPerSecond, 0) * 0.05,
      time: this.time,
      dt: frameDt,
      muzzle: this.muzzle,
      end: this.beamEnd,
    });
    this.nuggets.update(this.sim.state, alpha, frameDt);
    this.shipView.group.visible = !player.destroyed;
    this.combat.update(this.sim.state, alpha, frameDt, { pos, angle });
    this.enemyMarkers.update({
      enemies: this.sim.state.combat.enemies,
      alpha,
      aim,
      cameraDistance: this.rig.viewDistance,
      visible: player.dock.mode === 'flying' && !player.destroyed,
    });
    this.contracts.update(this.sim.state, this.time);
    this.discovery.update(this.sim.state, frameDt, { cameraDistance: this.camera.position.distanceTo(this.cameraTarget), reducedMotion: this.assist.reducedMotion });
    this.survey.update(this.sim.state, frameDt, this.assist.reducedMotion);
    this.shipView.group.updateMatrixWorld(true);
    this.salvage.update(this.sim.state, alpha, frameDt, this.shipView.tractorEmitterWorld(this.emitter), pos);
    this.fortresses.update(this.sim.state, frameDt);
    this.sites.update(this.sim.state, alpha, frameDt, { reducedMotion: this.assist.reducedMotion });
    this.micrometeors.update(this.sim.state, alpha, frameDt, { cameraDistance: this.rig.viewDistance, reducedMotion: this.assist.reducedMotion });

    const world = this.sim.state.world;
    this.stations.sync(world.stations());
    this.stations.update(this.time, frameDt, { dock: player.dock, tick: this.sim.state.tick, reducedMotion: this.assist.reducedMotion });
    this.homeModules.update(this.sim.state, alpha, frameDt);
    this.trophyShelf.update(this.sim.state, alpha, frameDt, this.assist.reducedMotion);

    const lead = lookAheadOffset(lerp(player.prevBody.vel, player.body.vel, alpha));
    this.cameraTarget.copy(this.focus).add(simToWorld(lead, 0, this.lead));
    this.frameCombat(pos, lead, frameDt);

    // "dock" view: the station and the ship in frame, the scene in the part of the screen the hub does not cover
    const dock = player.dock;
    const dockStation = dock.mode !== 'flying' ? (world.stations().find((s) => s.id === dock.stationId) ?? null) : null;
    this.dockBlend += ((dockStation ? 1 : 0) - this.dockBlend) * (1 - Math.exp(-frameDt * DOCK_VIEW_RATE));
    let distance: number | undefined;
    if (dockStation || this.dockBlend > 0.001) {
      if (dockStation) {
        // "Show" in the Development tab frames a home module (M4c)
        const atHome = dockStation.id === HOME_STATION_ID;
        const focus = this.homeFocus !== null && atHome ? HOME_MODULES[this.homeFocus].slot : null;
        if (focus) this.homeFocusSlot = focus;
        this.homeFocusBlend = atHome ? stepFocusBlend(this.homeFocusBlend, focus ? 1 : 0, frameDt, this.assist.reducedMotion) : 0;
        const base = dockView(dockStation, player.props.boundingRadius);
        const view = this.homeFocusSlot && this.homeFocusBlend > 0 ? mixDockView(base, moduleFocusView(dockStation, this.homeFocusSlot, player.props.boundingRadius), this.homeFocusBlend) : base;
        const width = this.container.clientWidth || window.innerWidth;
        const shift = insetShift(this.viewInset, width, view.distance, this.camera.fov, this.camera.aspect);
        simToWorld({ x: view.target.x + shift, y: view.target.y }, 0, this.dockTarget);
        this.lastDockDistance = view.distance;
      }
      this.cameraTarget.lerp(this.dockTarget, this.dockBlend);
      distance = this.rig.viewDistance + (this.lastDockDistance - this.rig.viewDistance) * this.dockBlend;
    }
    this.rig.update(this.cameraTarget, frameDt, distance);
    this.camera.updateMatrixWorld();
    // graveyard batches draw their LOD1 past the far-tier switch (sites/wreckBatch.ts)
    this.combat.setViewDistance(viewDistanceOf(this.camera));
    this.updateNavLights();
    this.asteroids.update(world, this.simTime, this.camera);
    this.scatter.update(this.sim.state, this.cameraTarget, this.simTime, frameDt);
    this.borders.update(this.sim.state, this.cameraTarget, this.camera, this.simTime, frameDt, this.assist.reducedMotion);
    this.starfield.update(this.camera.position);
    // the sky turns very slowly while travelling; the look follows the player's sector (depth and
    // environment, sectors design §5.2) and cross-fades past a border
    const zone = this.zone.update(this.sim.state.seed, player.body.pos);
    const depthsNear = this.zone.depthsNear(player.body.pos);
    this.sky.update(depthsNear, zone.depth, frameDt, (pos.x - pos.y) * SKY_DRIFT, this.camera.position);
    // the next depths' planet textures decode and upload before a crossing needs them (issue #9)
    void this.env.prefetch(depthsNear);
    // zone look: the visible sun and its light, planets and layers below the plane, the grade
    this.env.landmarks.sync(this.sim.state, this.assist.reducedMotion);
    this.env.update(zone, this.camera, this.cameraTarget, frameDt);
    this.sky.environmentScale = this.env.envScale;
    this.sky.setTint(this.env.skyTint);
    this.dust.setColor(this.env.dust);
    this.fill.position.copy(this.cameraTarget).add(FILL_OFFSET);
    this.fill.target.position.copy(this.cameraTarget);
    if (this.shadows.enabled) {
      this.shadows.update(this.camera, this.env.lightDir, this.scene);
    } else {
      this.sun.target.position.copy(this.cameraTarget);
      this.sun.position.copy(this.cameraTarget).addScaledVector(this.env.lightDir, SUN_DISTANCE);
    }
    this.traffic.update(world.stations(), this.cameraTarget, this.simTime, frameDt, this.env.layers.haze);
    this.convoys.update(this.sim.state, alpha, frameDt);
    this.rockDust.update(world, this.cameraTarget, frameDt);
    const vel = lerp(player.prevBody.vel, player.body.vel, alpha);
    this.dust.update(this.focus, simToWorld(vel, 0, this.velWorld));
    this.updateMarkers(pos, vel, angle);
    if (!draw) return;

    this.renderer.info.reset();
    this.rim.update(frameDt, this.camera.position.distanceTo(this.cameraTarget), this.fill.color);
    this.post.setGrade(this.env.grade);
    // docked behind the hub: no AO (but in a home module's close-up), the shadow map on a cadence (perf
    // audit 2026-10-17, P3)
    const docked = player.dock.mode === 'docked';
    this.post.holdAo(docked && this.homeFocusBlend === 0);
    this.shadowCadence.frame(this.renderer.shadowMap, this.sun, docked ? DOCKED_SHADOW_EVERY : 1);
    this.post.render(frameDt);
    this.adaptQuality(frameDt);
    if (LOG_STATS) this.logStats(frameDt);
  }

  /**
   * Nav lights for this frame (after the camera: the light scale follows its distance): the player's
   * ship, then the enemies of the combat layer (plan T6). No allocation: the list keeps its capacity.
   */
  private updateNavLights(): void {
    const player = this.sim.state.player;
    const nav = this.playerNav;
    nav.visible = !player.destroyed && this.shipView.group.visible;
    // the view's own points: its shell setting, outline and torn edges
    nav.points = this.shipView.navPoints();
    this.navShips.length = 1;
    for (const ship of this.combat.navShips) this.navShips.push(ship);
    this.navLights.update(this.navShips, {
      cameraDistance: this.camera.position.distanceTo(this.cameraTarget),
      time: this.time,
      reducedMotion: this.assist.reducedMotion,
      quality: this.quality,
    });
  }

  /** Nav lights drawn in the last frame (tests). */
  navLightCount(): number {
    return this.navLights.count;
  }

  /**
   * Shader warm-up before the first game frame (audit 2026-10-16, issue #1; render/warmup.ts): waits
   * (bounded) for what changes the programs of every lit material or what the layers build lazily –
   * the zone's sky and environment map, the planet catalogue, effect, traffic, scenery and place
   * models – then compiles the scene plus a zoo of every runtime material variant with
   * `compileAsync` and draws one frame of it through the post chain (shadow, AO and post-pass
   * programs), all behind the loading overlay. In two phases (perf O14): what the start zone's sky and
   * the model library make possible is compiled and drawn while the rest of the start's files download
   * (then `onFirstPhase` runs – the game's first UI draw), what those files bring as it arrives, and a
   * last pass after them does only what is new. Never rejects; after `dispose` it just stops.
   */
  async warmUp(onFirstPhase?: () => void): Promise<WarmUpReport> {
    try {
      return await this.warmUpScene(onFirstPhase);
    } finally {
      // the boot list's bytes the layers did not take are not kept for later (assets/prefetch.ts)
      releasePrefetched();
    }
  }

  private async warmUpScene(onFirstPhase?: () => void): Promise<WarmUpReport> {
    const t0 = performance.now();
    const report = (complete: boolean): WarmUpReport => ({ ms: Math.round(performance.now() - t0), programs: programCount(this.renderer), samples: 0, complete });
    const stopped = (): boolean => this.disposed;
    const left = (): number => Math.max(0, t0 + WARMUP_ASSETS_MS - performance.now());
    // one update without drawing: the layers start what the start position needs (sky, planets, clans…)
    this.render(1, 0, null, false);
    // the start zone's sky and its neighbours' (their environment maps go through the PMREM now)
    const near = this.zone.depthsNear(this.sim.state.player.body.pos);
    const zoo = new ShaderZoo();
    const layerSamples = [
      this.fortresses.warmUp(zoo),
      this.discovery.warmUp(zoo),
      this.traffic.warmUp(zoo),
      this.convoys.warmUp(zoo),
      this.sites.warmUp(zoo),
      this.comets.warmUp(zoo),
      this.micrometeors.warmUp(zoo),
      this.homeModules.warmUp(zoo),
      this.trophyShelf.warmUp(zoo),
    ];
    const sky = Promise.all(near.map((depth) => this.context.skyboxes.get(depth)));
    // what the hangar's warm-up needs: the clan parts and the bay model
    const hangarAssets = Promise.all([this.library.clans.settled(), this.hangar.bayReady()]);
    // each file that comes in counts: the wait below builds and compiles what it made possible
    let arrived = 0;
    const counted = (p: Promise<unknown>): Promise<unknown> => {
      void p.then(
        () => arrived++,
        () => arrived++,
      );
      return p;
    };
    const assets = Promise.all(
      [
        sky,
        hangarAssets,
        this.env.assetsReady().then(() => this.env.prefetch(near)),
        this.context.fxModels.ready,
        this.scatter.ready,
        this.borders.ready,
        sceneryReady(),
        preloadPaints(),
        ...layerSamples,
      ].map(counted),
    );
    let settled = false;
    let hangarReady = false;
    void assets.then(
      () => (settled = true),
      () => (settled = true),
    );
    void hangarAssets.then(() => (hangarReady = true));
    let complete = await within(sky, left());
    // the first phase's frame only pays while the network still works (a cold start, not one from the cache)
    if (!(await this.warmUpFirstPhase(stopped, () => settled || prefetchesPending() === 0))) return report(false);
    onFirstPhase?.();
    complete = (await this.warmUpWhileLoading(assets, () => settled, () => hangarReady, zoo, left, () => arrived)) && complete;
    // the layers' own callbacks of those downloads run first
    await delay(0);
    if (this.disposed) return report(false);
    let samples = 0;
    try {
      if (!(await this.warmUpLastPass(zoo, stopped))) return report(false);
      samples = zoo.size;
    } finally {
      zoo.dispose();
    }
    // the GPU works through the warm-up frame's first draws before the game's first frame
    if (!this.softwareGpu) complete = (await gpuIdle(this.renderer, WARMUP_COMPILE_MS)) && complete;
    return { ...report(complete), samples };
  }

  /**
   * The zoo's samples that need no download of their own: one of every material variant the layers
   * make later (beams, effects, markers, decals, paints, landmarks, borders, tinted batches). The
   * first phase and the last pass both add them (the second time finds them compiled).
   */
  private addSamples(zoo: ShaderZoo): void {
    for (const t of [...this.library.clans.templates(), ...this.context.fxModels.templates()]) zoo.add(t.clone());
    this.lasers.warmUp();
    this.salvage.warmUp(zoo);
    this.combat.warmUp(zoo, [...this.library.templates(), ...this.library.clans.templates()]);
    this.navLights.warmUp(zoo);
    this.nuggets.warmUp(zoo);
    this.enemyMarkers.warmUp(zoo);
    hullDecalSample(zoo);
    // M4c ship paints: their textures uploaded with a painted sample each
    paintWarmUpSamples(zoo, this.library);
    // the landmark models share the atlas material with baked vertex colours (RGBA) – like the stations
    let palette: Mesh | null = null;
    for (const t of this.library.templates()) {
      t.traverse((o) => {
        if (!palette && o instanceof Mesh && o.geometry.getAttribute('color')?.itemSize === 4) palette = o;
      });
    }
    this.env.warmUp(zoo, palette);
    this.borders.warmUp(zoo);
    // tinted batches (rubble chips, scatter): their colour texture appears with the first tint, and a
    // batch with nothing in view yet would not reach the shadow map – one drawn, tinted twin each
    const batched = new Set<Material>();
    this.scene.traverse((o) => {
      if (!(o instanceof BatchedMesh) || Array.isArray(o.material) || batched.has(o.material)) return;
      batched.add(o.material);
      zoo.addPlain(coloredBatchSample(zoo, o));
    });
  }

  /**
   * The warm-up's first phase (perf O14), while the rest of the start's files download: with the start
   * zone's sky in (its environment map is part of every lit program) the scene as it stands, the
   * library's templates, the hull shell and the samples that need no download are compiled, uploaded
   * and drawn once – most of the programs, the post chain's included. The draw is left to the last pass
   * when nothing is downloading by then (`settled` – a load from the cache). False when the renderer
   * went away.
   */
  private async warmUpFirstPhase(stopped: () => boolean, settled: () => boolean): Promise<boolean> {
    // the sky's own callbacks run first, then an update applies it (environment, background)
    await delay(0);
    if (stopped()) return false;
    this.render(1, 0, null, false);
    const zoo = new ShaderZoo();
    for (const t of this.library.templates()) zoo.add(t.clone());
    // hull shell (SL2 E1): shelled flight views with clipped armour and torn edges, baked
    shellWarmUpSamples(zoo, this.library);
    this.addSamples(zoo);
    try {
      if (!(await this.showZoo(zoo))) return false;
      await compileScene(this.renderer, this.scene, this.camera, this.post.composer.readBuffer, WARMUP_COMPILE_MS);
      if (stopped()) return false;
      // the hidden frame below sliced into tasks: the textures go to the GPU and the programs get their
      // first use (link check, uniform lookup) a few at a time before it – it used to do all of it in
      // one ~1.2 s long task at 4× CPU
      if (!(await uploadTexturesSliced(this.renderer, [this.scene], WARMUP_SLICE_BYTES, stopped))) return false;
      if (!(await primeProgramsSliced(this.renderer, WARMUP_SLICE_PROGRAMS, stopped))) return false;
      // a software rasterizer (CI, e2e) has no shadows, AO or driver variants to warm – drawing the zoo
      // there would only cost seconds
      if (this.softwareGpu || settled()) return true;
      if (!(await this.compileWarmUpDraws(() => this.drawWarmUpFrame(), stopped))) return false;
      this.drawWarmUpFrame();
      return true;
    } finally {
      zoo.dispose();
    }
  }

  /**
   * Waits (bounded by `left`) for the start's remaining files; meanwhile what they make possible is done
   * as they arrive (perf O14) – the shipyard hangar once its files are in, and after each arrival an
   * update builds the layers' new objects, and what is new in the scene and the zoo (the layers' samples)
   * is compiled and its textures uploaded – so the last pass finds that done. True when the files are
   * in; false = the time ran out (or the renderer went away).
   */
  private async warmUpWhileLoading(assets: Promise<unknown>, settled: () => boolean, hangarReady: () => boolean, zoo: ShaderZoo, left: () => number, arrived: () => number): Promise<boolean> {
    const done = new Set<Object3D>();
    const target = this.post.composer.readBuffer;
    const stopped = (): boolean => this.disposed || settled();
    const tinted = new Set<Material>();
    let seen = -1;
    while (!settled() && left() > 0) {
      if (hangarReady() && !this.hangarWarm) {
        // not cut short: the last pass would only do it again
        if (!(await this.warmUpHangar(() => this.disposed))) return false;
        continue;
      }
      if (seen === arrived()) {
        await within(assets, Math.min(WARMUP_POLL_MS, left()));
        if (this.disposed) return false;
        continue;
      }
      seen = arrived();
      this.render(1, 0, null, false);
      // the tinted twin of every batch the update built (its colour texture changes the program)
      this.scene.traverse((o) => {
        if (!(o instanceof BatchedMesh) || Array.isArray(o.material) || tinted.has(o.material)) return;
        tinted.add(o.material);
        zoo.addPlain(coloredBatchSample(zoo, o));
      });
      const fresh = [...zoo.gameplay.children, ...zoo.plain.children, ...zoo.backdrop.children].filter((o) => !done.has(o));
      for (const o of fresh) done.add(o);
      for (const o of zoo.gameplay.children) this.rim.patchTree(o);
      // the programs are created now and compile in the driver (in parallel) while the downloads go on
      const stand = lightsOf(this.scene, this.camera);
      const previous = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      try {
        for (const o of fresh) this.renderer.compile(o, this.camera, stand);
      } finally {
        this.renderer.setRenderTarget(previous);
      }
      void compileUncompiled(this.renderer, this.scene, this.camera, target, WARMUP_COMPILE_MS);
      await uploadTexturesSliced(this.renderer, [this.scene, ...fresh], WARMUP_SLICE_BYTES, stopped);
      await delay(0);
      if (this.disposed) return false;
    }
    return settled();
  }

  /**
   * The warm-up's last pass, after the downloads: an update builds what they made possible (sky,
   * planets, traffic, dust, scatter), the zoo gets the layers' samples and the rest again, then only
   * what has no program yet is compiled, what is new uploaded and the frame drawn once. False = disposed.
   */
  private async warmUpLastPass(zoo: ShaderZoo, stopped: () => boolean): Promise<boolean> {
    if (!this.hangarWarm && !(await this.warmUpHangar(stopped))) return false;
    this.render(1, 0, null, false);
    this.addSamples(zoo);
    if (!(await this.showZoo(zoo))) return false;
    await compileUncompiled(this.renderer, this.scene, this.camera, this.post.composer.readBuffer, WARMUP_COMPILE_MS);
    if (stopped()) return false;
    if (!(await uploadTexturesSliced(this.renderer, [this.scene], WARMUP_SLICE_BYTES, stopped))) return false;
    if (!(await primeProgramsSliced(this.renderer, WARMUP_SLICE_PROGRAMS, stopped))) return false;
    if (this.softwareGpu) return true;
    // what the frame still creates (the variants of the last files' draws; on a load from the cache the
    // post chain too) it compiles itself: with nothing left to download, compiling it ahead only costs
    // the recording on top
    this.drawWarmUpFrame();
    return true;
  }

  /**
   * The programs `draw` would create (shadow-map variants, AO overrides, post passes) compiled ahead in
   * parallel and given their first use a few per task, so the draw itself waits for none; false = disposed.
   */
  private async compileWarmUpDraws(draw: () => void, stopped: () => boolean): Promise<boolean> {
    await compileDraws(this.renderer, draw, this.warmUpDraws, WARMUP_COMPILE_MS);
    if (stopped() || !(await primeProgramsSliced(this.renderer, WARMUP_SLICE_PROGRAMS, stopped))) return false;
    await delay(0);
    return !stopped();
  }

  /**
   * The shipyard hangar has its own scene and lights: the ship templates (the clans' too) and the hangar
   * bay compiled, uploaded and drawn under them, so its first opening compiles nothing (SL2 E1 T11).
   * Once its files are in (the clan parts, the bay model). False = `stopped` (it runs again later).
   */
  private async warmUpHangar(stopped: () => boolean): Promise<boolean> {
    const hangarZoo = new Group();
    for (const t of [...this.library.templates(), ...this.library.clans.templates()]) hangarZoo.add(t.clone());
    hangarZoo.traverse((o) => {
      o.frustumCulled = false;
    });
    this.hangar.scene.environment = this.scene.environment;
    this.hangar.scene.add(hangarZoo);
    try {
      await compileScene(this.renderer, this.hangar.scene, this.hangar.camera, this.post.composer.readBuffer, WARMUP_COMPILE_MS);
      if (stopped()) return false;
      if (!(await uploadTexturesSliced(this.renderer, [this.hangar.scene], WARMUP_SLICE_BYTES, stopped))) return false;
      if (!(await primeProgramsSliced(this.renderer, WARMUP_SLICE_PROGRAMS, stopped))) return false;
      // the hangar drawn once (its shadow and post variants – compiled ahead while the network still
      // works), then – in a task of its own – the game scene
      if (!this.softwareGpu) {
        const drawHangar = (): void => this.post.renderOther(this.hangar.scene, this.hangar.camera, 0);
        if (prefetchesPending() > 0 && !(await this.compileWarmUpDraws(drawHangar, stopped))) return false;
        drawHangar();
      }
    } finally {
      hangarZoo.removeFromParent();
    }
    this.hangarWarm = true;
    return true;
  }

  /** Puts the zoo into the scene in view, rim-patched, shadow-tagged, with twins of the hidden objects; false = disposed. */
  private async showZoo(zoo: ShaderZoo): Promise<boolean> {
    zoo.group.position.copy(this.cameraTarget);
    this.scene.add(zoo.group);
    // async pieces of the samples (the gas giant's rings) attach first
    await delay(0);
    if (this.disposed) return false;
    this.rim.scan();
    this.rim.patchTree(zoo.gameplay);
    this.shadows.tagNow(this.scene);
    drawTwins(this.scene, zoo);
    zoo.showAll();
    return true;
  }

  /**
   * The hidden warm-up frame: everything drawn once, also what the camera does not see yet (the
   * station's far side, the traffic lanes) – a first draw costs the driver its variant even when the
   * program exists.
   */
  private drawWarmUpFrame(): void {
    const culled: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    this.renderer.info.reset();
    this.post.render(0);
    for (const o of culled) o.frustumCulled = true;
  }

  /**
   * Graphics quality from the settings (visual polish): `auto` starts from the GPU guess and steps
   * down (or back up, never above the guess) by the measured frame time.
   */
  setGraphicsQuality(setting: GraphicsSetting): void {
    this.graphicsSetting = setting;
    this.autoQuality = setting === 'auto' ? new AutoQuality(this.gpuQuality) : null;
    this.applyQuality(setting === 'auto' ? this.gpuQuality : setting);
  }

  /** Background brightness from the settings (0..1, 1 = the original backdrop; readability R4). */
  setBackgroundBrightness(level: number): void {
    const look = backdropLook(level);
    this.backgroundBrightness = level;
    this.starfield.setBackdrop(look.stars);
    this.sky.setBackdrop(look);
    this.env.setBackdrop(look);
    this.scatter.setBackdrop(level);
  }

  /**
   * The player's torn-edge memory: the cells of the blueprint (cells it has and the grid lost show torn
   * edges). The same set until the blueprint object changes.
   */
  private tornFrom(): ReadonlySet<string> {
    const blueprint = this.sim.state.player.blueprint;
    if (blueprint !== this.blueprint || !this.blueprintCells) {
      this.blueprint = blueprint;
      this.blueprintCells = gridCellKeys(blueprint);
    }
    return this.blueprintCells;
  }

  /** The level in effect (for `auto` the one it settled on). */
  get graphicsQuality(): { setting: GraphicsSetting; level: GraphicsQuality } {
    return { setting: this.graphicsSetting, level: this.quality };
  }

  private applyQuality(level: GraphicsQuality): void {
    this.quality = level;
    this.preset = presetFor(level, this.softwareGpu);
    this.shadows.setQuality(this.preset.shadowMapSize, this.preset.shadowRadius);
    this.post.setQuality(this.preset);
    this.env.setQuality(this.preset);
    this.traffic.setQuality(this.preset.traffic, this.preset.trails);
    this.rockDust.setQuality(this.preset.particles);
    this.scatter.setQuality(this.preset);
    this.borders.setQuality(this.preset);
    this.lasers.applyPreset(this.preset);
    this.nuggets.setQuality(this.preset.particles);
    this.sites.setQuality(this.preset);
    this.comets.setQuality(this.preset);
    this.micrometeors.setQuality(this.preset.particles);
    this.hangar.setQuality(this.preset);
    this.discovery.setQuality(level);
    SHIP_TRAILS.enabled = this.preset.trails;
    setHullShellQuality(level);
    SHIP_TRAILS.life = 0.5 + 0.3 * this.preset.particles;
    this.resize();
  }

  private adaptQuality(frameDt: number): void {
    const drs = this.adaptResolution(frameDt);
    if (!this.autoQuality) return;
    const next = this.autoQuality.frame(frameDt, drs && this.drs.holdsQuality);
    if (next) {
      this.applyQuality(next);
      this.drs.settle();
    }
  }

  /** Dynamic resolution for this frame; true while it is active. */
  private adaptResolution(frameDt: number): boolean {
    const active = this.gpuTimer !== null && !this.softwareGpu && dynamicResolutionEnabled();
    if (active !== this.drsActive) {
      this.drsActive = active;
      this.post.setGpuTimer(active ? this.gpuTimer : null);
      this.drs.reset();
      this.setRenderScale(1);
    }
    if (!active) return false;
    const scale = this.drs.frame(frameDt, this.gpuTimer!.poll());
    if (scale !== null) this.setRenderScale(scale);
    return true;
  }

  /**
   * A new render scale, applied between two frames (an UploadQueue gap): the scene and post targets are
   * resized and allocated there, not inside a frame (the canvas keeps its size, see PostStack.setRenderScale).
   */
  private setRenderScale(scale: number): void {
    if (this.renderScaleWanted === scale) return;
    this.renderScaleWanted = scale;
    this.context.uploads
      .run(() => {
        if (this.disposed || this.renderScale === this.renderScaleWanted) return;
        this.renderScale = this.renderScaleWanted;
        this.post.setRenderScale(this.renderScale);
        this.post.prepare();
      })
      .catch(() => undefined);
  }

  /** Dynamic resolution right now (tests, the perf probes). */
  dynamicResolutionStats(): { active: boolean; scale: number; gpuMs: number } {
    return { active: this.drsActive, scale: this.renderScale, gpuMs: this.drs.gpuMs };
  }

  /** What the visual-polish layers show right now (tests and tuning). */
  visualStats(): {
    quality: GraphicsQuality;
    shadows: boolean;
    ao: boolean;
    planets: number;
    traffic: { stations: number; vehicles: number; visible: number };
    backgroundBrightness: number;
    landmarks: { visible: number; echoColumns: number };
    scatter: ReturnType<ScatterLayer['stats']>;
    borders: ReturnType<BorderLayer['stats']>;
    zone: { sector: string | null; look: string | null; shown: string | null; fading: boolean; sky: number | null };
  } {
    const zone = this.zone.current;
    return {
      quality: this.quality,
      shadows: this.shadows.enabled,
      ao: this.post.aoActive,
      planets: this.env.planetCount(),
      traffic: this.traffic.stats(),
      backgroundBrightness: this.backgroundBrightness,
      landmarks: { visible: this.env.landmarks.visible, echoColumns: this.env.landmarks.echoColumns },
      scatter: this.scatter.stats(),
      borders: this.borders.stats(),
      zone: { sector: zone?.id ?? null, look: zone ? zoneKey(zone) : null, shown: this.env.zoneState.key, fading: this.env.zoneState.fading, sky: this.sky.ring },
    };
  }

  /** Flight-path marker, stopping point and the collision ring (M3.8) – only in free flight. */
  private updateMarkers(pos: Vec2, vel: Vec2, angle: number): void {
    this.dockMarker.update(this.sim.state, this.dockReadout);
    const player = this.sim.state.player;
    const flying = player.dock.mode === 'flying' && !player.destroyed;
    this.markers.object.visible = flying;
    if (!flying) {
      this.markers.rest();
      return;
    }
    const mass = player.props.mass + cargoMass(player.cargo);
    const stop = player.dampers && player.fuel > 0 ? stoppingPoint(player.props, mass, { pos, vel, angle }) : null;
    this.markers.update({
      pos,
      vel,
      radius: player.props.boundingRadius,
      stop,
      marker: this.assist.marker,
      collision: this.assist.collision,
      angle,
      cameraDistance: this.rig.viewDistance,
      time: this.time,
      reducedMotion: this.assist.reducedMotion,
    });
  }

  /**
   * Combat zoom-out (readability R1): while a hostile is in its aggro range the camera pulls back so the
   * ship and the nearest attacker fit (with a margin) – and every Gunner and sentry shooting from range
   * (`combatFrame`), so a salvo tell is on screen – its aim leaning a little towards the nearest attacker
   * so the fight sits in the middle, away from the HUD corners; off in the settings, while docking and
   * when dead. Adds the (smoothed) lean to the camera target.
   */
  private frameCombat(pos: Vec2, lead: Vec2, frameDt: number): void {
    const player = this.sim.state.player;
    const on = (this.assist.combatZoom ?? true) && player.dock.mode === 'flying' && !player.destroyed;
    const framed = on ? combatFrame(hostilesNear(this.sim.state.combat.enemies, pos)) : [];
    const focus = framed[0];
    let required: number | null = null;
    let lean: Vec2 | null = null;
    if (focus) {
      lean = combatLean({ x: focus.pos.x - pos.x, y: focus.pos.y - pos.y });
      // offsets from the camera's aim (ship + look-ahead + lean), pushed out by the hull radii
      const out = (p: Vec2, r: number): Vec2 => {
        const d = Math.hypot(p.x, p.y);
        return d < 1e-6 ? { x: 0, y: r } : { x: (p.x * (d + r)) / d, y: (p.y * (d + r)) / d };
      };
      const points = [out({ x: -lead.x - lean.x, y: -lead.y - lean.y }, player.props.boundingRadius)];
      for (const h of framed) {
        const enemy = this.sim.state.combat.enemies.find((e) => e.id === h.id);
        points.push(out({ x: h.pos.x - pos.x - lead.x - lean.x, y: h.pos.y - pos.y - lead.y - lean.y }, (enemy?.props.boundingRadius ?? 4) + 2));
      }
      required = frameDistance(points, { fovDeg: this.camera.fov, aspect: this.camera.aspect, pitchDeg: this.rig.pitchDeg }, COMBAT_MARGIN);
    }
    this.rig.frameCombat(required, frameDt, lean);
    this.cameraTarget.add(simToWorld(this.rig.combatLean, 0, this.lead));
  }

  /** Shader programs of the renderer (the warm-up guard: constant after the warm-up). */
  shaderPrograms(): number {
    return programCount(this.renderer);
  }

  /** Perf hook (SL2 E1 T6, hullShell.perf.spec.ts): median build, shell and bake times of a ship view of `grid`. */
  measureShellBuild(grid: ShipGrid, clan: FactionId | null = null, runs = 30): ShellBuildTiming {
    return measureShellBuild(this.library, grid, clan, runs);
  }

  /** Mining beams and nuggets on screen (tests of Mining 2.0 and the quality setting). */
  miningStats(): { beams: number; particles: number; lights: number; lightsInScene: number; nuggets: number } {
    return { ...this.lasers.stats(), lightsInScene: this.lasers.lightsInScene, nuggets: this.nuggets.count };
  }

  /** Puts `paint` on the player's ship view (before or after its bake – same draw calls). */
  private paintShip(paint: PaintId): void {
    applyPaint(this.shipView.group, paint);
    this.paintShown = paint;
    this.paintShell = hullShellVersion();
  }

  private renderHangar(scene: HangarScene, frameDt: number): void {
    // the same ambient light (the sky's environment map) as in flight – metal parts are not black
    this.hangar.scene.environment = this.scene.environment;
    this.hangar.reducedMotion = this.assist.reducedMotion;
    const dock = this.sim.state.player.dock;
    this.hangar.syncParked(this.sim.state.fleet.stored, dock.mode === 'flying' ? null : dock.stationId);
    this.hangar.sync(scene);
    this.hangar.update(frameDt);
    this.hangar.setPaint(this.paintPreview ?? paintOf(this.sim.state.fleet.active));
    this.renderer.info.reset();
    // the game scene's shadow map is not kept meanwhile: the first docked frame after draws it
    this.shadowCadence.reset();
    this.post.renderOther(this.hangar.scene, this.hangar.camera, frameDt);
    if (LOG_STATS) this.logStats(frameDt);
  }

  /** Logs draw calls every few seconds (performance check, `?stats`). */
  private logStats(frameDt: number): void {
    this.statsTime += frameDt;
    this.statsFrames++;
    if (this.statsTime < STATS_INTERVAL) return;
    const fps = Math.round(this.statsFrames / this.statsTime);
    this.statsTime = 0;
    this.statsFrames = 0;
    const { calls, triangles } = this.renderer.info.render;
    console.debug(`[render] draw calls: ${calls}, triangles: ${triangles}, average fps: ${fps}`);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.sky.dispose();
    this.post.dispose();
    this.gpuTimer?.dispose();
    this.env.dispose();
    this.traffic.dispose();
    this.convoys.dispose();
    this.rockDust.dispose();
    this.scatter.dispose();
    this.borders.dispose();
    // the shadow map belongs to this game's sun light
    this.sun.shadow.map?.dispose();
    this.shipView.dispose();
    this.navLights.dispose();
    this.hangar.dispose();
    this.asteroids.dispose();
    this.combat.dispose();
    this.contracts.dispose();
    this.discovery.dispose();
    this.survey.dispose();
    this.salvage.dispose();
    this.fortresses.dispose();
    this.sites.dispose();
    this.comets.dispose();
    this.micrometeors.dispose();
    this.trophyShelf.dispose();
    this.homeModules.dispose();
    this.stations.dispose();
    this.starfield.dispose();
    this.dust.dispose();
    this.markers.dispose();
    this.dockMarker.dispose();
    this.enemyMarkers.dispose();
    this.lasers.dispose();
    this.nuggets.dispose();
    disposePaints();
    // the shared renderer stays with the application (the next game uses it), its own one is freed with the context
    if (this.ownsContext) this.context.dispose();
    else this.context.detach();
  }
}

/** WebGL renderer name (WEBGL_debug_renderer_info) for the auto quality guess, or null. */
function gpuName(renderer: WebGLRenderer): string | null {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return null;
  }
}

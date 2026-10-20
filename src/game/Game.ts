import { priceList, type PriceList } from '../data/economy';
import { getLocale, tx, type Locale } from '../i18n';
import { rebuilt, ToastSlot, type ToastText } from './toastSlot';
import type { CoreTexts } from '../i18n/sk';
import type { ModelLibrary } from '../render/assets/ModelLibrary';
import { GameRenderer, type WarmUpReport } from '../render/GameRenderer';
import type { GraphicsQuality, GraphicsSetting } from '../render/quality';
import type { RenderContext } from '../render/RenderContext';
import type { GameAction, GameActionInput } from '../sim/commands';
import type { PaintId } from '../data/paints';
import type { PartKey } from '../data/parts';
import type { ShapeId } from '../data/shapes';
import { length, type Vec2 } from '../sim/math/vec2';
import { SIM_DT, Simulation, type SimEvent } from '../sim/Simulation';
import { emergencyFuelAvailable, stationStorage } from '../sim/station/actions';
import { checkDock } from '../sim/station/dock';
import { playerDockRules } from '../sim/station/dockRules';
import { towAvailable, towQuote } from '../sim/station/tow';
import { nearestDiscoveredStation, stationById, type StationDef } from '../sim/world/stations';
import { ringIndexAt } from '../sim/world/rings';
import { formatCredits, formatInt } from '../ui/format';
import { clearGameUi, renderGameUi, type ToastKind } from '../ui/GameUi';
import { whenIdle } from '../ui/lazy';
import type { HudData } from '../ui/Hud';
import { threatMode } from '../ui/combatHud';
import { buildRadarContacts, buildThreatContacts, type RadarSource } from '../ui/radar';
import { lootEmpty } from '../sim/combat/wrecks';
import { sleeperDisguised } from '../sim/sites/graveyard';
import { blastToast, combatToast, SilhouetteTrack } from './combatHudState';
import { combatHudView, HitTracker, silhouette, type Silhouette } from './combatView';
import { ThreatArrows } from './threatArrows';
import { buildStationContacts, dockPrompt, DockReadoutGate, dockRejectedText, edgeArrow, type EdgeArrow } from '../ui/stationHud';
import {
  STATION_TABS,
  tabEnabled,
  type StationHubData,
  type StationHubHandlers,
  type StationTab,
  type StationUiState,
} from '../ui/station/StationHub';
import type { ShipyardHandlers, ShipyardUiData } from '../ui/station/Shipyard';
import { shipyardContext, type ShipyardContext } from '../sim/shipyard/design';
import { lockReason } from './discovery/names';
import { craftingRows, partsMarketRows, repairView, type RepairView } from './stationView';
import { formatParts, hasShapes, partName, placementMessage, reshapePreview, shapeTip, type ReshapePreview } from './shipyardView';
import { partInfo, type PartInfoView } from './partInfo';
import { ShipyardEditor, type MirrorNotice } from './shipyardEditor';
import { hotkeyNumber } from './paletteHotkeys';
import { formatStationName } from '../ui/stationName';
import { FixedLoop } from './fixedLoop';
import { miningHud, MiningHudMemo } from './miningView';
import { MiningUi } from './mining/miningUi';
import { GameAudio } from './GameAudio';
import { buildCommand, KeyboardState, letterKey, PointerState } from './input';
import { CareerUi } from './career/careerUi';
import { TrainingUi } from './training/trainingUi';
import type { TrainingContext } from './training/trainingView';
import type { TrainingHandlers } from './training/trainingUi';
import { trainingActive } from '../sim/training/training';
import { ExploreUi, type CalloutData } from './discovery/exploreUi';
import type { CalloutItem } from '../ui/theme';
import { asteroidFields } from './discovery/fields';
import { courierOffer } from './board/storagesView';
import { PiratesUi } from './pirates/piratesUi';
import { coveredNozzles, designGap, type DesignGap } from './designGap';
import { CommsUi, type CommsHandlers } from './comms/commsUi';
import type { RadioSetting } from './comms/types';
import { predictCollision, type CollisionWarning } from './flightAssist';
import { applyCalloutShift, calloutSide, edgeArrowBox, hudPanelBoxes, type Box } from './calloutPlacement';
import { UiLayout } from './uiLayout';
import { HubLayout } from './hubLayout';
import { RESOURCE_IDS } from '../data/resources';
import { ViewMemo } from './viewMemo';
import { SectorsUi } from './sectors/sectorsUi';
import { sectorInfoAt } from '../sim/regions/sectors';
import { FleetUi, type FleetDevHooks } from './fleet/fleetUi';
import { deathTemplate, type DeathTemplateTarget } from './fleet/templatesView';
import { SitesUi, type SitesDevHooks } from './sites/sitesUi';
import type { HomeDevHooks } from './home/types';
import { HomeUi } from './home/homeUi';
import { perfDevHooks, type PerfDevHooks } from '../render/hull/perfHook';
import { loafMonitor, type LoafMonitor } from './loafMonitor';
import { WorkshopLamps } from './workshopView';
import type { GuildDevHooks } from './guild/types';
import { GuildUi } from './guild/guildUi';
import { MapPlanUi } from './map/mapPlanUi';
import { goalEdgeArrow, goalMark, type GoalHud } from '../ui/goalMark';
import { flightHudRects, hudArrowFootprint, hudArrowRect, navArrows, placeHudArrows, type EdgeArrowInput, type NavMark } from '../ui/edgeArrows';
import { formatClock } from '../ui/sites/chipFormat';
import type { RouteMark } from './map/mapPlanUi';
import type { EdgeArrowMark } from '../ui/EdgeArrowLayer';

declare global {
  interface Window {
    /** Debug access for tests (dev mode only). */
    __cinder?: {
      sim: Simulation;
      renderer: GameRenderer;
      game: Game;
      fleet?: FleetDevHooks;
      /** M4b world sites, space events and the derelict berth. */
      sites?: SitesDevHooks['sites'];
      events?: SitesDevHooks['events'];
      berth?: SitesDevHooks['berth'];
      /** Forces a rolled space event now (= `events.force`). */
      debugEvent?: SitesDevHooks['events']['force'];
      /** M4c home station helpers (T2 fills them). */
      home?: HomeDevHooks;
      /** Render switches for screenshots and probes (hull shell: terrace v2 override). */
      perf?: PerfDevHooks;
      /** M4d Guild and convoy helpers (`debugGuild`; the sim fills them in T2 / T3 / T5). */
      guild?: GuildDevHooks;
      /** Long animation frames (> 50 ms) for the perf guard (tests/e2e/perfGuard.spec.ts). */
      loaf?: LoafMonitor;
    };
  }
}

const UI_INTERVAL = 0.1;
/** Hits on the player redraw the HUD early, but at most this often (several hits in a burst share one). */
const HIT_REDRAW_GAP = 0.05;
/** While the hangar camera moves the UI over the hangar follows at most ~30× per second (every 2nd frame at 60 Hz). */
const HANGAR_UI_GAP = 0.03;

/** Shipyard context with the lock texts (Archive, blueprints – M3.5b). */
function withLockReasons(state: Simulation['state'], ctx: ShipyardContext): ShipyardContext {
  if (!ctx.locked || ctx.locked.size === 0) return ctx;
  const reasons = new Map<PartKey, string>();
  for (const key of ctx.locked) reasons.set(key, lockReason(state, key) ?? '');
  return { ...ctx, lockReasons: reasons };
}
/** Redraw interval of the still scene while paused (s). */
const PAUSED_REDRAW = 0.5;
/**
 * While the map covers the flight scene, the 3D scene is not drawn (the last frame stays under the
 * map's dim backdrop) – it only updates this often, so the camera and the layers are in step when the
 * map closes (audit 2026-10-17, P1: the 3D frame was ~75 % of the frame time with the map open).
 */
const MAP_SCENE_INTERVAL = 0.1;
/** The controls help collapses by itself after this many seconds of flight (unless the player toggles it with K). */
const HELP_AUTO_COLLAPSE = 25;
/** How long the full "Pirates!" band stays lit after an alert (s). */
const ALERT_TIME = 3.5;
/** A planned route ending this close to the station of the station arrow (u) merges into that arrow (M4d). */
const ROUTE_AT_STATION = 60;

/** Closed map – the HUD needs neither the explored chunks nor the station list. */
const CLOSED_MAP: HudData['map'] = { open: false, explored: [], stations: [] };

/** Empty repairs view outside the Service tab (not computed needlessly). */
const NO_REPAIRS: RepairView = {
  damaged: false,
  rows: [],
  all: { credits: 0, autoBuyCredits: 0, total: 0, ok: false, text: '' },
  hull: { current: 0, max: 0, fraction: 1 },
};

/** Hooks connecting the game to the app (menu, pause, saving – src/game/app/App.ts). */
export interface GameHooks {
  /** Esc in flight or on the hub Overview → pause. */
  onPauseRequest?: () => void;
  /** After every simulation step, with its events (autosave, death). */
  afterStep?: (events: readonly SimEvent[]) => void;
  /** F5 – quick save (in space too). */
  onQuickSave?: () => void;
}

export interface GameOptions {
  /** New or loaded simulation; defaults to a new game with seed 1337. */
  sim?: Simulation;
  /** Audio owned by the app (survives switching between games); without it the game creates its own. */
  audio?: GameAudio;
  hooks?: GameHooks;
  /** The controls help in the HUD starts expanded. */
  helpOpen?: boolean;
  /** Multiplier of the mouse wheel step when zooming. */
  zoomSensitivity?: number;
  /** The app's WebGL renderer and cache (one for all games); without it the game creates its own. */
  renderContext?: RenderContext;
  /** Loaded game: show the "Where you left off" card first (M3.5a). */
  resumeCard?: boolean;
  /** Game name on the return card. */
  gameName?: string;
  /** Flight assist switches (M3.8); default all on, motion per the system. */
  flight?: FlightSettings;
  /** Graphics quality from the settings (visual polish); default auto. */
  graphics?: GraphicsSetting;
  /** Background brightness 0..1 from the settings (readability); default the renderer's. */
  backgroundBrightness?: number;
  /** The "Radio" setting (communicator); default all. */
  radio?: RadioSetting;
}

/** Flight assist switches from the settings (M3.8). */
export interface FlightSettings {
  marker: boolean;
  shake: boolean;
  reducedMotion: boolean;
  /** Combat zoom-out (readability R1); default on. */
  combatZoom?: boolean;
  /** M4d "Markers in flight": map notes near the ship as edge arrows in flight; default on. */
  notesInFlight?: boolean;
}

/**
 * A hangar camera drag – middle button or Alt + left: orbit and tilt, with Shift pan. No movement =
 * eyedropper (the click those buttons always meant).
 */
interface PanDrag {
  x: number;
  y: number;
  moved: boolean;
}

/** A world label's element and what positionCallouts last wrote to it (null / NaN = not yet). */
interface CalloutDom {
  el: HTMLElement;
  x: number;
  y: number;
  hidden: boolean | null;
  flip: boolean | null;
  below: boolean | null;
  shift: number;
}

/** Held keys that move the hangar camera (KeyboardEvent.code – by key position, like flight). */
function hangarCameraKeys(pressed: ReadonlySet<string>): { orbit: number; tilt: number; panX: number; panY: number } {
  const axis = (minus: string, plus: string) => (pressed.has(plus) ? 1 : 0) - (pressed.has(minus) ? 1 : 0);
  return {
    orbit: axis('KeyE', 'KeyQ'),
    tilt: axis('PageDown', 'PageUp'),
    panX: axis('ArrowLeft', 'ArrowRight'),
    panY: axis('ArrowDown', 'ArrowUp'),
  };
}

export class Game {
  private readonly sim: Simulation;
  private readonly keyboard = new KeyboardState();
  private readonly pointer = new PointerState();
  private readonly renderer: GameRenderer;
  private readonly loop: FixedLoop;
  private readonly audio: GameAudio;
  /** The audio belongs to the game (not the app) – stop() releases it. */
  private readonly ownsAudio: boolean;
  private readonly hooks: GameHooks;
  /** Pause: the simulation does not step, input is discarded. */
  private paused = false;
  /** After a pause, discard presses from the same frame (the Esc that closed the pause). */
  private discardKeys = false;
  /** Seconds until the next redraw of the still scene while paused. */
  private pausedRedraw = 0;
  /** One signal for all listeners – stop() detaches them all at once. */
  private readonly lifetime = new AbortController();
  private frame: number | null = null;
  /** New presses waiting for the next simulation step. */
  private pending = new Set<string>();
  /** The player abandoned the ship (pause) – scuttle command in the next step. */
  private scuttlePending = false;
  /** Station actions waiting for the next step. */
  private actions: GameAction[] = [];
  private nextReqId = 1;
  private aim: Vec2 = { x: 0, y: 0 };
  private mapOpen = false;
  /** Scene time not yet given to the renderer while the map covers the scene (see MAP_SCENE_INTERVAL). */
  private mapSceneDt = 0;
  /** The UI root rect of the last drawn 3D frame: a resize under the open map draws the scene again. */
  private sceneDrawnRect: DOMRect | null = null;
  /** Controls help expanded in the HUD; `helpTouched` = the player toggled it themselves. */
  private helpOpen = true;
  private helpTouched = false;
  private flightTime = 0;
  /** The toast (a text builder says it again after a live language switch). */
  private readonly toast = new ToastSlot();
  private clock = 0;
  private lastTime: number | null = null;
  private uiTimer = 0;
  /** Clock of the last UI redraw (hit-forced redraws are coalesced). */
  private lastUiAt = -Infinity;
  /** UI root rect and the console edge, measured by a ResizeObserver instead of after each redraw. */
  private readonly layout: UiLayout;
  /** The flight HUD has been on screen (or warmed up off screen) at least once this game. */
  private flightHudWarm = false;
  /** The docking approach readout and clamp marker stay hidden while the ship departs (updated every frame). */
  private readonly dockGate = new DockReadoutGate();
  private dockReadout = false;
  private readonly stationUi: StationUiState = {
    tab: 'overview',
    qty: 1,
    sellFrom: 'ship',
    welcome: true,
    marketKind: 'resources',
    partTier: 1,
    craftTier: 1,
    craftKey: null,
    craftCount: 1,
    repairAutoBuy: true,
    boardView: 'contracts',
  };
  /** Shipyard editor – the draft lives while the ship is docked at this station. */
  private yard: ShipyardEditor | null = null;
  /** "On your design" of the selected palette part – recomputed when the draft or
   *  selection changes. */
  private yardInfo: { draft: unknown; key: PartKey; shape: ShapeId | null; locale: Locale; info: PartInfoView } | null = null;
  /** The shipyard key help card (K, SL2 E2). */
  private yardHelp = false;
  private panDrag: PanDrag | null = null;
  /** Last pointer position over the hangar (window px) – the hover cell follows a moving camera. */
  private yardPointerAt: { x: number; y: number } | null = null;
  /** Last position of the editor area (window px) – for the label next to the ghost. */
  private yardRect: DOMRect | null = null;
  /** The hub's cover and the editor view, kept by a ResizeObserver (perf audit 2026-10-17, P3). */
  private readonly hubLayout: HubLayout;
  /** Bumped by every simulation step with player actions or events: the hub's memoised views follow it. */
  private simEpoch = 0;
  /**
   * The hub's memoised views (see hubViewKey): the price list (by the station's ring and price jitter), the
   * parts market, crafting and repair rows, the overview's design gap and covered nozzles.
   */
  private readonly hubPrices = new ViewMemo<PriceList>();
  private readonly hubMarket = new ViewMemo<ReturnType<typeof partsMarketRows>>();
  private readonly hubCrafting = new ViewMemo<ReturnType<typeof craftingRows>>();
  private readonly hubRepair = new ViewMemo<{ view: RepairView; rowOk: Record<number, boolean> }>();
  private readonly hubGap = new ViewMemo<DesignGap | null>();
  private readonly hubNozzles = new ViewMemo<number>();
  /** Success texts for sent actions (reqId → toast). */
  private readonly pendingOk = new Map<number, () => string>();
  /** Last vein bonus for the HUD (the label does not flicker when briefly leaving the vein). */
  private readonly miningMemo = new MiningHudMemo();
  /** Mining 2.0: grade callouts, nugget pops and toasts, radar and map marks. */
  private readonly mining = new MiningUi();
  /** Combat (M3b): hit directions, the silhouette black box, the alert and the last hull hit. */
  private readonly hits = new HitTracker();
  /** Off-screen pirate arrows (readability R2). */
  private readonly threatArrows = new ThreatArrows();
  private readonly blackBoxTrack = new SilhouetteTrack();
  private alertUntil = -Infinity;
  private hullHit: { seq: number; at: number } | null = null;
  /** Flight assist (M3.8): settings, the current collision warning and the beep clock. */
  private flight: FlightSettings = { marker: true, shake: true, reducedMotion: false };
  private collision: CollisionWarning | null = null;
  private nextBeepAt = 0;

  private readonly yardHandlers: ShipyardHandlers = {
    select: (key) => this.yardDo((y) => y.select(key)),
    setTier: (tier) => this.yardDo((y) => y.setTier(tier)),
    toggleLayers: () => this.yardDo((y) => y.toggleLayers()),
    rotate: (dir) => this.yardDo((y) => y.rotate(dir)),
    undo: () => this.yardDo((y) => y.undo()),
    redo: () => this.yardDo((y) => y.redo()),
    restore: () => this.yardDo((y) => y.restore()),
    restoreDesign: () => this.yardRestoreDesign(),
    cancel: () => this.yardCancel(),
    commit: () => this.yardCommit(),
    resetView: () => this.renderer.hangar.resetView(),
    topView: () => this.renderer.hangar.topView(),
    toggleMirror: () => this.yardDo((y) => this.showNotice(y.toggleMirror())),
    toggleMirrorAxis: () => this.yardDo((y) => y.toggleMirrorAxis()),
    // SL2 E2: the shape strip puts a shape in hand; K / the help button toggles the key help
    selectShape: (shape) => this.yardDo((y) => y.setShape(shape)),
    toggleHelp: () => {
      this.yardHelp = !this.yardHelp;
      this.renderUi();
    },
    focus: (m) => this.yardDo((y) => y.toggleFocus(m)),
    setAcquire: (key, mode) => this.yardDo((y) => y.setAcquire(key, mode)),
    pointer: (kind, e) => this.yardPointer(kind, e),
    doubleClick: (e) => this.yardDoubleClick(e),
    wheel: (e) => this.renderer.hangar.zoomBy(e.deltaY * this.renderer.wheelScale),
    click: () => this.audio.click(),
    promptConfirm: () => this.yardPrompt(true),
    promptCancel: () => this.yardPrompt(false),
  };

  /** Career (M3.5a): Objectives, Storages, Board, return card, "First Day" tips. */
  private readonly career: CareerUi;
  /** Discovery (M3.5b): HUD scanner, Callout, map layers, journal, Archive, toasts. */
  private readonly explore: ExploreUi;
  /** Incremented by the C key with the map open – the map recentres on the ship. */
  private mapRecenter = 0;
  /** World labels from the last UI redraw – their position is updated every frame. */
  private callouts: CalloutData[] = [];
  /** The edge arrows' areas as of the last UI redraw – the world labels keep clear of them. */
  private calloutAvoid: Box[] = [];
  /**
   * The world labels' elements (per `callouts` entry) and what positionCallouts last wrote to them;
   * looked up again after each UI redraw (null = look up), not queried per label and frame.
   */
  private calloutEls: (CalloutDom | null)[] | null = null;
  /** The cannon reticle's element (undefined = look up after a UI redraw) and its last translate. */
  private reticleEl: HTMLElement | null | undefined = undefined;
  private readonly reticleAt = { x: NaN, y: NaN };
  /** The map layer switch (a stable handler – a new closure per redraw would redraw the map's toggles). */
  private readonly toggleMapLayer = (layer: Parameters<ExploreUi['toggleLayer']>[0]): void => this.explore.toggleLayer(layer);
  /** Pirates and salvage (M3.6): attention, toll, tractor, fortress, reticle, toasts. */
  private readonly pirates = new PiratesUi();
  /** Sectors: the HUD badge, the entry notice, its radio line or sound, the radar arc, the map layer and card. */
  private readonly sectors = new SectorsUi({
    sound: (security, notice) => this.audio.sectorEntry(security, notice),
    radio: (messages) => this.comms.say(this.sim.state, messages),
  });
  /** Guild Training (M3.7): step panel, highlight, hangar cells, world labels, skip. */
  private readonly training: TrainingUi;
  /** Communicator: radio messages with a speaker, the toll in the panel, the log (L). */
  private readonly comms: CommsUi;
  /** Hangar and templates (M4a): the fleet modals, their handlers and view models. */
  private readonly fleet: FleetUi;
  /** M4b: event chips, the derelict terminal and berth, site toasts. */
  private readonly sites: SitesUi;
  /** M4c: the home station's Development tab (modules, paint shop, trophy hall) and its camera focus. */
  private readonly home: HomeUi;
  /** M4c: the on-board workshop's flight lamps (RAF / OPR) with their idle hold. */
  private readonly workshopLamps = new WorkshopLamps();
  /** M4d: the convoy trade, the Guild chips, radar contacts, map layer, link prompt and toasts. */
  private readonly guild: GuildUi;
  /** M4d: the map's route planner, notes and stale marks (route and marks are session state). */
  private readonly mapPlan: MapPlanUi;
  /** Events of the current step whose toast the radio replaced. */
  private spoken: ReadonlySet<SimEvent> = new Set();
  /** The player's reactor blew up in the step being handled: its losses go into one blast toast. */
  private blastStep = false;
  /** Hub handlers + the training layer's and the radio's (rendered with the game UI). */
  private readonly uiHandlers: StationHubHandlers & { training: TrainingHandlers; comms: CommsHandlers };

  private readonly hubHandlers: StationHubHandlers = {
    action: (action) => {
      this.sendAction(action);
    },
    setTab: (tab) => this.setTab(tab),
    setQty: (qty) => {
      this.stationUi.qty = qty;
      this.renderUi();
    },
    setSellFrom: (from) => {
      this.stationUi.sellFrom = from;
      this.renderUi();
    },
    setUi: (patch) => {
      Object.assign(this.stationUi, patch);
      this.renderUi();
    },
    undock: () => this.requestUndock(),
    click: () => this.audio.click(),
    shipyard: this.yardHandlers,
    restoreDesign: () => {
      const station = this.dockedStation();
      if (!station?.services.shipyard) return;
      this.setTab('shipyard');
      this.yardRestoreDesign(this.yardFor(station));
    },
  };

  constructor(gameElement: HTMLElement, private readonly uiElement: HTMLElement, library: ModelLibrary, options: GameOptions = {}) {
    const signal = this.lifetime.signal;
    this.layout = new UiLayout(uiElement);
    // the docked scene is centred in the part of the screen the hub does not cover, the editor hangar
    // in the free area between the panels
    this.hubLayout = new HubLayout(uiElement, ({ inset, yard }) => {
      this.renderer.setViewInset(inset);
      this.yardRect = yard;
      if (yard) this.renderer.setHangarViewport(yard);
    });
    this.sim = options.sim ?? new Simulation({ seed: 1337 });
    this.training = new TrainingUi({ state: () => this.sim.state, send: (a) => void this.sendAction(a), render: () => this.renderUi(), click: () => this.audio.click() });
    this.career = new CareerUi(
      {
        state: () => this.sim.state,
        send: (a) => void this.sendAction(a),
        render: () => this.renderUi(),
        click: () => this.audio.click(),
        requestSkipTraining: () => {
          this.career.setPanel(null);
          this.training.askSkip();
        },
      },
      { resume: options.resumeCard ?? false, name: options.gameName ?? '' },
    );
    this.hubHandlers.career = this.career.handlers;
    this.explore = new ExploreUi({ state: () => this.sim.state, send: (a) => void this.sendAction(a), render: () => this.renderUi(), click: () => this.audio.click() });
    this.hubHandlers.explore = this.explore.handlers;
    this.audio = options.audio ?? new GameAudio();
    this.comms = new CommsUi(
      { state: () => this.sim.state, render: () => this.renderUi(), click: () => this.audio.click(), sound: (kind, duck) => this.audio.comms(kind, duck) },
      options.radio ?? 'all',
    );
    this.fleet = new FleetUi({
      state: () => this.sim.state,
      send: (a) => this.sendAction(a),
      render: () => this.renderUi(),
      click: () => this.audio.click(),
      notify: (text, kind, seconds) => this.show(text, kind, seconds),
      editor: () => (this.yard && this.yard.stationId === this.dockedStation()?.id ? this.yard : null),
      openShipyard: () => this.openShipyard(),
    });
    this.sites = new SitesUi({ state: () => this.sim.state, send: (a) => this.sendAction(a), render: () => this.renderUi() });
    this.guild = new GuildUi({ state: () => this.sim.state, send: (a) => this.sendAction(a) });
    this.mapPlan = new MapPlanUi({ state: () => this.sim.state, send: (a) => this.sendAction(a), render: () => this.renderUi() });
    this.home = new HomeUi({
      state: () => this.sim.state,
      send: (a) => this.sendAction(a),
      render: () => this.renderUi(),
      focus: (m) => this.renderer.setHomeFocus(m),
      notify: (text, kind, seconds) => this.show(text, kind, seconds),
    });
    this.hubHandlers.development = this.home.handlers;
    this.hubHandlers.hangar = this.fleet.hangar;
    this.hubHandlers.templates = this.fleet.templates;
    this.uiHandlers = Object.assign(this.hubHandlers, { training: this.training.handlers, comms: this.comms.handlers, templatesModal: this.fleet.templates, sites: this.sites.handlers, convoys: this.guild.handlers });
    this.ownsAudio = !options.audio;
    this.hooks = options.hooks ?? {};
    if (options.helpOpen !== undefined) this.helpOpen = options.helpOpen;
    this.renderer = new GameRenderer(gameElement, this.sim, library, signal, options.renderContext);
    // a shared (app-owned) audio still remembers the previous game – combat music must not carry over
    this.audio.newGame();
    if (options.zoomSensitivity !== undefined) this.renderer.wheelScale = options.zoomSensitivity;
    if (options.flight) this.flight = { ...options.flight };
    if (options.graphics) this.renderer.setGraphicsQuality(options.graphics);
    if (options.backgroundBrightness !== undefined) this.renderer.setBackgroundBrightness(options.backgroundBrightness);
    this.renderer.setFlightAssist({ ...this.flight, collision: null });
    this.keyboard.attach(window, signal);
    this.pointer.attach(gameElement, signal);
    gameElement.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    // Ctrl+Z / Ctrl+Y in the editor (KeyboardState deliberately ignores Ctrl combos – dampers are on Z)
    window.addEventListener('keydown', (e) => this.onEditorShortcut(e), { signal });
    // F5 = quick save instead of reloading the page
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'F5' || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (!e.repeat && !this.paused) this.hooks.onQuickSave?.();
      },
      { signal },
    );
    this.loop = new FixedLoop(SIM_DT, () => this.stepSimulation());
    if (import.meta.env.DEV) {
      const sites = this.sites.devHooks();
      window.__cinder = { sim: this.sim, renderer: this.renderer, game: this, fleet: this.fleet.devHooks(), ...sites, debugEvent: sites.events.force, home: this.home.devHooks(), perf: perfDevHooks(), guild: this.guildDevHooks(), loaf: loafMonitor() };
    }
  }

  /**
   * Starts the loop once the renderer's shader warm-up is done (the first game frame compiles nothing –
   * audit 2026-10-16, issue #1); resolves then. The caller keeps its loading overlay up meanwhile.
   */
  start(): Promise<void> {
    this.starting ??= this.renderer
      .warmUp(() => this.prerenderUi())
      .catch((e: unknown) => {
        // a failed warm-up only costs the old first-sight compiles – the game must start anyway
        console.warn('Shader warm-up failed', e);
        return null;
      })
      .then((report) => {
        this.warmUpReport = report;
        if (this.lifetime.signal.aborted || this.frame !== null) return;
        this.frame = requestAnimationFrame(this.tick);
      });
    return this.starting;
  }

  /** The shader warm-up's report (null until it finished). */
  warmUpReport: WarmUpReport | null = null;
  private starting: Promise<void> | null = null;
  /** The UI drawn by prerenderUi stays hidden until the first game frame. */
  private uiHeldUntilFrame = false;

  /**
   * The UI's first draw (the hub or the HUD, ~0.25 s at 4× CPU) while the warm-up waits for the network,
   * not in the first game frame (perf O14): kept hidden until that frame shows it.
   */
  private prerenderUi(): void {
    if (this.lifetime.signal.aborted || this.frame !== null) return;
    this.uiHeldUntilFrame = true;
    this.uiElement.style.visibility = 'hidden';
    this.renderUi();
  }

  /** Stops the loop, detaches input, removes the UI and releases WebGL. */
  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lifetime.abort();
    this.layout.dispose();
    this.hubLayout.dispose();
    clearGameUi(this.uiElement);
    this.uiElement.style.visibility = '';
    this.renderer.dispose();
    if (this.ownsAudio) this.audio.dispose();
    else this.audio.silence();
    if (import.meta.env.DEV && window.__cinder?.sim === this.sim) delete window.__cinder;
  }

  /** The simulation is halted (pause, settings, death card); the scene keeps drawing. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.keyboard.pressed.clear();
    // a mouse button released over an overlay would otherwise keep firing or mining
    this.pointer.release();
    this.discardKeys = true;
    this.pausedRedraw = 0;
    if (paused) this.audio.silence();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get simulation(): Simulation {
    return this.sim;
  }

  /** Mouse wheel step multiplier (Settings). */
  setZoomSensitivity(factor: number): void {
    this.renderer.wheelScale = factor;
  }

  /** Flight assist switches changed in the settings (M3.8). */
  /** Graphics quality changed in the settings (visual polish). */
  setGraphicsQuality(setting: GraphicsSetting): void {
    if (this.renderer.graphicsQuality.setting !== setting) this.renderer.setGraphicsQuality(setting);
  }

  /** Background brightness changed in the settings (readability). */
  setBackgroundBrightness(level: number): void {
    this.renderer.setBackgroundBrightness(level);
  }

  /** The level in effect (what auto settled on). */
  get graphicsLevel(): GraphicsQuality {
    return this.renderer.graphicsQuality.level;
  }

  /** The "Radio" setting changed (communicator). */
  setRadio(setting: RadioSetting): void {
    this.comms.setRadio(setting);
  }

  setFlightSettings(settings: FlightSettings): void {
    this.flight = { ...settings };
    this.renderer.setFlightAssist({ ...this.flight, collision: this.collision });
  }

  /**
   * Collision ahead (M3.8), once per frame in flight: the renderer rings the rock, the HUD shows the
   * band (redrawn at once when a warning starts) and a beep repeats faster as contact nears.
   */
  private updateCollision(): void {
    const state = this.sim.state;
    const before = this.collision;
    this.collision = this.paused ? null : predictCollision(state);
    this.renderer.setFlightAssist({ ...this.flight, collision: this.collision });
    if (this.collision && !before) this.uiTimer = 0;
    if (!this.collision) return;
    if (this.clock >= this.nextBeepAt) {
      this.audio.collisionBeep(this.collision.urgency);
      this.nextBeepAt = this.clock + 0.6 - 0.45 * this.collision.urgency;
    }
  }

  /** The docking approach readout and clamp marker, once per frame: hidden while the ship departs (stationHud). */
  private updateDockReadout(): void {
    const state = this.sim.state;
    const { player } = state;
    const check = checkDock(player.body, player.props.boundingRadius, state.world.stations(), playerDockRules(state));
    // a derelict clamp nearer than every station's docking point takes the readout (M4b berth)
    const berth = this.sites.updateReadout(state);
    // a convoy trader's trade port in reach takes it too (M4d; checked at the UI redraw)
    const shown = this.dockGate.update(player.dock.mode, player.body, check) && !berth && !this.guild.portInPlay;
    // a readout appearing on the approach shows at once, not at the next UI redraw
    if (shown && !this.dockReadout) this.uiTimer = 0;
    this.dockReadout = shown;
    this.renderer.dockReadout = shown;
  }

  /** Events outside a simulation step (e.g. death → applyDeath docks the ship) – handled like step events. */
  applyEvents(events: readonly SimEvent[]): void {
    this.simEpoch++;
    for (const event of events) {
      this.handleEvent(event);
      this.audio.event(event);
    }
    this.renderUi();
  }

  /** Objectives / Storages panel (from the pause menu, M3.5a). */
  openCareerPanel(panel: 'objectives' | 'storages'): void {
    this.career.setPanel(panel);
  }

  /**
   * The death card's "Rebuild from a template" (M4a): whether it shows, and which death option it takes
   * (the respawn station, or the evacuation when only that one has a shipyard).
   */
  deathTemplate(respawnStationId: string, evacuationStationId: string | null): DeathTemplateTarget {
    return deathTemplate(this.sim.state, this.sim.station(respawnStationId), evacuationStationId ? this.sim.station(evacuationStationId) : null);
  }

  /** After a respawn from the death card's template action: the Shipyard tab with the Templates modal. */
  openTemplatesAfterRespawn(): void {
    if (!this.openShipyard()) return;
    this.fleet.templates.open();
  }

  /** Abandon ship: the next simulation step destroys the cockpit (flight only; docked, the simulation ignores it). */
  requestScuttle(): void {
    this.scuttlePending = true;
  }

  /** Short in-game message (toast). */
  notify(text: string, kind: ToastKind = 'info', seconds = 3): void {
    this.show(text, kind, seconds);
    this.renderUi();
  }

  /** Queues a station action for the next simulation step; returns the reqId. */
  sendAction(action: GameActionInput): number {
    const reqId = this.nextReqId++;
    this.actions.push({ ...action, reqId } as GameAction);
    const ok = this.successText(action);
    if (ok) this.pendingOk.set(reqId, () => this.successText(action) ?? ok);
    return reqId;
  }

  /** Toast after a successful action (crafting, repairs). */
  private successText(action: GameActionInput): string | null {
    switch (action.type) {
      case 'craft':
        return tx().crafting.crafted(partName(action.key), action.count);
      case 'repair':
        return tx().service.repaired;
      case 'templateSave':
        return tx().fleet.templates.saved(action.name);
      case 'courierSend': {
        const q = courierOffer(this.sim.state, action.from, action.to, action.resources, action.parts);
        return q ? tx().goals.toasts.courierSent(q.time) : null;
      }
      default:
        return null;
    }
  }

  private get docked(): boolean {
    return this.sim.state.player.dock.mode === 'docked';
  }

  private dockedStation(): StationDef | null {
    const dock = this.sim.state.player.dock;
    return dock.mode === 'docked' ? this.sim.station(dock.stationId) : null;
  }

  private setTab(tab: StationTab): void {
    const station = this.dockedStation();
    // also keeps tab 8 (Development, M4c) closed away from the home station
    if (station && !tabEnabled(tab, station)) return;
    // the dock camera leaves a home module ("Show") with the Development tab
    if (tab !== 'development') this.home.leave();
    this.stationUi.tab = tab;
    if (tab !== 'shipyard') this.panDrag = null;
    this.renderUi();
  }

  // -------------------------------------------------------------------------
  // shipyard

  /** Switches the hub to the Shipyard tab of the docked station and returns its editor (null: no shipyard here). */
  private openShipyard(): ShipyardEditor | null {
    const station = this.dockedStation();
    if (!station?.services.shipyard) return null;
    const yard = this.yardFor(station);
    if (this.stationUi.tab !== 'shipyard') this.setTab('shipyard');
    return yard;
  }

  /** Editor for the station where the ship is docked (created when the shipyard is first opened). */
  private yardFor(station: StationDef): ShipyardEditor {
    if (this.yard?.stationId !== station.id) {
      const sim = this.sim;
      this.yard = new ShipyardEditor({
        stationId: station.id,
        ship: () => ({ grid: sim.state.player.grid, hp: sim.state.player.hp }),
        inventory: () => stationStorage(sim.state, station.id).parts,
        context: () => withLockReasons(sim.state, shipyardContext(sim.state, station)),
        blueprint: () => sim.state.player.blueprint,
      });
    }
    return this.yard;
  }

  /** Is the editor open (Shipyard tab while docked)? */
  private get yardOpen(): boolean {
    return this.docked && this.stationUi.tab === 'shipyard' && this.yard !== null;
  }

  private yardDo(fn: (yard: ShipyardEditor) => void): void {
    if (!this.yard) return;
    fn(this.yard);
    this.renderUi();
  }

  /** Restore to design (M3.8): the draft becomes the blueprint; a toast says what changed. */
  private yardRestoreDesign(yard: ShipyardEditor | null = this.yard): void {
    if (!yard || yard.prompt || yard.pendingCommit !== null) return;
    const plan = yard.restoreDesign();
    if (!plan) this.show(() => tx().flight.restore.nothing, 'info', 3);
    else if (plan.unplaced > 0) this.show(() => `${tx().flight.restore.drafted(plan.missing - plan.unplaced, plan.repaired)} · ${tx().flight.restore.unplaced(plan.unplaced)}`, 'error', 6);
    else if (plan.skippedRepairs > 0) this.show(() => tx().flight.restore.drafted(plan.missing, 0, tx().flight.restore.repairsSkipped(plan.skippedRepairs)), 'info', 6);
    else this.show(() => tx().flight.restore.drafted(plan.missing, plan.repaired), 'ok', 5);
    this.renderUi();
  }

  private yardCommit(): void {
    const yard = this.yard;
    if (!yard || yard.pendingCommit !== null || yard.prompt) return;
    const view = yard.view();
    if (!view.canCommit || !view.dirty) return;
    yard.pendingCommit = this.sendAction(view.commit);
    this.renderUi();
  }

  private yardCancel(): void {
    const yard = this.yard;
    if (!yard) return;
    if (yard.dirty) yard.prompt = 'cancel';
    else this.setTab('overview');
    this.renderUi();
  }

  /** F / the Undock button – with an unconfirmed draft it asks first. */
  private requestUndock(): void {
    if (this.yard?.prompt) return;
    if (this.yard?.dirty) {
      this.yard.prompt = 'undock';
      this.renderUi();
      return;
    }
    this.sendAction({ type: 'undock' });
  }

  private yardPrompt(confirm: boolean): void {
    const yard = this.yard;
    const prompt = yard?.prompt;
    if (!yard || !prompt) return;
    this.audio.click();
    if (prompt === 'stale') {
      if (confirm) {
        const changes = yard.rebase();
        this.show(() => tx().shipyard.ui.rebased(changes), 'info', 3);
      }
      else yard.discard();
    } else if (!confirm) {
      yard.prompt = null;
    } else {
      yard.discard();
      if (prompt === 'undock') this.sendAction({ type: 'undock' });
      else this.setTab('overview');
    }
    this.renderUi();
  }

  private yardPointer(kind: 'down' | 'move' | 'up' | 'leave', e: PointerEvent): void {
    const yard = this.yard;
    if (!yard || yard.prompt) return;
    const before = yard.scene();
    const cell = this.renderer.hangarCellAt(e.clientX, e.clientY);
    switch (kind) {
      case 'down':
        // focus away from the palette – Enter should confirm the draft, not press the button again
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
          e.preventDefault();
          this.panDrag = { x: e.clientX, y: e.clientY, moved: false };
        } else if (cell && (e.button === 0 || e.button === 2)) {
          const error = yard.pointerDown(cell, e.button === 2 ? 'right' : 'left', e.altKey, e.button === 0 && e.shiftKey);
          if (!error) this.audio.click();
        }
        break;
      case 'move':
        if (this.panDrag) {
          const dx = e.clientX - this.panDrag.x;
          const dy = e.clientY - this.panDrag.y;
          if (this.panDrag.moved || Math.hypot(dx, dy) > 4) {
            if (e.shiftKey) this.renderer.hangar.panBy(dx, dy);
            else this.renderer.hangar.orbitBy(dx, dy);
            this.panDrag = { x: e.clientX, y: e.clientY, moved: true };
          }
        } else {
          yard.setHover(cell);
        }
        break;
      case 'up':
        if (this.panDrag) {
          if (!this.panDrag.moved && cell) yard.eyedrop(cell);
          this.panDrag = null;
        } else {
          const error = yard.pointerUp();
          if (error) this.show(() => placementMessage(error), 'error', 2);
        }
        break;
      case 'leave':
        if (!yard.dragging && !this.panDrag) yard.setHover(null);
        break;
    }
    this.yardPointerAt = kind === 'leave' ? null : { x: e.clientX, y: e.clientY };
    if (yard.scene() !== before || kind !== 'move') this.renderUi();
  }

  /** Double click in the hangar: the whole connected piece under the cursor (Shipyard 2.0). */
  private yardDoubleClick(e: MouseEvent): void {
    const yard = this.yard;
    if (!yard || yard.prompt || e.button !== 0 || e.altKey) return;
    const cell = this.renderer.hangarCellAt(e.clientX, e.clientY);
    if (!cell) return;
    yard.selectPiece(cell);
    this.renderUi();
  }

  /** Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z), Ctrl+A (select every part) in the shipyard editor. */
  private onEditorShortcut(e: KeyboardEvent): void {
    if (!this.yardOpen || this.yard?.prompt || this.fleet.modalOpen || !(e.ctrlKey || e.metaKey)) return;
    const yard = this.yard!;
    if (e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) yard.redo();
      else yard.undo();
      this.renderUi();
    } else if (e.code === 'KeyY') {
      e.preventDefault();
      yard.redo();
      this.renderUi();
    } else if (e.code === 'KeyA' && !yard.dragging) {
      e.preventDefault();
      yard.selectAll();
      this.renderUi();
    }
  }

  /** Editor keys (new presses without Ctrl). Returns true if it consumed the key. */
  private yardKey(code: string): boolean {
    const yard = this.yard;
    if (!yard) return false;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    const shift = this.keyboard.pressed.has('ShiftLeft') || this.keyboard.pressed.has('ShiftRight');
    if (digit) yard.selectHotkey(hotkeyNumber(Number(digit[1]), shift || this.keyboard.wasShifted(code)));
    else if (code === letterKey('r')) yard.rotate(shift ? -1 : 1);
    else if (code === letterKey('t')) yard.toggleTier();
    else if (code === letterKey('v')) yard.toggleLayers();
    else if (code === letterKey('k')) this.yardHelp = !this.yardHelp;
    // M = mirror mode, Shift+M = mirror the selection (docked only – in flight M is the map)
    else if (code === letterKey('m')) this.showNotice(shift || this.keyboard.wasShifted(code) ? yard.mirrorSelection() : yard.toggleMirror());
    else if (code === letterKey('c')) this.renderer.hangar.resetView();
    else if (code === 'Home') this.renderer.hangar.topView();
    else if (code === 'Delete' || code === 'Backspace') yard.removeHovered();
    else if (code === 'Enter' || code === 'NumpadEnter') {
      // Enter on a button presses it – confirm only outside of controls
      if ((document.activeElement as HTMLElement | null)?.tagName !== 'BUTTON') this.yardCommit();
    } else if (code === 'Escape') {
      if (yard.cancelDrag()) this.panDrag = null;
      else if (yard.selected) yard.select(null);
      else if (!yard.clearSelection()) this.yardCancel();
    } else if (code === 'Tab') {
      // Tab / Shift+Tab = the armour shape in hand or under the cursor (SL2 E2; KeyboardState keeps the focus)
      const notice = yard.cycleShape(shift || this.keyboard.wasShifted(code) ? -1 : 1);
      if (notice) this.showNotice(notice);
    } else return false;
    this.renderUi();
    return true;
  }

  private stepSimulation(): void {
    const inStation = this.sim.state.player.dock.mode !== 'flying';
    // when docked, F means undocking (an action), not docking
    if (this.docked && this.pending.has(letterKey('f'))) this.requestUndock();
    const cmd = buildCommand(this.keyboard.pressed, this.pending, { aim: this.aim, mining: this.pointer.right, firing: this.pointer.left });
    if (inStation) {
      cmd.dock = false;
      cmd.tractor = false;
    }
    // toll answer (M3.6): Y pays, X refuses – only while pirates demand it
    if (!inStation && this.sim.state.pirates.toll) {
      if (this.pending.has(letterKey('y'))) cmd.toll = 'pay';
      else if (this.pending.has(letterKey('x'))) cmd.toll = 'refuse';
    }
    // the toll buttons in the comm panel
    const tollAnswer = this.comms.takeTollAnswer();
    if (tollAnswer && !inStation && this.sim.state.pirates.toll) cmd.toll ??= tollAnswer;
    // scanner only in flight and with neither the journal nor the map open
    if (inStation || this.explore.journalOpen || this.mapOpen) cmd.scan = false;
    cmd.actions = this.actions;
    this.actions = [];
    // a note saved or deleted on the open map shows (and can be clicked) at once, not at the next 10 Hz redraw
    if (this.mapOpen && cmd.actions.some((a) => a.type === 'mapNoteSet' || a.type === 'mapNoteDelete')) this.uiTimer = 0;
    if (this.scuttlePending) {
      cmd.scuttle = true;
      this.scuttlePending = false;
    }
    this.pending = new Set();
    this.syncBlackBox();
    const events = this.sim.step(cmd);
    if (cmd.actions.length > 0 || events.length > 0) this.simEpoch++;
    this.renderer.onSimEvents(events);
    this.training.onEvents(events);
    // the communicator speaks first: events it voiced lose their toast
    this.spoken = this.comms.onStep(this.sim.state, events, { toastOf: (e) => this.toastText(e), dockStation: () => this.clampStation() });
    const unspoken = this.spoken.size > 0 ? events.filter((e) => !this.spoken.has(e)) : events;
    this.trackCombat(events);
    this.sites.onEvents(events);
    this.guild.onEvents(events);
    let sold = 0;
    const blastCtx = { stationName: (id: string) => this.stationName(id) };
    const blast = blastToast(events, blastCtx);
    this.blastStep = blast !== null;
    for (const event of events) {
      if (event.type === 'creditsChanged' && event.reason === 'sell') sold += event.delta;
      this.handleEvent(event);
      this.audio.event(event);
    }
    this.blastStep = false;
    if (sold > 0) {
      const total = sold;
      this.show(() => tx().messages.sold(formatCredits(total)), 'ok', 2);
    }
    // the reactor blast and what it took, as one toast (separate ones would replace each other at once)
    if (blast) this.show(rebuilt(blast.text, () => blastToast(events, blastCtx)?.text), blast.kind, blast.seconds);
    // discovery (M3.5b): pulse (animation) and the single most important toast of the step
    if (events.length > 0) {
      this.explore.onEvents(events, this.clock, this.sim.state);
      this.mining.onEvents(events, this.clock);
      // a lost part (M3.8) keeps the toast – it is the one thing the player must not miss
      const lostPart = events.some((e) => e.type === 'partsLost');
      const state = this.sim.state;
      const ore = lostPart ? null : this.mining.toast(state, events);
      const found = lostPart ? null : this.explore.toast(state, unspoken);
      const site = lostPart ? null : this.sites.toast(state, unspoken);
      const pirate = lostPart ? null : this.pirates.toast(state, unspoken);
      const guild = lostPart ? null : this.guild.toast(state, unspoken);
      const t = pirate ?? guild ?? site ?? (found?.urgent ? found : null) ?? (ore?.urgent ? ore : null) ?? found ?? ore;
      if (t) {
        // the winning source says it again in a new language (the mining toast counts its nugget
        // toasts, so it keeps its text)
        const again =
          t === pirate ? () => this.pirates.toast(state, unspoken) : t === guild ? () => this.guild.toast(state, unspoken) : t === site ? () => this.sites.toast(state, unspoken) : t === found ? () => this.explore.toast(state, unspoken) : null;
        this.show(again ? rebuilt(t.text, () => again()?.text) : t.text, t.kind, t.seconds);
      }
      if (lostPart) this.uiTimer = 0;
    }
    this.hooks.afterStep?.(events);
  }

  /** The toast text an event would show (the radio's factual note when a person says it). */
  private toastText(e: SimEvent): string | null {
    const state = this.sim.state;
    if (e.type === 'dockRejected') return dockRejectedText(e, playerDockRules(state));
    return this.pirates.toast(state, [e])?.text ?? this.guild.toast(state, [e])?.text ?? this.sites.toast(state, [e])?.text ?? this.explore.toast(state, [e])?.text ?? this.career.toast(state, e)?.text ?? this.home.toast(state, e)?.text ?? null;
  }

  /** The station whose dock clamp the ship is at (who answers a docking request). */
  private clampStation(): StationDef | null {
    const { player, world } = this.sim.state;
    return checkDock(player.body, player.props.boundingRadius, world.stations(), playerDockRules(this.sim.state)).station;
  }

  /** Hits, lost parts and alerts for the combat HUD. */
  private trackCombat(events: readonly SimEvent[]): void {
    this.hits.push(events, this.sim.state, this.clock);
    this.threatArrows.push(events, this.clock);
    const lost: number[] = [];
    for (const e of events) {
      if (e.type === 'partDestroyed' && e.ref === 'player') lost.push(e.partId);
      else if (e.type === 'projectileHit' && e.ref === 'player') {
        if (e.target === 'ship') this.hullHit = { seq: (this.hullHit?.seq ?? 0) + 1, at: this.clock };
        // show the hit at once, not at the next redraw (a burst of hits shares one early redraw)
        this.uiTimer = Math.min(this.uiTimer, Math.max(0, this.lastUiAt + HIT_REDRAW_GAP - this.clock));
      } else if (e.type === 'enemyAlert') {
        this.alertUntil = this.clock + ALERT_TIME;
        this.uiTimer = 0;
      }
    }
    if (lost.length > 0) this.blackBoxTrack.lose(lost);
    // parts torn off in this step (without partDestroyed) – the grid already has a new version
    this.syncBlackBox();
  }

  /** Silhouette track for the black box – reads the ship only when the grid changes (not every step). */
  private syncBlackBox(): void {
    const player = this.sim.state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) return;
    this.blackBoxTrack.sync(player.gridVersion, () => silhouette(this.sim.state));
  }

  /** A new flight (dock, rebuild, respawn after death) – the combat track starts over. */
  private resetCombatTrack(): void {
    this.blackBoxTrack.reset();
    this.workshopLamps.reset();
    this.hits.clear();
    this.threatArrows.clear();
    this.alertUntil = -Infinity;
    this.hullHit = null;
  }

  /** Black box for the death card: the silhouette with the lost parts and the order they fell in. */
  blackBox(): { silhouette: Silhouette; order: number[]; total: number } {
    return this.blackBoxTrack.snapshot(silhouette(this.sim.state));
  }

  private stationName(id: string): string {
    const s = this.sim.station(id);
    return s ? formatStationName(s) : id;
  }

  private handleEvent(event: SimEvent): void {
    this.fleet.onEvent(event);
    this.home.onEvent(event, this.spoken.has(event));
    switch (event.type) {
      case 'cargoFull':
        this.show(() => tx().messages.cargoFull);
        break;
      case 'outOfFuel':
        this.show(() => tx().messages.outOfFuel, 'error');
        break;
      case 'partBlast':
        // the player's large reactor blew up (M4c): the renderer shakes the camera, this says what happened
        // (in a simulation step the blast toast comes after the loop, merged with the losses: blastToast)
        if (event.ref === 'player' && !this.blastStep) this.show(() => tx().home.workshop.blast(tx().parts.largeReactor, event.damage), 'error', 4);
        break;
      case 'exhaustBurn':
        // a covered nozzle burns a part (design 3.4.2): when it starts and at every quarter of its HP
        this.show(() => tx().flight.exhaust.burning(partName(event.key), Math.round(event.hp * 100)), 'error', 4);
        break;
      case 'stationDiscovered': {
        const s = this.sim.station(event.stationId);
        const depth = s ? sectorInfoAt(this.sim.state.seed, s.pos.x, s.pos.y).depth : 0;
        if (s) this.show(() => tx().messages.discovered(formatStationName(s), depth), 'ok', 4);
        break;
      }
      case 'playerDestroyed':
        this.pointer.release();
        break;
      case 'dockRejected':
        if (!this.spoken.has(event)) {
          const rules = playerDockRules(this.sim.state);
          this.show(() => dockRejectedText(event, rules), 'error');
        }
        break;
      case 'docked':
        this.stationUi.tab = 'overview';
        this.mapOpen = false;
        this.yard = null;
        this.resetCombatTrack();
        this.pointer.release();
        this.renderUi();
        break;
      case 'berthed':
        // the derelict terminal opens at once; the map closes behind it
        this.mapOpen = false;
        this.pointer.release();
        this.renderUi();
        break;
      case 'berthLeft':
        // a click in the terminal ("Undock") must not carry over into flight as a shot
        this.pointer.release();
        this.renderUi();
        break;
      case 'undocked':
        this.home.leave();
        this.resetCombatTrack();
        this.stationUi.welcome = false;
        this.yard = null;
        this.panDrag = null;
        // a click in the hub (the Undock button) must not carry over into flight as a shot
        this.pointer.release();
        this.renderUi();
        break;
      case 'salvaged':
      case 'salvageStored':
      case 'cargoSpilled':
      case 'partsLost': {
        // a blast step says its losses in the blast toast
        if (this.blastStep && (event.type === 'partsLost' || event.type === 'cargoSpilled')) break;
        const toast = combatToast(event, { stationName: (id) => this.stationName(id) });
        if (toast) this.show(rebuilt(toast.text, () => combatToast(event, { stationName: (id) => this.stationName(id) })?.text), toast.kind, toast.seconds);
        break;
      }
      case 'shipRebuilt':
        this.resetCombatTrack();
        this.yard?.committed();
        this.show(() => (event.cost > 0 ? tx().shipyard.rebuilt(formatCredits(event.cost)) : tx().shipyard.rebuiltFree), 'ok', 3);
        this.renderUi();
        break;
      case 'shipSwitched':
      case 'shipCreated':
        // another ship is active: a fresh flight track and a draft over the new ship
        this.resetCombatTrack();
        this.yard?.discard();
        this.renderUi();
        break;
      case 'guildLoan':
        // the hull changed while docked: a fresh flight track, and the shipyard draft resyncs itself
        this.resetCombatTrack();
        this.show(() => tx().messages.guildLoan(this.stationName(event.stationId), formatParts(event.parts)), 'info', 10);
        this.renderUi();
        break;
      case 'towed': {
        const name = this.stationName(event.stationId);
        this.show(() => (event.cost > 0 ? tx().messages.towed(name, formatCredits(event.cost)) : tx().messages.towedFree(name, event.cargoLost)), event.cargoLost ? 'error' : 'info', 5);
        break;
      }
      case 'actionResult': {
        const okText = this.pendingOk.get(event.reqId);
        this.pendingOk.delete(event.reqId);
        if (this.yard && event.reqId === this.yard.pendingCommit) {
          if (event.ok) break; // the toast and the new base come with shipRebuilt
          this.yard.pendingCommit = null;
          if (event.reason === 'staleDraft') this.yard.prompt = 'stale';
          else this.show(tx().shipyard.ui.failed(this.commitFailure(event.reason, event.detail)), 'error', 5);
          this.renderUi();
          break;
        }
        if (!event.ok) this.show(() => tx().actionErrors[event.reason], 'error');
        else if (okText) this.show(okText, 'ok', 3);
        break;
      }
      default: {
        // career (M3.5a): contracts, reputation, captains, courier, "First Day"
        const state = this.sim.state;
        const t = this.spoken.has(event) ? null : this.career.toast(state, event);
        if (t) this.show(rebuilt(t.text, () => this.career.toast(state, event)?.text), t.kind, t.seconds);
        break;
      }
    }
  }

  /** Readable reason for a failed commit (detail = design or placement error code). */
  private commitFailure(reason: keyof CoreTexts['actionErrors'], detail?: string): string {
    const message = this.yard?.view().messages.find((m) => m.code === detail);
    if (message) return message.text;
    if (detail && detail in tx().shipyard.placement) return placementMessage(detail as keyof CoreTexts['shipyard']['placement']);
    return tx().actionErrors[reason];
  }

  /** Shows a toast; pass a text builder (ToastText) so a live language switch re-says it. */
  private show(text: ToastText, kind: ToastKind = 'info', seconds = 3): void {
    this.toast.show(text, kind, seconds, this.clock);
  }

  private showNotice(n: MirrorNotice): void {
    this.show(n.text, n.kind, n.kind === 'error' ? 4 : 2);
  }

  /**
   * The paint shop's preview on the active ship (M4c, render-only): only while docked on the Development
   * tab with the paint shop selected and the active ship picked – otherwise none, so a tab change, an
   * undock or another module ends it.
   */
  private paintPreview(): PaintId | null {
    if (!this.docked || this.stationUi.tab !== 'development') return null;
    const preview = this.home.paintPreview(this.sim.state);
    return preview?.shipId === this.sim.state.fleet.active.id ? preview.paint : null;
  }

  private handleKeys(): void {
    if (this.paused || this.discardKeys) {
      // input belongs to the overlay (pause, settings); discard its presses after it closes
      this.keyboard.consumeJustPressed();
      this.discardKeys = this.paused;
      return;
    }
    for (const code of this.keyboard.consumeJustPressed()) {
      // a fleet modal (Hangar, Templates) owns the keyboard; an Esc that got past it closes it
      if (this.fleet.modalOpen) {
        if (code === 'Escape') {
          this.fleet.closeModals();
          this.renderUi();
        }
        continue;
      }
      if (code === letterKey('n')) {
        const muted = this.audio.toggleMute();
        this.show(() => (muted ? tx().messages.muted : tx().messages.unmuted), 'info', 2);
      }
      // the training's skip confirmation takes Esc (M3.7)
      if (this.training.onKey(code)) continue;
      // the comm log: L toggles it, Esc closes it
      if (!(this.docked && this.yard?.prompt) && this.comms.onKey(code, letterKey)) continue;
      // career: return card, Objectives (G), Storages (I), Esc closes the panel (M3.5a)
      if (!(this.docked && this.yard?.prompt) && this.career.onKey(code, letterKey)) continue;
      // discovery (M3.5b): journal (J), map layers (1–6), map back to the ship (C)
      if (!this.docked && this.explore.onKey(code, letterKey, this.mapOpen)) continue;
      if (!this.docked && this.mapOpen && code === letterKey('c')) {
        this.mapRecenter++;
        this.renderUi();
        continue;
      }
      if (this.docked) {
        // an open dialog handles its keys itself (Esc, Enter on buttons)
        if (this.yard?.prompt) continue;
        if (this.yardOpen && this.yardKey(code)) continue;
        const digit = /^Digit([1-8])$/.exec(code);
        if (digit) this.setTab(STATION_TABS[Number(digit[1]) - 1]!);
        if (code === 'Escape') {
          if (this.stationUi.tab === 'overview') this.hooks.onPauseRequest?.();
          else this.setTab('overview');
        }
      } else {
        if (code === letterKey('m')) this.mapOpen = !this.mapOpen;
        if (code === letterKey('k')) {
          this.helpOpen = !this.helpOpen;
          this.helpTouched = true;
          this.renderUi();
        }
        if (code === 'Escape') {
          // berthed at a derelict, Esc leaves the berth like the terminal's "Undock" (never pauses)
          if (this.sites.berthed(this.sim.state)) this.sites.leave();
          // linked to a convoy trader (an Esc the trade window did not catch) unlinks, like its "Undock"
          else if (this.guild.linked(this.sim.state)) this.guild.unlink();
          else if (this.mapOpen) this.mapOpen = false;
          else this.hooks.onPauseRequest?.();
        }
      }
      this.pending.add(code);
    }
  }

  private readonly tick = (now: number): void => {
    const dt = this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.clock += dt;

    this.handleKeys();
    if (!this.docked && !this.paused) {
      this.flightTime += dt;
      if (!this.helpTouched && this.helpOpen && this.flightTime > HELP_AUTO_COLLAPSE) this.helpOpen = false;
    }
    this.aim = this.renderer.screenToSim(this.pointer.x, this.pointer.y) ?? this.aim;
    this.renderer.showHangar(this.yardOpen ? this.yard!.scene() : null);
    this.renderer.setPaintPreview(this.paintPreview());
    if (this.yardOpen) this.driveHangarCamera(dt);

    if (this.paused || this.career.resumeOpen) {
      // the scene is still while paused (also under the return card) – an occasional redraw is enough
      // (window resize), saves the GPU
      this.pausedRedraw -= dt;
      if (this.pausedRedraw <= 0) {
        this.pausedRedraw = PAUSED_REDRAW;
        this.renderer.render(1, 0, this.aim);
      }
    } else {
      const alpha = this.loop.advance(dt);
      this.updateCollision();
      this.updateDockReadout();
      this.renderer.miningHeld = this.pointer.right && !this.docked;
      this.renderer.setScanView(this.explore.scanView(this.clock, this.flight.reducedMotion));
      this.renderScene(alpha, dt);
      this.audio.frame(this.sim.state);
    }

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) this.renderUi();
    // world labels follow their objects every frame (the UI redraws 10×/s)
    this.positionCallouts();
    this.positionReticle();
    if (this.uiHeldUntilFrame) {
      this.uiHeldUntilFrame = false;
      this.uiElement.style.visibility = '';
    }

    this.frame = requestAnimationFrame(this.tick);
  };

  /**
   * The 3D frame. Under the open map (flight) the scene is not drawn: the canvas keeps its last frame,
   * the layers and the camera step at MAP_SCENE_INTERVAL with the time gathered meanwhile; a resize (the
   * canvas is cleared) draws once.
   */
  private renderScene(alpha: number, dt: number): void {
    const rect = this.layout.rect;
    if (!this.mapOpen || this.docked) {
      this.mapSceneDt = 0;
      this.sceneDrawnRect = rect;
      this.renderer.render(alpha, dt, this.aim);
      return;
    }
    this.mapSceneDt += dt;
    const resized = rect !== this.sceneDrawnRect;
    if (!resized && this.mapSceneDt < MAP_SCENE_INTERVAL) return;
    const sceneDt = Math.min(this.mapSceneDt, 0.25);
    this.mapSceneDt = 0;
    this.sceneDrawnRect = rect;
    this.renderer.render(alpha, sceneDt, this.aim, resized);
  }

  private renderUi(): void {
    this.uiTimer = UI_INTERVAL;
    this.lastUiAt = this.clock;
    // the redraw may replace the world labels and the reticle: positionCallouts looks them up again
    this.calloutEls = null;
    this.reticleEl = undefined;
    const toast = this.toast.current(this.clock);
    const dock = this.sim.state.player.dock;
    const station = dock.mode === 'docked' ? this.sim.station(dock.stationId) : null;
    const state = this.sim.state;
    const hud = station ? null : this.hudData();
    const trainingCtx = this.trainingContext(hud);
    this.training.update(state, { mapOpen: trainingCtx.mapOpen, objectivesOpen: this.career.panel === 'objectives' });
    if (!station) this.flightHudWarm = true;
    else if (!this.flightHudWarm) this.warmFlightHudLater();
    // the shipyard editor takes the whole screen: the radio holds its messages meanwhile
    this.comms.setVisible(!this.yardOpen, state);
    renderGameUi(
      this.uiElement,
      {
        hud,
        hub: station ? this.hubData(station) : null,
        toast,
        career: this.career.uiData(state, this.clock, !station),
        explore: { journal: this.explore.journal(state) },
        training: this.training.uiData(state, trainingCtx, this.clock, this.yardOpen ? (x, y) => this.hangarCellOnUi(x, y) : null),
        comms: this.comms.uiData(() => (station ? null : this.pirates.hud(state).toll), station !== null),
        templates: station ? this.fleet.templatesData(state) : null,
        events: station ? null : this.sites.chips(state),
        terminal: station ? null : this.sites.terminal(state),
        workshop: station ? null : this.workshopLamps.view(state, this.clock),
        // M4d: the Guild chips and the convoy trade window (open exactly while linked)
        guild: station ? null : this.guild.status(state),
        convoyTrade: station ? null : this.guild.trade(state),
      },
      this.uiHandlers,
    );
    // the radio sits on the flight console's top edge (`--cm-bottom`, kept by the ResizeObserver)
    this.layout.watchConsole(station ? null : this.uiElement.querySelector('.hud-console'));
    // the hub and the editor view: their rects come from the ResizeObserver, not a layout read right
    // after the patch (a forced reflow at 10 Hz)
    this.hubLayout.watch(station ? this.uiElement.querySelector('.hub') : null, station ? this.uiElement.querySelector('[data-testid="yard-view"]') : null);
  }

  /**
   * warmFlightHud in an idle moment once the game runs – not on the way to its first frame (perf O14,
   * ~0.13 s at 4× CPU); a game that undocks first has no use for it.
   */
  private warmFlightHudLater(): void {
    this.flightHudWarm = true;
    const run = (): void => {
      if (this.lifetime.signal.aborted || this.sim.state.player.dock.mode !== 'docked') return;
      if (this.frame === null) whenIdle(run, 1000);
      else this.warmFlightHud();
    };
    whenIdle(run, 1000);
  }

  /**
   * A game that starts docked mounts the flight HUD once off screen, inside the start-up frame: the
   * first undock then finds its code compiled and its fonts and styles warm. A cold first mount cost
   * ~110 ms of script plus ~90 ms of style and layout at 4× CPU (audit 2026-10-16, issue #8). The
   * copy lives only within this call, so nothing else ever sees it. Its data come from pure views of the
   * state, not from hudData() (that one advances the HUD's trackers and notices).
   */
  private warmFlightHud(): void {
    this.flightHudWarm = true;
    const host = this.uiElement.parentElement;
    if (!host) return;
    const box = document.createElement('div');
    box.className = this.uiElement.className;
    box.setAttribute('aria-hidden', 'true');
    box.inert = true;
    box.style.visibility = 'hidden';
    host.append(box);
    const state = this.sim.state;
    const { player } = state;
    const props = player.props;
    const hud: HudData = {
      speed: 0,
      dampers: player.dampers,
      fuel: player.fuel,
      fuelMax: props.fuelCapacity,
      energy: player.energy,
      energyMax: props.batteryCapacity,
      cargo: { ...player.cargo },
      cargoMax: props.cargoCapacity,
      ring: ringIndexAt(length(player.body.pos)),
      pos: player.body.pos,
      angle: player.body.angle,
      radar: { range: this.career.radarRange(state), contacts: [], stations: [], threats: [] },
      map: CLOSED_MAP,
      message: null,
      credits: state.credits,
      prompt: null,
      nearest: null,
      arrow: null,
      helpOpen: this.helpOpen,
      combat: { view: combatHudView(state), hits: [], now: this.clock, hullHit: null, threat: null },
    };
    try {
      renderGameUi(box, { hud, hub: null, toast: null }, this.uiHandlers);
      // style and layout now, while the copy is in the document
      box.querySelector('.hud-console')?.getBoundingClientRect();
    } finally {
      clearGameUi(box);
      box.remove();
    }
  }

  /** The UI situation the training guidance depends on (M3.7). */
  private trainingContext(hud: HudData | null): TrainingContext {
    const state = this.sim.state;
    const docked = this.docked;
    const yard = this.yardOpen ? this.yard : null;
    return {
      tab: docked ? this.stationUi.tab : null,
      craftKey: this.stationUi.craftKey,
      yard: yard ? { selected: yard.selected, rot: yard.rot, grid: yard.draft.grid, dirty: yard.dirty } : null,
      mapOpen: this.mapOpen && !docked,
      inCombat: state.combat.enemies.some((e) => e.ai.mode === 'attack'),
      // in flight the goal is the training target: the panel shows its live distance and direction
      target: hud?.goal ? { distance: hud.goal.distance, bearing: hud.goal.bearing } : null,
    };
  }

  /**
   * A hangar cell on the UI layer (px) – the training's cell suggestions: the floor centre (where the
   * pointer ray picks it), a size and the projected half-cell axes, so it matches the cell in any view.
   */
  private hangarCellOnUi(x: number, y: number): { x: number; y: number; size: number; ax: number; ay: number; bx: number; by: number } {
    const root = this.layout.rect;
    const q = this.renderer.hangarCellQuad(x, y);
    // a little inside the cell, like the 3D cell marks
    const k = 0.9;
    const size = Math.max(12, 2 * Math.sqrt(Math.abs(q.ax * q.by - q.ay * q.bx)) - 4);
    return { x: q.x - root.left, y: q.y - root.top, size, ax: q.ax * k, ay: q.ay * k, bx: q.bx * k, by: q.by * k };
  }

  /**
   * Hangar camera per frame: held keys (Q/E orbit, PgUp/PgDn tilt, arrows pan), and while the camera
   * moves the cell under a still pointer is picked again and the UI over the hangar follows.
   */
  private driveHangarCamera(dt: number): void {
    const hangar = this.renderer.hangar;
    if (this.paused || this.career.resumeOpen) return;
    if (!this.yard?.prompt) hangar.cameraKeys(dt, hangarCameraKeys(this.keyboard.pressed));
    if (!hangar.cameraMoved) return;
    const yard = this.yard;
    const at = this.yardPointerAt;
    if (yard && !yard.prompt && at && !this.panDrag) yard.setHover(this.renderer.hangarCellAt(at.x, at.y));
    // the UI over the hangar (ghost label, training cells) follows at most every HANGAR_UI_GAP (audit
    // 2026-10-17 P7: every frame cost ~4 ms of script per frame at 4× CPU); the tick's `uiTimer -= dt` comes after
    this.uiTimer = Math.min(this.uiTimer, Math.max(0, this.lastUiAt + HANGAR_UI_GAP - this.clock) + dt);
  }

  private yardData(yard: ShipyardEditor): ShipyardUiData {
    yard.sync();
    const ghost = yard.ghost();
    let ghostLabel: ShipyardUiData['ghostLabel'] = null;
    const text = yard.ghostMessage();
    if (ghost && text && this.yardRect) {
      const p = this.renderer.hangarCellToScreen(ghost.x, ghost.y, 1.1);
      ghostLabel = { text, x: p.x - this.yardRect.left, y: p.y - this.yardRect.top };
    }
    let mirrorLabel: ShipyardUiData['mirrorLabel'] = null;
    const copy = yard.mirrorScene()?.ghost;
    const mirrorText = yard.mirrorGhostMessage();
    if (copy && mirrorText && this.yardRect) {
      const p = this.renderer.hangarCellToScreen(copy.x, copy.y, 1.1);
      mirrorLabel = { text: mirrorText, x: p.x - this.yardRect.left, y: p.y - this.yardRect.top };
    }
    const station = this.dockedStation();
    return {
      view: yard.view(),
      tier: yard.tier,
      selected: yard.selected,
      rot: yard.rot,
      layers: yard.layers,
      ghostLabel,
      mirror: { ...yard.mirror },
      mirrorLabel,
      focusCode: yard.focus?.code ?? null,
      committing: yard.pendingCommit !== null,
      grab: yard.hoveredPart() !== null,
      selection: yard.selection.length,
      // SL2 E2: the shape in hand, the ghost's points / HP / arc tooltip and the key help
      shape: yard.shape,
      shapeTip:
        ghost && ghost.movingId === undefined
          ? (shapeTip(yard.draft.grid, { key: ghost.key, x: ghost.x, y: ghost.y, rot: ghost.rot, shape: ghost.shape ?? null })?.text ?? null)
          : null,
      // an empty hand over a placed armour plate: what Tab reshapes it to (points, HP, arcs)
      reshape: this.yardReshape(yard),
      help: this.yardHelp,
      bow: this.renderer.hangar.bowAngle(),
      restore: yard.restoreInfo(),
      info: this.selectedPartInfo(yard),
      ...(station ? { header: this.fleet.header(this.sim.state, station) } : {}),
    };
  }

  private yardReshape(yard: ShipyardEditor): ReshapePreview | null {
    const id = yard.hoveredPart();
    return id === null ? null : reshapePreview(yard.draft.grid, id);
  }

  private selectedPartInfo(yard: ShipyardEditor): PartInfoView | null {
    const key = yard.selected;
    if (!key) return null;
    // SL2 E2: the effect counts the armour shape in hand (a wedge is half a plate)
    const shape = hasShapes(key) ? yard.shape : null;
    // the texts follow a live language switch: the locale is part of the key
    const locale = getLocale();
    const c = this.yardInfo;
    if (c && c.draft === yard.draft && c.key === key && c.shape === shape && c.locale === locale) return c.info;
    const info = partInfo(yard.draft.grid, key, { draft: true, shape });
    this.yardInfo = { draft: yard.draft, key, shape, locale, info };
    return info;
  }

  private hubData(station: StationDef): StationHubData {
    const { player, credits } = this.sim.state;
    const key = this.hubViewKey(station);
    const autoBuy = this.stationUi.repairAutoBuy;
    const repair = this.stationUi.tab === 'service' ? this.hubRepair.get([...key, autoBuy], () => ({ view: repairView(this.sim.state, station, autoBuy), rowOk: this.repairRowOk(station) })) : null;
    const storage = stationStorage(this.sim.state, station.id);
    return {
      station,
      name: formatStationName(station),
      // the header shows the depth of the station's sector (sectors 1b), not its ring
      depth: sectorInfoAt(this.sim.state.seed, station.pos.x, station.pos.y).depth,
      credits,
      cargo: { ...player.cargo },
      cargoMax: player.props.cargoCapacity,
      refined: { ...player.refined },
      shipGrid: player.grid,
      fuel: player.fuel,
      fuelMax: player.props.fuelCapacity,
      energy: player.energy,
      energyMax: player.props.batteryCapacity,
      storage: { resources: { ...storage.resources }, parts: { ...storage.parts } },
      prices: this.hubPrices.get([station.ring, station.priceJitter], () => priceList(station)),
      emergency: emergencyFuelAvailable(this.sim.state, station),
      ui: { ...this.stationUi },
      partsMarket: this.hubMarket.get([...key, this.stationUi.partTier], () => partsMarketRows(station, storage.parts, credits, this.stationUi.partTier, (k) => lockReason(this.sim.state, k))),
      crafting: this.stationUi.tab === 'crafting' ? this.hubCrafting.get([...key, this.stationUi.craftTier], () => craftingRows(this.sim.state, station, this.stationUi.craftTier)) : [],
      repair: repair?.view ?? NO_REPAIRS,
      repairRowOk: repair?.rowOk ?? {},
      shipyard: this.stationUi.tab === 'shipyard' && station.services.shipyard ? this.yardData(this.yardFor(station)) : null,
      yardPrompt: this.yard?.prompt ?? null,
      yardDirty: this.yard?.dirty ?? false,
      yardLoose: this.yard?.prompt ? this.yard.view().disconnected.length : 0,
      ...this.career.hubExtras(this.sim.state, station, this.stationUi.tab, key),
      archive: this.stationUi.tab === 'archive' ? this.explore.archive(this.sim.state) : null,
      // the Development tab's view model (M4c; memoised – the same object while nothing changed)
      development: this.stationUi.tab === 'development' ? this.home.data(this.sim.state) : null,
      designGap: this.stationUi.tab === 'overview' ? this.hubGap.get([...key, player.gridVersion, player.blueprint], () => designGap(this.sim.state, station)) : null,
      coveredNozzles: this.stationUi.tab === 'overview' ? this.hubNozzles.get([this.sim.state, player.grid, player.gridVersion], () => coveredNozzles(this.sim.state)) : 0,
      ...this.fleet.hubExtras(this.sim.state, station, this.stationUi.tab === 'overview', key),
    };
  }

  /**
   * What the hub's views (the Board with its cartography, the hangar, the market, crafting and repair rows,
   * the design gap) are memoised on: the state and the station, every simulation step with player actions or
   * events, the game second (the minute counters, the board's 20-minute epoch), credits, the language, and
   * what may change without an event while docked: the fuel and the cargo (the on-board workshop) and the
   * escorts' progress (a departed convoy keeps going).
   */
  private hubViewKey(station: StationDef): readonly unknown[] {
    const state = this.sim.state;
    const { player } = state;
    let escorts = 0;
    for (const e of state.convoys.escorts.values()) escorts += e.progress;
    let cargo = 0;
    for (let i = 0; i < RESOURCE_IDS.length; i++) cargo += player.cargo[RESOURCE_IDS[i]!] * (i + 1);
    return [state, station.id, this.simEpoch, Math.floor(state.tick / 60), state.credits, getLocale(), player.fuel, cargo, escorts];
  }

  /** Can each damaged part be repaired separately? */
  private repairRowOk(station: StationDef): Record<number, boolean> {
    const out: Record<number, boolean> = {};
    for (const row of repairView(this.sim.state, station, this.stationUi.repairAutoBuy).rows) {
      out[row.id] = repairView(this.sim.state, station, this.stationUi.repairAutoBuy, [row.id]).all.ok;
    }
    return out;
  }

  /** Station definitions by id (deterministic from the seed – the HUD asks for them 10× per second). */
  private readonly stationDefs = new Map<string, StationDef | null>();
  /** Map data – recomputed only with the map open and on a newly explored chunk or station. */
  private mapCache: { explored: number; discovered: number; mined: number; data: HudData['map'] } | null = null;

  /** Station definition – from the active chunks, otherwise from the world hash. */
  private resolveStation = (id: string): StationDef | null => {
    let station = this.stationDefs.get(id);
    if (station === undefined) {
      station = this.sim.state.world.stations().find((s) => s.id === id) ?? stationById(this.sim.state.seed, id, this.sim.state.world.gen);
      this.stationDefs.set(id, station);
    }
    return station;
  };

  private mapData(): HudData['map'] {
    if (!this.mapOpen) return CLOSED_MAP;
    const state = this.sim.state;
    const world = state.world;
    const c = this.mapCache;
    // depleted rocks and newly assayed chunks (Mining 2.0) change the fields
    const mined = world.remainingById.size + state.mining.assayed.size * 100_000;
    let base: HudData['map'];
    if (c && c.explored === world.explored.size && c.discovered === world.discovered.size && c.mined === mined) base = c.data;
    else {
      const discovered = [...world.discovered].map(this.resolveStation).filter((s): s is StationDef => s !== null);
      base = {
        open: true,
        explored: [...world.explored],
        stations: discovered.map((s) => ({ pos: s.pos, name: formatStationName(s), kind: s.kind })),
        // remembered asteroid fields from explored chunks (10.8 "my trail")
        fields: asteroidFields(state.seed, world.explored, (id) => world.remainingById.get(id), state.mining.assayed),
      };
      this.mapCache = { explored: world.explored.size, discovered: world.discovered.size, mined, data: base };
    }
    // scanner signals and places change often – just a reference to the layers, the computation is cheap
    const sectors = this.sectors.map(state);
    return {
      ...base,
      discovery: this.explore.map(state),
      recenter: this.mapRecenter,
      pirates: this.pirates.map(state),
      sectors,
      // M4d: the Guild layer, the planned route (current security), the notes and the stale marks
      guild: this.guild.map(state, this.career.radarRange(state)),
      ...this.mapPlan.mapData(state, sectors),
    };
  }

  /** `window.__cinder.guild` (dev builds): the `debugGuild` command per helper. */
  private guildDevHooks(): GuildDevHooks {
    return {
      secure: (lane) => this.sendAction({ type: 'debugGuild', what: 'secure', lane }),
      watchNear: () => this.sendAction({ type: 'debugGuild', what: 'watch' }),
      convoyNear: () => this.sendAction({ type: 'debugGuild', what: 'convoy' }),
    };
  }

  /**
   * The cannon reticle follows the mouse every frame (its content changes with the UI redraw); the
   * element is looked up once per redraw and written only when the rounded position moved.
   */
  private positionReticle(): void {
    if (this.reticleEl === undefined) {
      this.reticleEl = this.uiElement.querySelector<HTMLElement>('[data-reticle]');
      this.reticleAt.x = NaN;
    }
    const el = this.reticleEl;
    if (!el) return;
    const rect = this.layout.rect;
    const x = Math.round(this.pointer.x - rect.left + 16);
    const y = Math.round(this.pointer.y - rect.top + 14);
    if (x === this.reticleAt.x && y === this.reticleAt.y) return;
    this.reticleAt.x = x;
    this.reticleAt.y = y;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  /**
   * Moves the world labels to the objects' current positions (without a Preact redraw). The elements
   * are looked up once per UI redraw; a label's translate, visibility, sides and shift are written only
   * when they changed (audit 2026-10-17 P8) – the same pixels without a style change per label and frame.
   */
  private positionCallouts(): void {
    if (this.callouts.length === 0) return;
    const rect = this.layout.rect;
    const els = (this.calloutEls ??= this.callouts.map((c) => {
      const el = this.uiElement.querySelector<HTMLElement>(`[data-callout-id="${CSS.escape(c.id)}"]`);
      return el ? { el, x: NaN, y: NaN, hidden: null, flip: null, below: null, shift: NaN } : null;
    }));
    for (let i = 0; i < this.callouts.length; i++) {
      const dom = els[i];
      if (!dom) continue;
      const el = dom.el;
      const p = this.renderer.projectToScreen(this.callouts[i]!.world);
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (rx !== dom.x || ry !== dom.y) {
        dom.x = rx;
        dom.y = ry;
        el.style.transform = `translate(${rx}px, ${ry}px)`;
      }
      // a label near the screen edge goes to the other side of the anchor, off screen it hides
      const side = calloutSide(x, y, rect, this.calloutAvoid);
      const hidden = p.behind || !side;
      if (hidden !== dom.hidden) {
        dom.hidden = hidden;
        el.style.visibility = hidden ? 'hidden' : '';
      }
      const flip = side?.flip ?? false;
      if (flip !== dom.flip) {
        dom.flip = flip;
        el.classList.toggle('is-flipped', flip);
      }
      const below = side?.below ?? false;
      if (below !== dom.below) {
        dom.below = below;
        el.classList.toggle('is-below', below);
      }
      const shift = side?.shift ?? 0;
      if (shift !== dom.shift) {
        dom.shift = shift;
        applyCalloutShift(el, shift);
      }
    }
  }

  private hudData(): HudData {
    const state = this.sim.state;
    this.sectors.update(state);
    const { player, world } = state;
    const props = player.props;
    const pos = player.body.pos;
    const radarRange = this.career.radarRange(state);
    // stale marks (M4d S6): what the radar shows now is live, what drops out of sight fades on the map
    this.mapPlan.observe(state, radarRange);
    // only rocks within the radar range become contacts – the grade lookup is skipped for the rest
    const sources: RadarSource[] = [];
    for (const a of world.asteroids()) {
      const dx = a.pos.x - pos.x;
      const dy = a.pos.y - pos.y;
      if (dx * dx + dy * dy > radarRange * radarRange) continue;
      sources.push({ pos: a.pos, radius: world.radiusOf(a), resource: a.resource, rich: this.mining.radarRich(state, a) });
    }
    const flying = player.dock.mode === 'flying';
    let hint: string | null = null;
    let hintTone: HudData['messageTone'] = 'bad';
    if (player.dock.mode === 'docking') {
      hint = playerDockRules(state).maxAngle === null ? tx().docking.autoApproach : tx().docking.latch;
      hintTone = 'info';
    } else if (towAvailable(player)) {
      const quote = towQuote(state);
      const name = formatStationName(quote.station);
      const cost = formatCredits(quote.cost);
      if (player.fuel <= 0) hint = quote.free ? tx().messages.noFuelTowFree(name) : tx().messages.noFuelTow(name, cost);
      else hint = quote.free ? tx().messages.noEnginesTowFree(name) : tx().messages.noEnginesTow(name, cost);
    }

    const check = checkDock(player.body, props.boundingRadius, world.stations(), playerDockRules(state));
    // berthed at a derelict (M4b) the terminal is open, linked to a convoy trader (M4d) its trade window:
    // no F prompts, no arrows to fly by
    const berthed = this.sites.berthed(state) || this.guild.linked(state);
    // a trader's trade port first (the sim tries the convoy link first on F), then a derelict clamp, a station
    const dock = flying ? (this.guild.prompt(state) ?? this.sites.prompt(state) ?? (check.station && this.dockReadout ? dockPrompt(check, formatStationName(check.station)) : null)) : null;
    // F at a survey point / stranded ship (M3.5a), a cache or a ship in distress (M3.5b) takes precedence
    // over a distant station
    const prompt = berthed ? null : ((flying && dock?.kind !== 'ok' ? (this.career.prompt(state) ?? this.explore.prompt(state) ?? this.pirates.prompt(state)) : null) ?? dock);
    const goal = flying ? this.career.arrowTarget(state) : null;
    const nearest = nearestDiscoveredStation(state.seed, world.discovered, pos, this.resolveStation);
    const nearestName = formatStationName(nearest);
    const distance = Math.hypot(nearest.pos.x - pos.x, nearest.pos.y - pos.y);
    const rect = this.layout.rect;
    const arrowPos = edgeArrow(this.renderer.projectToScreen(nearest.pos), { width: rect.width, height: rect.height }, 48);
    const combat = combatHudView(state);
    // after destruction the grid stays whole (the HP of destroyed parts is cleared) – show the black box
    if (player.destroyed) combat.silhouette = this.blackBox().silhouette;
    const threats = buildThreatContacts(
      // a dormant graveyard sleeper (M4b) plays a wreck on the radar until analysed ("active reactor") or awake
      state.combat.enemies.map((e) => ({ pos: e.body.pos, angle: e.body.angle, attacking: e.ai.mode === 'attack', dormant: sleeperDisguised(state, e) })),
      state.combat.wrecks.map((w) => ({ pos: w.body.pos, loot: !lootEmpty(w.loot) })),
      pos,
      radarRange,
    );
    const scanArrows = flying ? this.explore.scanArrows(this.clock, this.flight.reducedMotion, (p) => this.renderer.projectToScreen(p), { width: rect.width, height: rect.height }) : null;
    const enemyArrows = this.mapOpen ? [] : this.threatArrows.view(state, (p) => this.renderer.projectToScreen(p), rect, this.clock);
    // the station arrow; a planned route that ends at that station merges into it (its ETA in the label)
    const route = flying ? this.mapPlan.routeMark(state) : null;
    const stationShown = arrowPos !== null && flying && !prompt && !berthed;
    const routeAtStation = stationShown && route !== null && Math.hypot(route.pos.x - nearest.pos.x, route.pos.y - nearest.pos.y) <= ROUTE_AT_STATION;
    const stationLabel = `${nearestName} ${formatInt(distance)} ${tx().hud.distanceUnit}`;
    const stationArrow = stationShown
      ? { ...arrowPos, label: routeAtStation && route.seconds !== null ? tx().guild.route.station(stationLabel, formatClock(route.seconds)) : stationLabel }
      : null;
    const goalHud = this.goalHud(goal, rect, pos);
    const objectiveArrow = goalHud ? goalEdgeArrow(goalHud) : null;
    const marks =
      flying && !this.mapOpen && !berthed
        ? this.navArrowMarks(state, rect, routeAtStation ? null : route, stationArrow, objectiveArrow)
        : null;
    // the world labels (callouts) keep clear of the edge arrows and their labels and of the top HUD panels
    this.calloutAvoid = [...[...enemyArrows, ...(scanArrows ?? []), ...(marks ?? [])].map(edgeArrowBox), ...hudPanelBoxes(rect)];
    return {
      speed: length(player.body.vel),
      dampers: player.dampers,
      fuel: player.fuel,
      fuelMax: props.fuelCapacity,
      energy: player.energy,
      energyMax: props.batteryCapacity,
      cargo: { ...player.cargo },
      cargoMax: props.cargoCapacity,
      // the HUD accent follows the depth of the ship's sector (the ring circle only before the first look)
      ring: this.sectors.depth(state) ?? ringIndexAt(length(player.body.pos)),
      pos: player.body.pos,
      angle: player.body.angle,
      radar: {
        range: radarRange,
        contacts: buildRadarContacts(sources, pos, radarRange),
        stations: buildStationContacts(world.stations(), pos, radarRange),
        threats,
      },
      map: this.career.withMapTargets(state, this.mapData()),
      message: hint,
      messageTone: hintTone,
      helpOpen: this.helpOpen,
      mining: miningHud({ lasers: props.lasers.length, heat: player.heat, beams: flying ? player.beams : [] }, this.clock, this.miningMemo),
      miningPops: this.mining.activePops(this.clock),
      combat: {
        view: combat,
        hits: this.hits.indicators(this.clock),
        now: this.clock,
        hullHit: this.hullHit ? { seq: this.hullHit.seq, age: this.clock - this.hullHit.at } : null,
        threat: threatMode(combat.threat, this.clock, this.alertUntil),
      },
      credits: state.credits,
      prompt,
      nearest: { name: nearestName, distance },
      arrow: stationArrow,
      // the training's step panel takes the band's place (one onboarding, no duplicate line)
      objectives: flying && !trainingActive(state) ? this.career.band(state) : null,
      objectiveArrow,
      goal: goalHud,
      scan: flying || player.destroyed ? this.explore.scanHud(state, this.clock) : null,
      discovery: { radar: this.explore.radar(state, radarRange), callouts: this.calloutItems(state, rect) },
      onToggleLayer: this.toggleMapLayer,
      // the comm panel answers the toll when the radio is on
      pirates: flying ? { ...this.pirates.hud(state), ...(this.comms.showsToll ? { toll: null } : {}) } : null,
      reticle: flying && !this.mapOpen && !berthed ? this.pirates.reticle(state, this.aim) : null,
      radarPirates: this.pirates.radar(state, radarRange),
      collision: this.collision ? { time: this.collision.time, urgency: this.collision.urgency, dampersOff: !player.dampers } : null,
      scanArrows,
      enemyArrows,
      sector: this.sectors.badge(state),
      sectorNotice: flying ? this.sectors.noticeData(state) : null,
      radarSectors: this.sectors.radar(state, radarRange),
      // M4d: Guild Watch and convoy ships on the radar, the route / notes / convoy / relay marks, the map planner
      radarGuild: this.guild.radar(state, radarRange),
      navArrows: marks,
      mapPlan: this.mapPlan.handlers,
    };
  }

  /**
   * M4d flight marks (edge arrows out of view, pins in view): the planned route, the map notes within
   * `NOTES.flightRange` (setting "Markers in flight"), the nearest open convoy and the known Guild relays.
   * Their arrows and labels keep off the HUD panels and off the station and goal arrows (placed as Hud
   * places them).
   */
  private navArrowMarks(
    state: Simulation['state'],
    rect: DOMRect,
    route: RouteMark | null,
    stationArrow: (EdgeArrow & { label: string }) | null,
    objectiveArrow: (EdgeArrow & { label: string }) | null | undefined,
  ): EdgeArrowMark[] | null {
    const inputs: EdgeArrowInput<NavMark>[] = [];
    const add = (pos: Vec2, item: NavMark) => {
      const p = this.renderer.projectToScreen(pos);
      inputs.push({ screen: { x: p.x - rect.left, y: p.y - rect.top, behind: p.behind }, item });
    };
    if (route) add(route.pos, { key: 'route', kind: 'route', title: tx().guild.route.title, distance: route.distance, seconds: route.seconds });
    const ship = state.player.body.pos;
    for (const n of this.mapPlan.noteMarks(state, this.flight.notesInFlight ?? true)) {
      add(n.pos, { key: `note:${n.id}`, kind: 'note', icon: n.icon, title: n.text, distance: Math.hypot(n.pos.x - ship.x, n.pos.y - ship.y) });
    }
    for (const m of this.guild.navMarks(state)) add(m.pos, m.mark);
    if (inputs.length === 0) return null;
    const view = { width: rect.width, height: rect.height };
    const placed = placeHudArrows(stationArrow, objectiveArrow, view, this.helpOpen);
    const hudArrows = [placed.station, placed.goal].filter((a): a is EdgeArrow & { label: string } => a !== null);
    return navArrows(inputs, view, { avoid: [...flightHudRects(view), ...hudArrows.map(hudArrowRect)], obstacles: hudArrows.map(hudArrowFootprint) });
  }

  /** Callout labels with screen positions (the 2 nearest objects, the object under analysis). */
  private calloutItems(state: Simulation['state'], rect: DOMRect): CalloutItem[] {
    // pirate callouts (hulks, fortress, beacon) take precedence; at most two labels
    // (the label of an object under analysis keeps its progress bar)
    const explore = this.explore.callouts(state);
    const analysing = explore.filter((c) => c.progress !== undefined);
    // pirate callouts first, then Mining 2.0 (nuggets, the mined rock's grade, rich rocks)
    const mine = [...this.pirates.callouts(state).sort((a, b) => a.dist - b.dist), ...this.mining.callouts(state)].filter((c) => !analysing.some((a) => a.id === c.id));
    const ids = new Set(mine.map((c) => c.id));
    // the training's buoy or rock first (M3.7)
    const all = [...this.training.callouts(state), ...analysing, ...mine.map(({ dist: _d, ...c }) => c), ...explore.filter((c) => !ids.has(c.id) && c.progress === undefined)];
    // at most two labels and never two on top of each other (anchors too close on screen)
    const picked: { c: CalloutData; x: number; y: number }[] = [];
    for (const c of all) {
      if (picked.length >= 2) break;
      const p = this.renderer.projectToScreen(c.world);
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      // an anchor off screen has no label (it would be cut off by the edge)
      if (p.behind || !calloutSide(x, y, rect)) continue;
      if (picked.some((q) => Math.abs(q.x - x) < 230 && Math.abs(q.y - y) < 90)) continue;
      picked.push({ c, x, y });
    }
    this.callouts = picked.map((q) => q.c);
    return this.callouts.map((c) => {
      const p = this.renderer.projectToScreen(c.world);
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      const side = calloutSide(x, y, rect, this.calloutAvoid);
      return {
        id: c.id,
        x,
        y,
        title: c.title,
        detail: c.detail,
        keys: c.keys,
        action: c.action,
        tone: c.tone,
        flip: side?.flip ?? false,
        below: side?.below ?? false,
        shift: side?.shift ?? 0,
        ...(c.progress !== undefined ? { progress: c.progress } : {}),
      };
    });
  }

  /**
   * The goal (contract, "First day", training target): a ring on it while on screen, an edge arrow while
   * off screen, its distance and the bearing from the ship (`goalMark`).
   */
  private goalHud(goal: { pos: Vec2; label: string; distance: number } | null, rect: DOMRect, ship: Vec2): GoalHud | null {
    if (!goal) return null;
    const p = this.renderer.projectToScreen(goal.pos);
    const s = this.renderer.projectToScreen(ship);
    const { mark, bearing } = goalMark({ x: p.x - rect.left, y: p.y - rect.top, behind: p.behind }, { x: s.x - rect.left, y: s.y - rect.top }, { width: rect.width, height: rect.height });
    return { label: goal.label, distance: goal.distance, bearing, mark };
  }
}

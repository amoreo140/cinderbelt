// Discovery in the game layer (M3.5b): the scanner in the HUD (pulse, analysis, bonuses, storm), signals
// and places on the radar and map (layers 10.8), Callout labels in the world, the journal (J), the Archive
// tab and event toasts. Game.ts only calls these methods – the discovery UI logic lives here.
import { ANOMALIES, BUFF_KINDS, CACHE, type BuffKind } from '../../data/poi';
import { DISTRESS } from '../../data/events';
import { ECHOES } from '../../data/echoes';
import { SCANNER } from '../../data/scanner';
import { LOAD_MAX_PARTS } from '../../data/salvage';
import type { ArchiveNodeId } from '../../data/archive';
import { VARIANTS } from '../../data/variants';
import { partKey } from '../../data/parts';
import { tx } from '../../i18n';
import type { ScanKind } from '../../sim/discovery/types';
import { lootEmpty } from '../../sim/combat/wrecks';
import { distressNear } from '../../sim/discovery/events';
import { stormAt } from '../../sim/events/storms';
import { shellHp } from '../../sim/discovery/giants';
import { discoveryInteraction } from '../../sim/discovery/interact';
import { echoSites, poiById, poisNear } from '../../sim/discovery/poi';
import { ANALYZE_TICKS, findTarget, pulseCooldownTicks, radarRangeOf, trapRevealed } from '../../sim/discovery/scanner';
import type { SignalKind } from '../../sim/discovery/types';
import type { GameActionInput } from '../../sim/commands';
import { length, sub, type Vec2 } from '../../sim/math/vec2';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { GIANT_RADIUS, GIANT_SHELL_HP } from '../../data/poi';
import { formatCredits, formatGrade } from '../../ui/format';
import type { ToastKind } from '../../ui/GameUi';
import type { DockPrompt } from '../../ui/stationHud';
import { archiveData, type ArchiveData } from './archiveView';
import { journalData, journalTitle, type JournalData, type JournalTab, JOURNAL_TABS } from './journalView';
import { mapLandmarks, type MapLandmark } from './landmarksUi';
import { partBaseName } from './names';
import { findColor, SCAN_WAVE, ScanFeedback, type ScanFindKind, type ScanView } from './scanFeedback';
import { flightHudRects, placeEdgeArrows } from '../../ui/edgeArrows';
import type { EdgeArrowMark } from '../../ui/EdgeArrowLayer';
import { sectorKnowledge } from '../../sim/regions/knowledge';
import { sectorIdAt, sectorInfo } from '../../sim/regions/sectors';
import { sectorName } from '../../ui/sectors/sectorText';
import { chartTrade } from '../../sim/charts/charts';
import { mapSurveyMarks, SURVEY_CALLOUT_RANGE, SURVEY_RANGE, surveyKey, surveyMarksNear } from '../sectors/surveyUi';
import { trainingMapNotes } from '../training/trainingMap';
import { buildSiteContacts, type SiteContact } from '../../ui/radar';
import { cometMapData } from '../sites/cometMapView';
import { currentReadout, isSiteReadoutKey, readoutInReach, type ScanReadout } from '../sites/scanReadout';
import { siteMapData, siteRadarInput, type MapSite } from '../sites/siteMapView';
import type { CometMapData } from '../sites/types';

const sectorLabelOf = (state: SimState, id: string): string => {
  const info = sectorInfo(state.seed, id);
  return info ? sectorName(info.name) : id;
};

const TICKS = 60;

/** Map layers (10.8); M4d adds the Guild layer (`convoys`: convoys, Guild relays, Watch ships) and `notes`. */
export type MapLayer = 'stations' | 'signals' | 'places' | 'contracts' | 'fields' | 'sectors' | 'convoys' | 'notes';
/** The layers in toolbar order (key = position + 1). */
export const MAP_LAYERS: readonly MapLayer[] = ['stations', 'signals', 'places', 'contracts', 'fields', 'sectors', 'convoys', 'notes'];
/**
 * Layers without anything to draw yet: hidden from the map toolbar and its digit keys until their drawing
 * lands (M4d T0 added `convoys` and `notes` here, T12 drew them and emptied the set). Pending layers go
 * last in `MAP_LAYERS`, so the other keys keep their digits.
 */
export const PENDING_MAP_LAYERS: ReadonlySet<MapLayer> = new Set<MapLayer>();

export type PlaceKind = SignalKind;

export interface ScanHudData {
  /** 0..1 pulse charge. */
  charge: number;
  ready: boolean;
  cooldown: number;
  /** Analysis: progress 0..1 and the target's name. */
  analysis: { label: string; progress: number } | null;
  /** Sequence number of the last pulse (restarts the CSS animation), null = none recently. */
  pulse: number | null;
  dataFund: number;
  buffs: { kind: BuffKind; name: string; effect: string; seconds: number }[];
  storm: boolean;
  /** M4b: what the scanner tells about a site object (relay charge, derelict, comet, sleeper). */
  readout?: ScanReadout | null;
}

export interface RadarSignal {
  /** Position relative to the ship (u). */
  x: number;
  y: number;
  radius: number;
  kind: SignalKind;
}

export interface RadarPlace {
  x: number;
  y: number;
  kind: PlaceKind;
  /** Not analysed yet. */
  fresh: boolean;
}

/** A survey point on the radar (relative to the ship, sectors §4.1). */
export interface RadarSurvey {
  x: number;
  y: number;
  done: boolean;
}

/** A survey point on the map. */
export interface MapSurvey {
  pos: Vec2;
  done: boolean;
}

/** A training note on the map (Guild Training step 8, §6.6): a callout at a world point. */
export interface MapNote {
  id: string;
  pos: Vec2;
  title: string;
  detail: string;
  tone: 'info' | 'warn' | 'ok';
}

export interface MapPlace {
  pos: Vec2;
  kind: PlaceKind;
  label: string;
  fresh: boolean;
}

export interface MapDiscovery {
  layers: Record<MapLayer, boolean>;
  signals: { pos: Vec2; radius: number; kind: SignalKind; label: string }[];
  places: MapPlace[];
  /** Far landmarks the player has seen (readability §2). */
  landmarks?: MapLandmark[];
  /** Survey points of the current and the known sectors that are not Charted (sectors §4.1). */
  survey?: MapSurvey[];
  /** Guild Training step 8: what the map shows (§6.6). */
  notes?: MapNote[];
  /** M4b: known derelict stations (with relay power) and ship graveyards. */
  sites?: MapSite[];
  /** M4b: known comets – pass track, nucleus while passing, the next pass near the player. */
  comets?: CometMapData[];
}

export interface CalloutData {
  id: string;
  /** A point in the world (Game projects it every frame). */
  world: Vec2;
  title: string;
  detail: string | null;
  keys: string | null;
  action: string | null;
  tone: 'info' | 'warn' | 'ok';
  /** Analysis progress 0..1 (only on the object being analysed). */
  progress?: number;
}

export interface ExploreUiData {
  journal: JournalData | null;
}

export interface ExploreHandlers {
  closeJournal(): void;
  setJournalTab(tab: JournalTab): void;
  selectEntry(id: string): void;
  toggleLayer(layer: MapLayer): void;
  selectNode(id: ArchiveNodeId): void;
  buyNode(id: ArchiveNodeId): void;
  click(): void;
}

export interface ExploreToast {
  text: string;
  kind: ToastKind;
  seconds: number;
  /** Progress the player must not miss (a survey point, a charted sector, a chart trade) – over the pulse's ore toast. */
  urgent?: boolean;
}

export interface ExploreUiHost {
  state(): SimState;
  send(action: GameActionInput): void;
  render(): void;
  click(): void;
}

const placeName = (kind: PlaceKind): string => (kind === 'echo' ? tx().discovery.scanKinds.echo : tx().discovery.scanKinds[kind]);

/** Which find leads a merged arrow: rich ore is what the pulse is mostly for. */
const FIND_PRIORITY: Record<ScanFindKind, number> = { rich: 3, cache: 2, echo: 2, signal: 1 };

function findLabel(f: ScanView['finds'][number]): string {
  if (f.kind === 'rich') return tx().discovery.scanFinds.rich(f.resource ? tx().mining.symbols[f.resource] : '', formatGrade(f.grade ?? 0));
  if (f.kind === 'signal') return f.signal ? tx().discovery.signalKinds[f.signal] : tx().discovery.scanKinds.cache;
  return tx().discovery.scanKinds[f.kind];
}

export class ExploreUi {
  journalOpen = false;
  journalTab: JournalTab = 'knowledge';
  private selectedEntry: string | null = null;
  selectedNode: ArchiveNodeId | null = null;
  readonly layers: Record<MapLayer, boolean> = { stations: true, signals: true, places: true, contracts: true, fields: true, sectors: true, convoys: true, notes: true };
  private pulseSeq = 0;
  private pulseAt = -Infinity;
  /** The last pulse's wave and finds (R6): rings in the world, arrows at the screen edge. */
  private readonly feedback = new ScanFeedback();
  /** The last analysed site object (M4b): its readout stays by the scanner while it is in reach. */
  private readoutKey: string | null = null;
  readonly handlers: ExploreHandlers;

  constructor(private readonly host: ExploreUiHost) {
    this.handlers = {
      closeJournal: () => this.setJournal(false),
      setJournalTab: (tab) => {
        this.journalTab = tab;
        this.host.render();
      },
      selectEntry: (id) => {
        this.selectedEntry = id;
        this.host.render();
      },
      toggleLayer: (layer) => this.toggleLayer(layer),
      selectNode: (id) => {
        this.selectedNode = id;
        this.host.render();
      },
      buyNode: (id) => this.host.send({ type: 'archiveBuy', node: id }),
      click: () => this.host.click(),
    };
  }

  setJournal(open: boolean): void {
    this.journalOpen = open;
    this.host.render();
  }

  toggleLayer(layer: MapLayer): void {
    this.layers[layer] = !this.layers[layer];
    this.host.render();
  }

  /** A key for discovery; returns true if it was consumed. `mapOpen` = digits toggle the map layers. */
  onKey(code: string, letter: (l: string) => string, mapOpen: boolean): boolean {
    if (code === letter('j')) {
      this.setJournal(!this.journalOpen);
      return true;
    }
    if (this.journalOpen) {
      if (code === 'Escape') {
        this.setJournal(false);
        return true;
      }
      const digit = /^Digit([1-4])$/.exec(code);
      if (digit) {
        this.journalTab = JOURNAL_TABS[Number(digit[1]) - 1]!;
        this.host.render();
        return true;
      }
      return false;
    }
    if (mapOpen) {
      const digit = /^Digit([1-8])$/.exec(code);
      if (digit) {
        this.toggleLayer(MAP_LAYERS[Number(digit[1]) - 1]!);
        return true;
      }
    }
    return false;
  }

  /** Events of a step (start of the pulse animation; with the state also the pulse's finds). */
  onEvents(events: readonly SimEvent[], clock: number, state?: SimState): void {
    for (const e of events) {
      if (e.type === 'scanPulse') {
        this.pulseSeq++;
        this.pulseAt = clock;
      }
      if (e.type === 'analysisDone') this.readoutKey = isSiteReadoutKey(e.target) ? e.target : null;
    }
    if (state) this.feedback.onEvents(state, events, clock);
  }

  /** The pulse wave and the highlighted finds for the renderer (null = nothing to draw). */
  scanView(clock: number, reduced: boolean): ScanView | null {
    return this.feedback.view(clock, reduced);
  }

  /**
   * Edge arrows to the finds out of view (R6): coloured by kind like the rings, nearby arrows merge
   * with a count. `project` = a world point to view pixels (the renderer).
   */
  scanArrows(clock: number, reduced: boolean, project: (p: Vec2) => { x: number; y: number; behind?: boolean }, view: { width: number; height: number }): EdgeArrowMark[] | null {
    const v = this.feedback.view(clock, reduced);
    if (!v || v.finds.length === 0) return null;
    const placed = placeEdgeArrows(
      v.finds.map((f) => ({ screen: project(f.pos), item: f, priority: FIND_PRIORITY[f.kind] * 1000 - f.dist })),
      view,
      { margin: 34, avoid: flightHudRects(view), mergePx: 46, max: 6 },
    );
    if (placed.length === 0) return null;
    return placed.map((a) => {
      const f = a.items[0]!;
      return {
        key: f.id,
        x: a.x,
        y: a.y,
        angle: a.angle,
        color: findColor(f.kind),
        label: findLabel(f),
        count: a.items.length,
        alpha: Math.max(...a.items.map((i) => i.alpha)),
        small: f.kind !== 'rich',
        testId: `scan-find-arrow-${f.kind}`,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // HUD

  scanHud(state: SimState, clock: number): ScanHudData {
    const d = state.discovery;
    const full = Math.max(1, pulseCooldownTicks(state));
    const s = d.scanner;
    let analysis: ScanHudData['analysis'] = null;
    if (s.target) {
      const t = findTarget(state, s.target);
      if (t) analysis = { label: this.targetLabel(state, t.key, t.kind), progress: Math.min(1, s.held / ANALYZE_TICKS) };
    }
    return {
      charge: s.cooldown > 0 ? 1 - s.cooldown / full : 1,
      ready: s.cooldown <= 0,
      cooldown: Math.ceil(s.cooldown / TICKS),
      analysis,
      pulse: clock - this.pulseAt < SCAN_WAVE.seconds + 0.2 ? this.pulseSeq : null,
      dataFund: Math.floor(d.dataFund),
      buffs: BUFF_KINDS.flatMap((k) => {
        const b = d.buffs.find((x) => x.kind === k && x.until > state.tick);
        return b ? [{ kind: k, name: tx().discovery.buffs[k], effect: tx().discovery.buffEffect[k], seconds: Math.ceil((b.until - state.tick) / TICKS) }] : [];
      }),
      storm: state.player.dock.mode === 'flying' && stormAt(state, state.player.body.pos, state.tick),
      readout: this.readout(state),
    };
  }

  /** The site readout by the scanner (M4b); the pinned analysis goes once its object leaves the radar reach. */
  private readout(state: SimState): ScanReadout | null {
    if (this.readoutKey && !readoutInReach(state, this.readoutKey, radarRangeOf(state) + 40)) this.readoutKey = null;
    return currentReadout(state, this.readoutKey);
  }

  private targetLabel(state: SimState, key: string, kind: string): string {
    if (key.startsWith('echo:')) return tx().discovery.echoName(Number(key.slice(5)));
    if (key.startsWith('ast:')) return tx().discovery.scanKinds.asteroid;
    const poi = poiById(state.seed, key);
    if (poi?.kind === 'anomaly') return `${tx().discovery.scanKinds.anomaly} · ${tx().discovery.anomalies[poi.type]}`;
    return tx().discovery.scanKinds[kind as ScanKind] ?? kind;
  }

  /** Signals and places on the radar (relative to the ship). */
  radar(state: SimState, range: number): { signals: RadarSignal[]; places: RadarPlace[]; survey: RadarSurvey[]; sites: SiteContact[] } {
    const pos = state.player.body.pos;
    const d = state.discovery;
    // signals beyond radar range show on the rim (direction), closer ones as an uncertainty circle
    const signals = d.signals.map((s) => ({ x: s.pos.x - pos.x, y: s.pos.y - pos.y, radius: s.radius, kind: s.kind }));
    const places: RadarPlace[] = [];
    for (const p of poisNear(state.seed, pos, range + 20)) {
      if (p.kind === 'wreck') continue;
      if (p.kind === 'cache' && (!d.known.has(p.id) || d.opened.has(p.id))) continue;
      places.push({ x: p.pos.x - pos.x, y: p.pos.y - pos.y, kind: p.kind, fresh: !d.scanned.has(p.id) });
    }
    for (const e of echoSites(state.seed)) {
      if (length(sub(e.pos, pos)) <= range + 10) places.push({ x: e.pos.x - pos.x, y: e.pos.y - pos.y, kind: 'echo', fresh: !d.scanned.has(e.id) });
    }
    for (const ds of distressNear(state.seed, pos, range, state.tick)) {
      if (!d.opened.has(ds.id)) places.push({ x: ds.pos.x - pos.x, y: ds.pos.y - pos.y, kind: 'distress', fresh: true });
    }
    // survey points of sectors not Charted yet (§4.1)
    const survey = surveyMarksNear(state, pos, range).map((m) => ({ x: m.pos.x - pos.x, y: m.pos.y - pos.y, done: m.done }));
    // M4b world sites: derelicts with their relays, graveyards, live mines, comet nuclei
    const sites = buildSiteContacts(siteRadarInput(state, range), pos, range);
    return { signals, places, survey, sites };
  }

  /** Map layers: signals and discovered places. */
  map(state: SimState): MapDiscovery {
    const d = state.discovery;
    const places: MapPlace[] = [];
    for (const id of d.known) {
      if (id.startsWith('echo:')) {
        const site = echoSites(state.seed).find((s) => s.id === id);
        if (site) places.push({ pos: site.pos, kind: 'echo', label: tx().discovery.echoName(site.index), fresh: !d.scanned.has(id) });
        continue;
      }
      const poi = poiById(state.seed, id);
      if (!poi || (poi.kind === 'cache' && d.opened.has(id))) continue;
      const label = poi.kind === 'anomaly' ? tx().discovery.anomalies[poi.type] : poi.kind === 'wreck' ? tx().discovery.wreckClasses[poi.cls] : placeName(poi.kind);
      places.push({ pos: poi.pos, kind: poi.kind, label, fresh: !d.scanned.has(id) });
    }
    return {
      layers: { ...this.layers },
      signals: d.signals.map((s) => ({ pos: s.pos, radius: s.radius, kind: s.kind, label: tx().discovery.signalKinds[s.kind] })),
      places,
      landmarks: mapLandmarks(state.seed, state.world.explored, (id) => sectorKnowledge(state, id) !== 'uncharted'),
      survey: this.mapSurvey(state),
      notes: trainingMapNotes(state),
      sites: siteMapData(state),
      comets: cometMapData(state),
    };
  }

  private surveyCache: { key: string; points: MapSurvey[] } | null = null;

  /** Survey points for the map – recomputed only when a mark, a chart, a contract or the explored area changes. */
  private mapSurvey(state: SimState): MapSurvey[] {
    const pos = state.player.body.pos;
    const current = sectorIdAt(state.seed, pos.x, pos.y);
    const key = surveyKey(state, current);
    if (this.surveyCache?.key !== key) this.surveyCache = { key, points: mapSurveyMarks(state, current).map((m) => ({ pos: m.pos, done: m.done })) };
    return this.surveyCache.points;
  }

  /** At most 2 labels at the nearest objects (10.3 Callout) + the object being analysed. */
  callouts(state: SimState): CalloutData[] {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) return [];
    const pos = player.body.pos;
    const d = state.discovery;
    const range = Math.min(radarRangeOf(state), 220);
    const out: (CalloutData & { dist: number })[] = [];
    // the anchor of a big object (giant, anomaly) is on its rim towards the ship – the centre may be off screen
    const edge = (p: Vec2, r: number): Vec2 => {
      const d = sub(pos, p);
      const len = length(d);
      return len > r ? { x: p.x + (d.x / len) * r * 0.75, y: p.y + (d.y / len) * r * 0.75 } : p;
    };
    const add = (c: CalloutData, p: Vec2) => out.push({ ...c, dist: length(sub(p, pos)) });
    const scanHint = { keys: 'Tab', action: tx().discovery.callout.analyze };
    for (const p of poisNear(state.seed, pos, range)) {
      const fresh = !d.scanned.has(p.id);
      if (p.kind === 'anomaly') {
        add({ id: p.id, world: edge(p.pos, ANOMALIES[p.type].core), title: `${tx().discovery.scanKinds.anomaly} · ${tx().discovery.anomalies[p.type]}`, detail: tx().discovery.callout.anomalyBoon(tx().discovery.buffs[ANOMALIES[p.type].buff]), ...(fresh ? scanHint : { keys: null, action: null }), tone: 'info' }, p.pos);
      } else if (p.kind === 'giant') {
        const hp = shellHp(state, p.id);
        const detail = hp > 0 ? tx().discovery.callout.shell(Math.round((hp / GIANT_SHELL_HP) * 100)) : tx().discovery.callout.core;
        add({ id: p.id, world: edge(p.pos, GIANT_RADIUS), title: `${tx().discovery.scanKinds.giant}`, detail, ...(fresh ? scanHint : { keys: null, action: null }), tone: hp > 0 ? 'warn' : 'ok' }, p.pos);
      } else if (p.kind === 'cache' && d.known.has(p.id) && !d.opened.has(p.id)) {
        const near = length(sub(p.pos, pos)) - player.props.boundingRadius <= CACHE.openRange + 3;
        add({ id: p.id, world: p.pos, title: tx().discovery.scanKinds.cache, detail: null, keys: near ? 'F' : null, action: near ? tx().discovery.callout.open : null, tone: 'ok' }, p.pos);
      }
    }
    for (const w of state.combat.wrecks) {
      const dist = length(sub(w.body.pos, pos));
      if (dist > range || (lootEmpty(w.loot) && d.scanned.has(w.poi ?? `wreck#${w.id}`))) continue;
      // hulks and cut pieces have their own callouts (PiratesUi, M3.6)
      if (w.from || (w.dismantle && w.grid.parts.length > LOAD_MAX_PARTS)) continue;
      const key = w.poi ?? `wreck#${w.id}`;
      const preview = d.scanned.has(key) && w.contents ? { fragment: w.contents.fragment !== null || w.contents.shard } : null;
      const title = w.cls ? tx().discovery.wreckClasses[w.cls] : tx().discovery.scanKinds.wreck;
      const detail = preview === null ? tx().discovery.callout.unscanned : preview.fragment ? tx().discovery.callout.fragment : tx().discovery.callout.noFragment;
      add({ id: key, world: w.body.pos, title, detail, ...(d.scanned.has(key) ? { keys: null, action: null } : scanHint), tone: preview?.fragment ? 'ok' : 'info' }, w.body.pos);
    }
    for (const e of echoSites(state.seed)) {
      if (length(sub(e.pos, pos)) > range + 20) continue;
      add({ id: e.id, world: e.pos, title: tx().discovery.echoName(e.index), detail: ECHOES[e.index].gate === 'none' ? tx().discovery.callout.echo : tx().discovery.callout.echoDeep, ...(d.scanned.has(e.id) ? { keys: null, action: null } : scanHint), tone: 'info' }, e.pos);
    }
    // survey points (§4.1): "Survey point · Tab" within the pulse's reach, an approach hint a little beyond
    const surveyText = tx().sectors.survey;
    for (const m of surveyMarksNear(state, pos, SURVEY_CALLOUT_RANGE)) {
      if (m.done) continue;
      const near = length(sub(m.pos, pos)) <= SURVEY_RANGE;
      const sector = sectorInfo(state.seed, m.sector);
      add(
        {
          id: m.id,
          world: m.pos,
          title: surveyText.point,
          detail: near ? surveyText.detail(sector ? sectorName(sector.name) : '', m.marked, m.total) : surveyText.approach(`${SURVEY_RANGE} ${tx().hud.distanceUnit}`),
          keys: near ? 'Tab' : null,
          action: near ? surveyText.pulse : null,
          tone: near ? 'ok' : 'info',
        },
        m.pos,
      );
      // within the pulse's reach the point is what to do here: it goes before a POI it sits at
      if (near) out[out.length - 1]!.dist -= SURVEY_RANGE;
    }
    for (const ds of distressNear(state.seed, pos, range, state.tick)) {
      if (d.opened.has(ds.id)) continue;
      const trap = ds.kind === 'trap' && trapRevealed(state, ds.id);
      const detail = trap ? tx().discovery.callout.trap : tx().discovery.distressKinds[ds.kind];
      const it = discoveryInteraction(state);
      const near = it?.kind === 'distress' && it.id === ds.id;
      add({ id: ds.id, world: ds.pos, title: tx().discovery.scanKinds.distress, detail, keys: near ? 'F' : 'Tab', action: near ? tx().discovery.callout.help : tx().discovery.callout.analyze, tone: trap ? 'warn' : 'warn' }, ds.pos);
    }
    out.sort((a, b) => a.dist - b.dist);
    const picked = out.slice(0, 2);
    // the object being analysed always has a label (with progress)
    const s = d.scanner;
    if (s.target) {
      const t = findTarget(state, s.target);
      if (t) {
        const progress = Math.min(1, s.held / ANALYZE_TICKS);
        const existing = out.find((c) => c.id === t.key);
        const label = this.targetLabel(state, t.key, t.kind);
        const c = existing ?? { id: t.key, world: t.pos, title: label, detail: null, keys: null, action: null, tone: 'info' as const, dist: 0 };
        const merged = { ...c, progress, detail: tx().discovery.callout.analyzing(Math.round(progress * 100)) };
        return [merged, ...picked.filter((x) => x.id !== t.key)].slice(0, 2).map(({ dist: _d, ...x }) => x);
      }
    }
    return picked.map(({ dist: _d, ...x }) => x);
  }

  /** F prompt at a cache / a ship in distress. */
  prompt(state: SimState): DockPrompt | null {
    const it = discoveryInteraction(state);
    if (!it) return null;
    if (it.kind === 'cache') return { kind: 'ok', text: tx().discovery.prompts.cache };
    const ds = it.distress;
    if (ds.kind === 'fuel') return { kind: state.player.fuel >= ds.fuel ? 'ok' : 'warn', text: tx().discovery.prompts.fuel(ds.fuel) };
    return { kind: state.player.cargo.iron + 1e-9 >= DISTRESS.iron ? 'ok' : 'warn', text: tx().discovery.prompts.repair(DISTRESS.iron) };
  }

  // ---------------------------------------------------------------------------
  // journal and Archive

  journal(state: SimState): JournalData | null {
    return this.journalOpen ? journalData(state, this.journalTab, this.selectedEntry) : null;
  }

  archive(state: SimState): ArchiveData {
    return archiveData(state, this.selectedNode);
  }

  // ---------------------------------------------------------------------------
  // toasts

  /** The most important toast from a step's events (null = none). */
  toast(state: SimState, events: readonly SimEvent[]): ExploreToast | null {
    let best: (ExploreToast & { prio: number }) | null = null;
    const offer = (t: ExploreToast | null, base: number) => {
      // urgent progress (a survey point, a chart) goes before the step's other finds
      const prio = base + (t?.urgent ? 10 : 0);
      if (t && (!best || prio > best.prio)) best = { ...t, prio };
    };
    const o = tx().discovery.toasts;
    for (const e of events) {
      switch (e.type) {
        case 'scanPulse':
          offer({ text: e.found > 0 ? o.pulse(e.found) : o.pulseEmpty, kind: 'info', seconds: 2 }, 1);
          break;
        case 'scanFailed':
          offer({ text: e.reason === 'cooldown' ? o.cooldown(Math.ceil(state.discovery.scanner.cooldown / TICKS)) : e.reason === 'energy' ? o.energy : o.noTarget, kind: 'error', seconds: 2 }, 1);
          break;
        case 'analysisDone': {
          const label = this.targetLabel(state, e.target, e.kind);
          offer({ text: e.first ? (e.data > 0 ? o.analysed(label, e.data) : o.analysedNoData(label)) : o.analysedAgain(label), kind: 'ok', seconds: 3 }, 2);
          break;
        }
        case 'cacheLocated':
          offer({ text: o.cacheLocated, kind: 'ok', seconds: 4 }, 4);
          break;
        case 'cacheOpened':
          offer({ text: o.cacheOpened(formatCredits(e.credits)), kind: 'ok', seconds: 4 }, 4);
          break;
        case 'echoHeard':
          offer({ text: e.located ? o.echoLocated(e.echo) : o.echoHeard(e.echo, e.fixes), kind: 'info', seconds: 4 }, 3);
          break;
        case 'fragmentFound': {
          const name = partBaseName(partKey(VARIANTS[e.plan].base, 1, e.plan));
          offer({ text: e.duplicate ? o.fragmentDuplicate(name) : e.complete ? o.planDone(name) : o.fragment(name, e.count), kind: 'ok', seconds: 5 }, 6);
          break;
        }
        case 'keyItemFound':
          // the Resonator (M3.6) has its own toast in PiratesUi
          if (e.item === 'shard') offer({ text: o.keyItem(tx().discovery.archive.shard), kind: 'ok', seconds: 6 }, 7);
          break;
        case 'journalEntry':
          offer({ text: o.journal(journalTitle(e.id)), kind: 'info', seconds: 4 }, 5);
          break;
        case 'buffGained':
          offer({ text: o.buff(tx().discovery.buffs[e.buff], tx().discovery.buffEffect[e.buff], e.seconds), kind: 'ok', seconds: 4 }, 5);
          break;
        case 'giantBroken':
          offer({ text: o.giantBroken, kind: 'ok', seconds: 4 }, 5);
          break;
        case 'distressHeard':
          offer({ text: o.distress, kind: 'info', seconds: 4 }, 3);
          break;
        case 'distressResolved':
          offer({ text: o.distressDone(formatCredits(e.reward)), kind: 'ok', seconds: 4 }, 6);
          break;
        case 'distressAmbush':
          offer({ text: o.ambush, kind: 'error', seconds: 4 }, 8);
          break;
        case 'interactFailed':
          if (e.contractId === -1) offer({ text: e.reason === 'notEnoughIron' ? o.needIron(DISTRESS.iron) : o.needFuel, kind: 'error', seconds: 3 }, 6);
          break;
        case 'archiveBought':
          offer({ text: tx().discovery.archive.unlocked(tx().discovery.archive.nodes[e.node]), kind: 'ok', seconds: 4 }, 6);
          break;
        case 'atlasComplete':
          offer({ text: o.atlas(tx().discovery.atlas.collections[e.collection], e.data), kind: 'ok', seconds: 5 }, 6);
          break;
        case 'sectorCharted': {
          const info = sectorInfo(state.seed, e.id);
          const name = info ? sectorName(info.name) : '';
          // the Guild buys the chart of this sector (§4.1 toast): say so, the Board's Cartography sells it
          const sellable = chartTrade(state.seed, e.id) === 'player' && !state.regions.sold.has(e.id);
          offer({ text: sellable ? tx().sectors.survey.chartedSell(name, e.data) : o.sectorCharted(name, e.data), kind: 'ok', seconds: 5, urgent: true }, 6);
          break;
        }
        case 'surveyPointMarked': {
          const info = sectorInfo(state.seed, e.sector);
          offer({ text: tx().sectors.survey.marked(e.done, e.total, info ? sectorName(info.name) : ''), kind: 'ok', seconds: 3, urgent: true }, 4);
          break;
        }
        case 'chartSold':
          offer({ text: tx().sectors.charts.soldToast(sectorLabelOf(state, e.id), formatCredits(e.credits)), kind: 'ok', seconds: 4, urgent: true }, 6);
          break;
        case 'chartBought':
          // over the "station discovered" toasts that come with it
          offer({ text: tx().sectors.charts.boughtToast(sectorLabelOf(state, e.id)), kind: 'ok', seconds: 4, urgent: true }, 6);
          break;
        case 'chartGranted':
          offer({ text: tx().sectors.charts.grantedToast(sectorLabelOf(state, e.id)), kind: 'ok', seconds: 5, urgent: true }, 5);
          break;
        case 'ionStorm':
          offer({ text: e.active ? o.storm : o.stormOver, kind: e.active ? 'error' : 'info', seconds: 4 }, 5);
          break;
        default:
          break;
      }
    }
    if (!best) return null;
    const { prio: _p, ...t } = best as ExploreToast & { prio: number };
    return t;
  }
}

export { SCANNER };

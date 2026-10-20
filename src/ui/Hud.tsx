import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { RESOURCE_IDS, cargoUsed, type Cargo } from '../data/resources';
import { tx } from '../i18n';
import type { Vec2 } from '../sim/math/vec2';
import { CHUNK_SIZE } from '../sim/world/generate';
import { RINGS } from '../sim/world/rings';
import { formatAmount, formatInt } from './format';
import { splitKeyLabel, splitShortKeyLabel } from './keyLabel';
import { HitMarkers, SalvagePromptView, ShipStatus, ThreatBand, type CombatHudData } from './Combat';
import { CollisionBand, type CollisionHud } from './FlightAssist';
import { DockApproachView } from './DockApproach';
import type { RadarContact, ThreatContact } from './radar';
import type { DockPrompt, EdgeArrow, StationContact } from './stationHud';
import { Gauge, Key, KeyHint, Lamp, Odometer, Panel, Readout, ResourceChip, RingBadge } from './theme';
import type { MiningHudData } from '../game/miningView';
import { MiningHeat } from './MiningHeat';
import type { MiningPop } from '../game/mining/miningUi';
import { ObjectiveBand, type ObjectiveItem } from './board/Objectives';
import { FONTS, PALETTE, RING_ACCENTS, STATION_COLORS } from './theme/tokens';
import { CalloutLayer, type CalloutItem } from './theme';
import type { MapDiscovery, MapLayer, RadarPlace, RadarSignal, RadarSurvey, ScanHudData } from '../game/discovery/exploreUi';
import type { MapField, MapStation, MapTarget } from './discovery/MapView';
import { MapView, prefetchMap } from './lazyScreens';
import { drawPirateMark, drawPlace, drawShipMarker, drawSignal, drawSurveyPoint, prepareCanvas, withAlpha } from './canvasDraw';
import { BuffStrip, ScanWidget, StormBanner } from './discovery/ScanHud';
import { drawRadarGuild, drawRadarRock, drawRadarShip, drawRadarSites, drawRadarStation, drawRadarWreck } from './radarDraw';
import type { GuildContact, SiteContact } from './radar';
import { RadarLegend } from './RadarLegend';
import { hudParts, isFresh } from './hudParts';
import type { UiFeature } from '../game/onboarding/reveal';
import { deepEqual, pure, sameDeep } from './pure';
import {
  RADAR_SIZE,
  sameCallouts,
  sameCargoTags,
  sameCollision,
  sameConsoleGauges,
  sameEdgeArrows,
  sameHitMarkers,
  sameHudArrow,
  sameObjectiveBand,
  sameRadar,
  sameSalvagePrompt,
  sameScanWidget,
  sameShipStatus,
  sameThreatBand,
  SHIP_STATUS_SETTLE_AT,
  vignetteSeq,
  type ConsoleGaugesProps,
} from './hudMemo';
import { EdgeArrowLayer, type EdgeArrowMark } from './EdgeArrowLayer';
import { LEFT_COLUMN, NAV_ZONE, TOP_RIGHT_ZONE } from './hudZones';
import { goalLabelFlips, goalText, sameGoalHud, type GoalHud } from './goalMark';
import { LiveSlot, LiveText } from './liveText';
import { flightHudRects, goalLabelOffset, placeHudArrows } from './edgeArrows';
import { columnClear, fitLeftColumn, LEFT_FIT_GAP, logClaim, type FitRect, type LeftFit } from './leftColumn';
import type { AttentionHud, FortressHud, MapPirate, PirateHudData, RadarPirate, ReticleData, TollHud, TractorHud } from '../game/pirates/piratesUi';
import type { CombatHudView } from '../game/combatView';
import { AttentionRow, CannonReticle, FortressBand, TollBand, TractorLine } from './pirates/PirateHud';
import { drawRadarSectors, EntryNotice, SectorBadge, type EntryNoticeData, type RadarSectorData, type SectorBadgeData } from './sectors/SectorHud';
import { SECURITY_COLORS } from './sectors/sectorStyle';
import type { Security } from '../sim/regions/constants';
import type { MapSectorsData } from './discovery/mapSectors';
import type { MapPlanData, MapPlanHandlers } from '../game/map/types';
// after the theme – screen rules win over the component base
import './hud.css';

export type { MapStation } from './discovery/MapView';

export interface HudData {
  speed: number;
  dampers: boolean;
  fuel: number;
  fuelMax: number;
  energy: number;
  energyMax: number;
  cargo: Cargo;
  cargoMax: number;
  ring: number;
  pos: Vec2;
  angle: number;
  radar: { range: number; contacts: RadarContact[]; stations: StationContact[]; threats?: ThreatContact[] };
  /** targets = contract targets and "First Day" targets (M3.5a). */
  /** Map (M): stations, contract targets, fields, discoveries, layers (10.8); recenter changes with the C key. */
  /** M4d (game/map/types.ts `MapPlanData`): the Guild layer, the planned route, notes, stale marks – drawn by T12. */
  map: { open: boolean; explored: string[]; stations: MapStation[]; targets?: MapTarget[]; fields?: MapField[]; discovery?: MapDiscovery | null; recenter?: number; pirates?: MapPirate[]; sectors?: MapSectorsData | null } & Partial<MapPlanData>;
  message: string | null;
  /** Message tone: info (docking…) or bad (out of fuel). */
  messageTone?: 'info' | 'bad';
  credits: number;
  /** Docking prompt at a station. */
  prompt: DockPrompt | null;
  /** Nearest discovered station. */
  nearest: { name: string; distance: number } | null;
  /** Arrow to the nearest discovered station when it is off screen. */
  arrow: (EdgeArrow & { label: string }) | null;
  /** Expanded controls help (K). */
  helpOpen?: boolean;
  /** Combat (M3b): ship state, hits, warning, salvage. */
  combat?: CombatHudData | null;
  /** Vein mining (M2d): heat of the hottest laser and the bonus. */
  mining?: MiningHudData | null;
  /** Ore of collected nuggets popping at the cargo gauge (Mining 2.0). */
  miningPops?: readonly MiningPop[];
  /** Objectives band under the navigation band (M3.5a). */
  objectives?: ObjectiveItem[] | null;
  /** Arrow to a contract / "First Day" target when it is off screen (M3.5a). */
  objectiveArrow?: (EdgeArrow & { label: string }) | null;
  /** The goal (training target, contract): name, distance, bearing and its mark (a ring on screen, an edge arrow off screen). */
  goal?: GoalHud | null;
  /** Scanner (M3.5b): charge, analysis, pulse, bonuses, storm. */
  scan?: ScanHudData | null;
  /** Signals and places on the radar, callouts in the world (M3.5b). */
  discovery?: { radar: { signals: RadarSignal[]; places: RadarPlace[]; survey?: RadarSurvey[]; sites?: SiteContact[] }; callouts: CalloutItem[] } | null;
  /** Map layer switch (click on the toggle). */
  onToggleLayer?: (layer: MapLayer) => void;
  /** M4d route planner and map notes (game layer, T9); without them the map has no route / note tools. */
  mapPlan?: MapPlanHandlers;
  /** Pirates and salvage (M3.6): attention, toll, tractor beam, fortress band. */
  pirates?: PirateHudData | null;
  /** Cannons that can hit the aim point (pips at the cursor). */
  reticle?: ReticleData | null;
  /** Fortresses, beacons and containers on the radar. */
  radarPirates?: RadarPirate[];
  /** Collision ahead (M3.8). */
  collision?: CollisionHud | null;
  /** Edge arrows to the scanner pulse's finds out of view (R6). */
  scanArrows?: EdgeArrowMark[] | null;
  /** Off-screen hostile pirates: red arrows / merged arcs at the screen edge (readability R2). */
  enemyArrows?: EdgeArrowMark[] | null;
  /** The ship's sector (badge top left, replaces the ring badge) and its entry notice (sectors §5.2). */
  sector?: SectorBadgeData | null;
  sectorNotice?: EntryNoticeData | null;
  /** Sector borders near the ship for the radar arc. */
  radarSectors?: RadarSectorData | null;
  /** M4d: live Guild Watch ships and convoy ships on the radar (`buildGuildContacts`). */
  radarGuild?: GuildContact[];
  /** M4d: edge arrows and pins of the planned route, map notes, convoys and Guild relays (`navArrows`). */
  navArrows?: EdgeArrowMark[] | null;
  /** Unlocked UI features (progressive reveal during the Guild Training); absent = everything shows. */
  reveal?: ReadonlySet<UiFeature>;
  /** Features still highlighted as new, space separated (`is-new` on the part, hud.css); absent = none. */
  fresh?: string;
}


const EMPTY: never[] = [];




/** What the radar canvas draws (positions relative to the ship, sim units). */
interface RadarCanvasProps {
  range: number;
  contacts: RadarContact[];
  stations: StationContact[];
  threats: ThreatContact[] | undefined;
  angle: number;
  ring: number;
  signals: RadarSignal[];
  places: RadarPlace[];
  /** Survey points of sectors not Charted yet (sectors §4.1). */
  survey: RadarSurvey[];
  pirates: RadarPirate[];
  sectors: RadarSectorData | null;
  /** Security of the ship's sector – the rim colour (the ring accent before sectors are known). */
  security: Security | null;
  /** M4b world sites: derelicts and relays, graveyards, live mines, comets. */
  sites: SiteContact[];
  /** M4d Guild Watch ships and convoys (friends and neutrals, under the pirates). */
  guild: GuildContact[];
}

/** Draws the radar: the still face from its cache, the sector borders, every contact, the ship marker. */
function drawRadar(canvas: HTMLCanvasElement, { range, contacts, stations, threats, angle, ring, signals, places, survey, pirates, sectors, security, sites, guild }: RadarCanvasProps): void {
  const ctx = prepareCanvas(canvas, RADAR_SIZE);
  if (!ctx) return;
  const half = RADAR_SIZE / 2;
  const r = half - 2;
  const accent = security ? SECURITY_COLORS[security] : (RING_ACCENTS[ring - 1]?.a ?? PALETTE.glow);
  ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE);
  // the still face (display, range circles, axis cross, rim with ticks) from its cache, 1:1 in device
  // pixels; then the drawing state the face leaves behind
  const face = radarFace(accent, canvas.width, ctx.getTransform().a);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(face, 0, 0);
  ctx.restore();
  ctx.fillStyle = faceGradient(ctx);
  ctx.strokeStyle = withAlpha(accent, 0.75);
  ctx.lineWidth = 1;
  if (range > 0) {
    const s = (r - 6) / range;
    // sector borders under every contact (sectors §5.2)
    if (sectors) drawRadarSectors(ctx, sectors, half, r, s);
    // radar grammar (R7): objects hollow (rocks in their ore colour, stations by kind), ships filled
    for (const c of contacts) drawRadarRock(ctx, half + c.x * s, half - c.y * s, Math.max(1.6, c.radius * s), c.color, c.rich);
    for (const st of stations) {
      drawRadarStation(ctx, half + st.x * s, half - st.y * s, st.edge ? 7 : 9, STATION_COLORS[st.kind], st.edge);
    }
    drawRadarSites(ctx, sites, half, half, s, r - 2);
    for (const t of threats ?? []) {
      if (t.kind === 'wreck') drawRadarWreck(ctx, half + t.x * s, half - t.y * s);
    }
    drawRadarGuild(ctx, guild, half, half, s);
    for (const t of threats ?? []) {
      if (t.kind === 'pirate') drawRadarShip(ctx, half + t.x * s, half - t.y * s, t.angle, t.glyph, t.edge ? 5.5 : 6.5, t.edge);
    }
    // discoveries (M3.5b): signals as uncertainty circles (beyond range a mark on the rim), places by kind
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, r - 2, 0, Math.PI * 2);
    ctx.clip();
    for (const sg of signals) {
      const dist = Math.hypot(sg.x, sg.y);
      if (dist <= range) drawSignal(ctx, half + sg.x * s, half - sg.y * s, sg.radius * s);
      else {
        const k = (r - 9) / dist;
        drawSignal(ctx, half + sg.x * k, half - sg.y * k, 3.5);
      }
    }
    for (const pl of places) {
      if (Math.hypot(pl.x, pl.y) > range) continue;
      // a ship in distress is a ship: filled, neutral blue
      if (pl.kind === 'distress') drawRadarShip(ctx, half + pl.x * s, half - pl.y * s, Math.PI / 2, 'shipNeutral', 6);
      else drawPlace(ctx, half + pl.x * s, half - pl.y * s, pl.kind, pl.fresh, 4.5);
    }
    for (const sp of survey) {
      if (Math.hypot(sp.x, sp.y) <= range) drawSurveyPoint(ctx, half + sp.x * s, half - sp.y * s, 3.5, sp.done);
    }
    // pirates (M3.6): fortress, clan beacon, containers
    for (const pp of pirates) {
      if (Math.hypot(pp.x, pp.y) > range + 30) continue;
      drawPirateMark(ctx, half + pp.x * s, half - pp.y * s, pp.kind, pp.kind === 'fortress' ? Math.max(5, 10 * s) : pp.kind === 'beacon' ? 4.5 : 3);
    }
    ctx.restore();
  }
  drawShipMarker(ctx, half, half, angle, 7);
}

/**
 * The radar canvas, drawn outside the diff (O13): the HUD hands the scope its contacts at every redraw,
 * and the scope draws them – on the next animation frame, as the effect it replaces did – only when the
 * picture changed at the radar's resolution (hudMemo.ts `sameRadar`).
 */
class RadarScope {
  private canvas: HTMLCanvasElement | null = null;
  /** The contacts drawn (or about to be). */
  private shown: RadarCanvasProps | null = null;
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The canvas element's ref. */
  readonly attach = (el: HTMLCanvasElement | null): void => {
    this.canvas = el;
    if (el && this.shown) this.schedule();
  };

  update(p: RadarCanvasProps): void {
    if (this.shown && sameRadar(this.shown, p)) return;
    this.shown = p;
    this.schedule();
  }

  /** After the next paint, like Preact's effects (an animation frame, or a timeout in a hidden tab). */
  private schedule(): void {
    if (this.frame || this.timer !== undefined) return;
    const done = (): void => {
      cancelAnimationFrame(this.frame);
      clearTimeout(this.timer);
      this.frame = 0;
      this.timer = undefined;
      if (this.canvas && this.shown) drawRadar(this.canvas, this.shown);
    };
    this.timer = setTimeout(done, 35);
    this.frame = requestAnimationFrame(done);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.frame = 0;
    this.timer = undefined;
    this.canvas = null;
  }
}

const RADAR_STYLE = { width: `${RADAR_SIZE}px`, height: `${RADAR_SIZE}px` };

/** The display's radial gradient (the face's fill). */
function faceGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const half = RADAR_SIZE / 2;
  const grad = ctx.createRadialGradient(half, half * 0.7, 4, half, half, half - 2);
  grad.addColorStop(0, '#13283f');
  grad.addColorStop(1, PALETTE.screen);
  return grad;
}

/** The radar's still face of the last rim colour and pixel ratio (audit 2026-10-17 P7: ~40 strokes per redraw). */
let radarFaceCache: { accent: string; px: number; dpr: number; canvas: HTMLCanvasElement } | null = null;

/**
 * The radar face – the display, range circles, axis cross and the rim with its ticks in `accent` – on a
 * `px` × `px` canvas drawn at the radar canvas's own scale `dpr` (prepareCanvas), so it copies 1:1.
 */
function radarFace(accent: string, px: number, dpr: number): HTMLCanvasElement {
  const known = radarFaceCache;
  if (known && known.accent === accent && known.px === px && known.dpr === dpr) return known.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const half = RADAR_SIZE / 2;
  const r = half - 2;
  // display
  ctx.fillStyle = faceGradient(ctx);
  ctx.beginPath();
  ctx.arc(half, half, r, 0, Math.PI * 2);
  ctx.fill();
  // range circles and the axis cross
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(PALETTE.glow, 0.16);
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.arc(half, half, r * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(half - r, half);
  ctx.lineTo(half + r, half);
  ctx.moveTo(half, half - r);
  ctx.lineTo(half, half + r);
  ctx.stroke();
  // rim with tick marks in the colour of the sector's security
  ctx.strokeStyle = withAlpha(accent, 0.75);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(half, half, r - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const len = i % 9 === 0 ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(half + Math.cos(a) * (r - 3), half + Math.sin(a) * (r - 3));
    ctx.lineTo(half + Math.cos(a) * (r - 3 - len), half + Math.sin(a) * (r - 3 - len));
    ctx.stroke();
  }
  radarFaceCache = { accent, px, dpr, canvas };
  return canvas;
}

// Memoised HUD parts (audit 2026-10-17 P7, O13): the view models are rebuilt every redraw, so the parts
// compare what they show (hudMemo.ts, pure.ts) and skip their subtree while it is the same. What changes
// all the time in flight (the speed, the position, a distance) sits in small parts of its own, so the
// rest of the HUD skips the diff.
const ShipStatusPart = pure(ShipStatus, sameShipStatus, { settleAt: SHIP_STATUS_SETTLE_AT });
const HitMarkersPart = pure(HitMarkers, sameHitMarkers);
const ThreatBandPart = pure(ThreatBand, sameThreatBand);
const SalvagePromptPart = pure(SalvagePromptView, sameSalvagePrompt);
const CalloutLayerPart = pure(CalloutLayer, sameCallouts);
const SectorBadgePart = pure(SectorBadge, sameDeep);
const AttentionRowPart = pure(AttentionRow, sameDeep);
const ObjectiveBandPart = pure(ObjectiveBand, sameObjectiveBand);
const TractorLinePart = pure(TractorLine, sameDeep);
const MiningHeatPart = pure(MiningHeat, sameDeep);
const FortressBandPart = pure(FortressBand, sameDeep);
const TollBandPart = pure(TollBand, sameDeep);
const CannonReticlePart = pure(CannonReticle, sameDeep);
const ScanWidgetPart = pure(ScanWidget, (a: { d: ScanHudData; fresh?: boolean }, b: { d: ScanHudData; fresh?: boolean }) => a.fresh === b.fresh && sameScanWidget(a, b));
const BuffStripPart = pure(BuffStrip, (a: { d: ScanHudData }, b: { d: ScanHudData }) => deepEqual(a.d.buffs, b.d.buffs));
const StormBannerPart = pure(StormBanner);
const EntryNoticePart = pure(EntryNotice, sameDeep);
const CollisionBandPart = pure(CollisionBand, sameCollision);
const EdgeArrowLayerPart = pure(EdgeArrowLayer, sameEdgeArrows);

/** The hull-hit edge vignette: a new hit (its sequence) restarts the flash; -1 = none. */
const VignettePart = pure(function Vignette({ seq }: { seq: number }) {
  return seq >= 0 ? <div key={seq} class="cb-vignette" aria-hidden="true" /> : null;
});

/** The speed readout: its number is a live text the HUD writes at each redraw (liveText.ts). */
const SpeedPart = pure(function Speed({ live, fresh }: { live: LiveText; fresh: boolean }) {
  return <Readout size="lg" label={tx().hud.speed} live={live} unit={tx().hud.speedUnit} fresh={fresh} />;
});

/** The dampers lamp and its key. */
const DampersPart = pure(function Dampers({ on, fresh }: { on: boolean; fresh: boolean }) {
  return (
    <div class={`hud-dampers${on ? '' : ' is-off'}${fresh ? ' is-new' : ''}`}>
      <Lamp state={on ? 'ok' : 'bad'} />
      <span>{tx().hud.dampers}</span>
      <strong>{on ? tx().hud.on : tx().hud.off}</strong>
      <Key dark>Z</Key>
    </div>
  );
});

/** Cargo as tags (from 0.05 up); `flight` = the combat console's place under the speed. */
function CargoTags({ cargo, flight }: { cargo: Cargo; flight: boolean }) {
  const ids = RESOURCE_IDS.filter((id) => cargo[id] >= 0.05);
  if (ids.length === 0) return null;
  return (
    // in the combat console the gauge column is taller – cargo as tags goes under the speed
    <div class={`af-res-list hud-cargo${flight ? ' hud-cargo--flight' : ''}`}>
      {ids.map((id) => (
        <ResourceChip key={id} id={id} amount={cargo[id]} tag />
      ))}
    </div>
  );
}

const CargoTagsPart = pure(CargoTags, (a: { cargo: Cargo; flight: boolean }, b: { cargo: Cargo; flight: boolean }) => a.flight === b.flight && sameCargoTags(a, b));

/** The console's gauge column: shield and hull in combat, fuel, energy (with the laser heat), cargo. */
const ConsoleGaugesPart = pure(function ConsoleGauges(p: ConsoleGaugesProps) {
  return (
    <div class="hud-console-gauges">
      {p.shield && <Gauge {...p.shield} />}
      {p.hull && <Gauge {...p.hull} />}
      <Gauge {...p.fuel} />
      {p.energy &&
        (p.mining ? (
          // energy and laser heat on one row – a console with lasers keeps its height while mining
          <div class="hud-gauge-pair">
            <Gauge {...p.energy} />
            <MiningHeatPart m={p.mining} />
          </div>
        ) : (
          <Gauge {...p.energy} />
        ))}
      {p.cargo && (
        <div class="hud-cargo-wrap">
          <Gauge {...p.cargo} />
          {p.pops.map((pop) => (
            <span key={pop.seq} class="hud-pop" data-testid="hud-pop" role="status">
              {pop.text}
            </span>
          ))}
        </div>
      )}
      {p.tags && <CargoTags cargo={p.tags} flight={false} />}
    </div>
  );
}, sameConsoleGauges);

/** The navigation band: the sector badge (or the ring), the position, the nearest station, the attention row. */
const NavPart = pure(function NavBand({
  sector,
  ring,
  position,
  station,
  distance,
  attention,
  full,
  fresh,
}: {
  fresh: boolean;
  /** False = the location rows are not unlocked yet: only the attention row (an attack) shows. */
  full: boolean;
  sector: SectorBadgeData | null;
  ring: number;
  /** The position as shown ("x, y" in whole units) – live texts. */
  position: HudLive['position'];
  station: string | null;
  /** The distance to the nearest station as shown – a live text. */
  distance: LiveText;
  attention: AttentionHud | null;
}) {
  return (
    <Panel material="band" translucent cut="md" class={`hud-nav${fresh ? ' is-new' : ''}`} as="section" aria-label={tx().hud.zone}>
      {full && (sector ? <SectorBadgePart d={sector} /> : <RingBadge ring={ring} name={tx().rings[ring - 1]} />)}
      {full && <dl class="hud-nav-grid">
        <dt>{tx().hud.position}</dt>
        <LiveSlot tag="dd" live={position} />
        {station !== null && (
          <>
            <dt>{tx().hud.station}</dt>
            <dd class="hud-nav-station">
              <span class="hud-nav-station-name">{station}</span>
              <Readout live={distance} unit={tx().hud.distanceUnit} />
            </dd>
          </>
        )}
      </dl>}
      {attention && <AttentionRowPart a={attention} />}
    </Panel>
  );
}, sameDeep);

/**
 * The radar panel: the canvas (its scope draws it), the scanner pulse ring and the range readout. It
 * redraws only for a new pulse or a new language; the contacts go to the scope.
 */
const RadarSectionPart = pure(function RadarSection({ scope, pulse, range, fresh }: { scope: RadarScope; pulse: number | null; range: number; fresh: boolean }) {
  return (
    <Panel material="band" translucent cut="lg" class={`hud-radar${fresh ? ' is-new' : ''}`} as="aside" aria-label={tx().hud.radar}>
      <canvas ref={scope.attach} class="hud-radar-canvas" style={RADAR_STYLE} aria-hidden="true" />
      {pulse !== null && <span key={pulse} class="ds-radar-pulse" aria-hidden="true" />}
      <RadarRangePart range={range} />
    </Panel>
  );
});

/** The range readout under the radar (whole units). */
const RadarRangePart = pure(function RadarRange({ range }: { range: number }) {
  return (
    <span class="hud-radar-range">
      <Readout value={range} unit={tx().hud.distanceUnit} />
    </span>
  );
});

/** The measured panel zones as a string: the goal label's flip recomputes when they move. */
const zonesKey = (): string => `${NAV_ZONE.width},${NAV_ZONE.height},${TOP_RIGHT_ZONE.width},${TOP_RIGHT_ZONE.height},${LEFT_COLUMN.chipsBottom},${LEFT_COLUMN.chipsRight ?? 0},${LEFT_COLUMN.radio?.y ?? 0}`;

type HudArrowProps = { arrow: EdgeArrow & { label: string }; kind: 'station' | 'goal' };

type GoalMarkProps = { goal: GoalHud & { mark: { kind: 'onScreen'; x: number; y: number } }; view: { width: number; height: number }; zones: string };

/** The goal on screen: a ring on it and "name · 97 u" beside it; pulses once when the goal changes. */
const GoalMarkPart = pure(function GoalMark({ goal, view }: GoalMarkProps) {
  const { x, y } = goal.mark;
  const text = goalText(goal);
  const flip = goalLabelFlips(x, y, text.length, view, flightHudRects(view));
  return (
    <div class={`hud-goal${flip ? ' is-flipped' : ''}`} style={{ left: `${x}px`, top: `${y}px` }} data-testid="goal-mark">
      <div class="hud-goal-ring" key={goal.label} />
      <div class="hud-goal-label">
        <b>{goal.label}</b>
        <span class="hud-goal-dist"> · {formatInt(Math.round(goal.distance))} {tx().hud.distanceUnit}</span>
      </div>
    </div>
  );
}, (a: GoalMarkProps, b: GoalMarkProps) => a.view.width === b.view.width && a.view.height === b.view.height && a.zones === b.zones && sameGoalHud(a.goal, b.goal));

/** The station arrow (with a dock clamp icon) or the goal arrow at the screen edge. */
const HudArrowPart = pure(function HudArrow({ arrow, kind }: HudArrowProps) {
  // the goal's bolder head needs the label further out (and further by its own width along the edge)
  const off = kind === 'goal' ? goalLabelOffset(arrow.angle, arrow.label) : null;
  return (
    <div class={`hud-arrow hud-arrow--${kind}`} style={{ left: `${arrow.x}px`, top: `${arrow.y}px` }} data-testid={kind === 'station' ? 'station-arrow' : 'objective-arrow'}>
      <div class="hud-arrow-head" style={{ transform: `rotate(${arrow.angle}rad)` }} />
      <div
        class="hud-arrow-label"
        style={{
          // label towards the screen centre; horizontally further by half its width so it does not cover the tip
          left: `${off ? off.x : -Math.cos(arrow.angle) * (34 + 72 * Math.abs(Math.cos(arrow.angle)))}px`,
          top: `${off ? off.y : -Math.sin(arrow.angle) * 32}px`,
        }}
      >
        {/* a dock clamp icon: the station arrow differs from the red pirate arrows in shape, not only colour */}
        {kind === 'station' && (
          <svg class="hud-arrow-dock" viewBox="-7 -7 14 14" aria-hidden="true">
            <path d="M-6 -6 H-2 V-2 H2 V-6 H6 V1 H3 V6 H-3 V1 H-6 Z" />
          </svg>
        )}
        {arrow.label}
      </div>
    </div>
  );
}, (a: HudArrowProps, b: HudArrowProps) => a.kind === b.kind && sameHudArrow(a, b));


/** The flight console: the ship status in combat, the speed, the dampers, the tractor line, the gauges. */
interface ConsoleProps {
  /** The combat view (ship status, cannons, hold), null outside combat. */
  status: CombatHudView | null;
  /** Null = not unlocked yet. */
  speed: LiveText | null;
  /** The cargo tags in the combat console; null = the cargo is not unlocked yet. */
  cargo: Cargo | null;
  /** Null = the dampers row is not unlocked yet. */
  dampers: boolean | null;
  /** The speed readout / the dampers row were just unlocked. */
  speedNew: boolean;
  dampersNew: boolean;
  tractor: TractorHud | null;
  gauges: ConsoleGaugesProps;
}

const sameStatus = (a: ConsoleProps, b: ConsoleProps): boolean => (a.status && b.status ? sameShipStatus({ view: a.status }, { view: b.status }) : a.status === b.status);

const sameConsole = (a: ConsoleProps, b: ConsoleProps): boolean =>
  a.speed === b.speed &&
  a.dampers === b.dampers &&
  a.speedNew === b.speedNew &&
  a.dampersNew === b.dampersNew &&
  sameStatus(a, b) &&
  deepEqual(a.tractor, b.tractor) &&
  (a.cargo && b.cargo ? sameCargoTags({ cargo: a.cargo }, { cargo: b.cargo }) : a.cargo === b.cargo) &&
  sameConsoleGauges(a.gauges, b.gauges);

/**
 * Gated as one (O13). The ship status inside keeps its own settle deadlines (hit pulse, loss flash);
 * the console arms them too for a status change, a little later than the status (whose deadlines are
 * armed a moment after the console's in the same redraw), so the status is surely due when it draws.
 */
const CONSOLE_SETTLE_AT = SHIP_STATUS_SETTLE_AT.map((ms) => ms + 50);

const ConsolePart = pure(
  function Console({ status, speed, cargo, dampers, speedNew, dampersNew, tractor, gauges }: ConsoleProps) {
    return (
      <Panel material="band" translucent cut="md" trim="top" class={`hud-console${status ? ' has-status' : ''}`} as="section" aria-label={tx().station.ship}>
        {status && <ShipStatusPart view={status} />}
        <div class="hud-console-flight">
          {speed && <SpeedPart live={speed} fresh={speedNew} />}
          {status && cargo && <CargoTagsPart cargo={cargo} flight />}
          {dampers !== null && <DampersPart on={dampers} fresh={dampersNew} />}
          {tractor && <TractorLinePart t={tractor} />}
        </div>
        <ConsoleGaugesPart {...gauges} />
      </Panel>
    );
  },
  sameConsole,
  { settleAt: CONSOLE_SETTLE_AT, settleOn: (a, b) => !sameStatus(a, b) },
);

/**
 * The HUD's quieter parts, gated as one (O13): in flight most redraws change none of them, and one
 * comparison for the group is cheaper than a diff entry for each. When one changes, the group draws and
 * every member still skips unless it is the one that changed (each is memoised on its own).
 */
interface QuietPartsProps {
  /** Null = the radar legend is not unlocked yet. */
  legend: 'help' | 'hover' | null;
  /** null = no callouts (the map is open, or no discovery data). */
  callouts: readonly CalloutItem[] | null;
  fortress: FortressHud | null;
  toll: TollHud | null;
  reticle: ReticleData | null;
  scan: ScanHudData | null;
  notice: EntryNoticeData | null;
  /** Null = the credits are not unlocked yet. */
  credits: number | null;
  /** Whether the help chip (K) shows. */
  help: boolean;
  /** Freshly unlocked parts (highlighted). */
  creditsNew: boolean;
  helpNew: boolean;
  scanNew: boolean;
  helpOpen: boolean;
  collision: CollisionHud | null;
}

const orNone = <T,>(a: T | null, b: T | null, same: (p: T, q: T) => boolean): boolean => (a !== null && b !== null ? same(a, b) : a === b);

function sameQuietParts(a: QuietPartsProps, b: QuietPartsProps): boolean {
  return (
    a.legend === b.legend &&
    a.credits === b.credits &&
    a.help === b.help &&
    a.creditsNew === b.creditsNew &&
    a.helpNew === b.helpNew &&
    a.scanNew === b.scanNew &&
    a.helpOpen === b.helpOpen &&
    orNone(a.callouts, b.callouts, (p, q) => sameCallouts({ items: p }, { items: q })) &&
    orNone(a.scan, b.scan, (p, q) => p.storm === q.storm && sameScanWidget({ d: p }, { d: q }) && deepEqual(p.buffs, q.buffs)) &&
    orNone(a.collision, b.collision, (p, q) => sameCollision({ c: p }, { c: q })) &&
    deepEqual(a.fortress, b.fortress) &&
    deepEqual(a.toll, b.toll) &&
    deepEqual(a.reticle, b.reticle) &&
    deepEqual(a.notice, b.notice)
  );
}

const QuietPartsPart = pure(function QuietParts(p: QuietPartsProps) {
  return (
    <>
      {/* above the radar: pinned while the controls help (K) is open, else on hover */}
      {p.legend && <RadarLegend variant={p.legend} />}

      {p.callouts && <CalloutLayerPart items={p.callouts} />}
      {p.fortress && <FortressBandPart f={p.fortress} />}
      {p.toll && <TollBandPart t={p.toll} />}
      {p.reticle && <CannonReticlePart r={p.reticle} />}
      {p.scan && <ScanWidgetPart d={p.scan} fresh={p.scanNew} />}
      {p.scan && <BuffStripPart d={p.scan} />}
      {p.scan && <StormBannerPart on={p.scan.storm} />}
      {p.notice && <EntryNoticePart d={p.notice} />}

      <TopRightPart credits={p.credits} help={p.help} helpOpen={p.helpOpen} creditsNew={p.creditsNew} helpNew={p.helpNew} />

      {p.collision && <CollisionBandPart c={p.collision} />}
    </>
  );
}, sameQuietParts);

/** The docking prompt and the combat overlays (Combat.tsx CombatOverlay, part by part), gated as one. */
interface PromptPartsProps {
  /** The docking / F prompt, null = none or the salvage prompt has its place. */
  prompt: DockPrompt | null;
  combat: CombatHudData | null;
  view: { width: number; height: number };
  /** The salvage prompt shows (a wreck in reach, no docking prompt in its way). */
  salvage: boolean;
}

function samePromptParts(a: PromptPartsProps, b: PromptPartsProps): boolean {
  if (a.salvage !== b.salvage || !deepEqual(a.prompt, b.prompt)) return false;
  const p = a.combat;
  const q = b.combat;
  if (!p || !q) return p === q;
  return (
    vignetteSeq(p) === vignetteSeq(q) &&
    sameHitMarkers({ hits: p.hits, view: a.view }, { hits: q.hits, view: b.view }) &&
    p.threat === q.threat &&
    (p.threat === null || sameThreatBand({ threat: p.view.threat, mode: p.threat }, { threat: q.view.threat, mode: q.threat! })) &&
    (!a.salvage || sameSalvagePrompt({ salvage: p.view.salvage! }, { salvage: q.view.salvage! }))
  );
}

const PromptPartsPart = pure(function PromptParts({ prompt, combat, view, salvage }: PromptPartsProps) {
  return (
    <>
      {prompt && <DockPromptView prompt={prompt} />}
      {/* the combat overlays: edge vignette, hit markers, pirate band, salvage prompt */}
      {combat && <VignettePart seq={vignetteSeq(combat)} />}
      {combat && <HitMarkersPart hits={combat.hits} now={combat.now} view={view} />}
      {combat?.threat && <ThreatBandPart threat={combat.view.threat} mode={combat.threat} />}
      {salvage && combat?.view.salvage && <SalvagePromptPart salvage={combat.view.salvage} />}
    </>
  );
}, samePromptParts);

/** Controls help lines: the base list plus the Mining 2.0 lines right after the mining laser. */
function helpLines(): readonly string[] {
  const h = tx().help;
  const lines: string[] = [...h.lines];
  // the comm log (communicator) right after the journal, the Mining 2.0 lines right after the laser
  lines.splice(Math.min(h.journalLine + 1, lines.length), 0, tx().comms.help);
  lines.splice(Math.min(h.laserLine + 1, lines.length), 0, tx().mining.help.lasers, tx().mining.help.nuggets);
  return lines;
}

/** Memoised: the help only changes when it is toggled (K) or the language changes. */
const Help = pure(HelpView);

function HelpView({ open, fresh }: { open: boolean; fresh: boolean }) {
  if (!open) {
    return (
      <div class={`hud-help is-collapsed${fresh ? ' is-new' : ''}`}>
        <KeyHint keys="K" dark>
          {tx().help.title}
        </KeyHint>
      </div>
    );
  }
  // the radar legend (R7) is pinned above the radar while the help is open (Hud renders it there)
  return (
    <Panel material="band" translucent cut="md" class={`hud-help${fresh ? ' is-new' : ''}`} as="aside" aria-label={tx().help.title}>
      <div class="hud-help-head">
        <span class="hud-help-title">{tx().help.title}</span>
        <Key>K</Key>
      </div>
      <dl class="hud-help-list">
        {helpLines().map((line) => {
          const short = splitShortKeyLabel(line);
          const any = short ?? splitKeyLabel(line);
          return (
            <div key={line} class="hud-help-row">
              <dt>
                {short
                  ? short.keys.map((k) => (
                      <Key key={k} dark>
                        {k}
                      </Key>
                    ))
                  : <span class="hud-help-mouse">{any?.keys.join(' / ') ?? ''}</span>}
              </dt>
              <dd>{any?.text ?? line}</dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

function DockPromptLine({ prompt }: { prompt: DockPrompt }) {
  const parsed = prompt.kind === 'ok' ? splitShortKeyLabel(prompt.text) : null;
  const line = (
    <div class={`hud-prompt hud-prompt--${prompt.kind}`} data-testid="dock-prompt" role="status">
      {parsed ? (
        <>
          {parsed.keys.map((k) => (
            <Key key={k}>{k}</Key>
          ))}
          <span>{parsed.text}</span>
        </>
      ) : (
        <span>{prompt.text}</span>
      )}
    </div>
  );
  // near a dock clamp the approach readout sits right under the prompt
  return prompt.approach ? (
    <div class="dk-stack">
      {line}
      <DockApproachView a={prompt.approach} />
    </div>
  ) : (
    line
  );
}


const DockPromptView = pure(DockPromptLine, sameDeep);

/** The credits and the controls help, top right; an observer keeps TOP_RIGHT_ZONE (edge arrows avoid it). */
function TopRight({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const root = el.parentElement?.parentElement;
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      TOP_RIGHT_ZONE.width = Math.round(window.innerWidth - box.left) + 16;
      TOP_RIGHT_ZONE.height = Math.round(box.bottom) + 8;
      // the sector entry notice stays left of the open help (sectors.css); from the right edge, so a
      // window resize that only moves the box keeps it right
      root?.style.setProperty('--hud-tr-width', `${Math.round(root.getBoundingClientRect().right - box.left)}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      TOP_RIGHT_ZONE.width = 0;
      TOP_RIGHT_ZONE.height = 0;
      root?.style.removeProperty('--hud-tr-width');
    };
  }, []);
  return (
    <div ref={ref} class="hud-topright">
      {children}
    </div>
  );
}

/** The top-right corner's content: it changes only with the credits and the help toggle (K). */
const TopRightPart = pure(function TopRightView({ credits, help, helpOpen, creditsNew, helpNew }: { credits: number | null; help: boolean; helpOpen: boolean; creditsNew: boolean; helpNew: boolean }) {
  return (
    <TopRight>
      {credits !== null && <Odometer value={credits} testId="hud-credits" fresh={creditsNew} />}
      {help && <Help open={helpOpen} fresh={helpNew} />}
    </TopRight>
  );
});

/**
 * The top-left stack: the navigation band with the objectives band under it, in the flow (the sector
 * badge's survey dots and the attention row make the nav band taller). A ResizeObserver publishes where
 * the nav band and the whole stack end as `--hud-nav-bottom` / `--hud-tl-bottom` on the UI root, so the
 * training's step panel (a sibling layer) takes the objectives band's place right under the nav band.
 * The reads run in the observer callback, after the browser's own layout (audit 2026-10-16, #8).
 */
function NavStack({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stack = ref.current;
    const root = stack?.parentElement?.parentElement;
    if (!stack || !root || typeof ResizeObserver !== 'function') return;
    const measure = (): void => {
      const nav = stack.querySelector('.hud-nav');
      const top = root.getBoundingClientRect().top;
      const box = stack.getBoundingClientRect();
      const navBottom = nav?.isConnected ? nav.getBoundingClientRect().bottom : box.bottom;
      NAV_ZONE.width = Math.max(470, Math.round(box.right) + 16);
      NAV_ZONE.height = Math.round(box.bottom) + 8;
      root.style.setProperty('--hud-nav-bottom', `${Math.round(navBottom - top)}px`);
      root.style.setProperty('--hud-tl-bottom', `${Math.round(box.bottom - top)}px`);
      root.style.setProperty('--hud-tl-right', `${Math.round(box.right - root.getBoundingClientRect().left)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    const nav = stack.querySelector('.hud-nav');
    if (nav) observer.observe(nav);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--hud-nav-bottom');
      root.style.removeProperty('--hud-tl-bottom');
      root.style.removeProperty('--hud-tl-right');
    };
  }, []);
  return (
    <div ref={ref} class="hud-tl">
      {children}
    </div>
  );
}

/** A DOM element's box (px, viewport). */
const boxOf = (el: Element): FitRect => {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, width: b.width, height: b.height };
};

/** The chip column (event chips + Guild status chips, not the UI kit's inline ones) as one box; null = none. */
function chipColumn(parts: readonly (Element | null)[]): FitRect | null {
  let box: FitRect | null = null;
  for (const el of parts) {
    if (!el) continue;
    const b = boxOf(el);
    if (b.height <= 0) continue;
    if (!box) {
      box = b;
      continue;
    }
    const right = Math.max(box.x + box.width, b.x + b.width);
    const bottom = Math.max(box.y + box.height, b.y + b.height);
    box = { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), width: 0, height: 0 };
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  return box;
}

/**
 * Applies a fold to the UI root: `data-left-fit` (guild.css), the Guild chips' `--gs-left` beside the
 * event chips and the radio's `--cm-left` (comms.css) when aside.
 */
function applyLeftFit(root: HTMLElement, fit: LeftFit, column: FitRect | null, events: Element | null): void {
  if (fit === 'full') delete root.dataset.leftFit;
  else root.dataset.leftFit = fit;
  const beside = fit === 'beside' ? events : null;
  if (beside) root.style.setProperty('--gs-left', `${Math.round(beside.getBoundingClientRect().right - root.getBoundingClientRect().left + LEFT_FIT_GAP)}px`);
  else root.style.removeProperty('--gs-left');
  if (fit === 'aside' && column) {
    root.style.setProperty('--cm-left', `${Math.round(column.x + column.width - root.getBoundingClientRect().left + 2 * LEFT_FIT_GAP)}px`);
  } else {
    root.style.removeProperty('--cm-left');
  }
}

/** The chips drop in and the radio slides in (240 ms): the column is measured on every redraw meanwhile. */
const LEFT_SETTLE_MS = 400;

type LeftSlot = 'events' | 'guild' | 'radio' | 'log' | 'console';

/**
 * The left column under the top-left stack, measured into LEFT_COLUMN (hudZones.ts): the event chips,
 * the Guild status chips and the radio panel or the comm log – siblings of the HUD in the game UI that
 * come and go with the events and the messages. The edge arrows use it from the next frame on. First
 * it folds the column so the chips end clear of the radio (leftColumn.ts): fitted again from `full`
 * when the column's content changes, folded further when it still meets the radio.
 *
 * Driven by change, not by every HUD redraw (audit 2026-10-17 P7): a ResizeObserver on the chips, the
 * radio / log, the console (the radio sits on it) and the UI root flags a size change; a new element
 * or a changed content key (window, stack bottom, chip count, Guild states and hints) does the same.
 * Only then – and for LEFT_SETTLE_MS after it, while the drop-in animations move the boxes – is the
 * column measured and fitted; a quiet frame reads no layout and writes nothing.
 */
class LeftColumnWatch {
  private readonly observer: ResizeObserver | null;
  private dirty = true;
  private settleUntil = 0;
  private readonly el: Record<LeftSlot, Element | null> = { events: null, guild: null, radio: null, log: null, console: null };
  /** The content key without the radio's height (cheap: no layout read). */
  private content = '';
  /** The full key of the last fit (with the radio's height) and its fold. */
  private key = '';
  private fit: LeftFit = 'full';
  private leftBottom = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly hud: HTMLElement,
  ) {
    this.observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            this.dirty = true;
          })
        : null;
    this.observer?.observe(root);
  }

  /** After a HUD redraw (an effect: the layout is clean). */
  frame(): void {
    let events: Element | null = null;
    let guild: Element | null = null;
    let radio: Element | null = null;
    let log: Element | null = null;
    for (let el = this.root.firstElementChild; el; el = el.nextElementSibling) {
      const c = el.classList;
      if (c.contains('ev-chips')) events ??= c.contains('ev-chips--inline') ? null : el;
      else if (c.contains('gs-chips')) guild ??= c.contains('gs-chips--inline') ? null : el;
      else if (c.contains('cm-panel')) radio ??= c.contains('is-docked') ? null : el;
      else if (c.contains('cm-log')) log ??= c.contains('is-docked') ? null : el;
    }
    if (radio) log = null;
    const known = this.el.console;
    const console = known?.isConnected ? known : this.hud.querySelector('.hud-console');
    let changed = this.dirty || !this.observer;
    changed = this.watch('events', events) || changed;
    changed = this.watch('guild', guild) || changed;
    changed = this.watch('radio', radio) || changed;
    changed = this.watch('log', log) || changed;
    changed = this.watch('console', console) || changed;
    const content = this.contentKey();
    if (content !== this.content) {
      this.content = content;
      changed = true;
    }
    const now = performance.now();
    if (changed) this.settleUntil = now + LEFT_SETTLE_MS;
    else if (now >= this.settleUntil) return;
    this.dirty = false;
    this.measure();
  }

  /** Keeps `slot` on `el`, observed; true when it is another element than before. */
  private watch(slot: LeftSlot, el: Element | null): boolean {
    const was = this.el[slot];
    if (was === el) return false;
    if (was) this.observer?.unobserve(was);
    this.el[slot] = el;
    if (el) this.observer?.observe(el);
    return true;
  }

  /** What decides the fold, short of the radio's height: the window, the stack, the chips (count, Guild states, hints). */
  private contentKey(): string {
    const { events, guild, radio, log } = this.el;
    let key = `${window.innerWidth}x${window.innerHeight}|${this.root.style.getPropertyValue('--hud-tl-bottom')}|${events?.childElementCount ?? 0}`;
    for (let chip = guild?.firstElementChild ?? null; chip; chip = chip.nextElementSibling) {
      const data = (chip as HTMLElement).dataset;
      key += `|${data.state ?? data.stage ?? ''}:${chip.querySelector('.gs-next')?.textContent ?? ''}`;
    }
    return key + (radio ? '|radio' : log ? '|log' : '|-');
  }

  /** Fits the column (from `full` on a new key, further when it still meets the radio) and publishes it. */
  private measure(): void {
    const root = this.root;
    const { events, guild, radio, log } = this.el;
    const parts = [events, guild];
    const claim = (): FitRect | null => (radio ? boxOf(radio) : log ? logClaim(boxOf(log)) : null);
    const clear = (f: LeftFit): boolean => {
      applyLeftFit(root, f, chipColumn(parts), events);
      return columnClear(chipColumn(parts), f === 'aside' ? null : claim());
    };
    const key = `${this.content}:${radio ? (radio as HTMLElement).offsetHeight : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.fit = fitLeftColumn(clear, radio !== null);
    } else if (this.fit !== 'aside' && !columnClear(chipColumn(parts), claim())) {
      this.fit = fitLeftColumn(clear, radio !== null, this.fit);
    }
    // the event chips and the M4d Guild status chips under them
    const column = chipColumn(parts);
    LEFT_COLUMN.chipsBottom = column ? Math.round(column.y + column.height) : 0;
    LEFT_COLUMN.chipsRight = column ? Math.round(column.x + column.width) : 0;
    // the comm log's max-height ends above the chips (comms.css)
    const leftBottom = column ? `${Math.round(column.y + column.height - root.getBoundingClientRect().top)}px` : '';
    if (leftBottom !== this.leftBottom) {
      this.leftBottom = leftBottom;
      if (leftBottom) root.style.setProperty('--hud-left-bottom', leftBottom);
      else root.style.removeProperty('--hud-left-bottom');
    }
    const shown = radio ?? log;
    if (!shown) {
      LEFT_COLUMN.radio = null;
      return;
    }
    const box = shown.getBoundingClientRect();
    LEFT_COLUMN.radio = { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
  }

  dispose(): void {
    this.observer?.disconnect();
    LEFT_COLUMN.chipsBottom = 0;
    LEFT_COLUMN.chipsRight = 0;
    LEFT_COLUMN.radio = null;
    applyLeftFit(this.root, 'full', null, null);
    this.root.style.removeProperty('--hud-left-bottom');
  }
}

/** The left column's fold and measurement (LeftColumnWatch), checked after each HUD frame. */
function useLeftColumn(ref: { current: HTMLDivElement | null }): void {
  const watch = useRef<LeftColumnWatch | null>(null);
  useEffect(() => {
    const hud = ref.current;
    const root = hud?.parentElement;
    if (!hud || !root) return;
    watch.current ??= new LeftColumnWatch(root, hud);
    watch.current.frame();
  });
  useEffect(
    () => () => {
      watch.current?.dispose();
      watch.current = null;
    },
    [],
  );
}

/** The HUD's live texts (liveText.ts): values that change at nearly every redraw in flight. */
interface HudLive {
  speed: LiveText;
  /** "x, y" as three text nodes, as the JSX `{x}, {y}` they replace (the text shapes the same). */
  position: readonly [LiveText, string, LiveText];
  distance: LiveText;
}

export function Hud(d: HudData) {
  const ref = useRef<HTMLDivElement>(null);
  useLeftColumn(ref);
  const scopeRef = useRef<RadarScope | null>(null);
  const scope = (scopeRef.current ??= new RadarScope());
  useEffect(() => () => scope.dispose(), [scope]);
  const liveRef = useRef<HudLive | null>(null);
  const live = (liveRef.current ??= { speed: new LiveText(), position: [new LiveText(), ', ', new LiveText()], distance: new LiveText() });
  live.speed.set(formatAmount(d.speed));
  live.position[0].set(String(Math.round(d.pos.x)));
  live.position[2].set(String(Math.round(d.pos.y)));
  live.distance.set(d.nearest ? formatInt(d.nearest.distance) : '');
  // in flight: the map's chunk in an idle moment (M opens it any time – lazy.ts)
  useEffect(prefetchMap, []);
  const view = { width: window.innerWidth, height: window.innerHeight };
  // off the HUD panels, the goal arrow off the station arrow
  const { station: arrow, goal } = placeHudArrows(d.arrow, d.objectiveArrow, view, d.helpOpen ?? true);
  const parts = hudParts(d.reveal);
  const combat = d.combat ?? null;
  const mapOpen = d.map.open;
  // a goal marker or arrow on screen: the other navigation arrows step back (opacity, not size)
  const showGoal = !mapOpen && !!d.goal;
  const shield = combat?.view.shield;
  scope.update({
    range: d.radar.range,
    contacts: d.radar.contacts,
    stations: d.radar.stations,
    threats: d.radar.threats,
    angle: d.angle,
    ring: d.ring,
    signals: d.discovery?.radar.signals ?? EMPTY,
    places: d.discovery?.radar.places ?? EMPTY,
    survey: d.discovery?.radar.survey ?? EMPTY,
    pirates: d.radarPirates ?? EMPTY,
    sectors: d.radarSectors ?? null,
    security: d.sector?.security ?? null,
    sites: d.discovery?.radar.sites ?? EMPTY,
    guild: d.radarGuild ?? EMPTY,
  });
  return (
    <div ref={ref} class={`hud${showGoal ? ' hud--goal' : ''}`} data-ring={d.ring} style={d.fresh ? { '--hud-new-tag': JSON.stringify(tx().hud.newTag) } : undefined}>
      <NavStack>
        {(parts.location || d.pirates?.attention) && <NavPart
          full={parts.location}
          fresh={isFresh(d.fresh, 'location')}
          sector={d.sector ?? null}
          ring={d.ring}
          position={live.position}
          station={d.nearest?.name ?? null}
          distance={live.distance}
          attention={d.pirates?.attention ?? null}
        />}
        {d.objectives && <ObjectiveBandPart items={d.objectives} />}
      </NavStack>

      <ConsolePart
        status={combat ? combat.view : null}
        speed={parts.speed ? live.speed : null}
        cargo={parts.cargo ? d.cargo : null}
        dampers={parts.dampers ? d.dampers : null}
        speedNew={isFresh(d.fresh, 'speed')}
        dampersNew={isFresh(d.fresh, 'dampers')}
        tractor={d.pirates?.tractor ?? null}
        gauges={{
          shield: shield ? { kind: 'shield', label: tx().combat.shield, value: shield.current, max: shield.max, warnAt: 0.3, critAt: 0.001, compact: true, segments: 24, testId: 'gauge-shield' } : null,
          hull: combat ? { kind: 'hull', label: tx().combat.hull, value: combat.view.hull.current, max: combat.view.hull.max, warnAt: 0.6, critAt: 0.3, compact: true, segments: 24, testId: 'gauge-hull' } : null,
          fuel: { kind: 'fuel', label: tx().hud.fuel, value: d.fuel, max: d.fuelMax, compact: true, segments: 24 },
          energy: parts.energy ? { fresh: isFresh(d.fresh, 'energy'), kind: 'energy', label: tx().hud.energy, value: d.energy, max: d.energyMax, compact: true, segments: d.mining && parts.heat ? 12 : 24 } : null,
          cargo: parts.cargo ? { fresh: isFresh(d.fresh, 'cargo'), kind: 'cargo', label: tx().hud.cargo, value: cargoUsed(d.cargo), max: d.cargoMax, decimals: 1, invert: true, compact: true, segments: 24 } : null,
          mining: parts.heat && parts.energy ? (d.mining ?? null) : null,
          pops: d.miningPops ?? EMPTY,
          tags: combat || !parts.cargo ? null : d.cargo,
        }}
      />

      {parts.radar && <RadarSectionPart scope={scope} pulse={d.scan?.pulse ?? null} range={Math.round(d.radar.range)} fresh={isFresh(d.fresh, 'radar')} />}
      <QuietPartsPart
        legend={parts.radarLegend ? ((d.helpOpen ?? true) ? 'help' : 'hover') : null}
        callouts={d.discovery && !mapOpen ? d.discovery.callouts : null}
        fortress={!mapOpen ? (d.pirates?.fortress ?? null) : null}
        toll={d.pirates?.toll ?? null}
        reticle={!mapOpen ? (d.reticle ?? null) : null}
        scan={parts.scanner ? (d.scan ?? null) : null}
        notice={parts.location && d.sectorNotice && !mapOpen && !d.pirates?.toll ? d.sectorNotice : null}
        credits={parts.credits ? d.credits : null}
        help={parts.helpChip}
        creditsNew={isFresh(d.fresh, 'credits')}
        helpNew={isFresh(d.fresh, 'helpChip')}
        scanNew={isFresh(d.fresh, 'scanner')}
        helpOpen={d.helpOpen ?? true}
        collision={!mapOpen ? (d.collision ?? null) : null}
      />
      <PromptPartsPart
        prompt={d.prompt && !(combat?.view.salvage && d.prompt.kind !== 'ok') ? d.prompt : null}
        combat={combat}
        view={view}
        salvage={!!combat?.view.salvage && d.prompt?.kind !== 'ok'}
      />
      {d.enemyArrows && !mapOpen && <EdgeArrowLayerPart arrows={d.enemyArrows} />}
      {arrow && !mapOpen && (parts.location || !d.goal) && <HudArrowPart arrow={arrow} kind="station" />}
      {d.scanArrows && !mapOpen && parts.scanner && <EdgeArrowLayerPart arrows={d.scanArrows} />}
      {d.navArrows && !mapOpen && parts.worldMarks && <EdgeArrowLayerPart arrows={d.navArrows} />}
      {goal && !mapOpen && <HudArrowPart arrow={goal} kind="goal" />}
      {d.goal && d.goal.mark.kind === 'onScreen' && !mapOpen && <GoalMarkPart goal={d.goal as GoalMarkProps['goal']} view={view} zones={zonesKey()} />}
      {d.message && <div class={`hud-hint hud-hint--${d.messageTone ?? 'bad'}`} role="alert">{d.message}</div>}
      {mapOpen && (
        <MapView
          explored={d.map.explored}
          stations={d.map.stations}
          pos={d.pos}
          angle={d.angle}
          targets={d.map.targets ?? EMPTY}
          fields={d.map.fields ?? EMPTY}
          discovery={d.map.discovery ?? null}
          pirates={d.map.pirates ?? EMPTY}
          recenter={d.map.recenter ?? 0}
          sectors={d.map.sectors ?? null}
          guild={d.map.guild ?? null}
          route={d.map.route ?? null}
          mapNotes={d.map.notes ?? EMPTY}
          stale={d.map.stale ?? EMPTY}
          notesLocked={d.map.notesLocked ?? false}
          {...(d.onToggleLayer ? { onToggleLayer: d.onToggleLayer } : {})}
          {...(d.mapPlan ? { plan: d.mapPlan } : {})}
        />
      )}
    </div>
  );
}

// What makes a memoised flight HUD part draw again (audit 2026-10-17 P7, O13). The HUD redraws 10× per
// second with view models built anew each time; these comparators say when two of them would draw the
// same, so the part skips its subtree in the diff. They compare what is shown, not the raw floats: a
// countdown in whole seconds, a distance as its formatted integer, a bearing to ~0.5°, a screen position
// in whole pixels, a radar contact at the radar's pixel resolution.
//
// Every comparison quantises both sides the same way (never "close enough"): Preact keeps the latest
// props even when a part skips, so a tolerance would let a slow drift pass forever, while a quantised
// value changes exactly when the drawing would. Pure functions (no DOM) – the components are in
// Hud.tsx / Combat.tsx / GameUi.tsx.
import type { CombatHudView } from '../game/combatView';
import type { ScanHudData } from '../game/discovery/exploreUi';
import type { EventChipItem } from '../game/sites/types';
import type { Cargo } from '../data/resources';
import { RESOURCE_IDS } from '../data/resources';
import type { MiningPop } from '../game/mining/miningUi';
import type { MiningHudData } from '../game/miningView';
import type { CombatHudData } from './Combat';
import type { CollisionHud } from './FlightAssist';
import type { EdgeArrowMark } from './EdgeArrowLayer';
import type { ObjectiveItem } from './board/Objectives';
import { formatAmount } from './format';
import { deepEqual } from './pure';
import { clockHour, normDeg } from './sites/chipFormat';
import type { CalloutItem } from './theme/Callout';
import { sameGaugeProps, type GaugeProps } from './theme/Meters';

/** A bearing (radians) in steps of 0.5°. */
export const angleStep = (rad: number): number => Math.round(rad * (360 / Math.PI));

/** A bearing (degrees) in steps of 0.5°. */
const degStep = (deg: number): number => Math.round(deg * 2);

/** A position on screen (px) in whole pixels. */
const px = Math.round;

/** A countdown as the whole seconds it shows (formatClock rounds up, never below 0); -1 = no timer. */
const wholeSeconds = (s: number | null): number => (s === null ? -1 : Number.isFinite(s) ? Math.max(0, Math.ceil(s)) : 0);

/** A 0..1 progress as the whole percent it shows. */
const percent = (p: number | undefined): number => (p === undefined ? -1 : Math.round(p * 100));

/** Element by element with `same`. */
function sameList<T>(a: readonly T[], b: readonly T[], same: (p: T, q: T) => boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!same(a[i]!, b[i]!)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// world labels, ship status, combat overlays

/**
 * Callout labels: the game moves them every frame (positionCallouts: the translate, the flip / below
 * classes and the leader shift), so only their content and order decide a redraw.
 */
export function sameCallouts(a: { items: readonly CalloutItem[] }, b: { items: readonly CalloutItem[] }): boolean {
  return sameList(a.items, b.items, sameCallout);
}

function sameCallout(p: CalloutItem, q: CalloutItem): boolean {
  return p.id === q.id && p.title === q.title && p.detail === q.detail && p.keys === q.keys && p.action === q.action && p.tone === q.tone && percent(p.progress) === percent(q.progress);
}

/** The ship status in the console: the silhouette, the cannons, the hull share and the salvage hold. */
export function sameShipStatus(a: { view: CombatHudView }, b: { view: CombatHudView }): boolean {
  const p = a.view;
  const q = b.view;
  return (
    p.hull.fraction === q.hull.fraction &&
    p.cannons.ready === q.cannons.ready &&
    p.cannons.total === q.cannons.total &&
    deepEqual(p.salvageHold, q.salvageHold) &&
    deepEqual(p.silhouette, q.silhouette)
  );
}

/**
 * When the ship status draws again after a change (ms): its hit pulse (450 ms) and loss flash (1.1 s)
 * end on the first redraw after them (ShipSilhouette); a little later, so the silhouette's own clock,
 * read inside that render, is surely past them.
 */
export const SHIP_STATUS_SETTLE_AT: readonly number[] = [500, 1150];

/** The hull-hit vignette shows for 0.45 s after the hit (Combat.tsx). */
const VIGNETTE_AGE = 0.45;

/** The hull hit whose edge vignette shows now (its sequence number keys the flash), -1 = none. */
export const vignetteSeq = (d: CombatHudData): number => (d.hullHit && d.hullHit.age < VIGNETTE_AGE ? d.hullHit.seq : -1);

/** Hit markers: none on both sides (a marker's fade and key follow the clock, so any marker redraws). */
export function sameHitMarkers(
  a: { hits: readonly unknown[]; view: { width: number; height: number } },
  b: { hits: readonly unknown[]; view: { width: number; height: number } },
): boolean {
  return a.hits.length === 0 && b.hits.length === 0 && a.view.width === b.view.width && a.view.height === b.view.height;
}

/** The pirate band: its counts, the nearest attacker's distance (whole units) and bearing (~0.5°). */
export function sameThreatBand(a: { threat: CombatHudView['threat']; mode: string }, b: { threat: CombatHudView['threat']; mode: string }): boolean {
  return a.mode === b.mode && sameThreat(a.threat, b.threat);
}

function sameThreat(p: CombatHudView['threat'], q: CombatHudView['threat']): boolean {
  if (p === q) return true;
  if (p.attacking !== q.attacking || p.nearby !== q.nearby) return false;
  const m = p.nearest;
  const n = q.nearest;
  if (!m || !n) return m === n;
  return Math.round(m.distance) === Math.round(n.distance) && angleStep(m.angle) === angleStep(n.angle);
}

type Salvage = CombatHudView['salvage'];

/** The salvage prompt: its distance as the text it shows ("fly closer – 12.5 u"), the rest as is. */
export function sameSalvagePrompt(a: { salvage: NonNullable<Salvage> }, b: { salvage: NonNullable<Salvage> }): boolean {
  return sameSalvage(a.salvage, b.salvage);
}

function sameSalvage(p: Salvage, q: Salvage): boolean {
  if (p === q) return true;
  if (!p || !q) return false;
  if (p.distance !== q.distance && ((p.distance <= 0) !== (q.distance <= 0) || formatAmount(p.distance) !== formatAmount(q.distance))) return false;
  const u = p as unknown as Record<string, unknown>;
  const v = q as unknown as Record<string, unknown>;
  for (const k in u) {
    if (k === 'distance') continue;
    if (!deepEqual(u[k], v[k])) return false;
  }
  return Object.keys(u).length === Object.keys(v).length;
}

/** The collision band: its urgency as written (two decimals), the time as its text, the brake key. */
export function sameCollision(a: { c: CollisionHud }, b: { c: CollisionHud }): boolean {
  const p = a.c;
  const q = b.c;
  return p === q || (p.dampersOff === q.dampersOff && p.urgency.toFixed(2) === q.urgency.toFixed(2) && formatAmount(p.time) === formatAmount(q.time));
}

// ---------------------------------------------------------------------------
// the flight console

/** Cargo tags: the resources shown (from 0.05 up) with their amounts as written. */
export function sameCargoTags(a: { cargo: Cargo }, b: { cargo: Cargo }): boolean {
  const p = a.cargo;
  const q = b.cargo;
  if (p === q) return true;
  for (const id of RESOURCE_IDS) {
    const u = p[id];
    const v = q[id];
    if (u === v) continue;
    if (u >= 0.05 !== v >= 0.05) return false;
    if (u >= 0.05 && formatAmount(u) !== formatAmount(v)) return false;
  }
  return true;
}

/** The console's gauge column (Hud.tsx `ConsoleGauges`). */
export interface ConsoleGaugesProps {
  shield: GaugeProps | null;
  hull: GaugeProps | null;
  fuel: GaugeProps;
  energy: GaugeProps;
  cargo: GaugeProps;
  mining: MiningHudData | null;
  pops: readonly MiningPop[];
  /** The cargo tags under the gauges (outside combat), null = none here. */
  tags: Cargo | null;
}

const sameGaugeOrNone = (a: GaugeProps | null, b: GaugeProps | null): boolean => (a && b ? sameGaugeProps(a, b) : a === b);

/** The gauge column: each gauge as it shows (Gauge's own comparator), the heat bar, the pops, the tags. */
export function sameConsoleGauges(a: ConsoleGaugesProps, b: ConsoleGaugesProps): boolean {
  return (
    sameGaugeOrNone(a.shield, b.shield) &&
    sameGaugeOrNone(a.hull, b.hull) &&
    sameGaugeProps(a.fuel, b.fuel) &&
    sameGaugeProps(a.energy, b.energy) &&
    sameGaugeProps(a.cargo, b.cargo) &&
    deepEqual(a.mining, b.mining) &&
    deepEqual(a.pops, b.pops) &&
    (a.tags && b.tags ? sameCargoTags({ cargo: a.tags }, { cargo: b.tags }) : a.tags === b.tags)
  );
}

// ---------------------------------------------------------------------------
// bands, chips, arrows

/** The objectives band: its two rows as shown – the distance as the whole number, the bearing to ~0.5°. */
export function sameObjectiveBand(a: { items: readonly ObjectiveItem[] }, b: { items: readonly ObjectiveItem[] }): boolean {
  const x = a.items;
  const y = b.items;
  if (x === y) return true;
  const n = Math.min(2, x.length);
  if (n !== Math.min(2, y.length)) return false;
  for (let i = 0; i < n; i++) if (!sameObjectiveRow(x[i]!, y[i]!)) return false;
  return true;
}

/** One row of the objectives band as shown. */
export function sameObjectiveRow(p: ObjectiveItem, q: ObjectiveItem): boolean {
  if (p.id !== q.id || p.scale !== q.scale || p.training !== q.training || p.trackName !== q.trackName || p.title !== q.title) return false;
  const u = p.progress;
  const v = q.progress;
  if (u !== v && (!u || !v || u.max !== v.max || Math.floor(u.value + 1e-9) !== Math.floor(v.value + 1e-9))) return false;
  if ((p.distance === null) !== (q.distance === null)) return false;
  if (p.distance !== null && Math.round(p.distance) !== Math.round(q.distance!)) return false;
  if (p.angle === q.angle) return true;
  return p.angle !== null && q.angle !== null && angleStep(p.angle) === angleStep(q.angle);
}

/** Event chips: the countdown in whole seconds; the direction dial turns by itself (EventChip.tsx). */
export function sameEventChips(a: { chips: readonly EventChipItem[]; inline?: boolean }, b: { chips: readonly EventChipItem[]; inline?: boolean }): boolean {
  return a.inline === b.inline && sameList(a.chips, b.chips, sameChip);
}

/** One event chip as shown. */
export function sameChip(p: EventChipItem, q: EventChipItem): boolean {
  if (p.key !== q.key || p.kind !== q.kind || p.title !== q.title || p.tone !== q.tone || p.pending !== q.pending) return false;
  if (wholeSeconds(p.secondsLeft) !== wholeSeconds(q.secondsLeft)) return false;
  // the direction itself turns the dial without a redraw (EventChip.tsx `LiveDial`); only whether it shows
  return (p.dirDeg === null) === (q.dirDeg === null);
}

/** A chip's direction dial: the arrow to ~0.5°, its clock-hour label and its whole-degree data-deg. */
export function sameDial(a: { deg: number }, b: { deg: number }): boolean {
  if (a.deg === b.deg) return true;
  const u = normDeg(a.deg);
  const v = normDeg(b.deg);
  return degStep(u) === degStep(v) && Math.round(u) === Math.round(v) && clockHour(u) === clockHour(v);
}

/** Edge arrows and pins: positions in whole pixels (as drawn), directions to ~0.5°, fades as drawn. */
export function sameEdgeArrows(a: { arrows: readonly EdgeArrowMark[] }, b: { arrows: readonly EdgeArrowMark[] }): boolean {
  return sameList(a.arrows, b.arrows, sameEdgeArrow);
}

/** One edge arrow or pin as drawn. */
export function sameEdgeArrow(p: EdgeArrowMark, q: EdgeArrowMark): boolean {
  if (p.key !== q.key || px(p.x) !== px(q.x) || px(p.y) !== px(q.y) || angleStep(p.angle) !== angleStep(q.angle)) return false;
  if (p.color !== q.color || p.label !== q.label || p.count !== q.count || p.small !== q.small || p.shape !== q.shape) return false;
  if (p.icon !== q.icon || p.pin !== q.pin || p.testId !== q.testId) return false;
  // a fade in the 8-bit steps it composites with; the scale and the flash with the two decimals they
  // are written with, a pack's arc as the SVG path its width gives
  if (p.alpha !== q.alpha && (p.alpha === undefined || q.alpha === undefined || Math.round(p.alpha * 255) !== Math.round(q.alpha * 255))) return false;
  if (p.scale !== q.scale && (p.scale === undefined || q.scale === undefined || p.scale.toFixed(2) !== q.scale.toFixed(2))) return false;
  if (p.flash !== q.flash && ((p.flash ?? 0) > 0 !== (q.flash ?? 0) > 0 || (p.flash ?? 0).toFixed(2) !== (q.flash ?? 0).toFixed(2))) return false;
  if (p.arc !== q.arc && (p.arc === undefined || q.arc === undefined || Math.round(p.arc * 1200) !== Math.round(q.arc * 1200))) return false;
  return true;
}

/** The station / goal arrow: its tip in whole pixels, its direction to ~0.5°, its label. */
export function sameHudArrow(a: { arrow: { x: number; y: number; angle: number; label: string } }, b: { arrow: { x: number; y: number; angle: number; label: string } }): boolean {
  const p = a.arrow;
  const q = b.arrow;
  return p === q || (p.label === q.label && px(p.x) === px(q.x) && px(p.y) === px(q.y) && angleStep(p.angle) === angleStep(q.angle));
}

/** The scanner widget: the charge as its lit bar and percent, the analysis percent, the rest as is. */
export function sameScanWidget(a: { d: ScanHudData }, b: { d: ScanHudData }): boolean {
  const p = a.d;
  const q = b.d;
  if (p === q) return true;
  if (p.ready !== q.ready || p.cooldown !== q.cooldown || p.dataFund !== q.dataFund) return false;
  if (p.charge !== q.charge && (Math.round(p.charge * 100) !== Math.round(q.charge * 100) || Math.floor(p.charge * 10 + 1e-6) !== Math.floor(q.charge * 10 + 1e-6))) return false;
  const u = p.analysis;
  const v = q.analysis;
  if (u !== v && (!u || !v || u.label !== v.label || Math.round(u.progress * 100) !== Math.round(v.progress * 100))) return false;
  return deepEqual(p.readout ?? null, q.readout ?? null);
}

// ---------------------------------------------------------------------------
// the radar

/** Radar canvas size (px, CSS) and its display radius – as RadarCanvas draws (Hud.tsx). */
export const RADAR_SIZE = 176;
const RADAR_R = RADAR_SIZE / 2 - 2;

/** Px per world unit on the radar for a range (as RadarCanvas scales). */
export const radarScale = (range: number): number => (range > 0 ? (RADAR_R - 6) / range : 0);

/**
 * Two radar marks at the radar's resolution: `x`, `y` in whole canvas pixels, `radius` in half pixels,
 * `angle` to ~0.5°, every other field as is.
 */
function sameMark(p: object, q: object, s: number): boolean {
  if (p === q) return true;
  const u = p as Record<string, unknown>;
  const v = q as Record<string, unknown>;
  let n = 0;
  for (const k in u) {
    n++;
    const x = u[k];
    const y = v[k];
    if (x === y) continue;
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (k === 'angle') {
      if (angleStep(x) !== angleStep(y)) return false;
    } else if (k === 'radius') {
      if (Math.round(x * s * 2) !== Math.round(y * s * 2)) return false;
    } else if (Math.round(x * s) !== Math.round(y * s)) return false;
  }
  for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) n--;
  return n === 0;
}

function sameMarks(a: readonly object[] | undefined, b: readonly object[] | undefined, s: number, reach = -1): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (!sameMark(p, q, s)) return false;
    // drawn only within a distance (signals: in range or pinned to the rim, places, survey, pirates)
    if (reach >= 0 && inReach(p, reach) !== inReach(q, reach)) return false;
  }
  return true;
}

const inReach = (m: object, reach: number): boolean => {
  const { x, y } = m as { x: number; y: number };
  return Math.hypot(x, y) <= reach;
};

/** What the radar draws (Hud.tsx `RadarScope`). */
export interface RadarDrawProps {
  range: number;
  contacts: readonly object[];
  stations: readonly object[];
  threats?: readonly object[] | undefined;
  angle: number;
  ring: number;
  signals: readonly object[];
  places: readonly object[];
  survey: readonly object[];
  pirates: readonly object[];
  sectors: { offset: { x: number; y: number }; groups: readonly unknown[] } | null;
  security: string | null;
  sites: readonly object[];
  guild: readonly object[];
}

/**
 * The radar: every contact at the radar's pixel resolution (positions in whole canvas pixels at the
 * current range, sizes in half pixels, headings to ~0.5°), the sector borders by their lines and their
 * offset in pixels.
 */
export function sameRadar(a: RadarDrawProps, b: RadarDrawProps): boolean {
  if (a.range !== b.range || a.ring !== b.ring || a.security !== b.security) return false;
  if (angleStep(a.angle) !== angleStep(b.angle)) return false;
  const s = radarScale(a.range);
  if (!sameSectors(a.sectors, b.sectors, s)) return false;
  return (
    sameMarks(a.contacts, b.contacts, s) &&
    sameMarks(a.stations, b.stations, s) &&
    sameMarks(a.threats, b.threats, s) &&
    sameMarks(a.sites, b.sites, s) &&
    sameMarks(a.guild, b.guild, s) &&
    sameMarks(a.signals, b.signals, s, a.range) &&
    sameMarks(a.places, b.places, s, a.range) &&
    sameMarks(a.survey, b.survey, s, a.range) &&
    sameMarks(a.pirates, b.pirates, s, a.range + 30)
  );
}

function sameSectors(p: RadarDrawProps['sectors'], q: RadarDrawProps['sectors'], s: number): boolean {
  if (p === q) return true;
  if (!p || !q) return false;
  if (Math.round(p.offset.x * s) !== Math.round(q.offset.x * s) || Math.round(p.offset.y * s) !== Math.round(q.offset.y * s)) return false;
  return p.groups === q.groups || deepEqual(p.groups, q.groups);
}

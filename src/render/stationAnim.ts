// Pure helpers for the station animations and the camera view at the dock.
import type { HomeSlot } from '../data/home';
import { frameDistance } from './CameraRig';
import { slotCircles } from './home/moduleLook';
import type { Vec2 } from '../sim/math/vec2';
import { DOCKING_TICKS, smoothstep, type DockState } from '../sim/station/dock';
import type { StationDef, StationId } from '../sim/world/stations';

export const BEACON_PERIOD = 1.6;
export const BEACON_FLASH = 0.22;
export const BEACON_DIM = 0.12;

/** Beacon brightness 0..1: a short flash once per period, each beacon with its own offset. */
export function beaconLevel(time: number, index: number): number {
  const phase = (time / BEACON_PERIOD + index * 0.37) % 1;
  const t = phase * BEACON_PERIOD;
  if (t > BEACON_FLASH) return BEACON_DIM;
  // fast attack, slower decay
  const k = t / BEACON_FLASH;
  return BEACON_DIM + (1 - BEACON_DIM) * Math.sin(Math.PI * Math.sqrt(k));
}

const GUIDE_PERIOD = 1.2;

/** The dock guide lights chase outwards (0 = nearest to the station). */
export function guideLightLevel(time: number, index: number, count: number): number {
  const phase = (time / GUIDE_PERIOD) % 1;
  const center = (index + 0.5) / (count + 1);
  const d = Math.abs(phase - center);
  return 0.15 + 0.85 * Math.max(0, 1 - d * (count + 1) * 1.2);
}

export interface DockView {
  /** Point of the game plane the camera looks at. */
  target: Vec2;
  distance: number;
}

/** The "dock" view: the station and the docked ship in frame. */
export function dockView(station: StationDef, shipRadius: number): DockView {
  const reach = station.radius + shipRadius + 1;
  const dir = { x: Math.cos(station.portAngle), y: Math.sin(station.portAngle) };
  const along = (reach - station.radius) / 2;
  return {
    target: { x: station.pos.x + dir.x * along, y: station.pos.y + dir.y * along },
    distance: Math.max(station.radius + reach, 24) * 1.35 + 10,
  };
}

/**
 * How many units to shift the camera target right (sim +x) so the scene centre sits in the middle
 * of the free part of the screen when a panel covers `insetPx` pixels on the right.
 */
export function insetShift(insetPx: number, viewportPx: number, distance: number, fovDeg: number, aspect: number): number {
  if (insetPx <= 0 || viewportPx <= 0) return 0;
  const visibleWidth = 2 * distance * Math.tan((fovDeg * Math.PI) / 360) * aspect;
  return (insetPx / 2 / viewportPx) * visibleWidth;
}

/** Dock clamp jaws (art batch D): open angle of `Clamp_Jaw_L` about local +Y (R turns the other way). */
export const CLAMP_JAW_OPEN = (35 * Math.PI) / 180;
/** The jaws open again in about this many seconds after the ship leaves. */
const CLAMP_JAW_OPEN_TIME = 0.9;

/**
 * Closure of a station's clamp jaws, 0 = open .. 1 = closed (the model's rest pose): open while no
 * ship is held, closing along the docking latch and closed while the ship is docked.
 */
export function clampJawTarget(dock: DockState, tick: number, stationId: StationId): number {
  if (dock.mode === 'flying' || dock.stationId !== stationId) return 0;
  if (dock.mode === 'docked') return 1;
  return smoothstep((tick - dock.startTick) / DOCKING_TICKS);
}

/** One frame of the jaws: they follow a closing latch exactly and open at a steady pace. */
export function stepClampJaw(current: number, target: number, dt: number, reducedMotion = false): number {
  if (reducedMotion || target >= current) return target;
  return Math.max(target, current - dt / CLAMP_JAW_OPEN_TIME);
}

/**
 * The camera pitch and the view share the module focus is framed for: the free part of the screen left
 * of the hub panel, which covers the right ~half at 1280 × 720 and 1920 × 1080 (≈ 0.85 : 1).
 */
const FOCUS_FRAME = { fovDeg: 50, aspect: 0.85, pitchDeg: 55 };
/** Share of the free view's half-extent the module may fill. */
const FOCUS_MARGIN = 0.75;
/** The focus view never comes closer than this (the module keeps a little context around it). */
const FOCUS_MIN_DISTANCE = 9;
/** Front slots frame the docked ship too (the paint shop paints it). */
const FOCUS_WITH_SHIP: ReadonlySet<HomeSlot> = new Set(['fl', 'fr']);

/**
 * The dock camera framing the home module at `slot` ("Show" in the Development tab, M4c): the
 * module's footprint (and the docked ship next to a front slot) in frame, centred.
 */
export function moduleFocusView(station: StationDef, slot: HomeSlot, shipRadius: number): DockView {
  const circles = slotCircles(station, slot);
  if (FOCUS_WITH_SHIP.has(slot)) {
    const d = station.radius + shipRadius + 1;
    circles.push({ x: station.pos.x + Math.cos(station.portAngle) * d, y: station.pos.y + Math.sin(station.portAngle) * d, r: shipRadius });
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const corners = [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: -hx, y: hy },
    { x: hx, y: hy },
  ];
  return { target, distance: Math.max(FOCUS_MIN_DISTANCE, frameDistance(corners, FOCUS_FRAME, FOCUS_MARGIN)) };
}

/** How long the dock camera takes to fly to a module and back (s). */
export const FOCUS_BLEND_TIME = 0.6;

/** One frame of the focus blend (0 = dock view .. 1 = module view); reduced motion = a cut. */
export function stepFocusBlend(current: number, target: number, dt: number, reducedMotion = false): number {
  if (reducedMotion) return target;
  const step = dt / FOCUS_BLEND_TIME;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

/** The camera between the dock view `a` and a module view `b` (eased blend `k` 0..1). */
export function mixDockView(a: DockView, b: DockView, k: number): DockView {
  const t = smoothstep(k);
  return {
    target: { x: a.target.x + (b.target.x - a.target.x) * t, y: a.target.y + (b.target.y - a.target.y) * t },
    distance: a.distance + (b.distance - a.distance) * t,
  };
}

// Shipyard hangar camera (Shipyard 2.0, plan section 3): orbit around the ship, tilt between a
// 3/4 view and straight top-down, pan, zoom – all with a damped goal pose – and the picking math
// that maps a pointer ray onto a hangar cell for any camera pose. Pure math on three.js vectors,
// no scene graph, so it is unit-tested without WebGL.
import { PerspectiveCamera, Ray, Vector3 } from 'three';

/** Top surface of the hangar floor (glTF y). */
export const HANGAR_FLOOR = -0.37;
export const HANGAR_FOV = 34;

/** Tilt = camera elevation above the floor plane: straight down … the lowest 3/4 view. */
export const PITCH_TOP = Math.PI / 2;
export const PITCH_MIN = (35 * Math.PI) / 180;
/** The view the editor opens with (the original fixed hangar view). */
export const PITCH_DEFAULT = (55 * Math.PI) / 180;

export const ZOOM_MIN = 0.6;
/** Zoom when the editor opens – the ship centred and larger, the hangar edge just outside. */
export const ZOOM_DEFAULT = 1.3;
export const ZOOM_MAX = 2.6;
export const PAN_LIMIT = 8;

/** World units that must fit in the view at zoom 1 (platform 17 + margin). */
const FIT_SIZE = 16.4;
/** Goal-following rate (1/s) of the damped camera. */
const DAMPING = 12;

/** Held-key speeds: orbit (rad/s), tilt (rad/s), pan (view heights per second). */
export const ORBIT_SPEED = Math.PI / 2;
export const TILT_SPEED = (50 * Math.PI) / 180;
export const PAN_SPEED = 0.7;
/** Pointer drag: radians per pixel (orbit) and per pixel (tilt). */
const DRAG_ORBIT = 0.008;
const DRAG_TILT = 0.006;

/**
 * Picked part bodies: a cell box `BODY_HALF` around the cell centre and `BODY_HEIGHT` above the floor.
 * Low and inset enough that a ray aimed at an empty cell's centre on the floor never clips a neighbour's
 * box for any tilt ≥ PITCH_MIN (0.55 · tan 35° ≈ 0.385 > 0.35).
 */
const BODY_HALF = 0.45;
const BODY_HEIGHT = 0.35;

export interface HangarPose {
  /** Orbit angle around the vertical axis (rad); 0 = the bow points up on the screen. */
  yaw: number;
  /** Elevation above the floor plane (rad): PITCH_MIN … PITCH_TOP (top-down). */
  pitch: number;
  zoom: number;
  /** Look-at point on the floor (world x, z). */
  panX: number;
  panZ: number;
}

export interface Cell {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Keeps a pose inside the allowed tilt, zoom and pan range (yaw is free). */
export function clampPose(p: HangarPose): HangarPose {
  return {
    yaw: p.yaw,
    pitch: clamp(p.pitch, PITCH_MIN, PITCH_TOP),
    zoom: clamp(p.zoom, ZOOM_MIN, ZOOM_MAX),
    panX: clamp(p.panX, -PAN_LIMIT, PAN_LIMIT),
    panZ: clamp(p.panZ, -PAN_LIMIT, PAN_LIMIT),
  };
}

/** Camera distance from the look-at point that fits the platform into the viewport at this tilt. */
export function fitDistance(pitch: number, aspect: number, zoom: number): number {
  const t = Math.tan((HANGAR_FOV * Math.PI) / 360);
  const byHeight = (FIT_SIZE * Math.sin(pitch) * 0.5 + 1.2) / t;
  const byWidth = (FIT_SIZE * 0.5) / (t * Math.max(1e-3, aspect));
  return Math.max(byHeight, byWidth) / zoom;
}

/** Ground direction that points up on the screen (the camera's forward along the floor). */
export function screenUpOnFloor(yaw: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Ground direction that points right on the screen. */
export function screenRightOnFloor(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/**
 * Places a perspective camera for a pose. `up` is the screen-up floor direction, so the basis stays
 * well defined even when looking straight down.
 */
export function placeCamera(camera: PerspectiveCamera, pose: HangarPose, aspect: number): void {
  const d = fitDistance(pose.pitch, aspect, pose.zoom);
  const flat = Math.cos(pose.pitch);
  camera.position.set(pose.panX + d * flat * Math.sin(pose.yaw), HANGAR_FLOOR + d * Math.sin(pose.pitch), pose.panZ + d * flat * Math.cos(pose.yaw));
  screenUpOnFloor(pose.yaw, camera.up);
  camera.lookAt(pose.panX, HANGAR_FLOOR, pose.panZ);
}

/** Hangar cell (ship grid) of a world floor point – the grid frame is the yard turned a quarter. */
export function worldToCell(wx: number, wz: number): Cell {
  // yard.rotation.y = π/2: ship +x (bow) = world −z, ship +y (port) = world −x
  return { x: Math.round(-wz) + 0, y: Math.round(-wx) + 0 };
}

/** World floor point (x, z) of a cell centre. */
export function cellToWorld(x: number, y: number): { x: number; z: number } {
  return { x: -y + 0, z: -x + 0 };
}

const hitPoint = new Vector3();
const boxMin = new Vector3();
const boxMax = new Vector3();

/**
 * The cell under a pointer ray. The ray is cast onto the hangar floor plane; a part body (a low box
 * over an occupied cell) in front of that point wins, so a tilted view grabs the part the cursor is
 * over rather than the floor cell behind it. Null when the ray misses the floor (pointing at the sky).
 */
export function pickCell(ray: Ray, bodies: readonly Cell[] = []): Cell | null {
  let best: Cell | null = null;
  let bestT = Infinity;
  for (const c of bodies) {
    const w = cellToWorld(c.x, c.y);
    boxMin.set(w.x - BODY_HALF, HANGAR_FLOOR, w.z - BODY_HALF);
    boxMax.set(w.x + BODY_HALF, HANGAR_FLOOR + BODY_HEIGHT, w.z + BODY_HALF);
    const t = rayBoxDistance(ray, boxMin, boxMax);
    if (t !== null && t < bestT) {
      bestT = t;
      best = c;
    }
  }
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return best;
  const t = (HANGAR_FLOOR - ray.origin.y) / dy;
  if (t < 0) return best;
  if (best && bestT <= t) return best;
  ray.at(t, hitPoint);
  return worldToCell(hitPoint.x, hitPoint.z);
}

/** Entry distance of a ray into an axis-aligned box (slab test), or null. */
function rayBoxDistance(ray: Ray, min: Vector3, max: Vector3): number | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = ray.origin[axis];
    const d = ray.direction[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let a = (min[axis] - o) / d;
    let b = (max[axis] - o) / d;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return null;
  }
  if (hi < 0) return null;
  return Math.max(0, lo);
}

/** Moves `current` toward `goal`; reduced motion (or a long frame) snaps. Returns true if it moved. */
export function dampPose(current: HangarPose, goal: HangarPose, dt: number, snap: boolean): boolean {
  const k = snap ? 1 : 1 - Math.exp(-DAMPING * Math.max(0, dt));
  let moved = false;
  for (const key of ['yaw', 'pitch', 'zoom', 'panX', 'panZ'] as const) {
    const diff = goal[key] - current[key];
    if (diff === 0) continue;
    // close enough: land exactly so the camera (and the UI that follows it) comes to rest
    current[key] = Math.abs(diff) < 1e-4 ? goal[key] : current[key] + diff * k;
    moved = true;
  }
  return moved;
}

/** Yaw equivalent to `target` that is nearest to `from` (reset turns the short way round). */
export function nearestYaw(from: number, target: number): number {
  const turn = 2 * Math.PI;
  return target + Math.round((from - target) / turn) * turn;
}

/**
 * The hangar camera controller: input changes the goal pose, `update` eases the current pose toward it
 * and `apply` puts the current pose on a three.js camera.
 */
export class HangarCamera {
  readonly goal: HangarPose = { yaw: 0, pitch: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, panX: 0, panZ: 0 };
  readonly current: HangarPose = { ...this.goal };
  /** Viewport height in px – converts pixel drags to world units. */
  viewportHeight = 1;
  aspect = 1;
  /** Reduced motion: the camera jumps to the goal instead of easing. */
  reducedMotion = false;

  private set(next: Partial<HangarPose>): void {
    Object.assign(this.goal, clampPose({ ...this.goal, ...next }));
  }

  /** World units per screen pixel at the look-at point. */
  unitsPerPixel(pose: HangarPose = this.current): number {
    const d = fitDistance(pose.pitch, this.aspect, pose.zoom);
    return (2 * d * Math.tan((HANGAR_FOV * Math.PI) / 360)) / Math.max(1, this.viewportHeight);
  }

  zoomBy(deltaY: number): void {
    this.set({ zoom: this.goal.zoom * Math.exp(-deltaY * 0.0012) });
  }

  orbit(radians: number): void {
    this.set({ yaw: this.goal.yaw + radians });
  }

  tilt(radians: number): void {
    this.set({ pitch: this.goal.pitch + radians });
  }

  /** Pointer drag that orbits (horizontal) and tilts (vertical): dragging down looks more from above. */
  orbitDrag(dx: number, dy: number): void {
    this.set({ yaw: this.goal.yaw - dx * DRAG_ORBIT, pitch: this.goal.pitch + dy * DRAG_TILT });
  }

  /** Grab-the-floor pan by screen pixels: the floor follows the pointer. */
  panBy(dx: number, dy: number): void {
    const upp = this.unitsPerPixel(this.goal);
    const right = screenRightOnFloor(this.goal.yaw);
    const up = screenUpOnFloor(this.goal.yaw);
    // a screen pixel up the view covers 1/sin(pitch) of floor
    const along = (dy * upp) / Math.max(0.2, Math.sin(this.goal.pitch));
    this.set({ panX: this.goal.panX - right.x * dx * upp + up.x * along, panZ: this.goal.panZ - right.z * dx * upp + up.z * along });
  }

  /** Held keys for `dt` seconds: orbit −1/+1, tilt −1/+1 (+1 = toward top-down), pan in screen axes. */
  keys(dt: number, input: { orbit: number; tilt: number; panX: number; panY: number }): void {
    if (input.orbit) this.orbit(input.orbit * ORBIT_SPEED * dt);
    if (input.tilt) this.tilt(input.tilt * TILT_SPEED * dt);
    if (input.panX || input.panY) {
      // view heights per second, as pixels of the current viewport
      const px = PAN_SPEED * this.viewportHeight * dt;
      this.panBy(-input.panX * px, input.panY * px);
    }
  }

  /** Centre the view on a floor point at the default zoom; orbit and tilt stay. */
  centre(at: { x: number; z: number }): void {
    this.set({ zoom: ZOOM_DEFAULT, panX: at.x, panZ: at.z });
  }

  /** "Top view" (Home): straight down, bow up, centred on `at`, default zoom – eased. */
  topView(at: { x: number; z: number }): void {
    this.set({ yaw: nearestYaw(this.current.yaw, 0), pitch: PITCH_TOP, zoom: ZOOM_DEFAULT, panX: at.x, panZ: at.z });
  }

  /** The goal looks (nearly) straight down – the "Top view" button shows its way back. */
  isTopView(): boolean {
    return this.goal.pitch >= PITCH_TOP - 0.02;
  }

  /** Home / "Top view" as a toggle: from the top view back to the default 3/4 view, eased. */
  toggleTopView(at: { x: number; z: number }): void {
    if (!this.isTopView()) this.topView(at);
    else this.set({ yaw: nearestYaw(this.current.yaw, 0), pitch: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, panX: at.x, panZ: at.z });
  }

  /** Editor opens: the default 3/4 view centred on `at`, without easing. */
  frame(at: { x: number; z: number }): void {
    this.set({ yaw: 0, pitch: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, panX: at.x, panZ: at.z });
    Object.assign(this.current, this.goal);
  }

  /** Eases toward the goal; true while the camera moves. */
  update(dt: number): boolean {
    return dampPose(this.current, this.goal, dt, this.reducedMotion);
  }

  apply(camera: PerspectiveCamera): void {
    placeCamera(camera, this.current, this.aspect);
  }
}


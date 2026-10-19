import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../sim/math/angle';
import { length, scale, type Vec2 } from '../sim/math/vec2';

/** Camera offset from its target: above it and "south" (+z), pitch in degrees from the horizontal plane. */
export function cameraOffset(distance: number, pitchDeg: number): Vector3 {
  const pitch = (pitchDeg * Math.PI) / 180;
  return new Vector3(0, distance * Math.sin(pitch), distance * Math.cos(pitch));
}

/** How many seconds of flight ahead the camera shows. */
const LOOK_AHEAD_TIME = 0.35;

/** Camera shift in the direction of flight (sim coordinates), capped at maxOffset. */
export function lookAheadOffset(velocity: Vec2, maxOffset = 12): Vec2 {
  const offset = scale(velocity, LOOK_AHEAD_TIME);
  const len = length(offset);
  return len > maxOffset ? scale(offset, maxOffset / len) : offset;
}

/** Camera shake (M3.8): how far a full-strength blow throws the camera at the reference zoom (world units). */
const SHAKE_REACH = 0.55;
/** How fast a shake dies out (1/s). */
const SHAKE_DECAY = 6.5;
/** The zoom the shake reach (and the flight markers' sizes) were tuned at. */
export const REFERENCE_DISTANCE = 28;

/** Flight camera zoom (readability pass R1): the default shows the ship with room around it. */
export const DEFAULT_DISTANCE = 48;
export const MIN_DISTANCE = 15;
export const MAX_DISTANCE = 210;
/**
 * Share of the half-screen the combat framing may use: the HUD corners (navigation, console, radar)
 * cover the outer band, so the attacker should land inside them.
 */
export const COMBAT_MARGIN = 0.62;
/** The combat zoom-out never goes past this (pirates would shrink to specks). */
export const COMBAT_MAX_DISTANCE = 150;
/**
 * How fast the combat zoom-out opens (1/s), how fast it narrows while the fight goes on (a Jackal's
 * hit-and-run must not pump the camera) and how fast it returns after the fight.
 */
const COMBAT_OUT_RATE = 1.6;
const COMBAT_IN_RATE = 0.35;
const COMBAT_BACK_RATE = 0.8;
/** The fight must be over this long before the camera starts to return (no pumping at the aggro edge). */
const COMBAT_HOLD = 2.5;
/** In a fight the camera's aim leans this share of the way towards the attacker, at most LEAN_MAX u. */
const LEAN_SHARE = 0.3;
const LEAN_MAX = 40;
/** How fast the lean follows (1/s) – a switch to another attacker slides, it does not jump. */
const LEAN_RATE = 1.2;

/** Where the camera's aim leans in a fight: part of the way to the attacker (`rel` from the ship). */
export function combatLean(rel: Vec2): Vec2 {
  const d = Math.hypot(rel.x, rel.y);
  const k = d > 1e-6 ? Math.min(LEAN_SHARE * d, LEAN_MAX) / d : 0;
  return { x: rel.x * k, y: rel.y * k };
}

export interface FrameView {
  /** Vertical field of view (degrees). */
  fovDeg: number;
  /** Width / height. */
  aspect: number;
  /** Camera pitch from the horizontal plane (degrees). */
  pitchDeg: number;
}

/**
 * Camera distance at which every point fits on screen. `points` are offsets on the game plane from the
 * camera's target (sim coordinates: +y = north = up on screen); `margin` is the share of the half-screen
 * they may use (0.8 = keep a 10 % border on each side). For a camera pitched by θ at distance D a plane
 * point (x right, z towards the camera) sits at depth D − z·cosθ, so it fits when
 *   D ≥ |x| / (m·tan φh) + z·cosθ   and   D ≥ |z|·sinθ / (m·tan φ) + z·cosθ.
 */
export function frameDistance(points: readonly Vec2[], view: FrameView, margin = 0.8): number {
  const pitch = (view.pitchDeg * Math.PI) / 180;
  const tanV = Math.tan((view.fovDeg * Math.PI) / 360);
  const tanH = tanV * view.aspect;
  let need = 0;
  for (const p of points) {
    const x = p.x;
    const z = -p.y;
    const along = z * Math.cos(pitch);
    need = Math.max(need, Math.abs(x) / (margin * tanH) + along, (Math.abs(z) * Math.sin(pitch)) / (margin * tanV) + along);
  }
  return need;
}

export class CameraRig {
  private chosen = DEFAULT_DISTANCE;
  /** Settings / reduced motion: no shake at all. */
  shakeEnabled = true;
  private shakeAmp = 0;
  private shakeClock = 0;
  private readonly shakeOffset = new Vector3();
  readonly minDistance = MIN_DISTANCE;
  readonly maxDistance = MAX_DISTANCE;
  readonly pitchDeg = 55;
  private readonly target = new Vector3();
  private initialized = false;
  /** The combat zoom-out (smoothed); never below the player's zoom. */
  private combatDistance = DEFAULT_DISTANCE;
  /** Seconds since the last frame with a fight (the hold before the camera returns). */
  private sinceCombat = Infinity;
  /** A fight raised the camera and it has not fully returned yet. */
  private engaged = false;
  /** The player zoomed (wheel, a test hook) during the fight – the combat zoom-out keeps out until it ends. */
  private overridden = false;
  /** The smoothed lean of the camera's aim towards the attacker (sim coordinates). */
  readonly combatLean = { x: 0, y: 0 };

  constructor(readonly camera: PerspectiveCamera) {}

  /** The zoom the player chose (wheel, or set directly by tests and fixtures). */
  get distance(): number {
    return this.chosen;
  }

  /** An explicit zoom always wins: during a fight (or its return) the combat zoom-out stands down. */
  set distance(value: number) {
    this.chosen = value;
    if (this.engaged || this.sinceCombat < COMBAT_HOLD) {
      this.overridden = true;
      this.engaged = false;
    }
    this.combatDistance = value;
  }

  onWheel(deltaY: number): void {
    this.distance = clamp(this.distance * Math.exp(deltaY * 0.001), this.minDistance, this.maxDistance);
  }

  /** The distance the flight camera uses now: the player's zoom, or further out while a fight needs it. */
  get viewDistance(): number {
    return Math.max(this.distance, this.combatDistance);
  }

  /** Is the combat zoom-out pulling the camera out now (tests)? */
  get combatZoomActive(): boolean {
    return this.combatDistance > this.distance + 0.5;
  }

  /**
   * Combat zoom-out, once per frame: `required` = the distance that frames the ship and the nearest
   * attacker (null = no fight, or the setting is off). Opens smoothly, holds a moment after the fight,
   * then returns smoothly to the player's zoom.
   */
  frameCombat(required: number | null, dt: number, lean: Vec2 | null = null): void {
    // the lean holds through the pause after the fight, then slides back with the zoom
    const leanGoal = lean ?? (this.sinceCombat + dt < COMBAT_HOLD ? this.combatLean : { x: 0, y: 0 });
    const k = 1 - Math.exp(-dt * LEAN_RATE);
    this.combatLean.x += (leanGoal.x - this.combatLean.x) * k;
    this.combatLean.y += (leanGoal.y - this.combatLean.y) * k;
    if (this.overridden) {
      // the player's zoom rules until the fight is over (and its hold has passed)
      if (required !== null) this.sinceCombat = 0;
      else this.sinceCombat += dt;
      if (this.sinceCombat >= COMBAT_HOLD) this.overridden = false;
      this.combatDistance = this.distance;
      return;
    }
    if (required !== null) {
      this.sinceCombat = 0;
      this.engaged = true;
    } else this.sinceCombat += dt;
    // outside a fight (and its return) the camera is the player's zoom; the wheel also sets the floor
    if (!this.engaged || this.combatDistance < this.distance) this.combatDistance = this.distance;
    if (!this.engaged || (required === null && this.sinceCombat < COMBAT_HOLD)) return;
    const goal = required !== null ? Math.max(this.distance, Math.min(COMBAT_MAX_DISTANCE, required)) : this.distance;
    const rate = goal > this.combatDistance ? COMBAT_OUT_RATE : required !== null ? COMBAT_IN_RATE : COMBAT_BACK_RATE;
    this.combatDistance += (goal - this.combatDistance) * (1 - Math.exp(-dt * rate));
    if (required === null && this.combatDistance - this.distance < 0.25) {
      this.combatDistance = this.distance;
      this.engaged = false;
    }
  }

  /** A hit or an impact (M3.8): `intensity` 0..1, the strongest recent blow wins. */
  shake(intensity: number): void {
    if (!this.shakeEnabled || !(intensity > 0)) return;
    this.shakeAmp = Math.min(1, Math.max(this.shakeAmp, intensity));
  }

  /** `distance` temporarily replaces the view distance (e.g. the dock view). */
  update(focus: Vector3, dt: number, distance = this.viewDistance): void {
    if (!this.initialized) {
      this.target.copy(focus);
      this.initialized = true;
    } else {
      this.target.lerp(focus, 1 - Math.exp(-dt * 10));
    }
    this.camera.position.copy(this.target).add(cameraOffset(distance, this.pitchDeg));
    this.camera.lookAt(this.target);
    this.applyShake(dt, distance);
  }

  /** Moves the whole camera (not its aim) on the plane – a jolt that never tilts the horizon. */
  private applyShake(dt: number, distance: number): void {
    if (!this.shakeEnabled) this.shakeAmp = 0;
    if (this.shakeAmp < 1e-4) {
      this.shakeAmp = 0;
      return;
    }
    this.shakeClock += dt;
    const t = this.shakeClock;
    // two incommensurate wobbles per axis – rough, not a regular buzz
    const k = this.shakeAmp * this.shakeAmp * SHAKE_REACH * (distance / REFERENCE_DISTANCE);
    this.shakeOffset.set(Math.sin(t * 61) * 0.7 + Math.sin(t * 37 + 1.3) * 0.3, 0, Math.sin(t * 53 + 0.4) * 0.7 + Math.sin(t * 29 + 2.1) * 0.3).multiplyScalar(k);
    this.camera.position.add(this.shakeOffset);
    this.shakeAmp *= Math.exp(-dt * SHAKE_DECAY);
  }
}

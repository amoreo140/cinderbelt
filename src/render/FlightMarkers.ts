// Flight markers (M3.8) on the plane of the game, drawn over everything (no depth test):
// - the flight-path marker: a ring with wings and a chevron ahead of the ship in the direction it
//   actually moves (not where the bow points), with a faint dashed trail from the hull;
// - the bow arrow: a small solid arrowhead just ahead of the hull in the direction the bow points (not
//   the direction of travel); bright and larger for a few seconds after undocking or a load, then dimmed;
// - the dampers' stopping point: a bar across the path where the ship will come to rest;
// - the collision ring: a dashed ring around the rock the path hits (amber → red with urgency),
//   and the flight-path marker takes the same colour.
// Sizes follow the camera distance, so the markers read the same at every zoom.
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShapeGeometry,
  Shape,
  type Material,
} from 'three';
import type { CollisionWarning } from '../game/flightAssist';
import { add, length, scale, type Vec2 } from '../sim/math/vec2';
import { PALETTE } from '../ui/theme/tokens';
import { simToWorld } from './coords';

/** Marker height over the plane (above ship decks, below nothing – depth test is off anyway). */
const Y = 0.2;
/** The default camera distance – sizes are 1× here. */
const BASE_DISTANCE = 28;

export interface FlightMarkerInput {
  pos: Vec2;
  vel: Vec2;
  /** Ship bounding radius. */
  radius: number;
  /** Where the dampers stop the ship, or null (dampers off, or a drift they cannot brake). */
  stop: Vec2 | null;
  /** Show the flight-path marker and the stopping point (setting). */
  marker: boolean;
  collision: CollisionWarning | null;
  /** Bow direction (rad, sim angle). */
  angle: number;
  cameraDistance: number;
  /** Seconds (animation clock). */
  time: number;
  reducedMotion: boolean;
}

/** The bow arrow is emphasised this long after the ship starts flying (s), easing out over the last part. */
const BOW_EMPHASIS = 4;
/** A jump of the ship by more than this (u) between frames counts as a fresh start (a load, a teleport). */
const BOW_JUMP = 5;

/** Smoothstep 0..1 between a and b. */
const ramp = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Flat ring sectors (a dashed ring) of radius 1 with the given relative thickness. */
export function dashedRing(dashes: number, fill: number, thickness: number): BufferGeometry {
  const pos: number[] = [];
  const step = (Math.PI * 2) / dashes;
  const seg = 4;
  for (let d = 0; d < dashes; d++) {
    const a0 = d * step;
    const a1 = a0 + step * fill;
    for (let s = 0; s < seg; s++) {
      const t0 = a0 + ((a1 - a0) * s) / seg;
      const t1 = a0 + ((a1 - a0) * (s + 1)) / seg;
      const p = (r: number, t: number) => [Math.cos(t) * r, 0, Math.sin(t) * r];
      const [a, b, c, e] = [p(1, t0), p(1 + thickness, t0), p(1 + thickness, t1), p(1, t1)];
      pos.push(...a!, ...b!, ...c!, ...a!, ...c!, ...e!);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export class FlightMarkers {
  readonly object = new Group();
  private readonly prograde = new Group();
  private readonly trail: Line;
  private readonly stop = new Group();
  private readonly bow: Mesh;
  private readonly bowMat: MeshBasicMaterial;
  /** Animation time the bow emphasis started, or null (not flying). */
  private bowSince: number | null = null;
  private bowLastX = 0;
  private bowLastY = 0;
  private readonly obstacle: Mesh;
  private readonly obstacleInner: Mesh;
  private readonly glowMat: MeshBasicMaterial;
  private readonly stopMat: MeshBasicMaterial;
  private readonly trailMat: LineDashedMaterial;
  private readonly obstacleMat: MeshBasicMaterial;
  private readonly obstacleInnerMat: MeshBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly glow = new Color(PALETTE.glow);
  private readonly warn = new Color(PALETTE.warn);
  private readonly bad = new Color(PALETTE.bad);
  private readonly tint = new Color();

  constructor() {
    const basic = (color: string, opacity: number) =>
      this.own(new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    this.glowMat = basic(PALETTE.glow, 0.9);
    this.stopMat = basic(PALETTE.hull, 0.75);
    this.bowMat = basic(PALETTE.hullHi, 0.4);
    this.obstacleMat = basic(PALETTE.warn, 0.9);
    this.obstacleInnerMat = basic(PALETTE.warn, 0.35);
    this.trailMat = this.own(new LineDashedMaterial({ color: PALETTE.glow, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));

    // flight-path marker: ring, two wings across the path, a chevron ahead (local +x = direction of travel)
    const ring = new Mesh(this.geo(new RingGeometry(0.42, 0.56, 36).rotateX(-Math.PI / 2)), this.glowMat);
    const wing = this.geo(new PlaneGeometry(0.12, 0.42).rotateX(-Math.PI / 2));
    const left = new Mesh(wing, this.glowMat);
    left.position.set(0, 0, -0.84);
    const right = new Mesh(wing, this.glowMat);
    right.position.set(0, 0, 0.84);
    const chevron = new Shape();
    chevron.moveTo(1.3, 0);
    chevron.lineTo(1.0, 0.3);
    chevron.lineTo(0.84, 0.3);
    chevron.lineTo(1.14, 0);
    chevron.lineTo(0.84, -0.3);
    chevron.lineTo(1.0, -0.3);
    chevron.closePath();
    const nose = new Mesh(this.geo(new ShapeGeometry(chevron).rotateX(-Math.PI / 2)), this.glowMat);
    this.prograde.add(ring, left, right, nose);

    // bow arrow: a solid arrowhead with a notch at the back (local +x = the bow)
    const arrow = new Shape();
    arrow.moveTo(0.5, 0);
    arrow.lineTo(-0.3, 0.42);
    arrow.lineTo(-0.1, 0);
    arrow.lineTo(-0.3, -0.42);
    arrow.closePath();
    this.bow = new Mesh(this.geo(new ShapeGeometry(arrow).rotateX(-Math.PI / 2)), this.bowMat);

    const trailGeo = this.geo(new BufferGeometry());
    trailGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    this.trail = new Line(trailGeo, this.trailMat);

    // stopping point: a bar across the path with short ticks pointing back at the ship
    const bar = new Mesh(this.geo(new PlaneGeometry(0.14, 1.5).rotateX(-Math.PI / 2)), this.stopMat);
    const tick = this.geo(new PlaneGeometry(0.36, 0.12).rotateX(-Math.PI / 2));
    const tickA = new Mesh(tick, this.stopMat);
    tickA.position.set(-0.18, 0, -0.69);
    const tickB = new Mesh(tick, this.stopMat);
    tickB.position.set(-0.18, 0, 0.69);
    this.stop.add(bar, tickA, tickB);

    this.obstacle = new Mesh(this.geo(dashedRing(28, 0.62, 0.05)), this.obstacleMat);
    this.obstacleInner = new Mesh(this.geo(new RingGeometry(1, 1.012, 72).rotateX(-Math.PI / 2)), this.obstacleInnerMat);

    for (const o of [this.bow, this.prograde, this.trail, this.stop, this.obstacle, this.obstacleInner]) {
      o.renderOrder = 20;
      o.traverse((c) => (c.renderOrder = 20));
      o.visible = false;
      this.object.add(o);
    }
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private own<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** Not flying (docked, destroyed): the next flight restarts the bow emphasis. */
  rest(): void {
    this.bowSince = null;
    this.bow.visible = false;
  }

  update(p: FlightMarkerInput): void {
    const zoom = Math.min(8, Math.max(0.7, p.cameraDistance / BASE_DISTANCE));
    const speed = length(p.vel);
    const show = p.marker ? ramp(speed, 0.6, 2.2) : 0;
    const c = p.collision;
    // collision colour: amber while there is time, red when close
    if (c) this.tint.copy(this.warn).lerp(this.bad, ramp(c.urgency, 0.35, 0.75));

    // --- bow arrow: emphasised for a few seconds after undocking / a load, then dimmed
    if (this.bowSince === null || Math.hypot(p.pos.x - this.bowLastX, p.pos.y - this.bowLastY) > BOW_JUMP) this.bowSince = p.time;
    this.bowLastX = p.pos.x;
    this.bowLastY = p.pos.y;
    const emphasis = 1 - ramp(p.time - this.bowSince, BOW_EMPHASIS * 0.4, BOW_EMPHASIS);
    this.bow.visible = true;
    const bowScale = zoom * (0.7 + 0.5 * emphasis);
    const bowAt = add(p.pos, { x: Math.cos(p.angle) * (p.radius + 0.5 + 0.5 * bowScale), y: Math.sin(p.angle) * (p.radius + 0.5 + 0.5 * bowScale) });
    simToWorld(bowAt, Y, this.bow.position);
    this.bow.rotation.y = p.angle;
    this.bow.scale.setScalar(bowScale);
    this.bowMat.opacity = 0.4 + 0.55 * emphasis;

    // --- flight-path marker
    const visible = show > 0.01 || (c !== null && speed > 0.1);
    this.prograde.visible = visible;
    this.trail.visible = visible && p.marker;
    if (visible) {
      const dir = scale(p.vel, 1 / Math.max(speed, 1e-6));
      const reach = (p.radius + 2.6) + Math.min(speed * 0.3, 7) * zoom;
      const at = add(p.pos, scale(dir, Math.max(reach, (p.radius + 2.6) * zoom)));
      simToWorld(at, Y, this.prograde.position);
      this.prograde.rotation.y = Math.atan2(dir.y, dir.x);
      this.prograde.scale.setScalar(zoom);
      this.glowMat.color.copy(c ? this.tint : this.glow);
      this.glowMat.opacity = c ? 0.95 : 0.85 * Math.max(show, 0.0);
      // dashed trail from the hull to the ring
      const from = add(p.pos, scale(dir, p.radius + 0.3));
      const to = add(at, scale(dir, -0.6 * zoom));
      const attr = this.trail.geometry.getAttribute('position') as Float32BufferAttribute;
      const a = simToWorld(from, Y);
      const b = simToWorld(to, Y);
      attr.setXYZ(0, a.x, a.y, a.z);
      attr.setXYZ(1, b.x, b.y, b.z);
      attr.needsUpdate = true;
      this.trail.computeLineDistances();
      this.trailMat.color.copy(c ? this.tint : this.glow);
      this.trailMat.opacity = 0.35 * show;
      this.trailMat.dashSize = 0.35 * zoom;
      this.trailMat.gapSize = 0.3 * zoom;
    }

    // --- stopping point (dampers)
    const stopAt = p.stop;
    const stopFar = stopAt ? length({ x: stopAt.x - p.pos.x, y: stopAt.y - p.pos.y }) > p.radius + 1.2 * zoom : false;
    this.stop.visible = p.marker && show > 0.01 && stopAt !== null && stopFar;
    if (this.stop.visible && stopAt) {
      simToWorld(stopAt, Y, this.stop.position);
      this.stop.rotation.y = Math.atan2(p.vel.y, p.vel.x);
      this.stop.scale.setScalar(zoom);
      this.stopMat.opacity = 0.7 * show;
    }

    // --- collision ring around the obstacle
    this.obstacle.visible = c !== null;
    this.obstacleInner.visible = c !== null;
    if (c) {
      const r = c.radius + 0.9 * zoom;
      simToWorld(c.pos, Y, this.obstacle.position);
      this.obstacle.position.y = Y;
      this.obstacleInner.position.copy(this.obstacle.position);
      // a unit ring scaled to the rock (bigger rocks get proportionally bolder dashes)
      this.obstacle.scale.set(r, 1, r);
      this.obstacleInner.scale.set(r, 1, r);
      if (!p.reducedMotion) this.obstacle.rotation.y = p.time * 0.6;
      this.obstacleMat.color.copy(this.tint);
      this.obstacleInnerMat.color.copy(this.tint);
      // close contact blinks (mechanically, on/off); reduced motion stays lit
      const blink = !p.reducedMotion && c.urgency > 0.6 && Math.floor(p.time * 6) % 2 === 1;
      this.obstacleMat.opacity = blink ? 0.35 : 0.95;
    }
  }

  /** What is shown (tests). */
  stats(): { prograde: boolean; stop: boolean; obstacle: boolean; bow: boolean; bowOpacity: number } {
    const on = this.object.visible;
    return { bow: on && this.bow.visible, bowOpacity: this.bowMat.opacity, prograde: on && this.prograde.visible, stop: on && this.stop.visible, obstacle: on && this.obstacle.visible };
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// The dock clamp marker (docking manoeuvre plan) on the plane of the game, drawn over
// everything like the flight markers (M3.8) and in their colours:
// - a dashed ring around the docking point (where the docked ship's centre sits by the clamp) with the
//   radius of the docking tolerance, and a small solid target ring in its middle;
// - chevrons along the dock axis outside the ring, pointing at the station – the approach line and the
//   heading the bow must hold (manoeuvre rules only; the docking computer takes any heading);
// - glow while approaching, green when all three rules are met; during the latch the ring closes on the
//   target in green.
// Shown within DOCK_APPROACH_RANGE of a docking point together with the HUD readout (hidden while the
// ship departs or moves away – ui/stationHud.ts DockReadoutGate); reads the simulation state only.
// A derelict's clamp (M4b) gets the same marker once all its relays are powered (`clampPowered`) and it
// is the nearest dock target (`nearestBerth`); the berth's latch closes the ring like a station's. The
// berth has its own small gate: hidden while the ship pulls away, and after leaving until it closes in again.
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry, type BufferGeometry, type Material } from 'three';
import type { Vec2 } from '../sim/math/vec2';
import type { SimState } from '../sim/Simulation';
import { berthLatched, derelictDockTarget, nearestBerth } from '../sim/sites/berth';
import { derelictById } from '../sim/sites/derelict';
import { checkDock, DOCK_APPROACH_RANGE, DOCKING_TICKS, dockHeading, dockPoint, smoothstep, type DockCheck, type DockTarget } from '../sim/station/dock';
import { playerDockRules } from '../sim/station/dockRules';
import { PALETTE } from '../ui/theme/tokens';
import { simToWorld } from './coords';
import { dashedRing } from './FlightMarkers';

/** Height over the plane (just under the flight markers). */
const Y = 0.18;
/** Ring line width (u), the same at every tolerance radius. */
const LINE = 0.13;
/** The ring fades in between these distances from the docking point. */
const FADE_FROM = DOCK_APPROACH_RANGE;
const FADE_TO = DOCK_APPROACH_RANGE - 5;
/** The ring's radius at the end of the latch. */
const LATCH_RADIUS = 0.7;
/** Speed (u/s) along the line to the docking point that counts as closing in / pulling away (= ui DOCK_CLOSING_SPEED). */
const CLOSING_SPEED = 0.3;

export interface DockMarkerStats {
  visible: boolean;
  /** All three rules met (green). */
  ready: boolean;
  /** The latch runs. */
  latch: boolean;
  /** The ring's centre (the docking point), or null. */
  point: Vec2 | null;
}

export class DockMarker {
  readonly object = new Group();
  private readonly ring: Mesh;
  private readonly target: Mesh;
  private readonly chevrons = new Group();
  private readonly ringMat: MeshBasicMaterial;
  private readonly targetMat: MeshBasicMaterial;
  private readonly chevronMat: MeshBasicMaterial;
  /** Dashed ring geometries per tolerance radius (the dash width stays constant). */
  private readonly rings = new Map<number, BufferGeometry>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly glow = new Color(PALETTE.glow);
  private readonly ok = new Color(PALETTE.ok);
  private last: DockMarkerStats = { visible: false, ready: false, latch: false, point: null };
  /** The berth of the last frame and whether the ship is pulling away from a clamp it just left. */
  private lastBerth: string | null = null;
  private berthDeparting = false;

  constructor() {
    const basic = (opacity: number) =>
      this.own(new MeshBasicMaterial({ color: PALETTE.glow, transparent: true, opacity, depthTest: false, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    this.ringMat = basic(0.85);
    this.targetMat = basic(0.9);
    this.chevronMat = basic(0.7);
    this.ring = new Mesh(this.ringGeometry(4), this.ringMat);
    this.target = new Mesh(this.geo(new RingGeometry(0.38, 0.5, 32).rotateX(-Math.PI / 2)), this.targetMat);
    // chevrons: local +x = towards the station
    const shape = new Shape();
    shape.moveTo(0.3, 0);
    shape.lineTo(-0.05, 0.42);
    shape.lineTo(-0.25, 0.42);
    shape.lineTo(0.1, 0);
    shape.lineTo(-0.25, -0.42);
    shape.lineTo(-0.05, -0.42);
    shape.closePath();
    const chevron = this.geo(new ShapeGeometry(shape).rotateX(-Math.PI / 2));
    for (let i = 0; i < 3; i++) this.chevrons.add(new Mesh(chevron, this.chevronMat));
    for (const o of [this.ring, this.target, this.chevrons]) {
      o.renderOrder = 19;
      o.traverse((c) => (c.renderOrder = 19));
      this.object.add(o);
    }
    this.object.visible = false;
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private own<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** A unit dashed ring for radius `r` (scaled by r at draw time; dash count and width follow r). */
  private ringGeometry(r: number): BufferGeometry {
    let g = this.rings.get(r);
    if (!g) {
      g = this.geo(dashedRing(Math.max(16, Math.round(r * 7)), 0.55, LINE / r));
      this.rings.set(r, g);
    }
    return g;
  }

  /** `shown` – the approach readout's visibility (the latch always shows). */
  update(state: SimState, shown = true): void {
    const { player, world } = state;
    const dock = player.dock;
    this.last = { visible: false, ready: false, latch: false, point: null };
    this.object.visible = false;
    if (player.destroyed) return;
    const rules = playerDockRules(state);
    if (this.updateBerth(state, rules)) return;

    if (dock.mode === 'docking') {
      // the latch: the ring closes on the target in green
      const k = smoothstep((state.tick - dock.startTick) / DOCKING_TICKS);
      const radius = rules.range + (LATCH_RADIUS - rules.range) * k;
      this.place(dock.to.pos, radius, rules.range, 1, true);
      this.chevrons.visible = false;
      this.last = { visible: true, ready: true, latch: true, point: dock.to.pos };
      return;
    }
    if (dock.mode !== 'flying' || !shown) return;

    const check = checkDock(player.body, player.props.boundingRadius, world.stations(), rules);
    if (!check.station || !check.point || check.distance > FADE_FROM) return;
    this.approach(check, rules.range, rules.maxAngle !== null);
  }

  /** The approach marker of a dock check within FADE_FROM: ring, target and the chevrons along the axis. */
  private approach<T extends DockTarget>(check: DockCheck<T>, range: number, chevrons: boolean): void {
    if (!check.station || !check.point) return;
    const t = Math.min(1, Math.max(0, (FADE_FROM - check.distance) / (FADE_FROM - FADE_TO)));
    const ready = check.status === 'ok';
    this.place(check.point, range, range, t, ready);
    // chevrons out along the axis, pointing at the station (the manoeuvre's heading)
    this.chevrons.visible = chevrons;
    if (this.chevrons.visible) {
      const heading = dockHeading(check.station);
      const out = { x: -Math.cos(heading), y: -Math.sin(heading) };
      this.chevrons.children.forEach((c, i) => {
        const d = range + 1.1 + i * 1.1;
        simToWorld({ x: check.point!.x + out.x * d, y: check.point!.y + out.y * d }, Y, c.position);
        c.rotation.y = heading;
      });
      this.chevronMat.opacity = 0.65 * t;
    }
    this.last = { visible: true, ready, latch: false, point: check.point };
  }

  /**
   * The derelict clamp (M4b): the latch while berthing, the approach marker at a powered clamp that is the
   * nearest dock target. True = the berth owns the marker this frame (the station marker is skipped).
   */
  private updateBerth(state: SimState, rules: ReturnType<typeof playerDockRules>): boolean {
    const { player, sites } = state;
    const berth = sites.berth;
    if (this.lastBerth !== null && berth === null) this.berthDeparting = true;
    this.lastBerth = berth;
    if (berth !== null) {
      const site = derelictById(state, berth);
      if (!site || berthLatched(state)) return true;
      // the latch: the ring closes on the target as the ship slides into the dock pose
      const point = dockPoint(derelictDockTarget(site), player.props.boundingRadius);
      const left = Math.hypot(player.body.pos.x - point.x, player.body.pos.y - point.y);
      const radius = LATCH_RADIUS + (rules.range - LATCH_RADIUS) * Math.min(1, left / rules.range);
      this.place(point, radius, rules.range, 1, true);
      this.chevrons.visible = false;
      this.last = { visible: true, ready: true, latch: true, point };
      return true;
    }
    if (player.dock.mode !== 'flying') return false;
    const near = nearestBerth(state);
    if (!near || !near.check.point) {
      this.berthDeparting = false;
      return false;
    }
    // the clamp has no power: no marker (the station marker, if any, stays hidden – the clamp is nearer)
    if (!near.powered) return true;
    const { check } = near;
    const point = check.point!;
    const dx = point.x - player.body.pos.x;
    const dy = point.y - player.body.pos.y;
    const closing = check.distance > 1e-6 ? (player.body.vel.x * dx + player.body.vel.y * dy) / check.distance : 0;
    if (this.berthDeparting && closing > CLOSING_SPEED) this.berthDeparting = false;
    const leaving = closing < -CLOSING_SPEED;
    if (this.berthDeparting || (leaving && check.status !== 'ok') || check.distance > FADE_FROM) return true;
    this.approach(check, rules.range, rules.maxAngle !== null);
    return true;
  }

  private place(point: Vec2, radius: number, range: number, alpha: number, ready: boolean): void {
    this.object.visible = true;
    const color = ready ? this.ok : this.glow;
    this.ring.geometry = this.ringGeometry(range);
    simToWorld(point, Y, this.ring.position);
    this.ring.scale.set(radius, 1, radius);
    simToWorld(point, Y, this.target.position);
    this.ringMat.color.copy(color);
    this.targetMat.color.copy(color);
    this.chevronMat.color.copy(color);
    this.ringMat.opacity = 0.85 * alpha;
    this.targetMat.opacity = 0.9 * alpha;
  }

  /** What is shown (tests). */
  stats(): DockMarkerStats {
    return this.last;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

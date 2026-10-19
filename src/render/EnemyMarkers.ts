// In-world enemy markers (readability pass R3), drawn over everything like the flight markers (M3.8):
// - a thin bracket ring under every pirate ship – red when hostile, amber when it is not a threat now
//   (a scavenger, a pirate paid off by the toll, a fleeing one); wrecks get none;
// - a small shield bar (if it has a shield) over a hull bar under the ring;
// - the ship under the cursor (the cannon target) is highlighted: a bolder bracket, an inner ring and
//   full opacity.
// Line widths and bars follow the camera distance, so the marker reads the same at every zoom.
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, type BufferGeometry } from 'three';
import { isHostile } from '../game/hostiles';
import type { Enemy } from '../sim/combat/types';
import type { Vec2 } from '../sim/math/vec2';
import { hullHp } from '../sim/ship/hp';
import { PALETTE } from '../ui/theme/tokens';
import { REFERENCE_DISTANCE } from './CameraRig';
import { simToWorld } from './coords';
import { dashedRing } from './FlightMarkers';
import type { WarmUpZoo } from './warmup';

/** Height over the plane (just under the flight markers). */
const Y = 0.16;
/** Bracket line width at the reference zoom (u). */
const LINE = 0.12;
/** Gap between the hull and the bracket (u, at the reference zoom). */
const GAP = 0.7;
/** Bar size at the reference zoom (u). */
const BAR_WIDTH = 2.3;
const BAR_HEIGHT = 0.17;
/** Extra reach of the cursor around a ship's hull that still counts as aiming at it (u). */
const TARGET_REACH = 1.5;

export interface EnemyMarkerInput {
  enemies: readonly Enemy[];
  /** Interpolation between the last and the next simulation step. */
  alpha: number;
  /** The plane point under the cursor, or null. */
  aim: Vec2 | null;
  /** The flight camera's distance (marker sizes follow it). */
  cameraDistance: number;
  /** Show the markers at all (free flight). */
  visible: boolean;
}

export interface EnemyMarkerStats {
  /** Markers on screen. */
  count: number;
  /** Hostile (red) markers. */
  hostile: number;
  /** The pirate under the cursor, or null. */
  target: string | null;
}

interface Entry {
  group: Group;
  bracket: Mesh;
  inner: Mesh;
  shieldBack: Mesh;
  shieldFill: Mesh;
  hullBack: Mesh;
  hullFill: Mesh;
  bracketMat: MeshBasicMaterial;
  innerMat: MeshBasicMaterial;
  backMat: MeshBasicMaterial;
  hullMat: MeshBasicMaterial;
  shieldMat: MeshBasicMaterial;
}

/** Share of a fill bar (0..1), safe for empty maxima. */
export const barFraction = (current: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, current / max)) : 0);

/** The pirate under the cursor: the nearest one whose hull (+ a little) covers the aim point. */
export function cursorTarget(ships: readonly { id: string; pos: Vec2; radius: number }[], aim: Vec2 | null): string | null {
  if (!aim) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const s of ships) {
    const d = Math.hypot(s.pos.x - aim.x, s.pos.y - aim.y);
    if (d <= s.radius + TARGET_REACH && d < bestD) {
      best = s.id;
      bestD = d;
    }
  }
  return best;
}

interface ShipMark {
  e: Enemy;
  id: string;
  pos: Vec2;
  radius: number;
}

/** One bar under the bracket (back plate + fill); returns the z of the next one. */
function placeBar(back: Mesh, fill: Mesh, frac: number, show: boolean, z: number, width: number, height: number): number {
  back.visible = show;
  fill.visible = show && frac > 0.001;
  if (!show) return z;
  back.position.set(0, 0, z);
  back.scale.set(width + height * 0.5, 1, height * 1.5);
  fill.position.set(-width / 2 + (width * frac) / 2, 0.01, z);
  fill.scale.set(Math.max(1e-3, width * frac), 1, height);
  return z + height * 1.9;
}

export class EnemyMarkers {
  readonly object = new Group();
  private readonly entries = new Map<string, Entry>();
  private readonly plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly innerRing = new RingGeometry(1, 1.035, 48).rotateX(-Math.PI / 2);
  /** Bracket geometries per relative line width (the line stays the same width on any hull). */
  private readonly brackets = new Map<number, BufferGeometry>();
  private readonly red = new Color(PALETTE.bad);
  private readonly amber = new Color(PALETTE.warn);
  private readonly last: EnemyMarkerStats = { count: 0, hostile: 0, target: null };
  private readonly seen = new Set<string>();
  private readonly ships: ShipMark[] = [];
  private readonly shipPool: ShipMark[] = [];

  update(p: EnemyMarkerInput): void {
    const zoom = Math.min(8, Math.max(0.7, p.cameraDistance / REFERENCE_DISTANCE));
    this.object.visible = p.visible;
    // per-frame records reused (issue #10: no set, array and objects per frame)
    const seen = this.seen;
    seen.clear();
    const ships = this.ships;
    ships.length = 0;
    if (p.visible) {
      p.enemies.forEach((e, i) => {
        const s = (this.shipPool[i] ??= { e, id: e.id, pos: { x: 0, y: 0 }, radius: 0 });
        s.e = e;
        s.id = e.id;
        s.pos.x = e.prevBody.pos.x + (e.body.pos.x - e.prevBody.pos.x) * p.alpha;
        s.pos.y = e.prevBody.pos.y + (e.body.pos.y - e.prevBody.pos.y) * p.alpha;
        s.radius = e.props.boundingRadius;
        ships.push(s);
      });
    }
    const target = cursorTarget(ships, p.aim);
    let hostileCount = 0;
    for (const s of ships) {
      seen.add(s.id);
      const entry = this.entries.get(s.id) ?? this.create(s.id);
      const hostile = isHostile(s.e);
      if (hostile) hostileCount++;
      this.place(entry, s.e, s.pos, zoom, hostile, s.id === target);
    }
    for (const [id, entry] of this.entries) if (!seen.has(id)) this.remove(id, entry);
    this.last.count = ships.length;
    this.last.hostile = hostileCount;
    this.last.target = target;
  }

  stats(): EnemyMarkerStats {
    return { ...this.last, count: this.object.visible ? this.last.count : 0 };
  }

  private place(entry: Entry, e: Enemy, pos: Vec2, zoom: number, hostile: boolean, target: boolean): void {
    simToWorld(pos, Y, entry.group.position);
    const radius = e.props.boundingRadius + GAP * zoom;
    const line = LINE * zoom * (target ? 1.6 : 1);
    entry.bracket.geometry = this.bracket(line / radius);
    entry.bracket.scale.set(radius, 1, radius);
    const color = hostile ? this.red : this.amber;
    entry.bracketMat.color.copy(color);
    entry.bracketMat.opacity = target ? 1 : hostile ? (e.ai.mode === 'attack' ? 0.85 : 0.6) : 0.5;
    entry.inner.visible = target;
    entry.inner.scale.set(radius * 0.86, 1, radius * 0.86);
    entry.innerMat.color.copy(color);

    // bars under the bracket (south = towards the bottom of the screen): shield over hull
    // against the hull at spawn: shot-off parts count as lost
    const now = hullHp(e.grid, e.hp);
    const hull = barFraction(now.current, Math.max(now.max, e.maxHull));
    const shieldCap = e.props.shield.capacity;
    const width = Math.max(BAR_WIDTH * zoom, e.props.boundingRadius * 1.1);
    const height = BAR_HEIGHT * zoom;
    const top = radius + height * 1.2;
    const z = placeBar(entry.shieldBack, entry.shieldFill, barFraction(e.shield, shieldCap), shieldCap > 0, top, width, height);
    placeBar(entry.hullBack, entry.hullFill, hull, true, z, width, height);
    entry.hullMat.color.copy(color);
    const dim = target ? 1 : 0.85;
    entry.hullMat.opacity = dim;
    entry.shieldMat.opacity = dim;
    entry.backMat.opacity = target ? 0.9 : 0.75;
  }

  private bracket(relWidth: number): BufferGeometry {
    // quantized so a handful of geometries cover every hull size and zoom
    const key = Math.max(0.01, Math.round(relWidth * 100) / 100);
    let g = this.brackets.get(key);
    if (!g) {
      // four arcs with gaps on the axes – a bracket, not a closed ring (reads as a target, not a shield)
      const fill = 0.6;
      g = dashedRing(4, fill, key).rotateY(-(Math.PI / 4 - (fill * Math.PI) / 4));
      this.brackets.set(key, g);
    }
    return g;
  }

  /** Shader warm-up: one marker (its own materials, never disposed – their programs outlive every fight). */
  warmUp(zoo: WarmUpZoo): void {
    const entry = this.create('warm-up');
    this.entries.delete('warm-up');
    zoo.add(entry.group);
  }

  private create(id: string): Entry {
    const mat = (color: string, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    const bracketMat = mat(PALETTE.bad, 0.8);
    const innerMat = mat(PALETTE.bad, 0.45);
    const backMat = mat(PALETTE.bandHi, 0.75);
    const hullMat = mat(PALETTE.bad, 0.85);
    const shieldMat = mat(PALETTE.shield, 0.85);
    const group = new Group();
    const bracket = new Mesh(this.bracket(0.04), bracketMat);
    const inner = new Mesh(this.innerRing, innerMat);
    const shieldBack = new Mesh(this.plane, backMat);
    const shieldFill = new Mesh(this.plane, shieldMat);
    const hullBack = new Mesh(this.plane, backMat);
    const hullFill = new Mesh(this.plane, hullMat);
    group.add(bracket, inner, shieldBack, hullBack, shieldFill, hullFill);
    group.traverse((o) => (o.renderOrder = 19));
    // fills over their backgrounds
    shieldFill.renderOrder = hullFill.renderOrder = 20;
    group.name = `enemy-marker:${id}`;
    this.object.add(group);
    const entry: Entry = { group, bracket, inner, shieldBack, shieldFill, hullBack, hullFill, bracketMat, innerMat, backMat, hullMat, shieldMat };
    this.entries.set(id, entry);
    return entry;
  }

  private remove(id: string, entry: Entry): void {
    this.object.remove(entry.group);
    for (const m of [entry.bracketMat, entry.innerMat, entry.backMat, entry.hullMat, entry.shieldMat]) m.dispose();
    this.entries.delete(id);
  }

  dispose(): void {
    for (const [id, entry] of this.entries) this.remove(id, entry);
    for (const g of this.brackets.values()) g.dispose();
    this.brackets.clear();
    this.plane.dispose();
    this.innerRing.dispose();
  }
}

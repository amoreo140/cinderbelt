// Ships parked in the hangar hall (M4a "Hangar and fleet", plan T8): the ships stored at the docked
// station stand on the bay deck beside the shipyard platform (spots: hangarParking.ts). Each one is
// built by the same ShipView as the flight and editor ship, then frozen into one mesh per material
// (shipBatch.bakeStatic – a cold ship has nothing that turns), slightly dimmed. The dimmed materials
// are clones of the part materials that differ only in uniforms (colour, emissive strength), so they
// share the parts' shader programs – parking a ship compiles nothing. Parked ships are not part of
// the editor: the pointer never picks them (HangarView picks the floor and the edited ship's cells).
// Each ship wears its record's paint (M4c, render/paint.ts) – a repaint rebuilds that ship.
import { Box3, Group, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { computeProperties } from '../sim/ship/properties';
import type { ShipGrid } from '../sim/ship/types';
import type { PaintId } from '../data/paints';
import { paintOf } from '../sim/fleet/state';
import type { ShipId, StoredShip } from '../sim/fleet/types';
import type { StationId } from '../sim/world/stations';
import type { ModelLibrary } from './assets/ModelLibrary';
import { simToWorld } from './coords';
import { PARKED_MAX, PARKING_SPOTS, placeInSpot, type ShipBounds } from './hangarParking';
import { cloneWithRim } from './rimLight';
import { bakeStatic } from './shipBatch';
import { applyPaint } from './paint';
import { ShipView } from './ShipView';
import { hullShellVersion } from './hull/setting';

/** Albedo and glow of a parked (cold) ship against the edited one. */
const PARKED_ALBEDO = 0.62;
const PARKED_GLOW = 0.35;

interface Parked {
  id: ShipId;
  grid: ShipGrid;
  /** Paint the frozen copy was built in (the record is painted in place). */
  paint: PaintId;
  /** Holder in the yard frame (position + scale of the spot). */
  holder: Group;
  /** The view the frozen copy was taken from (owns its placeholder geometry, if any). */
  view: ShipView;
  bounds: ShipBounds;
  /** Merged geometries (owned) and the dimmed material clones (owned). */
  geometries: { dispose(): void }[];
  materials: Material[];
  meshes: number;
  spot: number;
}

export class ParkedShips {
  readonly object = new Group();
  private entries: Parked[] = [];
  /** Rebuilds so far (tests: the per-frame check must not rebuild an unchanged fleet). */
  builds = 0;
  /** Hull shell setting the frozen copies were built with – a change rebuilds them all. */
  private shellVersion = hullShellVersion();

  constructor(private readonly library: ModelLibrary) {
    this.object.name = 'hangar-parked';
  }

  /**
   * Shows the stored ships standing at `stationId` (null = none). Cheap when nothing changed: compares
   * ship ids and grid objects in order (the fleet's stored list is sorted by id), no deep compare.
   */
  sync(stored: readonly StoredShip[], stationId: StationId | null): void {
    if (this.shellVersion !== hullShellVersion()) {
      this.shellVersion = hullShellVersion();
      for (const e of this.entries) this.drop(e);
      this.entries = [];
    }
    let n = 0;
    let same = true;
    for (const s of stored) {
      if (stationId === null || s.stationId !== stationId) continue;
      if (n >= PARKED_MAX) break;
      const e = this.entries[n];
      if (!e || e.id !== s.record.id || e.grid !== s.grid || e.paint !== paintOf(s.record)) same = false;
      n++;
    }
    if (same && n === this.entries.length) return;
    this.rebuild(stored.filter((s) => stationId !== null && s.stationId === stationId).slice(0, PARKED_MAX));
  }

  private rebuild(ships: readonly StoredShip[]): void {
    const old = new Map(this.entries.map((e) => [e.id, e]));
    const next: Parked[] = [];
    ships.forEach((s, spot) => {
      const kept = old.get(s.record.id);
      let entry: Parked;
      if (kept && kept.grid === s.grid && kept.paint === paintOf(s.record)) {
        old.delete(s.record.id);
        entry = kept;
      } else entry = this.build(s);
      if (entry.spot !== spot) this.place(entry, spot);
      next.push(entry);
    });
    for (const e of old.values()) this.drop(e);
    this.entries = next;
  }

  private build(ship: StoredShip): Parked {
    this.builds++;
    const view = new ShipView(ship.grid, computeProperties(ship.grid), this.library, null, { mode: 'hangar' });
    const paint = paintOf(ship.record);
    applyPaint(view.group, paint);
    const dimmed = new Map<Material, Material>();
    const materials: Material[] = [];
    const dim = (m: Material): Material => {
      let copy = dimmed.get(m);
      if (!copy) {
        copy = cloneWithRim(m);
        if (copy instanceof MeshStandardMaterial) {
          copy.color.multiplyScalar(PARKED_ALBEDO);
          copy.emissiveIntensity *= PARKED_GLOW;
        } else if ('color' in copy && (copy as { color?: unknown }).color) {
          (copy as unknown as { color: { multiplyScalar(k: number): void } }).color.multiplyScalar(PARKED_ALBEDO);
        }
        dimmed.set(m, copy);
        materials.push(copy);
      }
      return copy;
    };
    const baked = bakeStatic(view.group, dim);
    const holder = new Group();
    holder.name = 'parked-ship';
    holder.userData.shipId = ship.record.id;
    const box = new Box3();
    for (const m of [...baked.batches, ...baked.loose]) {
      holder.add(m);
      m.matrixWorldNeedsUpdate = true;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(m.matrix));
    }
    // ShipView frame: x = bow, y = up, z = −port
    const bounds: ShipBounds = box.isEmpty()
      ? { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }
      : { minX: box.min.x, maxX: box.max.x, minY: -box.max.z, maxY: -box.min.z, minZ: box.min.y, maxZ: box.max.y };
    this.object.add(holder);
    return {
      id: ship.record.id,
      grid: ship.grid,
      paint,
      holder,
      view,
      bounds,
      geometries: baked.batches.map((b) => b.geometry),
      materials,
      meshes: baked.batches.length + baked.loose.length,
      spot: -1,
    };
  }

  private place(e: Parked, spot: number): void {
    e.spot = spot;
    const p = placeInSpot(e.bounds, PARKING_SPOTS[spot]!);
    simToWorld({ x: p.x, y: p.y }, p.z, e.holder.position);
    e.holder.scale.setScalar(p.scale);
  }

  private drop(e: Parked): void {
    this.object.remove(e.holder);
    for (const g of e.geometries) g.dispose();
    for (const m of e.materials) m.dispose();
    e.view.dispose();
  }

  /** What stands in the hall (tests, screenshots). */
  stats(): { ships: number; meshes: number; ids: ShipId[]; builds: number } {
    return { ships: this.entries.length, meshes: this.entries.reduce((s, e) => s + e.meshes, 0), ids: this.entries.map((e) => e.id), builds: this.builds };
  }

  /** The parked ship holders (tests). */
  holders(): readonly Object3D[] {
    return this.entries.map((e) => e.holder);
  }

  dispose(): void {
    for (const e of this.entries) this.drop(e);
    this.entries = [];
    this.object.removeFromParent();
  }
}

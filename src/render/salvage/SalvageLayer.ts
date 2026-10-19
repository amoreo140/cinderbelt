// Salvage in the scene (M3.6): cargo containers (model with a blinking lamp), the violet tractor beam
// of the player and of scavengers (with rings travelling towards the ship), joint and intact-part
// markers on scanned hulks and the red-hot spot of a laser cut.
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { CONTAINER_RADIUS } from '../../data/salvage';
import { gridToWorld } from '../../sim/combat/geometry';
import type { Container, Wreck } from '../../sim/combat/types';
import { wreckKey } from '../../sim/discovery/wrecks';
import { lerpAngle } from '../../sim/math/angle';
import { lerp, length, sub, type Vec2 } from '../../sim/math/vec2';
import { isHulk, jointParts } from '../../sim/salvage/dismantle';
import { towable } from '../../sim/salvage/tractor';
import { partCenter } from '../../sim/ship/grid';
import type { SimState } from '../../sim/Simulation';
import { fetchAsset } from '../assets/ModelLibrary';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { assetUrl } from '../assets/url';
import { simToWorld } from '../coords';
import { PALETTE } from '../../ui/theme/tokens';
import type { WarmUpZoo } from '../warmup';

export const CONTAINER_PATH = 'assets/models/props/cargo_container.glb';
/** Model ~1.2 units long → container radius in the game. */
const CONTAINER_SCALE = (CONTAINER_RADIUS * 2) / 1.2;
const BEAM_HEIGHT = 0.45;
const MARKER_HEIGHT = 0.95;
const TRACTOR = Number.parseInt(PALETTE.tractor.slice(1), 16);
const AMBER = 0xffb547;
const GLOW = 0x62d9f4;
/** Markers on hulks this close to the ship. */
const MARKER_RANGE = 140;

interface ContainerEntry {
  group: Group;
  lamp: Object3D | null;
  real: boolean;
}

interface Beam {
  core: Mesh;
  halo: Mesh;
  rings: Mesh[];
  end: Mesh;
}

export class SalvageLayer {
  readonly object = new Group();
  private template: Object3D | null = null;
  private loading = false;
  private disposed = false;
  private readonly containers = new Map<number, ContainerEntry>();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly beams: Beam[] = [];
  private readonly markers: Mesh[] = [];
  private markerUsed = 0;
  private readonly cutGlow: Mesh;
  private time = 0;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly dir = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  /** Per-frame scratch: container ids still in the world. */
  private readonly seen = new Set<number>();
  /** One placeholder box shared by every container while (or if) the model is missing. */
  private placeholder: { geometry: BufferGeometry; material: Material } | null = null;

  private readonly beamGeo: BufferGeometry;
  private readonly haloGeo: BufferGeometry;
  private readonly ringGeo: BufferGeometry;
  private readonly endGeo: BufferGeometry;
  private readonly markerGeo: BufferGeometry;
  private readonly coreMat: MeshBasicMaterial;
  private readonly haloMat: MeshBasicMaterial;
  private readonly ringMat: MeshBasicMaterial;
  private readonly jointMat: MeshBasicMaterial;
  private readonly intactMat: MeshBasicMaterial;

  constructor() {
    this.object.name = 'salvage';
    this.beamGeo = this.own(new CylinderGeometry(0.07, 0.07, 1, 6).translate(0, 0.5, 0));
    this.haloGeo = this.own(new CylinderGeometry(0.26, 0.16, 1, 10, 1, true).translate(0, 0.5, 0));
    this.ringGeo = this.own(new TorusGeometry(0.42, 0.035, 6, 20).rotateX(Math.PI / 2));
    this.endGeo = this.own(new SphereGeometry(0.45, 12, 8));
    this.markerGeo = this.own(new PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2).rotateY(Math.PI / 4));
    const add = (color: number, opacity: number) =>
      this.ownMat(new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    this.coreMat = add(TRACTOR, 0.95);
    this.haloMat = add(TRACTOR, 0.22);
    this.ringMat = add(TRACTOR, 0.7);
    this.jointMat = add(AMBER, 0.85);
    this.intactMat = add(GLOW, 0.8);
    this.cutGlow = new Mesh(this.endGeo, add(0xff6a3a, 0.9));
    this.cutGlow.visible = false;
    this.object.add(this.cutGlow);
  }

  private own<T extends BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }

  /** Shader warm-up: the tractor beam pieces (hidden, kept for the first beam) and the container placeholder. */
  warmUp(zoo: WarmUpZoo): void {
    this.beam(0);
    this.hideBeams(0);
    if (!this.template) {
      const box = this.buildContainer();
      zoo.add(box.group);
    }
  }

  private ownMat<T extends Material>(m: T): T {
    this.materials.add(m);
    return m;
  }

  private load(): void {
    if (this.loading || this.disposed) return;
    this.loading = true;
    void (async () => {
      try {
        const data = await fetchAsset(CONTAINER_PATH);
        if (!data || this.disposed) return;
        const gltf = await createModelLoader().parseAsync(data, assetUrl(CONTAINER_PATH).replace(/[^/]*$/, ''));
        if (this.disposed) return;
        guardPaletteMaterials(gltf.scene);
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            this.geometries.add(o.geometry);
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials.add(m);
          }
        });
        this.template = gltf.scene;
        // placeholders are rebuilt with the model
        for (const [id, e] of [...this.containers]) {
          if (!e.real) {
            this.object.remove(e.group);
            this.containers.delete(id);
          }
        }
      } catch (e) {
        console.warn(`Container model failed to load: ${CONTAINER_PATH}`, e);
      }
    })();
  }

  private buildContainer(): ContainerEntry {
    this.load();
    const group = new Group();
    if (this.template) {
      const model = this.template.clone(true);
      model.scale.setScalar(CONTAINER_SCALE);
      group.add(model);
      return { group, lamp: model.getObjectByName('beacon_0') ?? null, real: true };
    }
    // shared: a failed model load must not leak a new box per container for the rest of the session
    this.placeholder ??= { geometry: this.own(new BoxGeometry(1.6, 0.9, 1.0)), material: this.ownMat(new MeshStandardMaterial({ color: 0x8d99ae, roughness: 0.7 })) };
    const box = new Mesh(this.placeholder.geometry, this.placeholder.material);
    group.add(box);
    return { group, lamp: null, real: false };
  }

  private syncContainers(list: readonly Container[], alpha: number): void {
    const seen = this.seen;
    seen.clear();
    for (const c of list) {
      seen.add(c.id);
      let e = this.containers.get(c.id);
      if (!e) {
        e = this.buildContainer();
        this.containers.set(c.id, e);
        this.object.add(e.group);
      }
      simToWorld(lerp(c.prevBody.pos, c.body.pos, alpha), 0, e.group.position);
      e.group.rotation.y = lerpAngle(c.prevBody.angle, c.body.angle, alpha);
      if (e.lamp) e.lamp.visible = Math.sin(this.time * 5 + c.id) > 0;
    }
    for (const [id, e] of this.containers) {
      if (seen.has(id)) continue;
      this.object.remove(e.group);
      this.containers.delete(id);
    }
  }

  private beam(i: number): Beam {
    while (this.beams.length <= i) {
      const core = new Mesh(this.beamGeo, this.coreMat);
      const halo = new Mesh(this.haloGeo, this.haloMat);
      const end = new Mesh(this.endGeo, this.haloMat);
      const rings = [0, 1, 2].map(() => new Mesh(this.ringGeo, this.ringMat));
      this.object.add(core, halo, end, ...rings);
      this.beams.push({ core, halo, rings, end });
    }
    return this.beams[i]!;
  }

  /** Draws beam `i` from `from` to `to` (world); rings travel from the target to the source. */
  private drawBeam(i: number, from: Vector3, to: Vector3, phase: number): void {
    const b = this.beam(i);
    this.dir.subVectors(to, from);
    const len = this.dir.length();
    const visible = len > 0.05;
    for (const m of [b.core, b.halo, b.end, ...b.rings]) m.visible = visible;
    if (!visible) return;
    this.dir.divideScalar(len);
    const pulse = 1 + 0.25 * Math.sin(this.time * 18 + phase);
    for (const m of [b.core, b.halo]) {
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(this.up, this.dir);
      m.scale.set(pulse, len, pulse);
    }
    b.end.position.copy(to);
    b.end.scale.setScalar(0.9 + 0.2 * Math.sin(this.time * 9 + phase));
    b.rings.forEach((r, k) => {
      const t = 1 - ((this.time * 0.9 + k / 3 + phase) % 1);
      r.position.copy(from).addScaledVector(this.dir, len * t);
      r.quaternion.setFromUnitVectors(this.up, this.dir);
      r.scale.setScalar(0.6 + 0.6 * t);
    });
  }

  private hideBeams(from: number): void {
    for (let i = from; i < this.beams.length; i++) {
      const b = this.beams[i]!;
      for (const m of [b.core, b.halo, b.end, ...b.rings]) m.visible = false;
    }
  }

  /** World point of a wreck part (interpolated body). */
  private partWorld(w: Wreck, partId: number, alpha: number, out: Vector3, height: number): Vector3 | null {
    const p = w.grid.parts.find((x) => x.id === partId);
    if (!p) return null;
    const body = { pos: lerp(w.prevBody.pos, w.body.pos, alpha), vel: w.body.vel, angle: lerpAngle(w.prevBody.angle, w.body.angle, alpha), angVel: 0 };
    return simToWorld(gridToWorld(body, w.props.centerOfMass, partCenter(p)), height, out);
  }

  private marker(material: MeshBasicMaterial): Mesh {
    let m = this.markers[this.markerUsed];
    if (!m) {
      m = new Mesh(this.markerGeo, material);
      this.markers.push(m);
      this.object.add(m);
    }
    m.material = material;
    m.visible = true;
    this.markerUsed++;
    return m;
  }

  private syncMarkers(state: SimState, alpha: number, shipPos: Vec2): void {
    this.markerUsed = 0;
    this.cutGlow.visible = false;
    const scanned = state.discovery.scanned;
    for (const w of state.combat.wrecks) {
      if (!w.dismantle || length(sub(w.body.pos, shipPos)) > MARKER_RANGE) continue;
      if (w.cutting) {
        const p = this.partWorld(w, w.cutting.partId, alpha, this.a, 0.6);
        if (p) {
          this.cutGlow.visible = true;
          this.cutGlow.position.copy(p);
          this.cutGlow.scale.setScalar(0.4 + w.cutting.progress * 1.1 + 0.1 * Math.sin(this.time * 30));
        }
      }
      if (!isHulk(w) || !scanned.has(wreckKey(w))) continue;
      const blink = 0.85 + 0.15 * Math.sin(this.time * 4);
      for (const id of jointParts(w.grid)) {
        const m = this.marker(this.jointMat);
        if (this.partWorld(w, id, alpha, m.position, MARKER_HEIGHT)) m.scale.setScalar(blink);
      }
      for (const id of w.dismantle.intact) {
        const m = this.marker(this.intactMat);
        if (this.partWorld(w, id, alpha, m.position, MARKER_HEIGHT + 0.05)) m.scale.setScalar(0.7);
      }
    }
    for (let i = this.markerUsed; i < this.markers.length; i++) this.markers[i]!.visible = false;
  }

  /**
   * `emitter` = world position of the player's tractor emitter (model), or null (then the ship
   * centre); `shipPos` = interpolated sim position of the player.
   */
  update(state: SimState, alpha: number, frameDt: number, emitter: Vector3 | null, shipPos: Vec2): void {
    this.time += frameDt;
    this.syncContainers(state.combat.containers, alpha);
    this.syncMarkers(state, alpha, shipPos);
    let n = 0;
    const tr = state.player.tractor;
    if (tr && state.player.dock.mode === 'flying' && !state.player.destroyed) {
      const t = towable(state, tr.target);
      if (t) {
        const from = emitter ? this.a.copy(emitter) : simToWorld(shipPos, BEAM_HEIGHT, this.a);
        let to: Vector3 | null = null;
        if (tr.rip && t.wreck) to = this.partWorld(t.wreck, tr.rip.partId, alpha, this.b, BEAM_HEIGHT);
        if (!to) {
          const body = t.wreck ?? t.container ?? t.nugget!;
          to = simToWorld(lerp(body.prevBody.pos, body.body.pos, alpha), BEAM_HEIGHT, this.b);
        }
        this.drawBeam(n++, from, to, 0);
      }
    }
    // scavengers reaching for loot with their own beam
    for (const e of state.combat.enemies) {
      if (e.kind !== 'scavenger' || e.ai.mode !== 'collect') continue;
      const pos = lerp(e.prevBody.pos, e.body.pos, alpha);
      if (length(sub(e.ai.waypoint, pos)) > e.props.boundingRadius + 14) continue;
      this.drawBeam(n++, simToWorld(pos, BEAM_HEIGHT, this.a), simToWorld(e.ai.waypoint, BEAM_HEIGHT, this.b), 1.7);
    }
    this.hideBeams(n);
  }

  stats(): { containers: number; beams: number; markers: number } {
    return { containers: this.containers.size, beams: this.beams.filter((b) => b.core.visible).length, markers: this.markerUsed };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.containers.values()) this.object.remove(e.group);
    this.containers.clear();
    // shared palette textures (createModelLoader) belong to the whole app – only geometry and materials
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.template = null;
    this.placeholder = null;
  }
}

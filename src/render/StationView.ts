import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { STATION_LAYOUTS } from '../data/stations';
import type { DockState } from '../sim/station/dock';
import type { StationDef } from '../sim/world/stations';
import type { ModelLibrary } from './assets/ModelLibrary';
import { simToWorld } from './coords';
import { cloneWithRim } from './rimLight';
import { beaconLevel, CLAMP_JAW_OPEN, clampJawTarget, guideLightLevel, stepClampJaw } from './stationAnim';

const AXIS_Y = new Vector3(0, 1, 0);
/** Ring rotor spin (rad/s). */
const ROTOR_SPEED = 0.12;
const tmpQuat = new Quaternion();

type EmissiveMaterial = Material & { emissiveIntensity: number };

interface Light {
  material: EmissiveMaterial;
  base: number;
  index: number;
}

const hasEmissive = (m: Material): m is EmissiveMaterial => 'emissiveIntensity' in m;

/** The player's dock state the clamp jaws follow (read-only from the simulation). */
export interface ClampJawInput {
  dock: DockState;
  tick: number;
  reducedMotion: boolean;
}

interface ClampJaw {
  node: Object3D;
  base: Quaternion;
  /** +1 = Clamp_Jaw_L (opens +35°), −1 = Clamp_Jaw_R. */
  sign: number;
}

/** A station in the scene: the Blender model (or a placeholder), the spinning ring, beacons and the dock clamp. */
export class StationView {
  readonly group = new Group();
  private rotor: { node: Object3D; base: Quaternion; angle: number } | null = null;
  private readonly jaws: ClampJaw[] = [];
  /** Jaw closure 0 = open .. 1 = closed (rest pose); null until the first update (no opening animation on load). */
  private jawClosure: number | null = null;
  private readonly beacons: Light[] = [];
  /** Home module mounts (`attach_<slot>` empties of station_home, M4c) by slot name. */
  readonly attachPoints = new Map<string, Object3D>();
  private readonly guides: Light[] = [];
  private readonly ownedGeometries: BufferGeometry[] = [];
  private readonly ownedMaterials: Material[] = [];

  constructor(readonly station: StationDef, library: ModelLibrary) {
    simToWorld(station.pos, 0, this.group.position);
    this.group.rotation.y = station.portAngle;

    const template = library.station(station.model);
    const model = template ? template.clone() : this.placeholder();
    this.group.add(model);

    const rotor = model.getObjectByName('ring_rotor');
    if (rotor) this.rotor = { node: rotor, base: rotor.quaternion.clone(), angle: station.variant * Math.PI * 2 };

    model.traverse((o) => {
      const match = /^beacon_(\d+)$/.exec(o.name);
      if (match && o instanceof Mesh) this.beacons.push(this.ownLight(o, Number(match[1])));
      const attach = /^attach_(\w+)$/.exec(o.name);
      if (attach) this.attachPoints.set(attach[1]!, o);
    });

    const port = model.getObjectByName('dock_port') ?? this.portFallback(model);
    const clampTemplate = library.dockClamp();
    const clamp = clampTemplate ? clampTemplate.clone() : this.clampPlaceholder();
    port.add(clamp);
    clamp.traverse((o) => {
      const match = /^guide_light_(\d+)$/.exec(o.name);
      if (match && o instanceof Mesh) this.guides.push(this.ownLight(o, Number(match[1])));
      if (o.name === 'Clamp_Jaw_L' || o.name === 'Clamp_Jaw_R') this.jaws.push({ node: o, base: o.quaternion.clone(), sign: o.name === 'Clamp_Jaw_L' ? 1 : -1 });
    });
  }

  /** The mesh gets its own copy of the material so it can blink on its own (textures stay shared). */
  private ownLight(mesh: Mesh, index: number): Light {
    const source = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    const material = cloneWithRim(source);
    this.ownedMaterials.push(material);
    mesh.material = material;
    const emissive = hasEmissive(material) ? material : (Object.assign(material, { emissiveIntensity: 1 }) as EmissiveMaterial);
    return { material: emissive, base: Math.max(emissive.emissiveIntensity, 0.5), index };
  }

  private own<T extends BufferGeometry>(g: T): T {
    this.ownedGeometries.push(g);
    return g;
  }

  private material(color: number, emissive = 0, intensity = 0): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, emissive, emissiveIntensity: intensity });
    this.ownedMaterials.push(m);
    return m;
  }

  /** Placeholder from primitives (spec 3.5): core, ring, arm with the port and beacons. */
  private placeholder(): Object3D {
    const layout = STATION_LAYOUTS[this.station.model];
    const r = layout.radius;
    const root = new Group();
    const hull = this.material(0xd8dde6);
    const accent = this.material(0xff8a3d);
    const core = new Mesh(this.own(new CylinderGeometry(r * 0.32, r * 0.38, 3, 16)), hull);
    root.add(core);
    if (this.station.kind !== 'outpost') {
      const rotor = new Group();
      rotor.name = 'ring_rotor';
      const ring = new Mesh(this.own(new TorusGeometry(r * 0.72, 0.7, 8, 40)), accent);
      ring.rotation.x = Math.PI / 2;
      rotor.add(ring);
      root.add(rotor);
    }
    const arm = new Mesh(this.own(new BoxGeometry(r * 0.62, 1.2, 1.6)), hull);
    arm.position.set(r * 0.69, 0, 0);
    root.add(arm);
    const lamp = this.own(new SphereGeometry(0.3, 10, 8));
    [
      [r - 0.4, 0.6, -1.1],
      [r - 0.4, 0.6, 1.1],
      [0, 2.2, 0],
    ].forEach(([x, y, z], i) => {
      const beacon = new Mesh(lamp, this.material(0xffffff, 0xff5a3c, 3));
      beacon.name = `beacon_${i}`;
      beacon.position.set(x!, y!, z!);
      root.add(beacon);
    });
    const port = new Object3D();
    port.name = 'dock_port';
    port.position.set(layout.dockPort.x, 0, -layout.dockPort.y);
    root.add(port);
    return root;
  }

  private portFallback(model: Object3D): Object3D {
    const layout = STATION_LAYOUTS[this.station.model];
    const port = new Object3D();
    port.position.set(layout.dockPort.x, 0, -layout.dockPort.y);
    model.add(port);
    return port;
  }

  private clampPlaceholder(): Object3D {
    const root = new Group();
    const frame = new Mesh(this.own(new BoxGeometry(3, 0.5, 3)), this.material(0x9aa3b5));
    frame.position.set(-0.9, -0.1, 0);
    root.add(frame);
    const light = this.own(new BoxGeometry(0.25, 0.1, 2.5));
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh(light, this.material(0xffffff, 0x6dfcb0, 3));
      mesh.name = `guide_light_${i}`;
      mesh.position.set(-1.6 + i * 0.65, 0.22, 0);
      root.add(mesh);
    }
    return root;
  }

  update(time: number, dt: number, jaws?: ClampJawInput): void {
    if (this.jaws.length > 0 && jaws) {
      const target = clampJawTarget(jaws.dock, jaws.tick, this.station.id);
      const closure = this.jawClosure === null ? target : stepClampJaw(this.jawClosure, target, dt, jaws.reducedMotion);
      if (closure !== this.jawClosure) {
        for (const j of this.jaws) j.node.quaternion.copy(j.base).multiply(tmpQuat.setFromAxisAngle(AXIS_Y, j.sign * CLAMP_JAW_OPEN * (1 - closure)));
      }
      this.jawClosure = closure;
    }
    if (this.rotor) {
      this.rotor.angle = (this.rotor.angle + ROTOR_SPEED * dt) % (Math.PI * 2);
      this.rotor.node.quaternion.copy(this.rotor.base).multiply(tmpQuat.setFromAxisAngle(AXIS_Y, this.rotor.angle));
    }
    for (const b of this.beacons) b.material.emissiveIntensity = b.base * beaconLevel(time, b.index);
    for (const g of this.guides) g.material.emissiveIntensity = g.base * guideLightLevel(time, g.index, this.guides.length);
  }

  /** Frees only its own materials and geometries (the library templates stay). */
  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.group.removeFromParent();
  }
}

/** Stations of the active chunks – creates and removes views as the world changes. */
export class StationLayer {
  readonly object = new Group();
  private readonly views = new Map<string, StationView>();

  constructor(private readonly library: ModelLibrary) {}

  sync(stations: readonly StationDef[]): void {
    const wanted = new Set<string>();
    for (const s of stations) {
      wanted.add(s.id);
      if (this.views.has(s.id)) continue;
      const view = new StationView(s, this.library);
      this.views.set(s.id, view);
      this.object.add(view.group);
    }
    for (const [id, view] of this.views) {
      if (wanted.has(id)) continue;
      view.dispose();
      this.views.delete(id);
    }
  }

  update(time: number, dt: number, jaws?: ClampJawInput): void {
    for (const view of this.views.values()) view.update(time, dt, jaws);
  }

  /**
   * The `attach_<slot>` empties of a station's model (home modules, M4c): null while the station has
   * no view (outside the active chunks), empty for a placeholder model.
   */
  attachPoints(id: string): ReadonlyMap<string, Object3D> | null {
    return this.views.get(id)?.attachPoints ?? null;
  }

  get count(): number {
    return this.views.size;
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }
}

// Cosmetic traffic around the stations (visual polish, render only): traders and shuttles from the
// schedule in schedule.ts – the NPC trader and the civilian ships of art batch C (models/npc, see
// npc_ships.json) and the cargo / scout drones (models/drones) with engine flames on their thruster_*
// nodes, blinking nav lamps (beacon_*) and a fading trail. Only stations near the camera get traffic;
// the density follows the graphics quality. Each vehicle's static meshes and lamps draw as one mesh
// (vehicleBatch.ts – the lamps blink in the shader).
import { Color, Group, Mesh, Object3D, Quaternion, Vector3, type Material, type ShaderMaterial } from 'three';
import type { StationDef } from '../../sim/world/stations';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { fetchAsset } from '../assets/ModelLibrary';
import { assetUrl } from '../assets/url';
import { simToWorld } from '../coords';
import { advanceFlame, createFlameGeometry, createFlameMaterial, setFlameIntensity } from '../fx/flame';
import { createTrailMaterial, Trail } from '../fx/Trail';
import { takeOut } from '../shipBatch';
import type { WarmUpZoo } from '../warmup';
import { trafficRole, trafficSlots, vehicleAt, type TrafficSlot, type VehicleKind, type VehiclePose } from './schedule';
import { nozzleMean, vehicleBatch, vehicleMaterial, type LampClock } from './vehicleBatch';

const MODELS: Readonly<Record<VehicleKind, string>> = {
  trader: 'assets/models/npc/trader.glb',
  cargo: 'assets/models/drones/drone_cargo.glb',
  scout: 'assets/models/drones/drone_scout.glb',
  miner_barge: 'assets/models/npc/miner_barge.glb',
  tanker: 'assets/models/npc/tanker.glb',
  courier: 'assets/models/npc/courier.glb',
  survey_ship: 'assets/models/npc/survey_ship.glb',
};
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const TRAFFIC_MODEL_PATHS: readonly string[] = Object.values(MODELS);
/** Model scale (drones are tiny next to a ship cell – a shuttle reads at ~3–4 units). */
const SCALE: Readonly<Record<VehicleKind, number>> = { trader: 1, cargo: 1.7, scout: 1.6, miner_barge: 1, tanker: 1, courier: 1, survey_ship: 1 };
/** Flame size per kind (strip width is in the material; length scales here). */
const FLAME_LENGTH: Readonly<Record<VehicleKind, number>> = {
  trader: 2.6,
  cargo: 1.1,
  scout: 1.0,
  miner_barge: 2.2,
  tanker: 2.2,
  courier: 1.2,
  survey_ship: 1.6,
};
/** Which flame material (strip width) the nozzles use. */
const FLAME_MATERIAL: Readonly<Record<VehicleKind, 'big' | 'small'>> = {
  trader: 'big',
  cargo: 'small',
  scout: 'small',
  miner_barge: 'big',
  tanker: 'big',
  courier: 'small',
  survey_ship: 'big',
};
/** Trail width, colour and lifetime (s). */
const TRAIL: Readonly<Record<VehicleKind, { width: number; color: readonly [number, number, number]; life: number }>> = {
  trader: { width: 1.5, color: [0.45, 0.62, 0.95], life: 1.6 },
  cargo: { width: 0.45, color: [0.9, 0.62, 0.35], life: 0.9 },
  scout: { width: 0.4, color: [0.55, 0.8, 1.0], life: 0.9 },
  miner_barge: { width: 1.3, color: [0.95, 0.66, 0.4], life: 1.6 },
  tanker: { width: 1.3, color: [0.95, 0.85, 0.5], life: 1.6 },
  courier: { width: 0.5, color: [0.55, 0.95, 0.7], life: 0.9 },
  survey_ship: { width: 0.9, color: [0.45, 0.85, 0.95], life: 1.3 },
};
/**
 * Parts that turn around their own local axis (rev/s). `docked`: only while the ship holds at the
 * berth (the barge's drills run there and idle in flight), otherwise always (the survey dish).
 */
const SPINNERS: Readonly<Record<string, { axis: Vector3; rev: number; docked: boolean }>> = {
  Drill_0: { axis: new Vector3(1, 0, 0), rev: 3, docked: true },
  Drill_1: { axis: new Vector3(1, 0, 0), rev: -3, docked: true },
  Survey_Dish: { axis: new Vector3(0, 1, 0), rev: 0.15, docked: false },
};
/** The barge's ore load: aboard while it arrives, unloaded halfway through the stay. */
const ORE_NODE = 'Barge_Ore';
/** Stations farther than this from the camera target have no traffic. */
const RANGE = 700;

let templates: Promise<Partial<Record<VehicleKind, Object3D>>> | null = null;

/** The vehicle models – loaded once per page, shared by all games (never disposed). */
function loadTemplates(): Promise<Partial<Record<VehicleKind, Object3D>>> {
  templates ??= (async () => {
    const loader = createModelLoader();
    const out: Partial<Record<VehicleKind, Object3D>> = {};
    await Promise.all(
      (Object.keys(MODELS) as VehicleKind[]).map(async (kind) => {
        try {
          const data = await fetchAsset(MODELS[kind]);
          if (!data) return;
          const gltf = await loader.parseAsync(data, assetUrl(MODELS[kind]).replace(/[^/]*$/, ''));
          guardPaletteMaterials(gltf.scene);
          out[kind] = gltf.scene;
        } catch (e) {
          console.warn(`Traffic model failed to load: ${MODELS[kind]}`, e);
        }
      }),
    );
    return out;
  })();
  return templates;
}

interface Vehicle {
  slot: TrafficSlot;
  root: Object3D;
  flames: Mesh[];
  /** Blinking lamp materials of this vehicle (vehicleBatch.ts), disposed with it. */
  materials: Material[];
  trail: Trail;
  thrusters: Object3D[];
  spinners: { node: Object3D; rest: Quaternion; axis: Vector3; rev: number; docked: boolean; angle: number; speed: number }[];
  ore: Object3D | null;
  /** This vehicle's pose, filled by vehicleAt every frame. */
  pose: VehiclePose;
  /**
   * The mean nozzle position in the model's own space (null = a nozzle hangs under a spinning part:
   * measured in the world every frame) – the trail starts there without a world-matrix pass per frame.
   */
  nozzle: Vector3 | null;
}

interface StationEntry {
  station: StationDef;
  group: Group;
  vehicles: Vehicle[];
  density: number;
  /** The frame this station was last near the camera (stations left behind are dropped). */
  seen: number;
}

const tmp = new Vector3();
const avg = new Vector3();
const spinQ = new Quaternion();
export class StationTraffic {
  readonly object = new Group();
  private models: Partial<Record<VehicleKind, Object3D>> | null = null;
  private readonly stations = new Map<string, StationEntry>();
  private readonly flameGeometry = createFlameGeometry();
  private readonly flameMaterials: Record<'big' | 'small', ShaderMaterial> = {
    big: createFlameMaterial(1.05, new Color(0.75, 0.85, 1.0)),
    small: createFlameMaterial(0.42),
  };
  private readonly trailMaterial = createTrailMaterial();
  /** Wall clock of the nav lamps, shared by every vehicle's lamp material. */
  private readonly lampClock: LampClock = { value: 0 };
  private density = 1;
  private trails = true;
  private disposed = false;
  private wallTime = 0;
  private frameDt = 0;
  private frameNo = 0;

  constructor() {
    this.object.name = 'station-traffic';
    void loadTemplates().then((m) => {
      if (this.disposed) return;
      this.models = m;
      // stations built before the models arrived are rebuilt with them
      for (const e of this.stations.values()) this.clear(e);
    });
  }

  /**
   * Shader warm-up: every vehicle model, its flames and its trail (they are built only when a station
   * with traffic comes near).
   */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    const models = await loadTemplates();
    for (const template of Object.values(models)) {
      if (!template) continue;
      zoo.add(template.clone());
      // the merged vehicle with its blinking-lamp material, as build() makes it
      for (const part of vehicleBatch(template, (o) => o.name in SPINNERS || o.name === ORE_NODE).parts) {
        zoo.add(new Mesh(part.geometry, part.lamps ? vehicleMaterial(part.material, this.lampClock, 0) : part.material));
      }
    }
    for (const material of Object.values(this.flameMaterials)) zoo.add(new Mesh(this.flameGeometry, material));
    const trail = new Trail(this.trailMaterial, 4, new Color(1, 1, 1), 0.2, 0.5);
    zoo.geometry(trail.mesh.geometry);
    zoo.add(trail.mesh);
  }

  setQuality(traffic: number, trails: boolean): void {
    this.density = traffic;
    this.trails = trails;
  }

  private clear(entry: StationEntry): void {
    for (const v of entry.vehicles) {
      v.trail.dispose();
      for (const m of v.materials) m.dispose();
    }
    entry.vehicles = [];
    entry.group.clear();
    entry.density = -1;
  }

  private build(entry: StationEntry): void {
    if (!this.models) return;
    const { station } = entry;
    entry.density = this.density;
    for (const slot of trafficSlots(station.id, trafficRole(station.kind, station.model), this.density)) {
      const template = this.models[slot.kind];
      if (!template) continue;
      const root = template.clone();
      root.scale.setScalar(SCALE[slot.kind]);
      root.visible = false;
      // the static meshes and lamps of the model → its merged parts
      const batch = vehicleBatch(template, (o) => o.name in SPINNERS || o.name === ORE_NODE);
      const replaced: Mesh[] = [];
      let index = 0;
      root.traverse((o) => {
        if (batch.merged.has(index++)) replaced.push(o as Mesh);
      });
      takeOut(replaced, root);
      const materials: Material[] = [];
      for (const part of batch.parts) {
        const material = part.lamps ? vehicleMaterial(part.material, this.lampClock, slot.index) : part.material;
        if (material !== part.material) materials.push(material);
        const mesh = new Mesh(part.geometry, material);
        mesh.name = 'vehicle-batch';
        root.add(mesh);
      }
      const flames: Mesh[] = [];
      const thrusters: Object3D[] = [];
      const spinners: Vehicle['spinners'] = [];
      let ore: Object3D | null = null;
      root.traverse((o) => {
        if (/^thruster_\d+$/.test(o.name)) thrusters.push(o);
        const spin = SPINNERS[o.name];
        if (spin) spinners.push({ node: o, rest: o.quaternion.clone(), ...spin, angle: 0, speed: spin.docked ? 0 : 1 });
        if (o.name === ORE_NODE) ore = o;
      });
      const material = this.flameMaterials[FLAME_MATERIAL[slot.kind]];
      for (const t of thrusters) {
        // the flame strip runs along its local +Y; the thruster's +X is the exhaust direction
        const flame = new Mesh(this.flameGeometry, material);
        flame.rotation.z = -Math.PI / 2;
        flame.userData.noAO = true;
        t.add(flame);
        flames.push(flame);
      }
      const spec = TRAIL[slot.kind];
      const trail = new Trail(this.trailMaterial, 36, new Color(...spec.color), spec.width, spec.life);
      this.object.add(trail.mesh);
      entry.group.add(root);
      entry.vehicles.push({ slot, root, flames, materials, trail, thrusters, spinners, ore, pose: {} as VehiclePose, nozzle: nozzleMean(root, thrusters, (o) => o.name in SPINNERS) });
    }
  }

  /** `stations` = the stations of the active chunks, `time` = simulation time (s). */
  update(stations: readonly StationDef[], target: Vector3, time: number, dt: number): void {
    this.wallTime += dt;
    this.frameDt = dt;
    this.lampClock.value = this.wallTime;
    advanceFlame(this.flameMaterials.big, dt);
    advanceFlame(this.flameMaterials.small, dt);
    const frame = ++this.frameNo;
    for (const s of stations) {
      const dx = s.pos.x - target.x;
      const dz = -s.pos.y - target.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      let entry = this.stations.get(s.id);
      if (!entry) {
        const group = new Group();
        simToWorld(s.pos, 0, group.position);
        group.rotation.y = s.portAngle;
        this.object.add(group);
        entry = { station: s, group, vehicles: [], density: -1, seen: frame };
        this.stations.set(s.id, entry);
      }
      entry.seen = frame;
      if (entry.density !== this.density) {
        this.clear(entry);
        this.build(entry);
      }
      this.animate(entry, time);
    }
    for (const [id, entry] of this.stations) {
      if (entry.seen === frame) continue;
      this.clear(entry);
      entry.group.removeFromParent();
      this.stations.delete(id);
    }
  }

  private animate(entry: StationEntry, time: number): void {
    // only the station group's own world matrix (the vehicles' are made by the renderer's pass)
    entry.group.updateWorldMatrix(true, false);
    for (const v of entry.vehicles) {
      const pose = vehicleAt(entry.station.id, v.slot, entry.station.radius, time, v.pose);
      v.root.visible = pose !== null && pose.scale > 0.01;
      if (!pose || !v.root.visible) {
        v.trail.emit(avg, 0, this.wallTime);
        v.trail.update(this.wallTime);
        continue;
      }
      v.root.position.set(pose.x, pose.y, pose.z);
      v.root.rotation.set(0, pose.heading, 0);
      v.root.scale.setScalar(SCALE[v.slot.kind] * pose.scale);
      const intensity = 0.25 + pose.throttle * 1.1;
      for (const f of v.flames) {
        f.visible = pose.throttle > 0.02;
        f.scale.set(1, FLAME_LENGTH[v.slot.kind] * (0.35 + pose.throttle), 1);
        setFlameIntensity(f, intensity);
      }
      if (v.ore) v.ore.visible = pose.phase === 'approach' || (pose.phase === 'docked' && pose.progress < 0.5);
      for (const s of v.spinners) {
        // drills spin up at the berth and wind down after it (no snap to a standstill)
        const target = !s.docked || pose.phase === 'docked' ? 1 : 0;
        s.speed += (target - s.speed) * Math.min(1, this.frameDt * 1.5);
        s.angle = (s.angle + s.rev * s.speed * Math.PI * 2 * this.frameDt) % (Math.PI * 2);
        s.node.quaternion.copy(s.rest).multiply(spinQ.setFromAxisAngle(s.axis, s.angle));
      }
      // trail from the mean nozzle position (world space)
      if (v.nozzle) {
        v.root.updateMatrix();
        avg.copy(v.nozzle).applyMatrix4(v.root.matrix).applyMatrix4(entry.group.matrixWorld);
      } else {
        v.root.updateMatrixWorld(true);
        avg.set(0, 0, 0);
        for (const t of v.thrusters) avg.add(t.getWorldPosition(tmp));
        avg.divideScalar(v.thrusters.length);
      }
      v.trail.width = TRAIL[v.slot.kind].width * pose.scale;
      v.trail.emit(avg, this.trails ? pose.throttle * pose.scale : 0, this.wallTime);
      v.trail.update(this.wallTime);
    }
  }

  /** Vehicles in flight or docked right now (tests). */
  stats(): { stations: number; vehicles: number; visible: number } {
    let vehicles = 0;
    let visible = 0;
    for (const e of this.stations.values()) {
      vehicles += e.vehicles.length;
      visible += e.vehicles.filter((v) => v.root.visible).length;
    }
    return { stations: this.stations.size, vehicles, visible };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.stations.values()) this.clear(e);
    this.stations.clear();
    this.flameGeometry.dispose();
    for (const m of Object.values(this.flameMaterials)) m.dispose();
    this.trailMaterial.dispose();
    this.object.removeFromParent();
  }
}

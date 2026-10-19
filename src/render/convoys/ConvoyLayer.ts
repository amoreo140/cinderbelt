// Convoys of the Free Traders in the world (M4d plan §2.5, T14): the scheduled lane convoys near the
// view – the trader (its containers gone once the pass is sold out), the tanker 16 u behind it and the
// cosmetic Guild cutter – with engine flames, blinking nav lamps (the amber beacon_3 right above the
// trade port), the trade-port marker the player lines up with and the link clamp while linked. Reads
// the simulation state only (`convoysNear`, `state.convoys`); what to draw is decided in convoyLook.ts.
// The linked ship itself is pinned by the simulation (sim/convoys/link.ts: the trade port + the ship's
// bounding radius outward) and drawn by the ship view.
//
// Cost – four draw calls for every convoy in view together (plus the hull batch's shadow and AO
// passes):
//   - every hull in ONE BatchedMesh (the shared palette atlas material; the lamps blink in its shader
//     like the station traffic, vehicleBatch.ts `vehicleMaterial`; the trader's `Trader_Cargo` is its
//     own geometry, hidden per instance);
//   - every engine flame in ONE InstancedMesh (the fx/flame.ts strip, instanced – convoyLook.ts);
//   - every lamp halo, engine glow and the link clamp in ONE sprite batch;
//   - the trade-port marker: one flat quad, only near a port.
// Every program is compiled in the shader warm-up (warmUp); nothing new mid-session.
//
// Escort contract convoys (T6, `state.convoys.escorts`, escortLook.ts): the trader and the tanker 16 u
// behind it in the same batch, flames while the convoy flies; their hits, damage smoke and explosions
// are the combat layer's (CombatLayer `npcHit` / `npcDestroyed`).
import {
  AdditiveBlending,
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { CONVOY_SHIP_KINDS, type ConvoyShipKind } from '../../data/convoys';
import { lerp, type Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { PALETTE } from '../../ui/theme/tokens';
import { createModelLoader } from '../assets/gltf';
import { loadModelScene, toFloatAttributes } from '../assets/ModelLibrary';
import { lampLevel } from '../borders/borderLamps';
import { advanceFlame, createFlameGeometry, createFlameMaterial } from '../fx/flame';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import { normalizeGeometry } from '../scatter/ScatterLayer';
import { mergeSources, type BatchSource } from '../shipBatch';
import { beaconLevel } from '../stationAnim';
import { BEACON_NODE, vehicleMaterial, type LampClock } from '../traffic/vehicleBatch';
import { uploadPrefix } from '../uploads';
import type { WarmUpZoo } from '../warmup';
import {
  clampBeam,
  CONVOY_RENDER_RANGE,
  convoyShipsNear,
  FLAME_LENGTH,
  instancedFlameShader,
  LAMPS,
  legThrottle,
  portMarker,
  renderTick,
  type ConvoyShipView,
  type LampColor,
} from './convoyLook';
import { escortShipsNow, type EscortShipView } from './escortLook';

const FILES: Readonly<Record<ConvoyShipKind, string>> = {
  trader: 'assets/models/npc/trader.glb',
  tanker: 'assets/models/npc/tanker.glb',
  cutter: 'assets/models/npc/guild_cutter.glb',
};
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const CONVOY_MODEL_PATHS: readonly string[] = Object.values(FILES);
/** The trader's container racks: hidden when the pass is sold out. */
const CARGO_NODE = 'Trader_Cargo';
const THRUSTER_NODE = /^thruster_\d+$/;

/** Hull instances (a trader takes two: hull + containers), flames and halos at most. */
const MAX_INSTANCES = 32;
const MAX_FLAMES = 48;
const MAX_HALOS = 160;

const LAMP_COLOR: Readonly<Record<LampColor, Color>> = {
  red: new Color('#ff4a3a'),
  green: new Color('#5dff8a'),
  white: new Color('#fff2dc'),
  amber: new Color(PALETTE.warn),
  strobe: new Color('#9ccbff'),
};
const ENGINE_COLOR = new Color(0.6, 0.78, 1);
const CLAMP_COLOR = new Color('#bfffd2');
/** Halo sizes (u) at the reference camera distance; they grow with the distance like the Watch's. */
const GLOW = { lamp: 1.4, amber: 2.6, engine: 1.9, gain: 2.0 } as const;
/** The amber port lamp's halo between its flashes (0..1). */
const AMBER_FLOOR = 0.6;
const REF_DISTANCE = 48;
/** The flame material's brightness (one shared value – a convoy only cruises or turns). */
const FLAME_INTENSITY = 0.85;
/** Heights above the gameplay plane: the marker lies just under the hulls, the clamp at port height. */
const MARKER_Y = -0.45;
const CLAMP_Y = 0.15;
/** Marker quad half-size beyond the ring radius (u) – room for the soft edge. */
const MARKER_MARGIN = 1.6;

interface ModelEntry {
  body: number;
  cargo: number | null;
  /** Lamp centres in the model frame. */
  lamps: { color: LampColor; beacon: number; strobe: number; local: Vector3 }[];
  /** Thruster frames in the model frame (local +X = exhaust). */
  thrusters: Matrix4[];
}

interface ShipSlot {
  kind: ConvoyShipKind;
  body: number;
  cargo: number | null;
  used: boolean;
}

/** Marker: a soft ring where the ship will sit, three chevrons running towards the trade port. */
const MARKER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MARKER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uReady;
uniform float uRadius;
uniform float uHalf;
uniform vec3 uColor;
uniform vec3 uReadyColor;
varying vec2 vUv;
void main() {
  // u along the way to the port, v across (world units from the ring centre)
  vec2 p = (vUv - 0.5) * 2.0 * uHalf;
  float d = length(p);
  float ring = 1.0 - smoothstep(0.08, 0.32, abs(d - uRadius));
  float halo = (1.0 - smoothstep(0.0, 1.2, abs(d - uRadius))) * 0.25;
  float chev = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float c = (fk - 1.0) * uRadius * 0.42;
    float line = abs((p.x - c) + abs(p.y) * 0.9);
    float shape = (1.0 - smoothstep(0.1, 0.26, line)) * (1.0 - smoothstep(uRadius * 0.32, uRadius * 0.4, abs(p.y)));
    float wave = fract(uTime * 0.9 - fk / 3.0);
    chev += shape * (0.35 + 0.65 * smoothstep(0.55, 1.0, wave));
  }
  float a = (ring * (0.7 + 0.3 * uReady) + halo + chev * 0.8) * uAlpha;
  if (a < 0.003) discard;
  vec3 col = mix(uColor, uReadyColor, uReady) * (1.2 + 0.8 * uReady);
  gl_FragColor = vec4(col * a, 1.0);
}`;

const UP = new Vector3(0, 1, 0);

export class ConvoyLayer {
  readonly object = new Group();
  /** The models have loaded (or failed) – the shader warm-up waits for it. */
  readonly ready: Promise<void>;
  private batch: BatchedMesh | null = null;
  private material: Material | null = null;
  private readonly models = new Map<ConvoyShipKind, ModelEntry>();
  private readonly slots = new Map<string, ShipSlot>();
  private readonly lampClock: LampClock = { value: 0 };
  private readonly flameGeometry = createFlameGeometry();
  private readonly flameMaterial: ShaderMaterial;
  private readonly flames: InstancedMesh;
  private readonly halos = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: MAX_HALOS, renderOrder: 12 });
  private readonly markerGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly markerMaterial = new ShaderMaterial({
    vertexShader: MARKER_VERTEX,
    fragmentShader: MARKER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uReady: { value: 0 },
      uRadius: { value: 3 },
      uHalf: { value: 4 },
      uColor: { value: new Color(PALETTE.ok) },
      uReadyColor: { value: new Color('#d9ffe4') },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    forceSinglePass: true,
  });
  private readonly marker: Mesh;
  private time = 0;
  /** Smoothed "the link would be accepted" level of the marker. */
  private readyLevel = 0;
  private disposed = false;
  private readonly shipsNow: ConvoyShipView[] = [];
  private readonly escortsNow: EscortShipView[] = [];
  private readonly camPos = new Vector3(0, REF_DISTANCE, 0);
  private readonly counts = { ships: 0, flames: 0, marker: false, clamp: false };
  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly flameLocal = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();

  constructor() {
    this.object.name = 'convoys';
    this.flameMaterial = createFlameMaterial(1.05, new Color(0.75, 0.85, 1.0));
    this.flameMaterial.vertexShader = instancedFlameShader(this.flameMaterial.vertexShader);
    this.flameMaterial.uniforms.uIntensity!.value = FLAME_INTENSITY;
    this.flames = new InstancedMesh(this.flameGeometry, this.flameMaterial, MAX_FLAMES);
    this.flames.name = 'convoy-flames';
    this.flames.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.userData.noAO = true;
    this.flames.renderOrder = 11;
    this.halos.mesh.name = 'convoy-halos';
    this.halos.mesh.userData.noAO = true;
    // the halos grow with the camera distance: the camera of the last drawn frame
    this.halos.mesh.onBeforeRender = (_r, _s, camera) => {
      this.camPos.setFromMatrixPosition(camera.matrixWorld);
    };
    this.marker = new Mesh(this.markerGeometry, this.markerMaterial);
    this.marker.name = 'convoy-port-marker';
    this.marker.visible = false;
    this.marker.userData.noAO = true;
    this.marker.renderOrder = 11;
    this.object.add(this.flames, this.halos.mesh, this.marker);
    this.ready = this.load();
  }

  // -------------------------------------------------------------------------------------------
  // loading

  private async load(): Promise<void> {
    const loader = createModelLoader();
    const scenes = await Promise.all(CONVOY_SHIP_KINDS.map((kind) => loadModelScene(loader, FILES[kind])));
    if (this.disposed) return;
    const baked: { kind: ConvoyShipKind; body: BufferGeometry; cargo: BufferGeometry | null; lamps: ModelEntry['lamps']; thrusters: Matrix4[] }[] = [];
    let source: Material | null = null;
    CONVOY_SHIP_KINDS.forEach((kind, i) => {
      const scene = scenes[i];
      if (!scene) return;
      const b = bake(kind, scene);
      source ??= b.material;
      if (b.body) baked.push({ kind, body: b.body, cargo: b.cargo, lamps: b.lamps, thrusters: b.thrusters });
      scene.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    });
    if (baked.length === 0 || !source) return;
    let vertices = 0;
    let indices = 0;
    for (const b of baked) {
      for (const g of [b.body, b.cargo]) {
        if (!g) continue;
        vertices += g.getAttribute('position').count;
        indices += g.index!.count;
      }
    }
    // the palette material with vertex colours (the tanker and the cutter carry them, the trader gets white)
    const base = (source as MeshStandardMaterial).clone();
    base.vertexColors = true;
    const material = vehicleMaterial(base, this.lampClock, 0);
    if (material !== base) base.dispose();
    const batch = new BatchedMesh(MAX_INSTANCES, vertices, indices, material);
    batch.name = 'convoy-batch';
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = false;
    for (const b of baked) {
      const body = batch.addGeometry(b.body);
      const cargo = b.cargo ? batch.addGeometry(b.cargo) : null;
      b.body.dispose();
      b.cargo?.dispose();
      this.models.set(b.kind, { body, cargo, lamps: b.lamps, thrusters: b.thrusters });
    }
    this.material = material;
    this.batch = batch;
    this.object.add(batch);
  }

  /**
   * Shader warm-up: the hull batch (main pass, shadow map, AO; with the rim light like the layer –
   * GameRenderer watches it), the instanced flames, the halo sprites and the marker – each a
   * one-instance sample with the layer's own material.
   */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    const batch = this.batch;
    if (batch && this.material) {
      const g = zoo.geometry(new BufferGeometry());
      for (const [name, attr] of Object.entries(batch.geometry.attributes)) g.setAttribute(name, new BufferAttribute(new Float32Array(3 * attr.itemSize), attr.itemSize, attr.normalized));
      g.setIndex([0, 1, 2]);
      const sample = new BatchedMesh(1, 3, 3, this.material);
      sample.addInstance(sample.addGeometry(g));
      zoo.add(sample);
    }
    const flames = new InstancedMesh(this.flameGeometry, this.flameMaterial, 1);
    flames.setMatrixAt(0, new Matrix4());
    flames.userData.noAO = true;
    zoo.addPlain(flames);
    const halos = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 1, renderOrder: 12 });
    halos.begin();
    halos.add(new Vector3(), null, 1, 1, 0, LAMP_COLOR.amber, 1);
    halos.end();
    halos.mesh.userData.noAO = true;
    zoo.addPlain(halos.mesh);
    zoo.onDispose(() => halos.dispose());
    const marker = new Mesh(this.markerGeometry, this.markerMaterial);
    marker.userData.noAO = true;
    zoo.addPlain(marker);
  }

  // -------------------------------------------------------------------------------------------
  // frame

  /** One frame: interpolated with `alpha` between the last two sim steps; `dt` = frame time (s). */
  update(state: SimState, alpha: number, dt: number): void {
    this.time += dt;
    this.lampClock.value = this.time;
    advanceFlame(this.flameMaterial, dt);
    this.markerMaterial.uniforms.uTime!.value = this.time;
    const batch = this.batch;
    if (!batch) return;
    const player = state.player;
    const center = lerp(player.prevBody.pos, player.body.pos, alpha);
    const ships = this.shipsNow;
    ships.length = 0;
    const { poses } = convoyShipsNear(state.seed, center, CONVOY_RENDER_RANGE, renderTick(state.tick, alpha), state.convoys.trades, ships);
    // the escort contract convoys (no trade port – they carry the contract's freight)
    const escorts = this.escortsNow;
    escorts.length = 0;
    escortShipsNow(state, alpha, escorts, center, CONVOY_RENDER_RANGE);
    for (const s of escorts) ships.push({ id: s.id, kind: s.kind, pos: s.pos, heading: s.heading, throttle: s.moving ? legThrottle('out') : 0, cargo: true });
    for (const slot of this.slots.values()) slot.used = false;
    this.halos.begin();
    let flames = 0;
    let shown = 0;
    const grow = Math.min(2.6, Math.max(1, Math.pow(this.camPos.distanceTo(this.v.set(center.x, 0, -center.y)) / REF_DISTANCE, 0.85)));
    for (const ship of ships) {
      const entry = this.models.get(ship.kind);
      if (!entry) continue;
      let slot = this.slots.get(ship.id);
      if (!slot) {
        const need = entry.cargo === null ? 1 : 2;
        if (batch.instanceCount + need > MAX_INSTANCES) continue;
        slot = { kind: ship.kind, body: batch.addInstance(entry.body), cargo: entry.cargo === null ? null : batch.addInstance(entry.cargo), used: false };
        this.slots.set(ship.id, slot);
      }
      slot.used = true;
      shown++;
      this.m.compose(this.v.set(ship.pos.x, 0, -ship.pos.y), this.q.setFromAxisAngle(UP, ship.heading), this.s.setScalar(1));
      batch.setMatrixAt(slot.body, this.m);
      batch.setVisibleAt(slot.body, true);
      if (slot.cargo !== null) {
        batch.setMatrixAt(slot.cargo, this.m);
        batch.setVisibleAt(slot.cargo, ship.cargo);
      }
      // engine flames: the strip runs along its local +Y, the thruster's +X is the exhaust
      if (ship.throttle > 0.02) {
        const length = FLAME_LENGTH[ship.kind] * (0.35 + ship.throttle);
        this.flameLocal.makeRotationZ(-Math.PI / 2).scale(this.s.set(1, length, 1));
        for (const t of entry.thrusters) {
          if (flames >= MAX_FLAMES) break;
          this.flames.setMatrixAt(flames++, this.m2.multiplyMatrices(this.m, t).multiply(this.flameLocal));
          this.v2.setFromMatrixPosition(this.m2);
          this.addHalo(this.v2, ENGINE_COLOR, GLOW.engine * grow, 0.5 + 0.5 * ship.throttle);
        }
      }
      for (const lamp of entry.lamps) {
        let level = lamp.beacon >= 0 ? beaconLevel(this.time, lamp.beacon) : lampLevel('strobe', this.time, lamp.strobe);
        // the amber lamp above the trade port never goes dark: it shows where to line up
        if (lamp.color === 'amber') level = Math.max(level, AMBER_FLOOR);
        if (level < 0.03) continue;
        this.v2.copy(lamp.local).applyMatrix4(this.m);
        this.addHalo(this.v2, LAMP_COLOR[lamp.color], (lamp.color === 'amber' ? GLOW.amber : GLOW.lamp) * grow, level);
      }
    }
    // free the slots of ships that left the view
    for (const [id, slot] of this.slots) {
      if (slot.used) continue;
      batch.deleteInstance(slot.body);
      if (slot.cargo !== null) batch.deleteInstance(slot.cargo);
      this.slots.delete(id);
    }
    this.flames.count = flames;
    uploadPrefix(this.flames.instanceMatrix, flames);
    this.updateLink(state, poses, alpha, dt);
    this.halos.end();
    this.counts.ships = shown;
    this.counts.flames = flames;
  }

  /** The trade-port marker near a port, the clamp while linked. */
  private updateLink(state: SimState, poses: Parameters<typeof portMarker>[0], alpha: number, dt: number): void {
    const player = state.player;
    const flying = !player.destroyed && player.dock.mode === 'flying';
    const pos: Vec2 = lerp(player.prevBody.pos, player.body.pos, alpha);
    const link = state.convoys.link;
    this.counts.clamp = false;
    if (flying && link) {
      const beam = clampBeam(poses, link.pass, pos);
      if (beam) {
        this.counts.clamp = true;
        const dx = beam.to.x - beam.from.x;
        const dy = beam.to.y - beam.from.y;
        const len = Math.hypot(dx, dy);
        const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
        if (len > 0.05) {
          this.v.set((beam.from.x + beam.to.x) / 2, CLAMP_Y, -(beam.from.y + beam.to.y) / 2);
          this.addHalo(this.v, CLAMP_COLOR, 0, pulse, this.v2.set(dx, 0, -dy), len + 0.8, 0.8);
        }
        this.addHalo(this.v.set(beam.from.x, CLAMP_Y, -beam.from.y), CLAMP_COLOR, 1.3, pulse);
      }
    }
    const marker = flying && !link ? portMarker(poses, { pos, vel: player.body.vel, radius: player.props.boundingRadius }) : null;
    this.readyLevel += ((marker?.ready ? 1 : 0) - this.readyLevel) * Math.min(1, dt * 6);
    this.marker.visible = marker !== null && marker.alpha > 0.01;
    this.counts.marker = this.marker.visible;
    if (!marker || !this.marker.visible) return;
    const half = marker.radius + MARKER_MARGIN;
    this.marker.position.set(marker.pos.x, MARKER_Y, -marker.pos.y);
    this.marker.rotation.set(0, Math.atan2(marker.dir.y, marker.dir.x), 0);
    this.marker.scale.setScalar(half * 2);
    const u = this.markerMaterial.uniforms;
    u.uAlpha!.value = marker.alpha;
    u.uReady!.value = this.readyLevel;
    u.uRadius!.value = marker.radius;
    u.uHalf!.value = half;
  }

  /** A halo (or, with `axis`, a sprite stretched along it: `width` × `height`). */
  private addHalo(at: Vector3, color: Color, size: number, level: number, axis: Vector3 | null = null, width = size, height = size): void {
    this.c.copy(color).multiplyScalar(GLOW.gain);
    this.halos.add(at, axis, width, height, 0, this.c, 0.55 * level);
  }

  /** What the layer draws (tests and tuning). */
  stats(): { loaded: boolean; ships: number; instances: number; flames: number; halos: number; marker: boolean; clamp: boolean } {
    const halos = (this.halos.mesh.geometry as { instanceCount?: number }).instanceCount ?? 0;
    return {
      loaded: this.batch !== null,
      ships: this.counts.ships,
      instances: this.batch?.instanceCount ?? 0,
      flames: this.counts.flames,
      halos,
      marker: this.counts.marker,
      clamp: this.counts.clamp,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.slots.clear();
    this.batch?.dispose();
    this.material?.dispose();
    this.batch = null;
    this.flames.dispose();
    this.flameGeometry.dispose();
    this.flameMaterial.dispose();
    this.halos.dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
    this.object.clear();
    this.object.removeFromParent();
  }
}

/**
 * One convoy model baked for the batch: the static meshes merged into one geometry in the model frame
 * (the lamp number per vertex for the blinking shader), the trader's containers apart, the lamp
 * centres and the thruster frames.
 */
function bake(
  kind: ConvoyShipKind,
  scene: Object3D,
): { body: BufferGeometry | null; cargo: BufferGeometry | null; material: Material | null; lamps: ModelEntry['lamps']; thrusters: Matrix4[] } {
  scene.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(scene.matrixWorld).invert();
  const body: BatchSource[] = [];
  const cargo: BatchSource[] = [];
  const lamps: ModelEntry['lamps'] = [];
  const thrusters: Matrix4[] = [];
  let material: Material | null = null;
  scene.traverse((o) => {
    if (THRUSTER_NODE.test(o.name)) thrusters.push(new Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
    if (!(o instanceof Mesh) || Array.isArray(o.material) || !o.visible) return;
    const color = LAMPS[kind][o.name];
    const beacon = BEACON_NODE.exec(o.name);
    if (color) {
      const g = o.geometry as BufferGeometry;
      g.computeBoundingBox();
      const local = g.boundingBox!.getCenter(new Vector3()).applyMatrix4(o.matrixWorld).applyMatrix4(toRoot);
      lamps.push({ color, beacon: beacon ? Number(beacon[1]) : -1, strobe: o.name.endsWith('1') ? 0.5 : 0, local });
    }
    material ??= o.material as Material;
    let inCargo = false;
    for (let n: Object3D | null = o; n && n !== scene; n = n.parent) if (n.name === CARGO_NODE) inCargo = true;
    const g = normalizeGeometry(toFloatAttributes((o.geometry as BufferGeometry).clone()));
    g.setAttribute('beaconIndex', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(beacon ? Number(beacon[1]) : -1), 1));
    (inCargo ? cargo : body).push({ geometry: g, matrix: new Matrix4().multiplyMatrices(toRoot, o.matrixWorld) });
  });
  const merge = (list: BatchSource[]): BufferGeometry | null => {
    if (list.length === 0) return null;
    const out = toFloatAttributes(mergeSources(list));
    for (const s of list) s.geometry.dispose();
    return out;
  };
  return { body: merge(body), cargo: merge(cargo), material, lamps, thrusters };
}

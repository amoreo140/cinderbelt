// Station traffic vehicles in one draw call each (audit 2026-10-16, follow-up of #4). A vehicle model
// is a hull, a few static attachments and 1–4 blinking nav lamps (beacon_*), and every lamp used to
// carry its own material clone (the blink was its emissive intensity) – about five meshes per
// vehicle, each drawn in the main pass, the shadow map and the AO pre-pass. Now the static meshes of
// a model merge once per model (the geometry is shared by all vehicles of that kind) and the lamps
// blink in the shader: a per-vertex lamp index, the shared wall clock and the vehicle's slot offset
// reproduce stationAnim.beaconLevel exactly. Nodes that move or hide on their own (drills, the
// survey dish, the barge's ore load) stay separate.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { materialKey, mergeSources, type BatchSource } from '../shipBatch';
import { BEACON_DIM, BEACON_FLASH, BEACON_PERIOD } from '../stationAnim';

export const BEACON_NODE = /^beacon_(\d+)$/;
/** Per-vertex lamp number (−1 = not a lamp). */
const LAMP_ATTRIBUTE = 'beaconIndex';

export interface VehiclePart {
  /** Merged static meshes in the model's frame (shared by every vehicle of the model, never disposed). */
  geometry: BufferGeometry;
  material: Material;
  /** The part holds lamps: each vehicle draws it with its own blinking material (vehicleMaterial). */
  lamps: boolean;
}

export interface VehicleBatch {
  parts: VehiclePart[];
  /** Indices (in `traverse` order) of the template's meshes the parts replace. */
  merged: ReadonlySet<number>;
}

const cache = new WeakMap<Object3D, VehicleBatch>();

/**
 * Bakes a vehicle model (cached per template): merges its static meshes per material. `live` marks
 * nodes that animate or toggle by themselves – they and everything below them stay as they are.
 */
export function vehicleBatch(template: Object3D, live: (o: Object3D) => boolean): VehicleBatch {
  const known = cache.get(template);
  if (known) return known;
  template.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(template.matrixWorld).invert();
  const groups = new Map<string, { material: Material; sources: BatchSource[]; lamps: boolean; indices: number[] }>();
  const liveNodes = new Set<Object3D>();
  let index = 0;
  template.traverse((o) => {
    const i = index++;
    if (live(o) || (o.parent && liveNodes.has(o.parent))) {
      liveNodes.add(o);
      return;
    }
    if (!(o instanceof Mesh) || Array.isArray(o.material) || !o.visible) return;
    const key = materialKey(o.material);
    if (key === null) return;
    const g = o.geometry as BufferGeometry;
    const attrs = Object.keys(g.attributes).sort().join(',');
    const lamp = BEACON_NODE.exec(o.name);
    // the merge reads a shallow copy that carries the lamp number per vertex
    const source = new BufferGeometry();
    for (const name of Object.keys(g.attributes)) source.setAttribute(name, g.getAttribute(name));
    source.setIndex(g.index);
    source.setAttribute(LAMP_ATTRIBUTE, new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(lamp ? Number(lamp[1]) : -1), 1));
    const k = `${key}#${attrs}`;
    let group = groups.get(k);
    if (!group) groups.set(k, (group = { material: o.material as Material, sources: [], lamps: false, indices: [] }));
    group.sources.push({ geometry: source, matrix: new Matrix4().multiplyMatrices(toRoot, o.matrixWorld) });
    group.lamps ||= lamp !== null;
    group.indices.push(i);
  });
  const parts: VehiclePart[] = [];
  const merged = new Set<number>();
  for (const g of groups.values()) {
    const geometry = mergeSources(g.sources);
    if (!g.lamps) geometry.deleteAttribute(LAMP_ATTRIBUTE);
    parts.push({ geometry, material: g.material, lamps: g.lamps });
    for (const i of g.indices) merged.add(i);
  }
  const batch = { parts, merged };
  cache.set(template, batch);
  return batch;
}

/** Shared clock of the lamps (s) – the traffic layer advances it once per frame. */
export type LampClock = { value: number };

/**
 * The blinking material of one vehicle: a clone of the model's material whose lamp vertices glow
 * `max(intensity, 0.8) × 1.6 × beaconLevel(clock, lamp + slot)` instead of the model's intensity
 * (the old per-lamp material clones). Dispose it with the vehicle; the program is shared.
 */
export function vehicleMaterial(source: Material, clock: LampClock, slot: number): Material {
  if (!(source instanceof MeshStandardMaterial)) return source;
  const m = source.clone();
  const intensity = source.emissiveIntensity;
  const gain = intensity > 0 ? (Math.max(intensity, 0.8) * 1.6) / intensity : 0;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLampClock = clock;
    shader.uniforms.uLampSlot = { value: slot };
    shader.uniforms.uLampGain = { value: gain };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float ${LAMP_ATTRIBUTE};
uniform float uLampClock;
uniform float uLampSlot;
uniform float uLampGain;
varying float vLamp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLamp = 1.0;
if (${LAMP_ATTRIBUTE} >= 0.0) {
  float lampT = fract(uLampClock / ${BEACON_PERIOD.toFixed(4)} + (${LAMP_ATTRIBUTE} + uLampSlot) * 0.37) * ${BEACON_PERIOD.toFixed(4)};
  float lampLevel = lampT > ${BEACON_FLASH.toFixed(4)} ? ${BEACON_DIM.toFixed(4)} : ${BEACON_DIM.toFixed(4)} + ${(1 - BEACON_DIM).toFixed(4)} * sin(PI * sqrt(lampT / ${BEACON_FLASH.toFixed(4)}));
  vLamp = uLampGain * lampLevel;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLamp;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLamp;');
  };
  m.customProgramCacheKey = () => 'cinder-traffic-lamps-v1';
  return m;
}

const chain = new Matrix4();
const point = new Vector3();

/**
 * The mean position of a vehicle's `thrusters` in its `root`'s own space (the root's transform left
 * out; the origin when it has none), or null when one of them hangs under a node that moves on its own
 * (`moving`, the spinners) – then the trail start is measured in the world every frame. StationTraffic
 * places the trail with it without a world-matrix pass over the vehicle per frame (audit 2026-10-17 P8).
 */
export function nozzleMean(root: Object3D, thrusters: readonly Object3D[], moving: (node: Object3D) => boolean): Vector3 | null {
  const sum = new Vector3();
  for (const t of thrusters) {
    t.updateMatrix();
    chain.copy(t.matrix);
    for (let p = t.parent; p && p !== root; p = p.parent) {
      if (moving(p)) return null;
      p.updateMatrix();
      chain.premultiply(p.matrix);
    }
    sum.add(point.setFromMatrixPosition(chain));
  }
  return thrusters.length > 0 ? sum.divideScalar(thrusters.length) : sum;
}

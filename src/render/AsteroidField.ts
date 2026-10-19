import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Frustum,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Matrix4,
  Object3D,
  Sphere,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { RESOURCES, RESOURCE_IDS, type ResourceId } from '../data/resources';
import { activeSegment, asteroidOrientation, initialVeinState, modelNameOf, veinsOf, type VeinState } from '../sim/mining/veins';
import type { Asteroid } from '../sim/world/generate';
import type { World } from '../sim/world/World';
import type { AsteroidModel, ModelLibrary } from './assets/ModelLibrary';
import { simToWorld } from './coords';
import { uploadPrefix } from './uploads';

/** Capacity of one InstancedMesh (the active chunks hold ~1000 asteroids together). */
const MAX_INSTANCES = 3000;
/** Asteroid veins are a bit dimmer in the game than in Blender (bloom would blow them out). */
const VEIN_EMISSIVE_SCALE = 0.6;
/** Active vein segment: emission × (1 + VEIN_BOOST · pulse) plus a tint of the ore colour (spec 2.1.1: 2× brighter). */
const VEIN_BOOST = 1.6;
const VEIN_TINT = 1.1;
/** Pulse of the active segment (rad/s). */
const VEIN_PULSE = 6;

/** Placeholder boulder when the model is missing: a deformed icosahedron. */
function createRockGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 2);
  const position = geometry.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const n =
      1 +
      0.16 * Math.sin(3.1 * v.x + 1.3) * Math.sin(2.7 * v.y + 0.4) * Math.sin(3.7 * v.z + 2.2) +
      0.07 * Math.sin(7.3 * v.x + 5.1 * v.z);
    v.multiplyScalar(n);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const frac = (x: number): number => x - Math.floor(x);

interface ModelMesh {
  mesh: InstancedMesh;
  /** Centre (in u) of the active segment of each of the (up to) 3 veins; half length < 0 = no vein. */
  veinCenter: InstancedBufferAttribute | null;
  veinHalf: InstancedBufferAttribute | null;
}

interface ResourceMeshes {
  /** Models by name (asteroid_iron_a …). */
  byName: Map<string, ModelMesh>;
  /** Fallback model when a variant is missing (the first loaded one or the placeholder). */
  fallback: ModelMesh;
  /** The placeholder icosahedron is scaled non-uniformly, a Blender model uniformly. */
  placeholder: boolean;
}

/**
 * Active vein segment shader (spec 2.1.1): a vein fragment (`veinIndex` ≥ 0) glows 2× brighter and
 * pulses when its u lies in the instance's active segment (`veinCenter`, `veinHalf`).
 */
function injectVeinShader(material: MeshStandardMaterial, color: Color, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVeinTime = time;
    shader.uniforms.uVeinColor = { value: color };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float veinIndex;
attribute float veinU;
attribute vec3 veinCenter;
attribute vec3 veinHalf;
varying float vVeinU;
varying float vVeinCenter;
varying float vVeinHalf;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vVeinU = veinU;
vVeinCenter = veinIndex < 0.5 ? veinCenter.x : (veinIndex < 1.5 ? veinCenter.y : veinCenter.z);
vVeinHalf = veinIndex < -0.5 ? -1.0 : (veinIndex < 0.5 ? veinHalf.x : (veinIndex < 1.5 ? veinHalf.y : veinHalf.z));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uVeinTime;
uniform vec3 uVeinColor;
varying float vVeinU;
varying float vVeinCenter;
varying float vVeinHalf;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (vVeinHalf > 0.0) {
  float veinMask = 1.0 - smoothstep(vVeinHalf - 0.05, vVeinHalf + 0.01, abs(vVeinU - vVeinCenter));
  float veinPulse = 0.7 + 0.3 * sin(uVeinTime * ${VEIN_PULSE.toFixed(1)});
  totalEmissiveRadiance = totalEmissiveRadiance * (1.0 + ${VEIN_BOOST.toFixed(2)} * veinMask * veinPulse)
    + uVeinColor * (${VEIN_TINT.toFixed(2)} * veinMask * veinPulse);
}`,
      );
  };
  material.customProgramCacheKey = () => 'cinder-vein-v1';
}

/** Asteroids: one InstancedMesh per model (ore × variant), pose from the simulation. */
export class AsteroidField {
  readonly object = new Group();
  private readonly meshes = {} as Record<ResourceId, ResourceMeshes>;
  private readonly all: ModelMesh[] = [];
  private readonly dummy = new Object3D();
  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly ownedMaterials: Material[] = [];
  private readonly ownedGeometries: BufferGeometry[] = [];
  private readonly veinTime = { value: 0 };
  /** Initial vein state of untouched asteroids (derived from the id – computed once). */
  private readonly initialVeins = new Map<string, VeinState>();

  constructor(library: ModelLibrary) {
    let fallback: BufferGeometry | null = null;
    for (const id of RESOURCE_IDS) {
      const models = library.asteroids(id);
      const byName = new Map<string, ModelMesh>();
      let first: ModelMesh | null = null;
      for (const model of models) {
        const entry = this.modelMesh(model, id);
        byName.set(model.name, entry);
        first ??= entry;
      }
      if (!first) {
        fallback ??= createRockGeometry();
        const def = RESOURCES[id];
        const material = new MeshStandardMaterial({
          color: def.rockColor,
          roughness: 0.85,
          metalness: 0.1,
          flatShading: true,
          emissive: def.color,
          emissiveIntensity: 0.12,
        });
        this.ownedMaterials.push(material);
        first = this.register(new InstancedMesh(fallback, material, MAX_INSTANCES), false);
      }
      this.meshes[id] = { byName, fallback: first, placeholder: models.length === 0 };
    }
  }

  private register(mesh: InstancedMesh, veins: boolean): ModelMesh {
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    let veinCenter: InstancedBufferAttribute | null = null;
    let veinHalf: InstancedBufferAttribute | null = null;
    if (veins) {
      veinCenter = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
      veinHalf = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3).fill(-1), 3);
      mesh.geometry.setAttribute('veinCenter', veinCenter);
      mesh.geometry.setAttribute('veinHalf', veinHalf);
    }
    const entry = { mesh, veinCenter, veinHalf };
    this.all.push(entry);
    return entry;
  }

  /** InstancedMesh of a model: own geometry (shared buffers) and a material copy with dimmer emission. */
  private modelMesh(model: AsteroidModel, resource: ResourceId): ModelMesh {
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(model.geometry.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(model.geometry.index);
    geometry.boundingSphere = model.geometry.boundingSphere;
    this.ownedGeometries.push(geometry);
    const material = model.material.clone();
    // vertex colours carry the AO and facet shading – without the attribute the shader would read black
    material.vertexColors = model.vertexColors;
    if (material instanceof MeshStandardMaterial) {
      material.emissiveIntensity *= VEIN_EMISSIVE_SCALE;
      if (model.veins) injectVeinShader(material, new Color(RESOURCES[resource].color), this.veinTime);
    }
    this.ownedMaterials.push(material);
    return this.register(new InstancedMesh(geometry, material, MAX_INSTANCES), model.veins);
  }

  private veinStateOf(world: World, a: Asteroid): VeinState {
    const saved = world.veins.get(a.id);
    if (saved) return saved;
    let state = this.initialVeins.get(a.id);
    if (!state) {
      state = initialVeinState(a);
      this.initialVeins.set(a.id, state);
    }
    return state;
  }

  /**
   * Draws only the asteroids in the camera view (the camera matrices must be current).
   * `simTime` = simulation time (s) – the rock rotation, and so the vein positions, match the simulation.
   */
  update(world: World, simTime: number, camera: Camera): void {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.veinTime.value = simTime;
    for (const m of this.all) m.mesh.count = 0;
    for (const a of world.asteroids()) {
      const r = world.radiusOf(a);
      if (r <= 0) continue;
      this.sphere.center.set(a.pos.x, 0, -a.pos.y);
      // margin 1.2 – the placeholder is scaled non-uniformly
      this.sphere.radius = r * 1.2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const { byName, fallback, placeholder } = this.meshes[a.resource];
      const entry = byName.get(modelNameOf(a)) ?? fallback;
      const { mesh } = entry;
      if (mesh.count >= MAX_INSTANCES) continue;
      const index = mesh.count++;
      simToWorld(a.pos, 0, this.dummy.position);
      const e = asteroidOrientation(a, simTime);
      this.dummy.rotation.set(e.x, e.y, e.z);
      if (placeholder) {
        const v = a.variant;
        this.dummy.scale.set(r * (0.85 + 0.3 * v), r * (0.8 + 0.25 * frac(v * 7)), r * (0.9 + 0.2 * frac(v * 13)));
      } else {
        // the geometry has a unit radius → scale = radius from the simulation
        this.dummy.scale.setScalar(r);
      }
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
      if (entry.veinCenter && entry.veinHalf) this.writeVeins(entry, index, world, a, r);
    }
    // upload only the instances drawn this frame, not all MAX_INSTANCES (~3 MB per frame before)
    for (const m of this.all) {
      const n = m.mesh.count;
      uploadPrefix(m.mesh.instanceMatrix, n);
      if (m.veinCenter) uploadPrefix(m.veinCenter, n);
      if (m.veinHalf) uploadPrefix(m.veinHalf, n);
    }
  }

  /** Active vein segments of an instance (up to 3 veins). */
  private writeVeins(entry: ModelMesh, index: number, world: World, a: Asteroid, r: number): void {
    const veins = veinsOf(a);
    const state = this.veinStateOf(world, a);
    for (let i = 0; i < 3; i++) {
      const vein = veins[i];
      const seg = vein ? activeSegment(vein, r, state) : null;
      entry.veinCenter!.setComponent(index, i, seg ? seg.center : 0);
      entry.veinHalf!.setComponent(index, i, seg ? seg.half : -1);
    }
  }

  dispose(): void {
    for (const m of this.ownedMaterials) m.dispose();
    for (const g of this.ownedGeometries) g.dispose();
  }
}

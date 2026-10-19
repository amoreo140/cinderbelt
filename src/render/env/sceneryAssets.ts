// Batch A scenery models (art/README §2.7.22): six GLBs whose children are independent unit-radius
// meshes at the origin, taken by name. Loaded once per page through createModelLoader() (meshopt +
// the shared palette atlas) and kept – the depth layers, the rubble chips and the belt beds copy
// the geometry into their BatchedMeshes, so nothing here is ever disposed.
//
// Also the haze patch shared by the far scenery: the lit part is mixed toward the zone haze colour
// and dimmed by the background brightness; the emissive (ember dashes, crystal glints) gets far less
// haze, like the landmarks, so the ring identity survives at depth.
import { BatchedMesh, Color, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from 'three';
import { assetUrl } from '../assets/url';
import { createModelLoader } from '../assets/gltf';
import { fetchAsset } from '../assets/ModelLibrary';
import { parseSceneryManifest, type SceneryManifest } from './scenery';

const DIR = 'assets/models/scenery/';

export interface SceneryFile {
  /** Mesh geometries by node name. */
  geometries: ReadonlyMap<string, BufferGeometry>;
  /** The file's AF_Palette material (atlas maps + vertex colours) – clone it, never change it. */
  material: MeshStandardMaterial;
}

let manifestPromise: Promise<SceneryManifest | null> | null = null;
const files = new Map<string, Promise<SceneryFile | null>>();
const loader = createModelLoader();

export function sceneryManifest(): Promise<SceneryManifest | null> {
  manifestPromise ??= fetchAsset(`${DIR}scenery.json`)
    .then((data) => (data ? (JSON.parse(new TextDecoder().decode(data)) as unknown) : null))
    .then((json: unknown) => parseSceneryManifest(json))
    .catch((e: unknown) => {
      console.warn('Scenery manifest missing – no batch A scenery', e);
      manifestPromise = null;
      return null;
    });
  return manifestPromise;
}

/** Resolves once the manifest and every scenery file have loaded (or failed) – the shader warm-up waits. */
export async function sceneryReady(): Promise<void> {
  const manifest = await sceneryManifest();
  if (manifest) await Promise.all(Object.values(manifest.sets).map((set) => sceneryFile(set.file)));
}

export function sceneryFile(file: string): Promise<SceneryFile | null> {
  let entry = files.get(file);
  if (!entry) {
    // through fetchAsset: the boot list may have its bytes already (assets/prefetch.ts)
    entry = fetchAsset(`${DIR}${file}`)
      .then((data) => {
        if (!data) throw new Error('missing');
        return loader.parseAsync(data, assetUrl(DIR));
      })
      .then((gltf) => {
        const geometries = new Map<string, BufferGeometry>();
        let material: MeshStandardMaterial | null = null;
        gltf.scene.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          const g = o.geometry as BufferGeometry;
          g.computeBoundingBox();
          g.computeBoundingSphere();
          geometries.set(o.name, g);
          if (!material && o.material instanceof MeshStandardMaterial) material = o.material;
        });
        return { geometries, material: material ?? new MeshStandardMaterial({ color: 0x77757e, vertexColors: true, flatShading: true }) };
      })
      .catch((e: unknown) => {
        console.warn(`Scenery ${file} failed to load`, e);
        files.delete(file);
        return null;
      });
    files.set(file, entry);
  }
  return entry;
}

/** One BatchedMesh holding every given geometry (ids in the order given); null when there are none. */
export function batchOf(geometries: readonly BufferGeometry[], maxInstances: number, material: Material): { mesh: BatchedMesh; ids: number[] } | null {
  if (geometries.length === 0) return null;
  let vertices = 0;
  let indices = 0;
  for (const g of geometries) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()?.count ?? 0;
  }
  const mesh = new BatchedMesh(maxInstances, vertices, Math.max(indices, 1), material);
  const ids = geometries.map((g) => mesh.addGeometry(g));
  return { mesh, ids };
}

export interface HazeUniforms {
  color: { value: Color };
  /** Share of the haze colour in the lit part. */
  amount: { value: number };
  /** Share of the haze in the emissive part. */
  emissive: { value: number };
  /** Multiplier of the lit part (background brightness). */
  dim: { value: number };
}

export const hazeUniforms = (color = new Color(), dim = { value: 1 }): HazeUniforms => ({ color: { value: color }, amount: { value: 0 }, emissive: { value: 0 }, dim });

/** A copy of an AF_Palette material with the far-scenery haze patch. */
export function hazeMaterial(source: MeshStandardMaterial, u: HazeUniforms): MeshStandardMaterial {
  const material = source.clone();
  material.vertexColors = true;
  material.flatShading = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScHaze = u.color;
    shader.uniforms.uScHazeAmount = u.amount;
    shader.uniforms.uScHazeEmissive = u.emissive;
    shader.uniforms.uScDim = u.dim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uScHaze;\nuniform float uScHazeAmount;\nuniform float uScHazeEmissive;\nuniform float uScDim;')
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 scLit = mix(totalDiffuse + totalSpecular, uScHaze, uScHazeAmount) * uScDim;
vec3 scEm = mix(totalEmissiveRadiance, uScHaze * dot(totalEmissiveRadiance, vec3(0.3333)) * 2.0, uScHazeEmissive) * (0.5 + 0.5 * uScDim);
vec3 outgoingLight = scLit + scEm;`,
      );
  };
  material.customProgramCacheKey = () => 'cinder-scenery-haze-v1';
  material.userData.noShadow = true;
  material.userData.noAO = true;
  return material;
}

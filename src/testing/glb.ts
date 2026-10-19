// Minimal GLB (binary glTF 2.0) reading in tests: vertex positions of all meshes of the scene
// in model world coordinates. The game loads models through the three.js GLTFLoader. Optimised
// models (npm run assets:optimize) have buffers compressed via EXT_meshopt_compression.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type Mat4 = number[];

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface Gltf {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: {
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    extensions?: { EXT_meshopt_compression?: MeshoptView };
  }[];
}

interface MeshoptView {
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
  filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major matrices as in glTF. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export interface GlbMesh {
  /** The mesh node name. */
  name: string;
  /** x, y, z in a row (model world coordinates). */
  positions: number[];
}

export async function readGlbMeshes(bytes: Uint8Array): Promise<GlbMesh[]> {
  await MeshoptDecoder.ready;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binStart = 20 + jsonLength + 8;

  /** The bytes of a bufferView (meshopt is decoded). */
  const bufferView = (index: number): DataView => {
    const bv = json.bufferViews[index]!;
    const mo = bv.extensions?.EXT_meshopt_compression;
    if (!mo) return new DataView(bytes.buffer, bytes.byteOffset + binStart + (bv.byteOffset ?? 0), bv.byteLength);
    const start = binStart + (mo.byteOffset ?? 0);
    const target = new Uint8Array(mo.count * mo.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, mo.count, mo.byteStride, bytes.subarray(start, start + mo.byteLength), mo.mode, mo.filter ?? 'NONE');
    return new DataView(target.buffer);
  };

  const readVec3 = (accessorIndex: number): number[] => {
    const acc = json.accessors[accessorIndex]!;
    if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error('expected float VEC3 positions');
    const data = bufferView(acc.bufferView);
    const stride = json.bufferViews[acc.bufferView]!.byteStride ?? 12;
    const base = acc.byteOffset ?? 0;
    const out: number[] = [];
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      out.push(data.getFloat32(o, true), data.getFloat32(o + 4, true), data.getFloat32(o + 8, true));
    }
    return out;
  };

  const meshes: GlbMesh[] = [];
  const visit = (index: number, parent: Mat4): void => {
    const node = json.nodes[index]!;
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const positions: number[] = [];
      for (const prim of json.meshes[node.mesh]!.primitives) {
        const local = readVec3(prim.attributes.POSITION!);
        for (let i = 0; i < local.length; i += 3) {
          const [x, y, z] = [local[i]!, local[i + 1]!, local[i + 2]!];
          positions.push(
            world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
            world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
            world[2]! * x + world[6]! * y + world[10]! * z + world[14]!,
          );
        }
      }
      meshes.push({ name: node.name ?? '', positions });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of json.scenes[json.scene ?? 0]!.nodes) visit(root, IDENTITY);
  return meshes;
}

/** Bounding sphere like three.js `computeBoundingSphere`: the box centre, radius = the farthest vertex. */
export function boundingSphere(positions: readonly number[]): { center: [number, number, number]; radius: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!);
      max[k] = Math.max(max[k]!, positions[i + k]!);
    }
  }
  const center: [number, number, number] = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  let r2 = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - center[0];
    const dy = positions[i + 1]! - center[1];
    const dz = positions[i + 2]! - center[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return { center, radius: Math.sqrt(r2) };
}

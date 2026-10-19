// Check of the delivered assets after optimisation (art/tools/optimize_assets.mjs, art/README §2.9):
// a forgotten `npm run assets:optimize` step after a rebuild in Blender shows up here.
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { describe, expect, it } from 'vitest';
import { nodeFs, type NodeFs } from '../../testing/nodeFs';
import { skyboxPaths } from '../skybox';
import { VFX_WEBP, vfxTexturePath } from '../fx/textures';
import { paletteKind, palettePath } from './gltf';
import { fetchAsset } from './ModelLibrary';

type Fs = NodeFs & { readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };

interface GltfJson {
  asset: { generator?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  images?: { name?: string; uri?: string; bufferView?: number }[];
  textures?: { sampler?: number; source?: number }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
}

const MODELS = 'public/assets/models';
/** Extensions the game's GLTFLoader supports (meshopt through createModelLoader). */
const SUPPORTED = ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_texture_transform'];
const NEAREST = 9728;
const NEAREST_MIPMAP_NEAREST = 9984;
const CLAMP = 33071;

function glbFiles(fs: Fs, dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? glbFiles(fs, `${dir}/${e.name}`) : e.name.endsWith('.glb') ? [`${dir}/${e.name}`] : [],
  );
}

function glbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as GltfJson;
}

/** Normalised path (without `..`). */
function resolve(dir: string, uri: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${uri}`.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

describe('shipped models', () => {
  const fs = nodeFs() as Fs;
  const files = glbFiles(fs, MODELS);

  it('are all optimized: meshopt, no embedded palette atlas, atlas referenced from textures/', () => {
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const json = glbJson(fs.readFileSync(file));
      expect(json.asset.generator ?? '', `${file}: run npm run assets:optimize`).toContain('af-optimize/');
      expect(json.extensionsRequired ?? [], file).toContain('EXT_meshopt_compression');
      for (const ext of json.extensionsUsed ?? []) expect(SUPPORTED, `${file}: ${ext}`).toContain(ext);
      for (const image of json.images ?? []) {
        if (image.name?.startsWith('AF_Palette_')) expect(image.bufferView, `${file}: embedded ${image.name}`).toBeUndefined();
        if (image.uri !== undefined) {
          const dir = file.replace(/\/[^/]*$/, '');
          expect(fs.existsSync(resolve(dir, image.uri)), `${file}: ${image.uri}`).toBe(true);
        }
      }
    }
  });

  it('reference the shared atlas with the sampler the loader gives the shared texture', () => {
    let palettes = 0;
    for (const file of files) {
      const json = glbJson(fs.readFileSync(file));
      for (const texture of json.textures ?? []) {
        const image = json.images?.[texture.source ?? -1];
        const kind = paletteKind(image);
        if (!kind) continue;
        palettes++;
        expect(`public/${palettePath(kind)}`.endsWith(image!.uri!.replace(/^(\.\.\/)+/, '')), file).toBe(true);
        expect(json.samplers?.[texture.sampler ?? -1], file).toEqual({ magFilter: NEAREST, minFilter: NEAREST_MIPMAP_NEAREST, wrapS: CLAMP, wrapT: CLAMP });
      }
    }
    expect(palettes).toBeGreaterThan(300);
    for (const kind of ['basecolor', 'orm', 'emissive'] as const) expect(fs.existsSync(`public/${palettePath(kind)}`)).toBe(true);
  });
});

describe('shipped textures', () => {
  const fs = nodeFs() as Fs;

  it('has every skybox panorama and environment map', () => {
    for (const ring of [1, 2, 3, 4]) {
      const p = skyboxPaths(ring);
      expect(fs.existsSync(`public/${p.background}`), p.background).toBe(true);
      expect(fs.existsSync(`public/${p.environment}`), p.environment).toBe(true);
    }
  });

  it('has environment maps three.js decodes (RLE RGBE after the optimizer)', () => {
    const p = skyboxPaths(1).environment;
    const bytes = fs.readFileSync(`public/${p}`);
    const hdr = new HDRLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect([hdr.width, hdr.height]).toEqual([1024, 512]);
    // RLE: smaller than the flat 4 bytes per pixel
    expect(bytes.byteLength).toBeLessThan(1024 * 512 * 4);
    expect(Number.isFinite(hdr.data?.[0])).toBe(true);
  });

  it('has the WebP explosion flipbooks', () => {
    for (const name of VFX_WEBP) {
      expect(vfxTexturePath(name)).toBe(`assets/vfx/${name}.webp`);
      expect(fs.existsSync(`public/${vfxTexturePath(name)}`), name).toBe(true);
    }
    expect(vfxTexturePath('spark')).toBe('assets/vfx/spark.png');
  });

  it('has every planet texture named in planets.json', () => {
    const meta = JSON.parse(fs.readFileSync('public/assets/planets/planets.json', 'utf8')) as Record<string, Record<string, unknown>>;
    let count = 0;
    for (const [key, planet] of Object.entries(meta)) {
      if (key.startsWith('_')) continue;
      const clouds = planet.clouds as { texture: string } | null;
      for (const file of [planet.albedo, planet.normal, planet.emissive, clouds?.texture]) {
        if (typeof file !== 'string') continue;
        count++;
        expect(file, key).toMatch(/\.webp$/);
        expect(fs.existsSync(`public/assets/planets/${file}`), file).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(30);
  });
});

describe('fetchAsset', () => {
  it('shares one download between callers asking at once, each with its own bytes', async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'model/gltf-binary' } });
    }) as typeof fetch;
    try {
      const [a, b] = await Promise.all([fetchAsset('assets/models/x.glb'), fetchAsset('assets/models/x.glb')]);
      expect(calls).toHaveLength(1);
      expect(a).not.toBe(b);
      expect([...new Uint8Array(a!)]).toEqual([1, 2, 3]);
      expect([...new Uint8Array(b!)]).toEqual([1, 2, 3]);
      // done: the next request downloads again (the browser's cache decides)
      await fetchAsset('assets/models/x.glb');
      expect(calls).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

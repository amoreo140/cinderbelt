import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NearestMipmapNearestFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  type Object3D,
} from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configurePaletteTexture, createModelLoader, createPaletteCache, guardPaletteMaterials, paletteKind, PalettePlugin, palettePath, type PaletteKind } from './gltf';
import { toFloatAttributes } from './ModelLibrary';

// GLTFLoader in Node: FileLoader needs ProgressEvent, the parser `self`; images are not loaded in Node
// (there is no DOM) – the loader returns them as null, which is exactly the "atlas missing" case.
beforeAll(() => {
  vi.stubGlobal('self', globalThis);
  if (typeof globalThis.ProgressEvent === 'undefined') {
    vi.stubGlobal(
      'ProgressEvent',
      class extends Event {
        constructor(type: string, readonly init: { loaded?: number; total?: number } = {}) {
          super(type);
        }
      },
    );
  }
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const URI = (kind: PaletteKind) => `../../textures/palette_default_${kind}.png`;

/** glTF with one triangle: the AF_Palette material (atlas through a URI) and a material with its own texture. */
function gltfJson(): string {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const data = btoa(String.fromCharCode(...new Uint8Array(positions.buffer)));
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Hull', mesh: 0 },
      { name: 'Tail', mesh: 1 },
    ],
    buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${data}` }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
    ],
    samplers: [{ magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33071 }],
    images: [
      { name: 'AF_Palette_BaseColor', uri: URI('basecolor'), mimeType: 'image/png' },
      { name: 'AF_Palette_ORM', uri: URI('orm'), mimeType: 'image/png' },
      { name: 'AF_Palette_Emissive', uri: URI('emissive'), mimeType: 'image/png' },
      { name: 'comet_tail', uri: 'comet_tail.png', mimeType: 'image/png' },
    ],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
      { sampler: 0, source: 2 },
      { source: 3 },
    ],
    materials: [
      {
        name: 'AF_Palette',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
        emissiveTexture: { index: 2 },
        emissiveFactor: [1, 1, 1],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 6 } },
      },
      { name: 'AF_CometTail', pbrMetallicRoughness: { baseColorTexture: { index: 3 } } },
    ],
    extensionsUsed: ['KHR_materials_emissive_strength'],
  });
}

function materialOf(scene: Object3D, node: string): MeshStandardMaterial {
  const mesh = scene.getObjectByName(node) as Mesh;
  return mesh.material as MeshStandardMaterial;
}

describe('paletteKind', () => {
  it('recognises the atlas by the shared file URI or by the Blender image name', () => {
    expect(paletteKind({ uri: '../../textures/palette_default_orm.png' })).toBe('orm');
    expect(paletteKind({ uri: 'palette_default_basecolor.png' })).toBe('basecolor');
    expect(paletteKind({ name: 'AF_Palette_Emissive' })).toBe('emissive');
    expect(paletteKind({ name: 'AF_Palette_BaseColor' })).toBe('basecolor');
  });

  it('ignores other textures and liveries', () => {
    expect(paletteKind({ name: 'comet_tail', uri: 'comet_tail.png' })).toBeNull();
    expect(paletteKind({ uri: '../../textures/palette_pirate_basecolor.png' })).toBeNull();
    expect(paletteKind({ name: 'gas_giant_ring' })).toBeNull();
    expect(paletteKind(undefined)).toBeNull();
  });

  it('builds the shared atlas paths', () => {
    expect(palettePath('basecolor')).toBe('assets/textures/palette_default_basecolor.png');
    expect(palettePath('orm')).toBe('assets/textures/palette_default_orm.png');
  });
});

describe('configurePaletteTexture', () => {
  it('matches the AF_Palette sampler: nearest, clamp, glTF orientation, colour spaces', () => {
    for (const kind of ['basecolor', 'orm', 'emissive'] as const) {
      const t = configurePaletteTexture(new Texture(), kind);
      expect(t.flipY).toBe(false);
      expect(t.magFilter).toBe(NearestFilter);
      expect(t.minFilter).toBe(NearestMipmapNearestFilter);
      expect(t.wrapS).toBe(ClampToEdgeWrapping);
      expect(t.wrapT).toBe(ClampToEdgeWrapping);
      expect(t.generateMipmaps).toBe(true);
      expect(t.colorSpace).toBe(kind === 'orm' ? NoColorSpace : SRGBColorSpace);
    }
  });
});

describe('PalettePlugin', () => {
  const parser = (fallback: Texture) =>
    ({ json: JSON.parse(gltfJson()), loadTexture: vi.fn(() => Promise.resolve(fallback)) }) as unknown as GLTFParser & {
      loadTexture: ReturnType<typeof vi.fn>;
    };

  it('serves atlas textures from the shared source and leaves other textures to the loader', async () => {
    const shared = new Texture();
    const p = parser(new Texture());
    const source = vi.fn(() => Promise.resolve(shared));
    const plugin = new PalettePlugin(p, source);
    await expect(plugin.loadTexture(1)).resolves.toBe(shared);
    expect(source).toHaveBeenCalledWith('orm');
    expect(plugin.loadTexture(3)).toBeNull();
    expect(p.loadTexture).not.toHaveBeenCalled();
  });

  it('falls back to the image referenced by the GLB when the shared atlas failed', async () => {
    const own = new Texture();
    const p = parser(own);
    const plugin = new PalettePlugin(p, () => Promise.resolve(null));
    await expect(plugin.loadTexture(0)).resolves.toBe(own);
    expect(p.loadTexture).toHaveBeenCalledWith(0);
  });
});

describe('createPaletteCache', () => {
  it('loads each atlas kind once and shares it', async () => {
    const load = vi.fn((_kind: PaletteKind) => Promise.resolve(new Texture()));
    const source = createPaletteCache(load);
    const a = await source('orm');
    const b = await source('orm');
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries a failed atlas on the next request instead of caching the failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const load = vi.fn((_kind: PaletteKind) => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(new Texture())));
    const source = createPaletteCache(load);
    await expect(source('basecolor')).resolves.toBeNull();
    fail = false;
    const texture = await source('basecolor');
    expect(texture).toBeInstanceOf(Texture);
    expect(texture!.name).toBe('AF_Palette_basecolor');
    expect(load).toHaveBeenCalledTimes(2);
    // and now it stays shared
    await source('basecolor');
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('createModelLoader', () => {
  it('binds one shared texture per atlas kind to every AF_Palette material', async () => {
    const shared = {
      basecolor: configurePaletteTexture(new Texture(), 'basecolor'),
      orm: configurePaletteTexture(new Texture(), 'orm'),
      emissive: configurePaletteTexture(new Texture(), 'emissive'),
    };
    const loader = createModelLoader((kind) => Promise.resolve(shared[kind]));
    const [a, b] = await Promise.all([loader.parseAsync(gltfJson(), '/assets/models/parts/'), loader.parseAsync(gltfJson(), '/assets/models/parts/')]);
    for (const gltf of [a, b]) {
      const m = materialOf(gltf.scene, 'Hull');
      expect(m.map).toBe(shared.basecolor);
      expect(m.roughnessMap).toBe(shared.orm);
      expect(m.metalnessMap).toBe(shared.orm);
      expect(m.emissiveMap).toBe(shared.emissive);
      expect(m.emissiveIntensity).toBe(6);
      expect(m.map!.colorSpace).toBe(SRGBColorSpace);
      expect(m.roughnessMap!.colorSpace).toBe(NoColorSpace);
      expect(guardPaletteMaterials(gltf.scene)).toBe(0);
    }
    // own texture (the comet tail) is not loaded in Node – it is not the atlas, the plugin leaves it alone
    expect(materialOf(a.scene, 'Tail').map).not.toBe(shared.basecolor);
  });

  it('switches the emission off when no atlas could be loaded at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = createModelLoader(() => Promise.resolve(null));
    const gltf = await loader.parseAsync(gltfJson(), '/assets/models/parts/');
    warn.mockRestore();
    const m = materialOf(gltf.scene, 'Hull');
    expect(m.emissiveMap).toBeNull();
    expect(m.emissive.getHex()).toBe(0xffffff);
    expect(guardPaletteMaterials(gltf.scene)).toBe(1);
    expect(m.emissive.getHex()).toBe(0);
    expect(guardPaletteMaterials(new Mesh(new BufferGeometry(), new MeshStandardMaterial()))).toBe(0);
  });
});

describe('toFloatAttributes', () => {
  it('dequantizes normalized and interleaved attributes to Float32', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3));
    g.setAttribute('normal', new BufferAttribute(new Int8Array([127, 0, -127]), 3, true));
    g.setAttribute('uv', new BufferAttribute(new Uint16Array([65535, 0]), 2, true));
    const interleaved = new InterleavedBuffer(new Int8Array([0, 127, 0, 0]), 4);
    g.setAttribute('normal2', new InterleavedBufferAttribute(interleaved, 3, 0, true));
    const position = g.getAttribute('position');
    toFloatAttributes(g);
    expect(g.getAttribute('position')).toBe(position);
    expect(Array.from(g.getAttribute('normal').array)).toEqual([1, 0, -1]);
    expect(Array.from(g.getAttribute('uv').array)).toEqual([1, 0]);
    expect(Array.from(g.getAttribute('normal2').array)).toEqual([0, 1, 0]);
    for (const name of ['normal', 'uv', 'normal2']) {
      const a = g.getAttribute(name) as BufferAttribute;
      expect(a.array).toBeInstanceOf(Float32Array);
      expect(a.normalized).toBe(false);
    }
  });
});

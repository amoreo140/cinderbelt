// Loading models from Blender (art/README §2.8–2.9). Optimised GLBs (npm run assets:optimize)
// are compressed with EXT_meshopt_compression and have no embedded AF_Palette atlas – the images point
// to shared files textures/palette_default_<kind>.png. The GLTFLoader plugin binds them to one
// shared texture (one download, one GPU upload). If the shared atlas fails to load,
// the loader downloads the image itself from the URI in the GLB (old GLBs with an embedded atlas work unchanged).
import {
  ClampToEdgeWrapping,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NearestMipmapNearestFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadImageAsset } from './imageAsset';
import { assetUrl } from './url';

export type PaletteKind = 'basecolor' | 'orm' | 'emissive';
export const PALETTE_KINDS: readonly PaletteKind[] = ['basecolor', 'orm', 'emissive'];

/** Atlas material (lib/materials.py). */
export const PALETTE_MATERIAL = 'AF_Palette';

/** Image name in the GLB → atlas kind. */
const PALETTE_IMAGE_NAMES: Readonly<Record<string, PaletteKind>> = {
  AF_Palette_BaseColor: 'basecolor',
  AF_Palette_ORM: 'orm',
  AF_Palette_Emissive: 'emissive',
};
const PALETTE_URI = /(?:^|\/)palette_default_(basecolor|orm|emissive)\.png$/;

/** Shared atlas (relative to BASE_URL). */
export const palettePath = (kind: PaletteKind): string => `assets/textures/palette_default_${kind}.png`;

interface ImageDef {
  name?: string;
  uri?: string;
}

/** Atlas kind by the glTF image (name from Blender or the URI of the shared file), otherwise null. */
export function paletteKind(image: ImageDef | undefined): PaletteKind | null {
  if (!image) return null;
  if (image.uri !== undefined) {
    const m = PALETTE_URI.exec(image.uri);
    return m ? (m[1] as PaletteKind) : null;
  }
  return image.name !== undefined ? (PALETTE_IMAGE_NAMES[image.name] ?? null) : null;
}

/**
 * Sets the atlas texture as the AF_Palette sampler in the GLB: nearest (mipmaps nearest), clamp,
 * flipY = false (glTF), base colour and emission sRGB, ORM linear.
 */
export function configurePaletteTexture(texture: Texture, kind: PaletteKind): Texture {
  texture.flipY = false;
  texture.colorSpace = kind === 'orm' ? NoColorSpace : SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestMipmapNearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.name = `AF_Palette_${kind}`;
  texture.needsUpdate = true;
  return texture;
}

export type PaletteSource = (kind: PaletteKind) => Promise<Texture | null>;

/**
 * A palette source that loads each atlas kind once and shares it. A failed load is not cached:
 * the models of that moment fall back to their own image (null), and the next request tries
 * again – a network hiccup must not leave the whole session on per-model copies of the atlas.
 */
export function createPaletteCache(load: (kind: PaletteKind) => Promise<Texture>): PaletteSource {
  const cache = new Map<PaletteKind, Promise<Texture | null>>();
  return (kind) => {
    let entry = cache.get(kind);
    if (!entry) {
      entry = load(kind)
        .then((texture) => configurePaletteTexture(texture, kind))
        .catch((e: unknown) => {
          console.warn(`Shared atlas ${palettePath(kind)} failed to load – models load it themselves`, e);
          // forget the failure – a later model retries the shared atlas
          if (cache.get(kind) === entry) cache.delete(kind);
          return null;
        });
      cache.set(kind, entry);
    }
    return entry;
  };
}

/**
 * An atlas image. Every model's parse waits for it, so its bytes come at high priority – an <img> is a
 * low-priority request and queued behind all the models on HTTP/1.1 (perf O14) – and it decodes through
 * an <img> as before (a blob URL: the same pixels).
 */
async function loadPaletteImage(kind: PaletteKind): Promise<Texture> {
  const image = await loadImageAsset(palettePath(kind), 'high');
  if (!image) throw new Error(`missing ${palettePath(kind)}`);
  return new Texture(image);
}

/** Shared atlas texture – loaded once per page run; null = it failed this time (the next request tries again). */
export const sharedPalette: PaletteSource = createPaletteCache(loadPaletteImage);

/**
 * GLTFLoader plugin: replaces the AF_Palette atlas textures with the shared texture. Other textures
 * (gas giant rings, comet tail …) it leaves to the loader.
 */
export class PalettePlugin implements GLTFLoaderPlugin {
  readonly name = 'AF_palette_atlas';

  constructor(
    private readonly parser: GLTFParser,
    private readonly source: PaletteSource = sharedPalette,
  ) {}

  loadTexture(textureIndex: number): Promise<Texture> | null {
    const json = this.parser.json as { textures?: { source?: number }[]; images?: ImageDef[] };
    const def = json.textures?.[textureIndex];
    const kind = def?.source !== undefined ? paletteKind(json.images?.[def.source]) : null;
    if (!kind) return null;
    return this.source(kind).then((texture) => texture ?? this.parser.loadTexture(textureIndex));
  }
}

/**
 * An atlas material without an emission map (the atlas loaded neither from the shared file nor from the GLB) would glow
 * all white × emissive strength – this turns the emission off. Returns the number of materials fixed.
 */
export function guardPaletteMaterials(scene: Object3D): number {
  const fixed = new Set<Material>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof MeshStandardMaterial) || m.name !== PALETTE_MATERIAL || m.emissiveMap || fixed.has(m)) continue;
      m.emissive.setScalar(0);
      fixed.add(m);
    }
  });
  return fixed.size;
}

/**
 * An AF_Palette material exported without its base colour map (seen on one clan part,
 * parts_pirate/cauldron/engine_titanium.glb) renders as flat white. Its UVs still point into the
 * atlas, so bind the shared base colour atlas. Returns the number of repaired materials.
 */
export async function restorePaletteBaseColor(scene: Object3D, source: PaletteSource = sharedPalette): Promise<number> {
  const broken = new Set<MeshStandardMaterial>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof MeshStandardMaterial && m.name === PALETTE_MATERIAL && !m.map && (m.roughnessMap || m.emissiveMap)) broken.add(m);
    }
  });
  if (broken.size === 0) return 0;
  const atlas = await source('basecolor');
  if (!atlas) return 0;
  for (const m of broken) {
    m.map = atlas;
    m.needsUpdate = true;
  }
  return broken.size;
}

/** GLTFLoader for the game's models: meshopt decoder + shared atlas. */
export function createModelLoader(source: PaletteSource = sharedPalette): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register((parser) => new PalettePlugin(parser, source));
}

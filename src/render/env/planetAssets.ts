// Planet assets (public/assets/planets, README there): the catalogue planets.json, the equirect
// textures and the gas-giant ring model. Loaded lazily, once per page and shared by every game on
// the one renderer (like the VFX textures) – never disposed.
import { Mesh, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { fetchAsset } from '../assets/ModelLibrary';
import { assetUrl } from '../assets/url';
import { decodeImage } from '../textureUploads';

export interface PlanetDef {
  albedo: string;
  normal: string | null;
  normalScale: number | null;
  emissive: string | null;
  emissiveIntensity: number;
  atmosphere: { color: string; density: number; shellScale: number; power: number };
  clouds: { texture: string; opacity: number; shellScale: number; speed: number } | null;
  ringSystem?: { model: string; texture: string; inner: number; outer: number; tiltDeg: number };
}

const DIR = 'assets/planets';
let catalog: Promise<Record<string, PlanetDef> | null> | null = null;

/** planets.json (null when it is missing – the zone then has no planet). */
export function planetCatalog(): Promise<Record<string, PlanetDef> | null> {
  catalog ??= fetchAsset(`${DIR}/planets.json`)
    .then((data) => (data ? (JSON.parse(new TextDecoder().decode(data)) as Record<string, PlanetDef>) : null))
    .catch((e: unknown) => {
      console.warn('planets.json failed to load – zones will have no planets', e);
      return null;
    });
  return catalog;
}

const textures = new Map<string, Texture>();
/** Resolves when a planet texture is decoded and on the GPU (or failed) – by cache key. */
const ready = new Map<string, Promise<void>>();

/** Puts a decoded image on its texture and on the GPU (RenderContext: one big upload per queue turn). */
export type PlanetTextureUploader = (texture: Texture, apply: () => void) => Promise<void>;
let uploader: PlanetTextureUploader | null = null;

/** How decoded planet textures reach the GPU; null = set in place (three uploads at the first draw). */
export function setPlanetTextureUploader(fn: PlanetTextureUploader | null): void {
  uploader = fn;
}

const textureKey = (file: string, maxWidth: number): string => `${file}@${maxWidth}`;

/**
 * Planet texture by file name (shared – do not dispose or change its settings). `maxWidth` scales a
 * larger image down once on load (lower graphics quality: a quarter of the upload and mip work).
 * Decoded off the main thread and uploaded in a queue turn (audit 2026-10-16, issue #9): until then
 * the texture has no image and draws nothing.
 */
export function planetTexture(file: string, data = false, maxWidth = Infinity): Texture {
  const width = data ? Infinity : maxWidth;
  const key = textureKey(file, width);
  let tex = textures.get(key);
  if (!tex) {
    const t = new Texture();
    t.colorSpace = data ? NoColorSpace : SRGBColorSpace;
    // longitude wraps (cloud scroll), latitude does not matter on a sphere
    t.wrapS = RepeatWrapping;
    t.anisotropy = 4;
    textures.set(key, t);
    ready.set(
      key,
      decodeImage(assetUrl(`${DIR}/${file}`), width)
        .then(async (decoded) => {
          if (!decoded) throw new Error('missing');
          const apply = (): void => {
            t.image = decoded.image;
            t.flipY = decoded.flipY;
            t.needsUpdate = true;
          };
          if (uploader) await uploader(t, apply);
          else apply();
        })
        .catch(() => console.warn(`Planet texture missing: ${DIR}/${file}`)),
    );
    tex = t;
  }
  return tex;
}

/** Resolves once `planetTexture(file, data, maxWidth)` is decoded and uploaded (starts it if needed). */
export function planetTextureReady(file: string, data = false, maxWidth = Infinity): Promise<void> {
  planetTexture(file, data, maxWidth);
  return ready.get(textureKey(file, data ? Infinity : maxWidth)) ?? Promise.resolve();
}

export interface RingTemplate {
  geometry: BufferGeometry;
  map: Texture | null;
}

let rings: Promise<RingTemplate | null> | null = null;

/**
 * What the first frame needs from the network: the planet catalogue and the gas-giant ring model (the
 * shader warm-up waits for them; the boot list starts them ahead of the game).
 */
export async function planetAssetsReady(): Promise<void> {
  const catalog = await planetCatalog();
  if (!catalog) return;
  // `_schema` / `_types` are documentation entries (their `ringSystem` is a note, not a model)
  const models = new Set(
    Object.entries(catalog).flatMap(([kind, d]) => (!kind.startsWith('_') && typeof d.ringSystem?.model === 'string' ? [d.ringSystem.model] : [])),
  );
  await Promise.all([...models].map((model) => ringTemplate(model)));
}

/** The texture files of a catalogue entry (all of them – the quality picks later which it draws). */
export function planetFiles(def: PlanetDef): string[] {
  return [def.albedo, def.normal, def.emissive, def.clouds?.texture].filter((f): f is string => typeof f === 'string').map((f) => `${DIR}/${f}`);
}

/** Geometry and texture of the gas-giant ring system (in planet radii, equatorial plane). */
export function ringTemplate(path: string): Promise<RingTemplate | null> {
  rings ??= (async () => {
    try {
      const data = await fetchAsset(`assets/${path}`);
      if (!data) return null;
      const gltf = await createModelLoader().parseAsync(data, assetUrl(`assets/${path}`).replace(/[^/]*$/, ''));
      guardPaletteMaterials(gltf.scene);
      let out: RingTemplate | null = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (out || !(o instanceof Mesh)) return;
        const geometry = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
        const m = o.material as MeshStandardMaterial;
        out = { geometry, map: m.map ?? null };
      });
      return out;
    } catch (e) {
      console.warn(`Planet rings failed to load: ${path}`, e);
      return null;
    }
  })();
  return rings;
}

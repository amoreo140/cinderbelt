// Ship liveries (art/README §3, §2.7.21): a livery = three textures with the AF_Palette atlas layout.
// The material is cloned (the library's templates stay untouched) and cached per source material.
// `pirate` = the old palette tint of the player's parts; clan parts (render/assets/clanParts.ts) keep
// their own look and never get it. `derelict` = a dead wreck: desaturated, sooty, no emission; every
// part gets a deterministic shade 0.7–1.0 so a wreck does not read as one flat lump. The texture loader
// serves any livery name – the M4c ship paints (`render/paint.ts`) load `paint_<id>` through it too.
import { Mesh, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture, type Material, type Object3D } from 'three';
import type { Livery } from '../../sim/combat/types';
import { hash3 } from '../../sim/world/hash';
import { isClanMaterial } from '../assets/clanParts';
import { loadImageAsset } from '../assets/imageAsset';
import { cloneWithRim } from '../rimLight';

export type RenderLivery = Livery | 'derelict';

interface LiveryTextures {
  base: Texture;
  orm: Texture;
  emissive: Texture;
  /** Settles once all three textures have loaded or failed (never rejects). */
  ready: Promise<void>;
}

/** Livery textures by livery name (`pirate`, `derelict`, `paint_navy` …) – loaded once per page. */
const textures = new Map<string, LiveryTextures>();
const cache = new Map<string, WeakMap<Material, Material>>();
const owned: Material[] = [];

/** A livery's texture file (the boot list downloads the paints ahead, assets/bootAssets.ts). */
export const liveryPath = (name: string): string => `assets/textures/palette_${name}.png`;

function load(name: string, srgb: boolean, settled: () => void): Texture {
  const tex = new Texture();
  tex.name = liveryPath(name);
  // through the prefetch store (perf O14): the shader warm-up waits for the paints
  void loadImageAsset(liveryPath(name)).then((image) => {
    if (image) {
      tex.image = image;
      tex.needsUpdate = true;
    } else console.warn(`Livery missing: palette_${name}.png`);
    settled();
  });
  tex.flipY = false;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  return tex;
}

function liveryTextures(name: string): LiveryTextures {
  let t = textures.get(name);
  if (!t) {
    let left = 3;
    let done = (): void => {};
    const ready = new Promise<void>((resolve) => (done = resolve));
    const settled = () => {
      if (--left === 0) done();
    };
    t = { base: load(`${name}_basecolor`, true, settled), orm: load(`${name}_orm`, false, settled), emissive: load(`${name}_emissive`, true, settled), ready };
    textures.set(name, t);
  }
  return t;
}

/** Starts loading a livery's three textures; resolves once they have loaded (or failed). */
export function preloadLivery(name: string): Promise<void> {
  return liveryTextures(name).ready;
}

/** Starts loading the derelict textures before the first wreck appears (no hitch on the first kill). */
export function preloadDerelictLivery(): void {
  liveryTextures('derelict');
}

/** Livery texture sampled like the original (atlas – nearest, clamp). */
function like(tex: Texture, source: Texture | null): Texture {
  if (source) {
    tex.magFilter = source.magFilter;
    tex.minFilter = source.minFilter;
    tex.wrapS = source.wrapS;
    tex.wrapT = source.wrapT;
    tex.generateMipmaps = source.generateMipmaps;
  }
  return tex;
}

/**
 * Clan parts are dark to begin with (gunmetal, soot, black lacquer); with the derelict remap
 * (value × 0.5) a pirate wreck sank into the background at the game camera – lift it back.
 */
export const CLAN_DERELICT_LIFT = 1.7;

/** Per-part derelict shades (a few steps, so the material cache stays small). */
export const DERELICT_SHADES: readonly number[] = [0.7, 0.8, 0.9, 1];

/** Deterministic shade of one part of a wreck (seed = the wreck, part = grid part id). */
export const derelictShade = (seed: number, part: number): number =>
  DERELICT_SHADES[hash3(seed, part, 0xde7e) % DERELICT_SHADES.length]!;

/** Puts a livery's atlas in place of the palette maps (materials without maps keep their colour). */
export function swapLiveryTextures(m: MeshStandardMaterial, source: MeshStandardMaterial, name: string): void {
  if (!m.map && !m.roughnessMap && !m.metalnessMap && !m.emissiveMap) return;
  const t = liveryTextures(name);
  if (m.map) m.map = like(t.base, source.map);
  if (m.roughnessMap) m.roughnessMap = like(t.orm, source.roughnessMap);
  if (m.metalnessMap) m.metalnessMap = like(t.orm, source.metalnessMap);
  if (m.emissiveMap) m.emissiveMap = like(t.emissive, source.emissiveMap);
}

function convert(source: Material, livery: RenderLivery, shade: number): Material {
  if (!(source instanceof MeshStandardMaterial)) return source;
  // clan parts have their own look: the old pirate tint would only undo it
  if (livery === 'pirate' && isClanMaterial(source)) return source;
  // the rim goes along: the copy must not compile once without it (shader warm-up)
  const m = cloneWithRim(source);
  if (livery === 'pirate') swapLiveryTextures(m, source, 'pirate');
  if (livery === 'derelict') {
    swapLiveryTextures(m, source, 'derelict');
    m.color.multiplyScalar(shade * (isClanMaterial(source) ? CLAN_DERELICT_LIFT : 1));
    m.emissiveIntensity = 0;
  }
  // a pirate or derelict look is never painted over (render/paint.ts)
  m.userData.afLivery = livery;
  owned.push(m);
  return m;
}

function swapper(livery: RenderLivery, shade: number): (mat: Material) => Material {
  const key = `${livery}:${shade}`;
  let map = cache.get(key);
  if (!map) cache.set(key, (map = new WeakMap()));
  const cached = map;
  return (mat) => {
    let out = cached.get(mat);
    if (!out) {
      out = convert(mat, livery, shade);
      cached.set(mat, out);
    }
    return out;
  };
}

function swapMeshes(root: Object3D, swap: (mat: Material) => Material, skip?: (o: Object3D) => boolean): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh) || skip?.(o)) return;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

/** Recolours every mesh under `root` (`default` changes nothing). */
export function applyLivery(root: Object3D, livery: RenderLivery): void {
  if (livery === 'default') return;
  swapMeshes(root, swapper(livery, 1));
}

/**
 * Derelict wreck: the dead livery on every mesh, each ship part (a node with `userData.afPart`, see
 * ShipView) in its own shade picked by `seed` and the part id; the rest (hull connectors) at 0.85.
 */
export function applyDerelict(root: Object3D, seed: number): void {
  const parts: Object3D[] = [];
  root.traverse((o) => {
    if (typeof o.userData.afPart === 'number') parts.push(o);
  });
  const inPart = new Set<Object3D>();
  for (const node of parts) {
    swapMeshes(node, swapper('derelict', derelictShade(seed, node.userData.afPart as number)));
    node.traverse((o) => inPart.add(o));
  }
  swapMeshes(root, swapper('derelict', 0.85), (o) => inPart.has(o));
}

export function disposeLiveries(): void {
  for (const m of owned) m.dispose();
  owned.length = 0;
  cache.clear();
}

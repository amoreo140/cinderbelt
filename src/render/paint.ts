// Ship paints in the renderer (M4c plan §2.2, T6): a paint swaps the three palette textures of a
// player ship's AF_Palette materials for the paint's livery (`PAINT_LIVERY`, art/README.md §3) – like
// the pirate livery, on a cloned material cached per paint and source material, so a painted ship
// batches exactly like an unpainted one (same draw calls) and compiles nothing new (same shader).
//
// Painting is reversible and works on a baked view too: every paint clone remembers its source, so
// a repaint (or `factory`) maps the worn material back to the template's first. Clan materials and
// the pirate / derelict liveries are never painted. A ShipView keeps the paint over its own shell
// rebuilds through its "dress" (captured at bake time); an owner that repaints a baked view re-applies
// the paint after a hull shell setting change (GameRenderer, HangarView).
import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { PAINT_IDS, PAINT_LIVERY, type PaintId } from '../data/paints';
import type { ModelLibrary } from './assets/ModelLibrary';
import { isClanMaterial } from './assets/clanParts';
import { PALETTE_MATERIAL } from './assets/gltf';
import { preloadLivery, swapLiveryTextures } from './combat/livery';
import { cloneWithRim } from './rimLight';
import type { WarmUpZoo } from './warmup';

type Paint = Exclude<PaintId, 'factory'>;

/** Paint clone → the material it was cloned from. */
const sources = new WeakMap<Material, Material>();
/** Per paint: source material → its paint clone. */
const caches = new Map<Paint, WeakMap<Material, Material>>();
const owned: Material[] = [];

/** A player palette material a paint may recolour (not a clan part, not a pirate / derelict livery). */
function paintable(m: Material): m is MeshStandardMaterial {
  return m instanceof MeshStandardMaterial && m.name === PALETTE_MATERIAL && m.map !== null && !isClanMaterial(m) && m.userData.afLivery === undefined;
}

/** The material `mat` wears in `paint` (itself when it cannot be painted). */
export function paintedMaterial(mat: Material, paint: PaintId): Material {
  const source = sources.get(mat) ?? mat;
  if (paint === 'factory' || !paintable(source)) return source;
  let cache = caches.get(paint);
  if (!cache) caches.set(paint, (cache = new WeakMap()));
  let out = cache.get(source);
  if (!out) {
    // the rim goes along: the copy must not compile once without it (shader warm-up)
    const m = cloneWithRim(source);
    swapLiveryTextures(m, source, PAINT_LIVERY[paint]);
    m.userData.afPaint = paint;
    sources.set(m, source);
    cache.set(source, m);
    owned.push(m);
    out = m;
  }
  return out;
}

/**
 * Paints a ship model built from player parts (`factory` = the default palette) – before or after
 * the ShipView baked. Clan and derelict looks are never painted; other materials stay as they are.
 */
export function applyPaint(root: Object3D, paint: PaintId): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => paintedMaterial(m, paint)) : paintedMaterial(o.material as Material, paint);
  });
}

/** The paint a material wears (`factory` for anything unpainted). */
export const paintOfMaterial = (m: Material): PaintId => (sources.has(m) ? (m.userData.afPaint as PaintId) : 'factory');

/** Starts loading every paint's textures (warm-up) – resolves once all of them have loaded or failed. */
export function preloadPaints(): Promise<void> {
  return Promise.all(PAINT_IDS.filter((p): p is Paint => p !== 'factory').map((p) => preloadLivery(PAINT_LIVERY[p]))).then(() => undefined);
}

/**
 * Warm-up samples: a cockpit in every paint, so the paint textures are uploaded (and their material
 * copies drawn once) before the first painted ship – the shader programs are the template's.
 */
export function paintWarmUpSamples(zoo: WarmUpZoo, library: ModelLibrary): void {
  const template = library.part('cockpit');
  if (!template) return;
  for (const paint of PAINT_IDS) {
    if (paint === 'factory') continue;
    const sample = template.clone();
    applyPaint(sample, paint);
    zoo.add(sample);
  }
}

/** Frees the paint material copies (the game ends); the next painted ship clones them again. */
export function disposePaints(): void {
  for (const m of owned) m.dispose();
  owned.length = 0;
  caches.clear();
}

// Models used only by effects (art/README §2.7, §2.7.23): combat debris per faction set
// (`debris_<a..e>` human, `debris_pirate_<a..e>`, `debris_kovaci_<a..c>`) and asteroid fragments
// `asteroid_frag_<resource>_<a|b|c>`. They load in the background – until then an effect uses a
// placeholder chip. No collisions, looks only.
import { DodecahedronGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { FactionId } from '../../data/factions';
import { FACTIONS } from '../../data/factions';
import { RESOURCE_IDS, RESOURCES, type ResourceId } from '../../data/resources';
import { assetUrl } from '../assets/url';
import { createModelLoader } from '../assets/gltf';
import { fetchAsset } from '../assets/ModelLibrary';

/** Debris look by the victim (art batch B2): human hull plates, pirate scrap, Forge-smith obsidian. */
export type DebrisSet = 'human' | 'pirate' | 'kovaci';
export const DEBRIS_SETS: readonly DebrisSet[] = ['human', 'pirate', 'kovaci'];

/** Variants of each set (file suffixes). */
export const DEBRIS_VARIANTS: Readonly<Record<DebrisSet, readonly string[]>> = {
  human: ['a', 'b', 'c', 'd', 'e'],
  pirate: ['a', 'b', 'c', 'd', 'e'],
  kovaci: ['a', 'b', 'c'],
};
export const FRAGMENT_VARIANTS = ['a', 'b', 'c'] as const;

export const debrisPath = (set: DebrisSet, v: string): string =>
  `assets/models/debris/debris_${set === 'human' ? '' : `${set}_`}${v}.glb`;
export const fragmentPath = (resource: ResourceId, v: string): string => `assets/models/asteroids/asteroid_frag_${resource}_${v}.glb`;

/**
 * Debris set of a victim: pirate clans → pirate scrap, the Wardens (Forge-smith, incl. the Colossus) →
 * obsidian shards, everyone else (the player, stations, traders, Guild) → human plates. `null` =
 * the player / no faction.
 */
export function debrisSetFor(faction: FactionId | null | undefined): DebrisSet {
  if (!faction) return 'human';
  if (faction === 'wardens') return 'kovaci';
  return FACTIONS[faction].clan ? 'pirate' : 'human';
}

export class FxModels {
  private readonly debris = new Map<DebrisSet, Object3D[]>();
  private fragments = new Map<ResourceId, Object3D[]>();
  private readonly fallback: Object3D;
  private readonly fallbackRock = new Map<ResourceId, Object3D>();
  private disposed = false;
  /** The debris and fragment models have loaded (or failed – then the fallbacks stay). */
  readonly ready: Promise<void>;

  constructor() {
    const geometry = new DodecahedronGeometry(0.35, 0);
    this.fallback = new Mesh(geometry, new MeshStandardMaterial({ color: 0x4a4d57, roughness: 0.7, metalness: 0.5, flatShading: true }));
    for (const id of RESOURCE_IDS) {
      this.fallbackRock.set(id, new Mesh(geometry, new MeshStandardMaterial({ color: RESOURCES[id].rockColor, roughness: 0.9, flatShading: true })));
    }
    this.ready = this.load().catch(() => {});
  }

  private async load(): Promise<void> {
    const loader = createModelLoader();
    const one = async (path: string): Promise<Object3D | null> => {
      try {
        const data = await fetchAsset(path);
        if (!data) return null;
        const gltf = await loader.parseAsync(data, assetUrl(path).replace(/[^/]*$/, ''));
        return gltf.scene;
      } catch (e) {
        console.warn(`Effect model failed to load: ${path}`, e);
        return null;
      }
    };
    const sets = await Promise.all(DEBRIS_SETS.map((set) => Promise.all(DEBRIS_VARIANTS[set].map((v) => one(debrisPath(set, v))))));
    const frags = await Promise.all(RESOURCE_IDS.map((id) => Promise.all(FRAGMENT_VARIANTS.map((v) => one(fragmentPath(id, v))))));
    if (this.disposed) return;
    DEBRIS_SETS.forEach((set, i) => this.debris.set(set, sets[i]!.filter((d): d is Object3D => d !== null)));
    RESOURCE_IDS.forEach((id, i) => this.fragments.set(id, frags[i]!.filter((d): d is Object3D => d !== null)));
  }

  /**
   * Debris template of a set (clone it). `pick` ∈ [0, 1). A set that has not loaded (or is missing)
   * falls back to the human set, then to the placeholder chip.
   */
  debrisTemplate(pick: number, set: DebrisSet = 'human'): Object3D {
    const own = this.debris.get(set) ?? [];
    const list = own.length > 0 ? own : (this.debris.get('human') ?? []);
    return list.length > 0 ? list[Math.floor(pick * list.length)]! : this.fallback;
  }

  /** Asteroid fragment template of a resource (clone it). */
  fragmentTemplate(resource: ResourceId, pick: number): Object3D {
    const list = this.fragments.get(resource) ?? [];
    return list.length > 0 ? list[Math.floor(pick * list.length)]! : this.fallbackRock.get(resource)!;
  }

  /** Every loaded debris and fragment template (the shader warm-up's samples). */
  templates(): Object3D[] {
    return [...[...this.debris.values()].flat(), ...[...this.fragments.values()].flat()];
  }

  dispose(): void {
    this.disposed = true;
  }
}

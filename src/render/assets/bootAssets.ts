// The boot list (perf O14): the files a game start waits for beyond the model library – the layers'
// models, the scenery and planet catalogues, the effect textures and the start zone's sky and planets.
// They download while the library's models do (or behind the menu), instead of once the Game is built;
// the layers then find the bytes in the prefetch store (prefetch.ts). A file missing from the list only
// downloads later, as before; a listed file the game does not ask for is dropped after the warm-up.
import { RESOURCE_IDS } from '../../data/resources';
import type { RingIndex } from '../../data/economy';
import { PAINT_LIVERY } from '../../data/paints';
import { BORDER_IMAGE_PATHS, BORDER_MODEL_PATHS } from '../borders/BorderLayer';
import { liveryPath } from '../combat/livery';
import { CONVOY_MODEL_PATHS } from '../convoys/ConvoyLayer';
import { DISCOVERY_MODEL_PATHS } from '../discovery/DiscoveryLayer';
import { planetAssetsReady, planetCatalog, planetFiles } from '../env/planetAssets';
import { sceneryReady } from '../env/sceneryAssets';
import { LANDMARK_PLANETS, ZONE_LOOKS } from '../env/zoneLook';
import { DEBRIS_SETS, DEBRIS_VARIANTS, debrisPath, FRAGMENT_VARIANTS, fragmentPath } from '../fx/fxModels';
import { VFX_TEXTURES, vfxTexturePath } from '../fx/textures';
import { prestartHdrWorker } from '../hdr';
import { HOME_MODULE_PATHS } from '../home/HomeModules';
import { FORTRESS_PATH as TROPHY_PATH } from '../home/TrophyShelf';
import { FORTRESS_MODEL_PATHS } from '../pirates/FortressLayer';
import { CONTAINER_PATH } from '../salvage/SalvageLayer';
import { buildCatalog } from '../scatter/scatterManifest';
import { PROPS_MANIFEST, WRECK_MANIFEST } from '../scatter/ScatterLayer';
import { COMET_MODEL_PATHS } from '../sites/CometLayer';
import { SITE_MODEL_PATHS } from '../sites/SiteLayer';
import { skyboxPaths } from '../skybox';
import { TRAFFIC_MODEL_PATHS } from '../traffic/StationTraffic';
import { HANGAR_BAY_PATH } from './catalog';
import { CLAN_MANIFEST_PATH } from './clanParts';
import { fetchAsset } from './ModelLibrary';
import { prefetchAsset } from './prefetch';

const json = async (path: string): Promise<unknown> => {
  const data = await fetchAsset(path);
  try {
    return data ? (JSON.parse(new TextDecoder().decode(data)) as unknown) : null;
  } catch {
    return null;
  }
};

/** The boot list's fixed files by download order (the scatter manifests' entries come with them). */
export function bootAssetList(): Record<'early' | 'start' | 'late', string[]> {
  // early: what the layers build their batches (and the warm-up the shipyard hangar) from – the last
  // files in decide how much the warm-up's last pass has to do
  const early = [CLAN_MANIFEST_PATH, PROPS_MANIFEST, WRECK_MANIFEST, HANGAR_BAY_PATH, ...TRAFFIC_MODEL_PATHS, ...CONVOY_MODEL_PATHS, ...BORDER_MODEL_PATHS, ...BORDER_IMAGE_PATHS];
  const start = [
    ...DISCOVERY_MODEL_PATHS,
    ...FORTRESS_MODEL_PATHS,
    ...COMET_MODEL_PATHS,
    ...SITE_MODEL_PATHS,
    ...HOME_MODULE_PATHS,
    TROPHY_PATH,
    CONTAINER_PATH,
    ...DEBRIS_SETS.flatMap((set) => DEBRIS_VARIANTS[set].map((v) => debrisPath(set, v))),
    ...RESOURCE_IDS.flatMap((id) => FRAGMENT_VARIANTS.map((v) => fragmentPath(id, v))),
    // the ship paints and the wreck livery (three textures each)
    ...[...Object.values(PAINT_LIVERY), 'derelict'].flatMap((name) => ['basecolor', 'orm', 'emissive'].map((kind) => liveryPath(`${name}_${kind}`))),
  ];
  // the effect textures after everything else: nothing waits for them
  const late = VFX_TEXTURES.map(vfxTexturePath);
  return { early: [...new Set(early)], start: [...new Set(start)].filter((p) => !early.includes(p)), late };
}

/**
 * The start's files that do not depend on where the game is: started once per page (the scatter
 * manifests' entries once their manifest is in). Never throws.
 */
export function prefetchBootAssets(): void {
  if (started) return;
  started = true;
  // the page-wide catalogues load (and parse) themselves – their results are kept for every game
  void sceneryReady();
  void planetAssetsReady();
  const list = bootAssetList();
  for (const order of ['early', 'start', 'late'] as const) for (const path of list[order]) prefetchAsset(path, order);
  void Promise.all([PROPS_MANIFEST, WRECK_MANIFEST].map(json)).then(([props, wreckage]) => {
    for (const def of buildCatalog(props, wreckage).values()) prefetchAsset(def.file, 'early');
  });
}
let started = false;

/**
 * The start zone's files: the sky panoramas of `depths` (the zone and its neighbours – what the
 * warm-up waits for first: the environment map changes every lit program) and their planets.
 */
export function prefetchZoneAssets(depths: readonly RingIndex[]): void {
  if (depths.length === 0) return;
  prestartHdrWorker();
  for (const depth of depths) {
    const sky = skyboxPaths(depth);
    prefetchAsset(sky.environment, 'first');
    prefetchAsset(sky.background, 'first');
  }
  void planetCatalog().then((catalog) => {
    if (!catalog) return;
    const specs = [...LANDMARK_PLANETS, ...depths.flatMap((d) => ZONE_LOOKS[d].planets)];
    for (const spec of specs) {
      const def = catalog[spec.kind];
      if (def) for (const file of planetFiles(def)) prefetchAsset(file);
    }
  });
}

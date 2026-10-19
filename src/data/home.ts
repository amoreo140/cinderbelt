// Home station modules and the Forge Index (M4c "Home and workshop", plan
// §2.1, §3; long-term design §7.4).
//
// The geometry (model file, default slot, collision circles, trophy pedestal room) comes from the art
// export `art/blender/data/home_modules.json`, copied to `./home_modules.json` (homeModules.test.ts
// guards the copy). Prices, Index points and milestones are game data and live here.
import type { Cargo } from './resources';
import type { LayoutCircle } from './stations';
import homeJson from './home_modules.json';

/** Game ids of the home modules (`homeRefinery` avoids a clash with the ship part `refinery`). */
export type HomeModuleId = 'paintShop' | 'trophyHall' | 'homeRefinery' | 'observatory' | 'laboratory' | 'droneHub';

/** Attach points on `station_home` (EMPTY nodes `attach_<slot>`). */
export type HomeSlot = 'fl' | 'rl' | 'rr' | 'fr' | 'port' | 'aft';

/** Rozvoj row order. */
export const HOME_MODULE_IDS: readonly HomeModuleId[] = ['paintShop', 'trophyHall', 'homeRefinery', 'observatory', 'laboratory', 'droneHub'];

/** The module's id in `home_modules.json`, the model file name and the icon name (`icons/home/<id>.png`). */
export const HOME_MODULE_JSON_ID: Record<HomeModuleId, keyof typeof homeJson.modules> = {
  paintShop: 'paint_shop',
  trophyHall: 'trophy_hall',
  homeRefinery: 'refinery',
  observatory: 'observatory',
  laboratory: 'laboratory',
  droneHub: 'drone_hub',
};

export interface HomeModuleDef {
  id: HomeModuleId;
  /** Model file: `models/stations/<file>.glb`. */
  file: string;
  /** Default (and in M4c the only) slot of the module. */
  slot: HomeSlot;
  /** Collision circles in the station frame at the default slot (+x = dock direction, unrotated). */
  circles: readonly LayoutCircle[];
  /** Price in credits. */
  credits: number;
  /**
   * Resources paid with the credits. Future modules also need intermediates (lenses, superconductors
   * – design §7.4) that are not resources yet; they join when M5 adds them.
   */
  resources?: Partial<Cargo>;
  /** Forge Index points the module adds when built (null = cosmetic, no point). */
  forgeIndex: number | null;
  /** The module comes with a later milestone: shown locked ("Later"), cannot be built. */
  since?: 'M5a' | 'M5b';
}

const json = homeJson.modules;

function def(id: HomeModuleId, rest: Pick<HomeModuleDef, 'credits' | 'resources' | 'forgeIndex' | 'since'>): HomeModuleDef {
  const m = json[HOME_MODULE_JSON_ID[id]];
  const out: HomeModuleDef = {
    id,
    file: m.file,
    slot: m.defaultSlot as HomeSlot,
    circles: m.circlesAtDefaultSlot.map((c) => ({ x: c.x, y: c.y, r: c.r })),
    credits: rest.credits,
    forgeIndex: rest.forgeIndex,
  };
  if (rest.resources) out.resources = rest.resources;
  if (rest.since) out.since = rest.since;
  return out;
}

/**
 * Prices from the design §7.4. Each key module adds one Index point (the JSON's `index` is its
 * ordinal on the gauge: refinery 1, observatory 2, drone hub 3; the Forge and the megaproject phases
 * bring the rest up to FORGE_INDEX_MAX in M6b).
 */
export const HOME_MODULES: Record<HomeModuleId, HomeModuleDef> = {
  paintShop: def('paintShop', { credits: 8000, forgeIndex: null }),
  trophyHall: def('trophyHall', { credits: 5000, forgeIndex: null }),
  homeRefinery: def('homeRefinery', { credits: 30000, resources: { titanium: 200 }, forgeIndex: 1, since: 'M5a' }),
  observatory: def('observatory', { credits: 25000, forgeIndex: 1, since: 'M5b' }),
  laboratory: def('laboratory', { credits: 35000, forgeIndex: null, since: 'M5b' }),
  droneHub: def('droneHub', { credits: 40000, forgeIndex: 1, since: 'M5b' }),
};

/** A module that can be built now (no later milestone). */
export const isBuildableModule = (id: HomeModuleId): boolean => HOME_MODULES[id].since === undefined;

/** The full Forge Index (4 key modules + 3 megaproject phases, design §7.4). */
export const FORGE_INDEX_MAX = 7;

/** Pedestals in the trophy hall (`trophy_0..5` empties). */
export const TROPHY_PEDESTALS = 6;

export interface HomeSlotDef {
  /** EMPTY node on `station_home`. */
  node: string;
  /** Position in the station frame (Blender axes: +x dock direction, +y left, z up). */
  x: number;
  y: number;
  z: number;
  /** Rotation about the up axis, degrees. */
  yawDeg: number;
}

export const HOME_SLOTS: Record<HomeSlot, HomeSlotDef> = homeJson.slots;

/** The room on one trophy pedestal (max horizontal extent / max height above its top, units). */
export const TROPHY_FIT: { maxExtent: number; maxHeight: number } = homeJson.trophies.fit;

/** Model file of the fortress trophy: `models/stations/<file>.glb`. */
export const TROPHY_FORTRESS_FILE: string = homeJson.trophies.fortress.file;

/** Rozvoj icon of a module (art: `public/assets/icons/home/<json id>.png`). */
export const homeModuleIconPath = (id: HomeModuleId): string => `assets/icons/home/${HOME_MODULE_JSON_ID[id]}.png`;

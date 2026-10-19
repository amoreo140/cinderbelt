import type { PartId, Tier } from '../../data/parts';
import type { ResourceId } from '../../data/resources';
import type { StationModel } from '../../data/stations';

/** Part tier (material) – determines the model. */
export type PartTier = 'iron' | 'titanium';
export const PART_TIERS: readonly PartTier[] = ['iron', 'titanium'];

/** Model material by part tier (T1 iron, T2 titanium). */
export const tierMaterial = (tier: Tier): PartTier => (tier === 2 ? 'titanium' : 'iron');
export type ConnectorKind = 'edge' | 'corner';

const PARTS_DIR = 'assets/models/parts';
const ASTEROIDS_DIR = 'assets/models/asteroids';
const STATIONS_DIR = 'assets/models/stations';
const PART_ICONS_DIR = 'assets/icons/parts';

/** Part file name without the tier (convention from art/blender). */
const PART_FILE: Record<PartId, string> = {
  cockpit: 'cockpit',
  armor: 'armor',
  engine: 'engine',
  gyro: 'gyroscope',
  miningLaser: 'mining_laser',
  cargo: 'cargo',
  fuelTank: 'fuel_tank',
  reactor: 'reactor',
  radar: 'radar',
  cannon: 'cannon',
  shield: 'shield_generator',
  heavyLaser: 'heavy_laser',
  largeCargo: 'large_cargo',
  battery: 'battery',
  tractorBeam: 'tractor_beam',
  largeReactor: 'large_reactor',
  repairModule: 'repair_module',
  refinery: 'refinery',
};

/** Shape variants of the asteroids of each resource. */
export const ASTEROID_VARIANTS = ['a', 'b', 'c'] as const;

/** Path to a part model (relative to BASE_URL). */
export function partModelPath(partId: PartId, tier: PartTier = 'iron'): string {
  return `${PARTS_DIR}/${PART_FILE[partId]}_${tier}.glb`;
}

/** Part icon 128 × 128 (editor palette, crafting, market) – relative to BASE_URL. */
export const partIconPath = (partId: PartId, tier: Tier): string => `${PART_ICONS_DIR}/${partId}_t${tier}.png`;

export const CONNECTOR_PATHS: Record<ConnectorKind, string> = {
  edge: `${PARTS_DIR}/hull_connector_edge.glb`,
  corner: `${PARTS_DIR}/hull_connector_corner.glb`,
};

export function asteroidModelPaths(resource: ResourceId): string[] {
  return ASTEROID_VARIANTS.map((v) => `${ASTEROIDS_DIR}/asteroid_${resource}_${v}.glb`);
}

/** Station model (conventions in spec M2, ch. 16). */
export const stationModelPath = (model: StationModel): string => `${STATIONS_DIR}/${model}.glb`;

/** Dock clamp – placed on the station's `dock_port` node. */
export const DOCK_CLAMP_PATH = `${STATIONS_DIR}/dock_clamp.glb`;

/** Hangar platform for the ship editor (17 × 17, floor y = −0.37, cells centred on −7…7). */
export const HANGAR_PATH = `${STATIONS_DIR}/hangar_platform.glb`;

/** The hangar bay around the platform (same frame; art batch D – render/HangarBay.ts). */
export const HANGAR_BAY_PATH = `${STATIONS_DIR}/hangar_bay.glb`;

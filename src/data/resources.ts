export type ResourceId = 'iron' | 'copper' | 'ice' | 'titanium';

export interface ResourceDef {
  id: ResourceId;
  /** Mass of one unit in the cargo bay. */
  massPerUnit: number;
  /** Colour of the veins on asteroids and of the dots on the radar. */
  color: number;
  /** Rock colour of the asteroid (placeholder model). */
  rockColor: number;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  iron: { id: 'iron', massPerUnit: 0.05, color: 0xff7a4d, rockColor: 0x7a5a4f },
  copper: { id: 'copper', massPerUnit: 0.05, color: 0xffb84d, rockColor: 0x86684a },
  ice: { id: 'ice', massPerUnit: 0.03, color: 0x8fe3ff, rockColor: 0xa8c8e8 },
  titanium: { id: 'titanium', massPerUnit: 0.04, color: 0xd9e2ff, rockColor: 0x8d93a3 },
};

export const RESOURCE_IDS = Object.keys(RESOURCES) as ResourceId[];

export type Cargo = Record<ResourceId, number>;

export function emptyCargo(): Cargo {
  return { iron: 0, copper: 0, ice: 0, titanium: 0 };
}

export function cargoUsed(cargo: Cargo): number {
  let sum = 0;
  for (const id of RESOURCE_IDS) sum += cargo[id];
  return sum;
}

export function cargoMass(cargo: Cargo): number {
  let sum = 0;
  for (const id of RESOURCE_IDS) sum += cargo[id] * RESOURCES[id].massPerUnit;
  return sum;
}

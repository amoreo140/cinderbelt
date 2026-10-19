import { describe, expect, it } from 'vitest';
import { PARTS, type PartId } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import { STATION_LAYOUTS, type StationModel } from '../../data/stations';
import { nodeFs } from '../../testing/nodeFs';
import {
  asteroidModelPaths,
  CONNECTOR_PATHS,
  DOCK_CLAMP_PATH,
  partIconPath,
  partModelPath,
  PART_TIERS,
  stationModelPath,
  tierMaterial,
} from './catalog';

describe('partModelPath', () => {
  it('maps every part to its iron model by default', () => {
    const expected: Record<PartId, string> = {
      cockpit: 'cockpit_iron',
      armor: 'armor_iron',
      engine: 'engine_iron',
      gyro: 'gyroscope_iron',
      miningLaser: 'mining_laser_iron',
      cargo: 'cargo_iron',
      fuelTank: 'fuel_tank_iron',
      reactor: 'reactor_iron',
      radar: 'radar_iron',
      cannon: 'cannon_iron',
      shield: 'shield_generator_iron',
      heavyLaser: 'heavy_laser_iron',
      largeCargo: 'large_cargo_iron',
      battery: 'battery_iron',
      tractorBeam: 'tractor_beam_iron',
      largeReactor: 'large_reactor_iron',
      repairModule: 'repair_module_iron',
      refinery: 'refinery_iron',
    };
    for (const id of Object.keys(PARTS) as PartId[]) {
      expect(partModelPath(id)).toBe(`assets/models/parts/${expected[id]}.glb`);
    }
  });

  it('points every part model and icon at an existing file', () => {
    const { existsSync } = nodeFs();
    for (const id of Object.keys(PARTS) as PartId[]) {
      for (const tier of PART_TIERS) expect(existsSync(`public/${partModelPath(id, tier)}`), partModelPath(id, tier)).toBe(true);
      for (const t of [1, 2] as const) expect(existsSync(`public/${partIconPath(id, t)}`), partIconPath(id, t)).toBe(true);
    }
  });

  it('selects the tier', () => {
    expect(partModelPath('gyro', 'titanium')).toBe('assets/models/parts/gyroscope_titanium.glb');
    expect(partModelPath('miningLaser', 'iron')).toBe('assets/models/parts/mining_laser_iron.glb');
  });
});

describe('part tiers', () => {
  it('maps game tiers to model materials', () => {
    expect(tierMaterial(1)).toBe('iron');
    expect(tierMaterial(2)).toBe('titanium');
    expect(PART_TIERS).toEqual(['iron', 'titanium']);
  });

  it('builds part icon paths', () => {
    expect(partIconPath('miningLaser', 2)).toBe('assets/icons/parts/miningLaser_t2.png');
    expect(partIconPath('armor', 1)).toBe('assets/icons/parts/armor_t1.png');
  });
});

describe('model catalog', () => {
  it('has both hull connectors', () => {
    expect(CONNECTOR_PATHS).toEqual({
      edge: 'assets/models/parts/hull_connector_edge.glb',
      corner: 'assets/models/parts/hull_connector_corner.glb',
    });
  });

  it('lists asteroid variants for every resource', () => {
    for (const id of RESOURCE_IDS) {
      const paths = asteroidModelPaths(id);
      expect(paths.length).toBeGreaterThanOrEqual(2);
      expect(paths[0]).toBe(`assets/models/asteroids/asteroid_${id}_a.glb`);
      expect(paths[1]).toBe(`assets/models/asteroids/asteroid_${id}_b.glb`);
    }
  });
});

describe('station models', () => {
  it('maps every station model to its file', () => {
    for (const model of Object.keys(STATION_LAYOUTS) as StationModel[]) {
      expect(stationModelPath(model)).toBe(`assets/models/stations/${model}.glb`);
    }
    expect(DOCK_CLAMP_PATH).toBe('assets/models/stations/dock_clamp.glb');
  });
});

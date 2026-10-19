import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../../data/resources';
import { richSim } from '../fleet/testing';
import { createGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import { HOME_STATION_ID } from '../world/stations';
import { playerShips, quoteUnitsPerHour } from './board';
import { miningUnitsPerHour } from './reward';

const minerGrid = createGrid([
  ['cockpit', 1, 0],
  ['gyro', 0, 0],
  ['miningLaser', 2, 0, 0],
  ['miningLaser', 2, 1, 0],
  ['miningLaser', 2, -1, 0],
  ['reactor', -1, 0],
  ['largeCargo', -1, 1],
  ['largeCargo', -1, -3],
  ['fuelTank', 1, 1],
  ['radar', 1, -1],
  ['engine', -2, 0, 0],
  ['engine', 1, 2, 3],
  ['engine', 1, -2, 1],
]);

describe('playerShips (M4a)', () => {
  it('counts the ships stored in hangar slots, so quotes use the best ship in all hangars', () => {
    const sim = richSim();
    const { state } = sim;
    const before = playerShips(state).length;
    const uphBefore = quoteUnitsPerHour(state, 1);
    state.fleet.stored.push({
      record: { id: 2, name: null, nameIdx: 0, log: { distance: 0, kills: 0, mined: 0, deaths: 0, built: 0 } },
      stationId: HOME_STATION_ID,
      grid: minerGrid,
      blueprint: minerGrid,
      hp: new Map(),
      fuel: 0,
      cargo: emptyCargo(),
    });
    expect(playerShips(state)).toHaveLength(before + 1);
    const miner = miningUnitsPerHour(computeProperties(minerGrid), 1, state.settings.miningYield);
    expect(miner).toBeGreaterThan(uphBefore);
    expect(quoteUnitsPerHour(state, 1)).toBeCloseTo(miner, 6);
  });
});

// The built home modules collide after a load too (M4c T1/T12): the save V19 carries `home`, the restore
// hands it to the Simulation, which puts the modules' colliders (`homeColliders`) into the World.
import { describe, expect, it } from 'vitest';
import { HOME_MODULES } from '../../data/home';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { act } from '../station/testHarness';
import { richSim } from '../fleet/testing';
import { homeStation } from '../world/stations';
import type { Simulation } from '../Simulation';

function roundTrip(sim: Simulation): Simulation {
  const loaded = loadSave(toEnvelope(toSave(sim, testContext())));
  if (!loaded.ok) throw new Error(`${loaded.error} ${loaded.details.join('; ')}`);
  return restoreSimulation(loaded.save);
}

describe('home colliders after a load', () => {
  it('the built modules are in the World again', () => {
    const sim = richSim();
    const bare = sim.state.world.stationCirclesNear(homeStation().pos, 1).length;
    act(sim, { type: 'homeBuild', module: 'paintShop' });
    act(sim, { type: 'homeBuild', module: 'trophyHall' });
    const built = sim.state.world.stationCirclesNear(homeStation().pos, 1);
    expect(built).toHaveLength(bare + HOME_MODULES.paintShop.circles.length + HOME_MODULES.trophyHall.circles.length);

    const restored = roundTrip(sim);
    expect([...restored.state.home.modules].sort()).toEqual(['paintShop', 'trophyHall']);
    expect(restored.state.world.stationCirclesNear(homeStation().pos, 1)).toEqual(built);
  });

  it('nothing extra without modules', () => {
    const sim = richSim();
    const bare = sim.state.world.stationCirclesNear(homeStation().pos, 1);
    const restored = roundTrip(sim);
    expect(restored.state.home.modules.size).toBe(0);
    expect(restored.state.world.stationCirclesNear(homeStation().pos, 1)).toEqual(bare);
  });
});

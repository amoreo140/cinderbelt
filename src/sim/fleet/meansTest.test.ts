// Means test with stored ships (M4a plan §2): a ship in this station's hangar is reachable wealth –
// its parts are spares in reach, its value counts, and a flyable one means no Guild loan at all.
import { describe, expect, it } from 'vitest';
import { partSellPrice, resourcePrice } from '../../data/economy';
import { partKey } from '../../data/parts';
import { IDLE_COMMAND } from '../commands';
import { meansTestedStarter } from '../death/death';
import { createStarterShip } from '../ship/presets';
import { guildLoanOffer, storedWorth } from '../station/guildLoan';
import type { Simulation } from '../Simulation';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { parkForNewShip, richSim } from './testing';

/** A broke player on a fresh cockpit-only ship; the starter ship (id 1) is stored at home. */
function brokeWithStoredStarter(): Simulation {
  const sim = richSim();
  sim.state.player.cargo.iron = 10;
  parkForNewShip(sim);
  sim.state.credits = 0;
  const home = sim.state.stations.get(HOME_STATION_ID)!;
  home.parts = {};
  home.resources.iron = 0;
  return sim;
}

describe('Guild loan means test with stored ships', () => {
  it('a flyable ship stored here: no loan offer, and no loan is mounted', () => {
    const sim = brokeWithStoredStarter();
    expect(guildLoanOffer(sim.state, homeStation())).toEqual([]);
    const events = sim.step(IDLE_COMMAND);
    expect(events.some((e) => e.type === 'guildLoan')).toBe(false);
    expect(sim.state.player.grid.parts).toHaveLength(1);
  });

  it('the same ship standing at another station does not help here', () => {
    const sim = brokeWithStoredStarter();
    sim.state.fleet.stored[0]!.stationId = 'st:9,9';
    expect(guildLoanOffer(sim.state, homeStation()).length).toBeGreaterThan(0);
  });

  it('a stored ship here adds its parts (buy-back) and cargo to the stored worth', () => {
    const sim = brokeWithStoredStarter();
    const station = homeStation();
    const here = storedWorth(sim.state, station);
    sim.state.fleet.stored[0]!.stationId = 'st:9,9';
    const elsewhere = storedWorth(sim.state, station);
    const parts = createStarterShip().parts.reduce((s, p) => s + partSellPrice(partKey(p.partId, p.tier, p.variant)), 0);
    const cargo = 10 * resourcePrice('iron', station.ring, station.priceJitter.iron).sell;
    expect(here - elsewhere).toBeCloseTo(parts + cargo, 6);
  });

  it('the Hard respawn hull lends less when a stored ship stands at the respawn station', () => {
    const sim = brokeWithStoredStarter();
    const lost = 1e9;
    const here = meansTestedStarter(sim, homeStation(), lost).parts.length;
    sim.state.fleet.stored[0]!.stationId = 'st:9,9';
    const elsewhere = meansTestedStarter(sim, homeStation(), lost).parts.length;
    expect(here).toBeLessThan(elsewhere);
  });
});

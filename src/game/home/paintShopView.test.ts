// Paint shop view model (M4c T2): only ships at home (the active ship docked there, ships in the home
// hangar), their paints, the selected ship and the preview – which never touches the simulation.
import { describe, expect, it } from 'vitest';
import { tx } from '../../i18n';
import { paintOf } from '../../sim/fleet/state';
import { fleetSnapshot, parkForNewShip, richSim } from '../../sim/fleet/testing';
import type { Simulation } from '../../sim/Simulation';
import { act, customStation, dockedAt, expectOk } from '../../sim/station/testHarness';
import { shipDisplayName } from '../../sim/fleet/names';
import { paintShopShips, paintShopView } from './paintShopView';

function withShop(): Simulation {
  const sim = richSim();
  expectOk(act(sim, { type: 'homeBuild', module: 'paintShop' }));
  return sim;
}

const NO_UI = { selectedShip: null, preview: null } as const;

describe('paintShopShips', () => {
  it('the active ship docked at home first, then the ships stored at home – not ships stored elsewhere', () => {
    const sim = withShop();
    parkForNewShip(sim); // ship 1 → the home hangar, ship 2 active
    const parked = sim.state.fleet.stored[0]!;
    // a ship stored at another station is not at home
    sim.state.fleet.stored.push({ ...structuredClone(parked), record: { ...parked.record, id: 9 }, stationId: 'st:5,5' });
    expectOk(act(sim, { type: 'paintShip', shipId: 1, paint: 'sand' }));
    const ships = paintShopShips(sim.state);
    expect(ships).toEqual([
      { shipId: 2, name: shipDisplayName(sim.state.fleet.active, tx().fleet.names), where: 'docked', paint: 'factory' },
      { shipId: 1, name: shipDisplayName(parked.record, tx().fleet.names), where: 'hangar', paint: 'sand' },
    ]);
  });

  it('nothing at home while docked elsewhere', () => {
    const sim = dockedAt(customStation({}));
    sim.state.home.modules.add('paintShop');
    expect(paintShopShips(sim.state)).toEqual([]);
  });
});

describe('paintShopView', () => {
  it('is null until the paint shop is built', () => {
    expect(paintShopView(richSim().state, NO_UI)).toBeNull();
  });

  it('selects the first ship by default and falls back when the selected ship is gone', () => {
    const sim = withShop();
    expect(paintShopView(sim.state, NO_UI)).toMatchObject({ selectedShip: 1, preview: null });
    expect(paintShopView(sim.state, { selectedShip: 77, preview: null })!.selectedShip).toBe(1);
    parkForNewShip(sim);
    expect(paintShopView(sim.state, { selectedShip: 1, preview: 'navy' })).toMatchObject({ selectedShip: 1, preview: 'navy' });
  });

  it('a preview is UI state only – the simulation stays as it was', () => {
    const sim = withShop();
    const before = fleetSnapshot(sim.state);
    const view = paintShopView(sim.state, { selectedShip: 1, preview: 'racing' })!;
    expect(view.preview).toBe('racing');
    expect(view.ships[0]!.paint).toBe('factory');
    expect(paintOf(sim.state.fleet.active)).toBe('factory');
    expect(fleetSnapshot(sim.state)).toEqual(before);
  });
});

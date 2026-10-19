import { describe, expect, it } from 'vitest';
import { STATION_SERVICES } from '../data/stations';
import { dockedSim } from '../sim/station/testHarness';
import { createGrid } from '../sim/ship/grid';
import { coveredNozzles, designGap } from './designGap';

const yard = { services: STATION_SERVICES.home };

describe('designGap (M3.8)', () => {
  it('is null for a ship that matches its blueprint', () => {
    expect(designGap(dockedSim().state, yard)).toBeNull();
  });

  it('lists the lost parts, shows the gaps and tells whether the station can restore them', () => {
    const sim = dockedSim();
    const p = sim.state.player;
    p.grid = { nextId: p.grid.nextId, parts: p.grid.parts.filter((q) => q.partId !== 'radar' && q.partId !== 'fuelTank') };
    p.hp.set(p.grid.parts[0]!.id, 1);
    const gap = designGap(sim.state, yard)!;
    expect(gap.missing).toEqual({ 'fuelTank:1': 1, 'radar:1': 1 });
    expect(gap.missingCount).toBe(2);
    expect(gap.damaged).toBe(1);
    expect(gap.silhouette.missing).toBe(2);
    expect(gap.shipyard).toBe(true);
    expect(designGap(sim.state, { services: STATION_SERVICES.outpost })!.shipyard).toBe(false);
  });
});

describe('coveredNozzles (I15)', () => {
  it('counts the engines blowing into the ship itself (the hub card), 0 for a clean layout', () => {
    expect(coveredNozzles(dockedSim().state)).toBe(0);
    const grid = createGrid([['cockpit', 1, 0], ['engine', 0, 0, 0], ['cargo', -1, 0], ['engine', 1, 1, 3]]);
    expect(coveredNozzles(dockedSim(grid).state)).toBe(1);
  });
});

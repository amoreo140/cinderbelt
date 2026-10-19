import { describe, expect, it } from 'vitest';
import { STATION_SERVICES } from '../../data/stations';
import { createStarterShip } from '../ship/presets';
import { Simulation } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { HOME_STATION_ID, homeStation, type StationDef } from '../world/stations';
import { homeOnly } from './testHarness';
import { towQuote, towShip } from './tow';

const station = (id: string, cx: number, pos: { x: number; y: number }, kind: StationDef['kind']): StationDef => ({
  ...homeStation(),
  id,
  kind,
  pos,
  chunk: { cx, cy: 0 },
  services: STATION_SERVICES[kind],
});

// outpost (no shipyard) nearest, a station with a shipyard further away, home furthest
const outpost = station('st:4,0', 4, { x: 900, y: 100 }, 'outpost');
const yard = station('st:6,0', 6, { x: 1300, y: 100 }, 'station');
const world: ChunkGenerator = (s, cx, cy) => {
  const found = [outpost, yard].find((st) => st.chunk.cx === cx && st.chunk.cy === 0 && cy === 0);
  return { ...homeOnly(s, cx, cy), ...(found ? { station: found } : {}) };
};

function strandedAt(grid = createStarterShip()): Simulation {
  const sim = new Simulation({ seed: 1, generator: world, grid, startDocked: false });
  for (const s of [outpost, yard]) sim.state.world.update(s.pos);
  const pos = { x: 1000, y: 100 };
  sim.state.world.update(pos);
  sim.state.player.body = { ...sim.state.player.body, pos };
  sim.state.player.prevBody = sim.state.player.body;
  sim.state.player.fuel = 0;
  return sim;
}

const withoutForwardEngines = () => {
  const starter = createStarterShip();
  return { ...starter, parts: starter.parts.filter((p) => !(p.partId === 'engine' && p.rot === 0)) };
};

describe('towing', () => {
  it('tows a ship that can still fly to the nearest discovered station', () => {
    const sim = strandedAt();
    expect(towQuote(sim.state).station.id).toBe(outpost.id);
    towShip(sim);
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: outpost.id });
  });

  it('tows a ship without forward thrust to the nearest discovered station with a shipyard (F1)', () => {
    const sim = strandedAt(withoutForwardEngines());
    sim.state.player.fuel = 50;
    expect(sim.state.player.props.thrust.forward).toBe(0);
    expect(towQuote(sim.state).station.id).toBe(yard.id);
    const events = towShip(sim);
    expect(events).toContainEqual(expect.objectContaining({ type: 'towed', stationId: yard.id }));
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: yard.id });
  });

  it('falls back to home when no other shipyard is known', () => {
    const sim = strandedAt(withoutForwardEngines());
    sim.state.world.discovered.delete(yard.id);
    expect(towQuote(sim.state).station.id).toBe(HOME_STATION_ID);
  });
});

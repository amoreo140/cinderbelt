// Helpers for station action tests (not used by the game).
import { expect } from 'vitest';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { Simulation, type SimEvent } from '../Simulation';
import type { ShipGrid } from '../ship/types';
import type { ChunkGenerator } from '../world/generate';
import { homeStation, type StationDef } from '../world/stations';
import { dockPose } from './dock';

/** A world with only the home station (no asteroids). */
export const homeOnly: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : {}),
});

/** A new game docked at home. */
export function dockedSim(grid?: ShipGrid): Simulation {
  return new Simulation({ seed: 1, generator: homeOnly, ...(grid ? { grid } : {}) });
}

/** A simulation docked at its own station at the origin (e.g. an outpost without services, another ring). */
export function dockedAt(station: StationDef, grid?: ShipGrid): Simulation {
  const sim = new Simulation({
    seed: 1,
    startDocked: false,
    generator: (_s, cx, cy) => ({ cx, cy, asteroids: [], ...(cx === 0 && cy === 0 ? { station } : {}) }),
    ...(grid ? { grid } : {}),
  });
  sim.enterDocked(station.id, dockPose(station, sim.state.player.props.boundingRadius));
  return sim;
}

let lastReqId = 0;

export function act(sim: Simulation, a: GameActionInput): SimEvent[] {
  return sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++lastReqId } as GameAction] });
}

export const resultOf = (events: SimEvent[]) => events.find((e) => e.type === 'actionResult');

/** Everything an action may change. */
export function snapshot(sim: Simulation) {
  const { player, credits, stations } = sim.state;
  return structuredClone({
    credits,
    cargo: player.cargo,
    fuel: player.fuel,
    energy: player.energy,
    stations: [...stations],
    body: player.body,
    grid: player.grid,
    hp: [...player.hp],
    gridVersion: player.gridVersion,
  });
}

export function expectOk(events: SimEvent[]): void {
  expect(resultOf(events)).toMatchObject({ type: 'actionResult', ok: true });
}

/** The action fails with the given reason and changes nothing. */
export function expectFailure(sim: Simulation, a: GameActionInput, reason: string): SimEvent[] {
  const before = snapshot(sim);
  const events = act(sim, a);
  expect(resultOf(events)).toMatchObject({ type: 'actionResult', ok: false, reason });
  expect(events.filter((e) => e.type !== 'actionResult')).toEqual([]);
  expect(snapshot(sim)).toEqual(before);
  return events;
}

/** A station at the origin with other services / another ring. */
export function customStation(patch: Partial<StationDef>): StationDef {
  return { ...homeStation(), id: 'st:0,0', ...patch };
}

// Test helpers of the fleet (M4a) – not used by the game.
import { ALL_PART_KEYS, partKey, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, emptyCargo } from '../../data/resources';
import { IDLE_COMMAND } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { HOME_STATION_ID } from '../world/stations';
import { act, dockedSim } from '../station/testHarness';
import type { Simulation } from '../Simulation';

/** A new game docked at home (only the home station in the world) with plenty of credits. */
export function richSim(credits = 100_000): Simulation {
  const sim = dockedSim();
  sim.state.credits = credits;
  // the first docked step records the ship's capability – settle it, so refused actions compare clean
  sim.step(IDLE_COMMAND);
  return sim;
}

/** Puts parts into the home storage. */
export function stock(sim: Simulation, parts: PartInventory): void {
  const storage = sim.state.stations.get(HOME_STATION_ID)!;
  for (const [key, n] of Object.entries(parts) as [PartKey, number][]) storage.parts[key] = (storage.parts[key] ?? 0) + n;
}

/** Buys a slot and parks the active ship by starting a new one from a storage cockpit (T1). */
export function parkForNewShip(sim: Simulation): SimEvent[] {
  stock(sim, { 'cockpit:1': 1 });
  if (sim.state.fleet.slots.size === 0) act(sim, { type: 'hangarBuySlot' });
  return act(sim, { type: 'hangarNewShip', cockpit: 'cockpit:1' });
}

/** Everything of value the player owns, summed over the whole game: parts by key, resources, fuel, credits. */
export function holdings(state: SimState): { parts: PartInventory; resources: Cargo; fuel: number; credits: number } {
  const parts: PartInventory = {};
  const add = (key: PartKey, n: number) => {
    if (n) parts[key] = (parts[key] ?? 0) + n;
  };
  const resources = emptyCargo();
  const addCargo = (c: Cargo) => {
    for (const r of RESOURCE_IDS) resources[r] += c[r];
  };
  let fuel = state.player.fuel;
  for (const p of state.player.grid.parts) if (!p.loan) add(partKey(p.partId, p.tier, p.variant), 1);
  for (const [key, n] of Object.entries(state.player.salvage) as [PartKey, number][]) add(key, n);
  addCargo(state.player.cargo);
  for (const s of state.fleet.stored) {
    for (const p of s.grid.parts) add(partKey(p.partId, p.tier, p.variant), 1);
    addCargo(s.cargo);
    fuel += s.fuel;
  }
  for (const st of state.stations.values()) {
    for (const [key, n] of Object.entries(st.parts) as [PartKey, number][]) add(key, n);
    addCargo(st.resources);
  }
  // canonical key order, so two holdings compare with toEqual
  const sorted: PartInventory = {};
  for (const key of ALL_PART_KEYS) if (parts[key]) sorted[key] = parts[key];
  return { parts: sorted, resources, fuel, credits: state.credits };
}

/** The fleet and the active ship as plain data (deep comparisons, determinism). */
export function fleetSnapshot(state: SimState) {
  const { player } = state;
  return structuredClone({
    fleet: state.fleet,
    credits: state.credits,
    stations: [...state.stations],
    player: {
      grid: player.grid,
      blueprint: player.blueprint,
      hp: [...player.hp],
      fuel: player.fuel,
      cargo: player.cargo,
      energy: player.energy,
      shield: player.shield,
      body: player.body,
      dock: player.dock,
    },
    respawn: state.respawn,
    stats: state.stats,
  });
}

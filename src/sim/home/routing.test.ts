// The home hooks of the simulation (M4c T0): state, command routing, the public surface.
// The rules of each action are T1's (modules.test.ts, paint.test.ts, trophies.test.ts).
import { describe, expect, it } from 'vitest';
import { TROPHY_PEDESTALS } from '../../data/home';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { createHome, forgeIndex, homeColliders, isHomeAction, trophiesOf, trophyShelf } from './index';

const empty: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });
const act = (a: GameActionInput, reqId: number) => ({ ...IDLE_COMMAND, actions: [{ ...a, reqId } as GameAction] });
const results = (events: SimEvent[]) => events.filter((e) => e.type === 'actionResult');

describe('home station hooks (M4c T0)', () => {
  it('starts a new game with nothing built and nothing pinned', () => {
    const sim = new Simulation({ seed: 3 });
    expect(sim.state.home).toEqual(createHome());
    expect(forgeIndex(sim.state)).toBe(0);
    expect(homeColliders(sim.state)).toEqual([]);
    expect(trophiesOf(sim.state)).toEqual([]);
    expect(trophyShelf(sim.state)).toEqual(Array.from({ length: TROPHY_PEDESTALS }, () => null));
  });

  it('routes only the three home actions to sim/home', () => {
    const base = { reqId: 1 };
    expect(isHomeAction({ ...base, type: 'homeBuild', module: 'paintShop' })).toBe(true);
    expect(isHomeAction({ ...base, type: 'paintShip', shipId: 1, paint: 'navy' })).toBe(true);
    expect(isHomeAction({ ...base, type: 'trophyPin', id: 'cap:0', pinned: true })).toBe(true);
    expect(isHomeAction({ ...base, type: 'undock' })).toBe(false);
  });

  it('refuses every home action in flight (one answer, same reqId) and changes nothing', () => {
    const sim = new Simulation({ seed: 3, generator: empty, startDocked: false });
    const credits = sim.state.credits;
    const actions: GameActionInput[] = [
      { type: 'homeBuild', module: 'paintShop' },
      { type: 'paintShip', shipId: sim.state.fleet.active.id, paint: 'racing' },
      { type: 'trophyPin', id: 'cap:0', pinned: true },
    ];
    actions.forEach((a, i) => {
      const answers = results(sim.step(act(a, 10 + i)));
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ reqId: 10 + i, ok: false });
    });
    expect(sim.state.home).toEqual(createHome());
    expect(sim.state.credits).toBe(credits);
    expect(sim.state.fleet.active.paint ?? 'factory').toBe('factory');
  });
});

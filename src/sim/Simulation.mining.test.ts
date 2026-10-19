import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from './commands';
import { Simulation } from './Simulation';
import type { ChunkGenerator } from './world/generate';

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

describe('Simulation – laser heat (M2d)', () => {
  it('cools idle lasers, drops heat of lasers the ship no longer has and clears it on docking', () => {
    const sim = new Simulation({ seed: 1, startDocked: false, generator: emptySpace });
    const player = sim.state.player;
    const laserId = player.props.lasers[0]!.partId;
    player.heat.set(laserId, { heat: 1, cooling: 0 });
    player.heat.set(999, { heat: 3, cooling: 0 });
    for (let i = 0; i < 30; i++) sim.step(IDLE_COMMAND);
    expect(player.heat.get(laserId)!.heat).toBeCloseTo(0.5);
    expect(player.heat.has(999)).toBe(false);
    for (let i = 0; i < 40; i++) sim.step(IDLE_COMMAND);
    // the cold laser is left out of the map (canonical save)
    expect(player.heat.size).toBe(0);
    player.heat.set(laserId, { heat: 2, cooling: 0 });
    sim.enterDocked('home', player.body);
    expect(player.heat.size).toBe(0);
  });
});

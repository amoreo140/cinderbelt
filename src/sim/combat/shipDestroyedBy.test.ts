// M4d T0: `shipDestroyed.by` – the owner of the destroying shot. A pirate destroyed by a Guild Watch shot
// (`gw:…`) is not the player's kill and leaves no cargo loot (plan §2.3 "Kills by the Watch"); the side
// rules (T4, npc/sides.ts) let Watch shots hit pirates.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../commands';
import { computeProperties } from '../ship/properties';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { createEnemy } from './enemies';
import type { Enemy } from './types';

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/** A flying sim with a one-cell pirate (cockpit only, no shield) 60 u ahead, a lethal shot just behind it. */
function killShot(owner: string): { events: SimEvent[]; sim: Simulation; enemy: Enemy } {
  const sim = new Simulation({ seed: 5, grid: createStarterShip(), startDocked: false, generator: emptySpace });
  const enemy = createEnemy({ id: 'pr:test:0', kind: 'jackal', tier: 1, pos: { x: 60, y: 0 }, angle: Math.PI, home: { x: 60, y: 0 }, orbit: 1 });
  enemy.grid = createGrid([['cockpit', 0, 0]]);
  enemy.props = computeProperties(enemy.grid);
  enemy.hp = new Map();
  enemy.shield = 0;
  enemy.maxHull = 1;
  sim.state.combat.enemies.push(enemy);
  sim.state.combat.projectiles.push({ id: 9000, owner, pos: { x: 57, y: 0 }, vel: { x: 300, y: 0 }, ttl: 10, damage: 10_000, tier: 1, origin: { x: 57, y: 0 } });
  sim.state.tick = 1; // not a spawn check step
  const events = sim.step(IDLE_COMMAND);
  return { events, sim, enemy };
}

describe('shipDestroyed.by', () => {
  it('names the player as the killer of a pirate the player shot (a kill, cargo loot)', () => {
    const { events, sim } = killShot('player');
    expect(events.find((e) => e.type === 'shipDestroyed')).toMatchObject({ ref: 'pr:test:0', by: 'player' });
    expect(sim.state.stats.kills).toBe(1);
    const wreck = sim.state.combat.wrecks.find((w) => w.cls === 'pirate');
    expect(wreck?.loot.cargo.iron ?? 0).toBeGreaterThan(0);
  });

  it('a Guild Watch kill is not the player’s and leaves no cargo', () => {
    const { events, sim } = killShot('gw:lane:A:0|0');
    expect(events.find((e) => e.type === 'shipDestroyed')).toMatchObject({ ref: 'pr:test:0', by: 'gw:lane:A:0|0' });
    expect(sim.state.stats.kills).toBe(0);
    for (const w of sim.state.combat.wrecks) expect(w.loot.cargo).toEqual({ iron: 0, copper: 0, ice: 0, titanium: 0 });
  });
});

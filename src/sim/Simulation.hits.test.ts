// Projectile hits (M18, M19): a shot inside the shield and a second hit on a destroyed part in the same step.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from './commands';
import { cellWorld, shieldRadius } from './combat/projectiles';
import type { Projectile } from './combat/types';
import { createGrid } from './ship/grid';
import type { ShipGrid } from './ship/types';
import { Simulation } from './Simulation';
import type { ChunkGenerator } from './world/generate';

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

function flyingSim(grid: ShipGrid): Simulation {
  const sim = new Simulation({ seed: 9, grid, startDocked: false, generator: emptySpace });
  const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  return sim;
}

const shot = (id: number, pos: { x: number; y: number }, vel: { x: number; y: number }, damage: number): Projectile => ({
  id, owner: 'pr:x', pos, vel, ttl: 10, damage, tier: 1, origin: { x: 40, y: 0 },
});

describe('M18 – a point-blank shot inside the shield bubble', () => {
  it('is reported as a shield hit when the shield absorbs it', () => {
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['shield', 1, 0], ['engine', -1, 0, 0]]));
    const p = sim.state.player;
    expect(p.shield).toBeGreaterThan(0);
    const cell = cellWorld(p, { x: 1, y: 0 });
    const r = shieldRadius(p.props);
    // starts inside the bubble (in front of the cell), flies towards it
    const start = { x: cell.x + 0.9, y: cell.y };
    expect(Math.hypot(start.x - p.body.pos.x, start.y - p.body.pos.y)).toBeLessThan(r);
    sim.state.combat.projectiles.push(shot(1, start, { x: -60, y: 0 }, 5));
    const shield = p.shield;
    const events = sim.step(IDLE_COMMAND);
    const hit = events.find((e) => e.type === 'projectileHit');
    expect(hit).toMatchObject({ type: 'projectileHit', target: 'shield', ref: 'player' });
    expect(p.shield).toBeCloseTo(shield - 5);
    expect(p.hp.size).toBe(0);
  });
});

describe('M19 – a second shot on a part destroyed in the same step', () => {
  it('passes through the destroyed part into the next cell', () => {
    const sim = flyingSim(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 2, 0], ['engine', -1, 0, 0]]));
    const p = sim.state.player;
    p.shield = 0;
    p.hp.set(3, 1);
    const cell = cellWorld(p, { x: 2, y: 0 });
    const start = { x: cell.x + 0.6, y: cell.y };
    sim.state.combat.projectiles.push(shot(1, start, { x: -60, y: 0 }, 5), shot(2, start, { x: -60, y: 0 }, 5));
    const events = sim.step(IDLE_COMMAND);
    expect(events).toContainEqual(expect.objectContaining({ type: 'partDestroyed', ref: 'player', partId: 3 }));
    expect(events.filter((e) => e.type === 'projectileHit')).toHaveLength(2);
    expect(p.hp.get(2)).toBe(40 - 5);
    expect(p.grid.parts.some((x) => x.id === 3)).toBe(false);
  });
});

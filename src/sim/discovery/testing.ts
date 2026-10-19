// Helpers for discovery tests (not used by the game).
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import type { Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import { Simulation, type SimEvent } from '../Simulation';
import type { ShipGrid } from '../ship/types';
import { poisInChunk, type Poi } from './poi';

/** The first POI of the given kind in a square of chunks around the origin (spiralling by distance). */
export function findPoi<K extends Poi['kind']>(seed: number, kind: K, filter: (p: Extract<Poi, { kind: K }>) => boolean = () => true, r = 25): Extract<Poi, { kind: K }> {
  const all: Extract<Poi, { kind: K }>[] = [];
  for (let cx = -r; cx < r; cx++) for (let cy = -r; cy < r; cy++) {
    for (const p of poisInChunk(seed, cx, cy)) if (p.kind === kind && filter(p as Extract<Poi, { kind: K }>)) all.push(p as Extract<Poi, { kind: K }>);
  }
  all.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y));
  const found = all[0];
  if (!found) throw new Error(`no ${kind} POI for seed ${seed}`);
  return found;
}

/** A simulation in flight at the given place (a real world from the seed). */
export function flyingAt(seed: number, pos: Vec2, grid?: ShipGrid): Simulation {
  const sim = new Simulation({ seed, startDocked: false, ...(grid ? { grid } : {}) });
  teleport(sim, pos);
  return sim;
}

/** Moves the ship (stopped) and loads the chunks around it. */
export function teleport(sim: Simulation, pos: Vec2, angle = 0): void {
  const body = createBody(pos, angle);
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(pos);
}

export function run(sim: Simulation, n: number, cmd: Partial<PlayerCommand> = {}): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step({ ...IDLE_COMMAND, ...cmd }));
  return out;
}

/** A Tab tap (pulse): held for 3 steps, then released. */
export function tapScan(sim: Simulation): SimEvent[] {
  return [...run(sim, 3, { scan: true }), ...run(sim, 1)];
}

/** Holding Tab with the cursor on a point (analysis) and releasing. */
export function holdScan(sim: Simulation, aim: Vec2, ticks = 125): SimEvent[] {
  return [...run(sim, ticks, { scan: true, aim }), ...run(sim, 1, { aim })];
}

export const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

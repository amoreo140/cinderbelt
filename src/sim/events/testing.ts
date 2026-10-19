// Test helpers of the events director (not used by the game).
import type { RolledEventKind } from '../../data/events';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { IDLE_COMMAND } from '../commands';
import type { Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import { securityOverrides } from '../pirates/sectors';
import { guildCorridorAt, sectorIdAt, sectorInfoAt, sectorSecurity, type Security } from '../regions';
import { Simulation, type SimEvent } from '../Simulation';
import type { ShipGrid } from '../ship/types';
import { BUCKET_TICKS, nearStation, pickRolledKind, rollBucket, rollContext } from './director';

export interface Spot {
  pos: Vec2;
  sector: string;
}

/** A point of the given depth and current security, off the Guild Lanes and ≥ 600 u from stations. */
export function findSpot(sim: Simulation, depth: number, security: Security, corridor: boolean | 'any' = false): Spot {
  const seed = sim.state.seed;
  for (let r = 1200; r < 16_000; r += 150) {
    for (let a = 0; a < 64; a++) {
      const pos = { x: Math.cos((a / 64) * Math.PI * 2 + r) * r, y: Math.sin((a / 64) * Math.PI * 2 + r) * r };
      const info = sectorInfoAt(seed, pos.x, pos.y);
      if (info.depth !== depth || sectorSecurity(seed, info.id, securityOverrides(sim.state)) !== security) continue;
      if ((corridor !== 'any' && guildCorridorAt(seed, pos.x, pos.y) !== corridor) || nearStation(sim.state, pos)) continue;
      return { pos, sector: sectorIdAt(seed, pos.x, pos.y) };
    }
  }
  throw new Error(`no depth-${depth} ${security} spot for seed ${seed}`);
}

/** A flying simulation parked at a point (the world loaded around it). */
export function parkedAt(seed: number, pos: Vec2, grid?: ShipGrid): Simulation {
  const sim = new Simulation({ seed, startDocked: false, ...(grid ? { grid } : {}) });
  park(sim, pos);
  return sim;
}

export function park(sim: Simulation, pos: Vec2, angle = 0): void {
  const body = createBody(pos, angle);
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(pos);
}

/**
 * The first trigger tick at or after `fromTick` (epoch ≥ 1) whose bucket in the spot's sector rolls
 * `kind` for the simulation's current state (its tick is moved there).
 */
export function findTrigger(sim: Simulation, spot: Spot, kind: RolledEventKind, fromTick = SECTOR_EPOCH_TICKS): number {
  const b0 = Math.ceil(fromTick / BUCKET_TICKS);
  for (let b = b0; b < b0 + 20_000; b++) {
    const roll = rollBucket(sim.state.seed, spot.sector, b);
    const tick = b * BUCKET_TICKS + roll.offset;
    sim.state.tick = tick;
    if (pickRolledKind(roll, rollContext(sim.state, spot.sector, spot.pos)) === kind) return tick;
  }
  throw new Error(`no ${kind} bucket in ${spot.sector}`);
}

export function steps(sim: Simulation, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step(IDLE_COMMAND));
  return out;
}

export const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

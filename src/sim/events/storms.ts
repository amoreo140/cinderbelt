// Ion storms for every consumer (M4b plan §2.2) – OWNED BY T1 after T0. A storm at a point = the legacy
// area storm (`ionStormAt`, discovery/events.ts – unchanged) or a derelict's local storm defence
// (`siteStorms`, sites/derelict.ts, T4). Shields drop and the radar halves inside either. Every consumer
// (discovery step, scanner radar range, the game's HUD) calls `stormAt`.
import { ionStormAt } from '../discovery/events';
import type { Vec2 } from '../math/vec2';
import { siteStorms } from '../sites/derelict';
import type { SimState } from '../Simulation';

/** Is there an ion storm at `pos` at `tick`? */
export function stormAt(state: SimState, pos: Vec2, tick: number): boolean {
  if (ionStormAt(state.seed, pos, tick)) return true;
  for (const s of siteStorms(state)) {
    if (tick >= s.start && tick < s.end && Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y) <= s.radius) return true;
  }
  return false;
}

// Comets on the map (M4b §2.3, T10 view model): a known comet's pass track, its nucleus while it
// passes and "Next pass near you: N min" – the next time it comes within `COMET.nearRange` of the
// player (`nextPassNear`, two periods searched). Unknown comets stay signals.
import { tx } from '../../i18n';
import { cometArc, cometAt, cometById, nextPassNear } from '../../sim/sites';
import type { SimState } from '../../sim/Simulation';
import type { CometMapData } from './types';

/** Sim steps per second. */
const TICKS_PER_SECOND = 60;

/** Whole minutes until `at` (ticks), rounded up; 0 = now. */
export const minutesUntil = (at: number, tick: number): number => Math.max(0, Math.ceil((at - tick) / (TICKS_PER_SECOND * 60)));

/** A comet's display name ("Comet K-3"): `cm:<n>` counts from 0, the name from 1 (map, radio, chip). */
export const cometName = (n: number): string => tx().world.comet.name(n + 1);

/** The next-pass search is costly; it is redone only when the player moved this far (u) or a second passed. */
const NEXT_PASS_STEP = 50;

interface NextPassMemo {
  key: string;
  tick: number;
  at: number | null;
}

const nextPassMemo = new Map<string, NextPassMemo>();

function nextPassTick(state: SimState, id: string): number | null {
  const pos = state.player.body.pos;
  const key = `${state.seed}|${Math.round(pos.x / NEXT_PASS_STEP)},${Math.round(pos.y / NEXT_PASS_STEP)}`;
  const hit = nextPassMemo.get(id);
  // still valid: same place, not older than a second, and the found pass has not started yet (or none)
  if (hit && hit.key === key && state.tick >= hit.tick && state.tick - hit.tick < TICKS_PER_SECOND && (hit.at === null || hit.at >= state.tick)) return hit.at;
  const at = nextPassNear(state.seed, id, pos, state.tick);
  if (nextPassMemo.size > 64) nextPassMemo.clear();
  nextPassMemo.set(id, { key, tick: state.tick, at });
  return at;
}

const arcMemo = new Map<string, CometMapData['arc']>();

/** Known comets (ids `cm:<n>` in `discovery.known`) with their track, nucleus and next pass near the player. */
export function cometMapData(state: SimState): CometMapData[] {
  const out: CometMapData[] = [];
  for (const id of state.discovery.known) {
    if (!id.startsWith('cm:')) continue;
    const def = cometById(state.seed, id);
    if (!def) continue;
    const arcKey = `${state.seed}|${id}`;
    let arc = arcMemo.get(arcKey);
    if (!arc) {
      arc = cometArc(state.seed, id, 48);
      if (arcMemo.size > 64) arcMemo.clear();
      arcMemo.set(arcKey, arc);
    }
    const pose = cometAt(state.seed, id, state.tick);
    const next = nextPassTick(state, id);
    out.push({
      id,
      name: cometName(def.n),
      known: true,
      arc,
      now: pose ? pose.pos : null,
      nextPassMin: next === null ? null : minutesUntil(next, state.tick),
    });
  }
  return out;
}

// Mining 2.0 state <-> save (V12): live nuggets and the assayed chunks (sorted – a canonical save).
import type { MiningState, Nugget } from '../mining/nuggets';
import type { SavedMiningV12 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function miningToSave(m: MiningState): SavedMiningV12 {
  return {
    nextId: m.nextId,
    nuggets: m.nuggets.map((n) => ({
      id: n.id,
      resource: n.resource,
      amount: n.amount,
      grade: n.grade,
      source: n.source,
      body: { pos: { ...n.body.pos }, vel: { ...n.body.vel }, angle: n.body.angle, angVel: n.body.angVel },
      ttl: n.ttl,
    })),
    assayed: [...m.assayed].sort(byString),
  };
}

export function miningFromSave(s: SavedMiningV12): MiningState {
  return {
    nextId: s.nextId,
    nuggets: s.nuggets.map((n): Nugget => {
      const body = { pos: { ...n.body.pos }, vel: { ...n.body.vel }, angle: n.body.angle, angVel: n.body.angVel };
      return { id: n.id, resource: n.resource, amount: n.amount, grade: n.grade, source: n.source, body, prevBody: body, ttl: n.ttl };
    }),
    assayed: new Set(s.assayed),
  };
}

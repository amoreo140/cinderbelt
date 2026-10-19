// Convoys ↔ save (V20, M4d): the trades with scheduled passes, the link to a trader and the escort
// contracts' convoys. The schedule itself is a pure function of the seed (nothing about a pass is saved
// but its trade). Maps as sorted arrays; an escort's `deposit` is always written (0 = none held).
import { createConvoys } from '../convoys/state';
import type { ConvoysState, EscortState } from '../convoys/types';
import type { SavedConvoysV20, SavedEscortV20 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const escortToSave = (e: EscortState): SavedEscortV20 => ({
  progress: e.progress,
  state: e.state,
  departed: e.departed,
  away: e.away,
  stopUntil: e.stopUntil,
  fired: e.fired,
  hulls: [...e.hulls],
  deposit: e.deposit ?? 0,
});

const escortFromSave = (e: SavedEscortV20): EscortState => ({ ...e, hulls: [...e.hulls] });

export function convoysToSave(c: ConvoysState): SavedConvoysV20 {
  return {
    trades: [...c.trades].sort((a, b) => byString(a[0], b[0])).map(([pass, t]) => [pass, { bought: t.bought, sold: t.sold, fuel: t.fuel }]),
    link: c.link ? { pass: c.link.pass, since: c.link.since } : null,
    escorts: [...c.escorts].sort((a, b) => a[0] - b[0]).map(([serial, e]) => [serial, escortToSave(e)]),
  };
}

export function convoysFromSave(saved: SavedConvoysV20): ConvoysState {
  return {
    trades: new Map(saved.trades.map(([pass, t]) => [pass, { ...t }])),
    link: saved.link ? { ...saved.link } : null,
    escorts: new Map(saved.escorts.map(([serial, e]) => [serial, escortFromSave(e)])),
  };
}

/** Convoys of a save before V20: no trades, no link, no escort convoys. */
export const legacyConvoys = (): SavedConvoysV20 => convoysToSave(createConvoys());

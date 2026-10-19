// A new game's convoy state (M4d): no trades, no link, no escort convoys.
import type { ConvoysState } from './types';

export function createConvoys(): ConvoysState {
  return { trades: new Map(), link: null, escorts: new Map() };
}

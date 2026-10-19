// A new game's Guild state (M4d): no relay progress, no live Watch ships.
import type { GuildState } from './types';

export function createGuild(): GuildState {
  return { relays: new Map(), hold: null, watch: [], lost: new Map(), lastRadio: -1e9 };
}

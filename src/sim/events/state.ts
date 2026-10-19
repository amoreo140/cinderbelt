// Fresh state of the events director (a new game; a save before V17 migrates to this, T11).
import type { DirectorState } from './types';

/** No event yet: the quiet window is open from the start. */
export const DIRECTOR_NEVER = -1e9;

export function createDirector(): DirectorState {
  return { last: DIRECTOR_NEVER, fired: new Map() };
}

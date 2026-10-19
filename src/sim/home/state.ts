// Fresh home state: nothing built, nothing pinned (a new game; saves before M4c migrate to this).
import type { HomeState } from './types';

export function createHome(): HomeState {
  return { modules: new Set(), trophyPins: [] };
}

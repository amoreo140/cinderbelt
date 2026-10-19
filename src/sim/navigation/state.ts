// A new game's navigation state (M4d): no map notes.
import type { NavigationState } from './types';

export function createNavigation(): NavigationState {
  return { notes: [], nextNote: 1 };
}

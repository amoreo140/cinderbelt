// Navigation ↔ save (V20, M4d): the player's map notes in their order and the next note id (ids are
// never reused). The route planner and the stale marks live in the game layer (not saved).
import { createNavigation } from '../navigation/state';
import type { NavigationState } from '../navigation/types';
import type { SavedNavigationV20 } from './types';

export function navigationToSave(n: NavigationState): SavedNavigationV20 {
  return { notes: n.notes.map((x) => ({ id: x.id, x: x.pos.x, y: x.pos.y, icon: x.icon, text: x.text })), nextNote: n.nextNote };
}

export function navigationFromSave(saved: SavedNavigationV20): NavigationState {
  return { notes: saved.notes.map((x) => ({ id: x.id, pos: { x: x.x, y: x.y }, icon: x.icon, text: x.text })), nextNote: saved.nextNote };
}

/** Navigation of a save before V20: no notes, ids from 1. */
export const legacyNavigation = (): SavedNavigationV20 => navigationToSave(createNavigation());

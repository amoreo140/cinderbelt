// Navigation in the simulation (M4d plan §2.8, §3): the player's map notes (Archive node
// "Map markers"). Saved from V20 (T15). The route planner and the stale marks live in the game layer (not saved).
import type { NoteIcon } from '../../data/navigation';
import type { Vec2 } from '../math/vec2';

export type { NoteIcon } from '../../data/navigation';

/** A map note: player text, shown as plain text, never as markup, never translated. */
export interface MapNote {
  id: number;
  pos: Vec2;
  icon: NoteIcon;
  /** ≤ NOTES.textMax characters, trimmed, control characters stripped. */
  text: string;
}

export interface NavigationState {
  notes: MapNote[];
  /** The next note id (ids are never reused). */
  nextNote: number;
}

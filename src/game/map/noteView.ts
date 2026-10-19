// Map notes as the map and the flight HUD show them (M4d "Map notes"): the sim's notes as
// views, whether the note tool is locked (Archive node `mapNotes` not bought), the notes near the ship
// for the flight edge arrows (user setting "Markers in flight"), and the editor's text check (the sim's
// cleaning rule, counted in characters). Player text stays plain text – never markup, never translated.
import { NOTES } from '../../data/navigation';
import type { Vec2 } from '../../sim/math/vec2';
import { hasFeature } from '../../sim/discovery/archive';
import { cleanNoteText } from '../../sim/navigation/notes';
import type { SimState } from '../../sim/Simulation';
import type { MapNoteView } from './types';

/** The notes of the save as map views (sorted by id, copies – the views never alias the sim). */
export function noteViews(state: Pick<SimState, 'navigation'>): MapNoteView[] {
  return [...state.navigation.notes]
    .sort((a, b) => a.id - b.id)
    .map((n) => ({ id: n.id, pos: { x: n.pos.x, y: n.pos.y }, icon: n.icon, text: n.text }));
}

/** The note tool is locked until the Archive node "Map markers" is bought. */
export const notesLocked = (state: SimState): boolean => !hasFeature(state, 'mapNotes');

/** Notes within `range` of the ship, nearest first (flight edge arrows; T9 / T11). */
export function notesNear(notes: readonly MapNoteView[], pos: Vec2, range: number = NOTES.flightRange): MapNoteView[] {
  const r2 = range * range;
  const d2 = (n: MapNoteView) => (n.pos.x - pos.x) ** 2 + (n.pos.y - pos.y) ** 2;
  return notes.filter((n) => d2(n) <= r2).sort((a, b) => d2(a) - d2(b));
}

/** The editor's check of a note text: the stored form, its length in characters and whether it can be saved. */
export function noteTextCheck(text: string): { clean: string; length: number; ok: boolean } {
  const clean = cleanNoteText(text);
  const length = [...clean].length;
  return { clean, length, ok: length >= 1 && length <= NOTES.textMax };
}

/** Cuts typed text to `NOTES.textMax` characters (code points, so an emoji is never split in half). */
export function clampNoteInput(text: string): string {
  const chars = [...text];
  return chars.length > NOTES.textMax ? chars.slice(0, NOTES.textMax).join('') : text;
}

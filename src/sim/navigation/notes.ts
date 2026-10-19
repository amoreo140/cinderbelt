// Map notes (M4d plan §2.8 "Map notes") – OWNED BY T8.
//
// Commands `mapNoteSet { id?; pos; icon; text }` (new or edit) and `mapNoteDelete { id }`, anywhere
// (docked or in flight); the Archive node `mapNotes` must be bought (`hasFeature(state, 'mapNotes')`, else
// `noMapNotes`); ≤ `NOTES.max` notes (`notesFull`, editing still works when full), text trimmed,
// control characters stripped, 1..`NOTES.textMax` characters (code points), a known icon and a finite
// position (`invalidNote`), an unknown id (`unknownNote`); ids are never reused (`nextNote` only grows).
// The text is player text: shown as plain text, never as markup, never translated – no escaping here.
import { NOTE_ICONS, NOTES, type NoteIcon } from '../../data/navigation';
import type { GameAction } from '../commands';
import { hasFeature } from '../discovery/archive';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import type { Vec2 } from '../math/vec2';

const NAVIGATION_ACTIONS = new Set<GameAction['type']>(['mapNoteSet', 'mapNoteDelete']);

export const isNavigationAction = (a: GameAction): boolean => NAVIGATION_ACTIONS.has(a.type);

// Line breaks and tabs become a space (two words stay two words); other control characters, including
// the bidirectional overrides / isolates (they could reorder the rest of a label), are removed.
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
const CONTROLS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

/** The stored form of a note text: control characters stripped, trimmed (may come out empty). */
export function cleanNoteText(text: string): string {
  return text.replace(BREAKS, ' ').replace(CONTROLS, '').trim();
}

const isIcon = (icon: unknown): icon is NoteIcon => NOTE_ICONS.includes(icon as NoteIcon);
const isPos = (pos: unknown): pos is Vec2 =>
  typeof pos === 'object' && pos !== null && Number.isFinite((pos as Vec2).x) && Number.isFinite((pos as Vec2).y);

/** A map note command. */
export function navigationAction(state: SimState, action: GameAction): SimEvent[] {
  const fail = (reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId: action.reqId, ok: false, reason }];
  const done: SimEvent[] = [{ type: 'actionResult', reqId: action.reqId, ok: true }];
  if (!hasFeature(state, 'mapNotes')) return fail('noMapNotes');
  const nav = state.navigation;

  if (action.type === 'mapNoteDelete') {
    const i = nav.notes.findIndex((n) => n.id === action.id);
    if (i < 0) return fail('unknownNote');
    nav.notes.splice(i, 1);
    return done;
  }
  if (action.type !== 'mapNoteSet') return fail('serviceUnavailable');

  const text = typeof action.text === 'string' ? cleanNoteText(action.text) : '';
  const length = [...text].length;
  if (length < 1 || length > NOTES.textMax || !isIcon(action.icon) || !isPos(action.pos)) return fail('invalidNote');
  const pos = { x: action.pos.x, y: action.pos.y };

  if (action.id !== undefined) {
    const note = nav.notes.find((n) => n.id === action.id);
    if (!note) return fail('unknownNote');
    note.pos = pos;
    note.icon = action.icon;
    note.text = text;
    return done;
  }
  if (nav.notes.length >= NOTES.max) return fail('notesFull');
  nav.notes.push({ id: nav.nextNote, pos, icon: action.icon, text });
  nav.nextNote += 1;
  return done;
}

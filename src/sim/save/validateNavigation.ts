// Validation of the map notes in save V20 (M4d "Guild and Trade") – the same style as validate.ts: a clean
// copy, errors with paths. A note is player text the game only ever stores cleaned, so a save holds
// exactly what `mapNoteSet` would store: at most `NOTES.max` notes, unique ids below `nextNote`, known
// icons, finite positions, a text of 1–`NOTES.textMax` code points that `cleanNoteText` leaves unchanged.
// Anything else is not a save of this game – rejected.
import { NOTE_ICONS, NOTES, type NoteIcon } from '../../data/navigation';
import { cleanNoteText } from '../navigation/notes';
import type { SavedMapNoteV20, SavedNavigationV20 } from './types';
import type { Checker } from './validate';

function note(c: Checker, v: unknown, path: string): SavedMapNoteV20 {
  const o = c.obj(v, path) ?? {};
  const text = c.str(o.text, `${path}.text`, true);
  const length = [...text].length;
  if (text && (cleanNoteText(text) !== text || length > NOTES.textMax)) c.err(`${path}.text`, `expected a cleaned text of 1–${NOTES.textMax} characters`);
  return {
    id: c.int(o.id, `${path}.id`, 1),
    x: c.num(o.x, `${path}.x`),
    y: c.num(o.y, `${path}.y`),
    icon: c.oneOf<NoteIcon>(o.icon, NOTE_ICONS, `${path}.icon`),
    text,
  };
}

/** Structure of `navigation` (V20). */
export function validateNavigationShape(c: Checker, raw: unknown, path: string): SavedNavigationV20 {
  const o = c.obj(raw, path) ?? {};
  const nextNote = c.int(o.nextNote, `${path}.nextNote`, 1);
  const list = c.arr(o.notes, `${path}.notes`) ?? [];
  if (list.length > NOTES.max) c.err(`${path}.notes`, `more than ${NOTES.max} notes`);
  const notes = list.map((x, i) => note(c, x, `${path}.notes[${i}]`));
  notes.forEach((n, i) => {
    if (n.id >= nextNote) c.err(`${path}.notes[${i}].id`, 'must be below nextNote');
  });
  if (new Set(notes.map((n) => n.id)).size !== notes.length) c.err(`${path}.notes`, 'duplicate ids');
  return { notes, nextNote };
}

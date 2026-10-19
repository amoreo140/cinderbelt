// M4d "Guild and trade" – navigation (M4d plan §2.8, §3):
// map notes (Archive node "Map markers", saved in the sim) and the stale marks of pirates and comets
// (game layer, session memory). The route planner needs no data of its own.

/** Icons of a map note. */
export type NoteIcon = 'star' | 'warning' | 'ore' | 'pirate' | 'flag';
export const NOTE_ICONS: readonly NoteIcon[] = ['star', 'warning', 'ore', 'pirate', 'flag'];

export const NOTES = {
  /** At most this many notes. */
  max: 30,
  /** Note text length (characters, after trimming and stripping control characters). */
  textMax: 40,
  /** In flight, notes within this distance show as edge arrows (u). */
  flightRange: 3000,
} as const;

export const STALE = {
  /** A stale mark fades out and is removed after this many seconds. */
  fadeSeconds: 600,
  /** Alpha of a mark at the end of its life. */
  minAlpha: 0.25,
} as const;

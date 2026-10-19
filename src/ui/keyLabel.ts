// Splits a text like "F – land…" / "W / S – thrust…" into the keys and a description so that the keys can be drawn as keycaps.

export interface KeyLabel {
  keys: string[];
  text: string;
}

const SEP = ' – ';
/** A key is a short token (a letter, Esc, 1–5…) – not a whole sentence. */
const KEY_TOKEN = /^[A-Za-zÁ-ž0-9–+]{1,9}$/;

export function splitKeyLabel(line: string): KeyLabel | null {
  const i = line.indexOf(SEP);
  if (i <= 0) return null;
  const head = line.slice(0, i).trim();
  const text = line.slice(i + SEP.length).trim();
  const keys = head.split(' / ').map((k) => k.trim());
  if (keys.length === 0 || !text) return null;
  return { keys, text };
}

/** Like splitKeyLabel, but only when all the keys are short tokens (otherwise null). */
export function splitShortKeyLabel(line: string): KeyLabel | null {
  const parsed = splitKeyLabel(line);
  return parsed && parsed.keys.every((k) => KEY_TOKEN.test(k)) ? parsed : null;
}

/** "1–5 tabs · F depart · Esc back" → [{keys:['1–5'], text:'tabs'}, …]. */
export function splitKeyList(line: string): KeyLabel[] {
  return line
    .split(' · ')
    .map((part) => {
      const space = part.indexOf(' ');
      return space > 0 ? { keys: [part.slice(0, space)], text: part.slice(space + 1) } : { keys: [part], text: '' };
    });
}

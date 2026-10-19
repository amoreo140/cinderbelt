// Shipyard palette keys: the first row 1–9, the second row Shift + 1–9 (cannon, shield and further parts).

/** The key for the nth palette part (from 1), or null if the keys do not suffice. */
export function hotkeyLabel(n: number): { shift: boolean; digit: number } | null {
  if (n < 1 || n > 18 || !Number.isInteger(n)) return null;
  return n <= 9 ? { shift: false, digit: n } : { shift: true, digit: n - 9 };
}

/** The palette position (from 1) for a pressed digit 1–9. */
export const hotkeyNumber = (digit: number, shift: boolean): number => (shift ? digit + 9 : digit);

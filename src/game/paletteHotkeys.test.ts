import { describe, expect, it } from 'vitest';
import { hotkeyLabel, hotkeyNumber } from './paletteHotkeys';

describe('palette hotkeys', () => {
  it('uses 1–9 for the first row and Shift + 1–9 for the second', () => {
    expect(hotkeyLabel(1)).toEqual({ shift: false, digit: 1 });
    expect(hotkeyLabel(9)).toEqual({ shift: false, digit: 9 });
    expect(hotkeyLabel(10)).toEqual({ shift: true, digit: 1 });
    expect(hotkeyLabel(11)).toEqual({ shift: true, digit: 2 });
    expect(hotkeyLabel(18)).toEqual({ shift: true, digit: 9 });
    expect(hotkeyLabel(19)).toBeNull();
    expect(hotkeyLabel(0)).toBeNull();
  });

  it('maps a pressed digit back to the palette position', () => {
    expect(hotkeyNumber(3, false)).toBe(3);
    expect(hotkeyNumber(1, true)).toBe(10);
    expect(hotkeyNumber(2, true)).toBe(11);
  });
});

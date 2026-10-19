import { describe, expect, it } from 'vitest';
import { wrapAround } from './wrap';

describe('wrapAround', () => {
  it('keeps values inside the window', () => {
    expect(wrapAround(0, 0, 10)).toBe(0);
    expect(wrapAround(6, 0, 10)).toBe(-4);
    expect(wrapAround(-6, 0, 10)).toBe(4);
  });

  it('follows the center', () => {
    expect(wrapAround(1, 100, 10)).toBe(101);
  });
});

import { describe, expect, it } from 'vitest';
import { cellsText, rollCells, rollDir, type OdoCell } from './odometerMath';

const rolled = (cells: OdoCell[]) => cells.filter((c) => c.from !== null).map((c) => `${c.from}>${c.ch}`);

describe('odometer digit roll', () => {
  it('first render: every character in place, nothing rolls', () => {
    const cells = rollCells(null, '1 240', 0, null);
    expect(cellsText(cells)).toBe('1 240');
    expect(cells.every((c) => c.from === null && c.dir === null)).toBe(true);
    expect(cells.map((c) => c.pos)).toEqual([4, 3, 2, 1, 0]);
  });

  it('only the changed digits roll, in the direction of the change', () => {
    const a = rollCells(null, '1 240', 0, null);
    const b = rollCells(a, '1 275', 1, 'up');
    expect(cellsText(b)).toBe('1 275');
    expect(rolled(b)).toEqual(['4>7', '0>5']);
    expect(b.filter((c) => c.from !== null).every((c) => c.dir === 'up' && c.gen === 1)).toBe(true);
  });

  it('unchanged positions keep their cell object (no remount, no restarted animation)', () => {
    const a = rollCells(null, '1 240', 0, null);
    const b = rollCells(a, '1 241', 1, 'up');
    expect(b[0]).toBe(a[0]);
    expect(b[3]).toBe(a[3]);
    expect(b[4]).not.toBe(a[4]);
    // a later change that leaves the last digit alone keeps the cell of the earlier roll
    const c = rollCells(b, '1 341', 2, 'up');
    expect(c[4]).toBe(b[4]);
    expect(c[4]!.gen).toBe(1);
    expect(c[2]!.gen).toBe(2);
  });

  it('aligns from the right: a longer number rolls a new leading digit in from empty', () => {
    const a = rollCells(null, '999', 0, null);
    const b = rollCells(a, '1 000', 1, 'up');
    expect(cellsText(b)).toBe('1 000');
    expect(rolled(b)).toEqual(['>1', '> ', '9>0', '9>0', '9>0']);
    expect(b.map((c) => c.pos)).toEqual([4, 3, 2, 1, 0]);
  });

  it('a shorter number drops the leading positions and rolls the rest down', () => {
    const a = rollCells(null, '1 000', 0, null);
    const b = rollCells(a, '950', 1, 'down');
    expect(cellsText(b)).toBe('950');
    expect(rolled(b)).toEqual(['0>9', '0>5']);
    expect(b[2]).toBe(a[4]);
    expect(b.filter((c) => c.from !== null).every((c) => c.dir === 'down')).toBe(true);
  });

  it('the same text returns cells equal to the previous ones', () => {
    const a = rollCells(null, '128 450', 0, null);
    const b = rollCells(a, '128 450', 1, null);
    expect(b).toEqual(a);
    b.forEach((c, i) => expect(c).toBe(a[i]));
  });

  it('direction of a change', () => {
    expect(rollDir(250, 300)).toBe('up');
    expect(rollDir(300, 250)).toBe('down');
    expect(rollDir(250, 250)).toBeNull();
  });
});

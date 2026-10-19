import { describe, expect, it } from 'vitest';
import { clearList, truncateList } from './scratch';

describe('scratch lists', () => {
  it('empty and shorten a list in place', () => {
    const list = [1, 2, 3, 4, 5];
    truncateList(list, 2);
    expect(list).toEqual([1, 2]);
    truncateList(list, 5);
    expect(list).toEqual([1, 2]);
    expect(clearList(list)).toBe(list);
    expect(list).toEqual([]);
    list.push(9);
    expect(list).toEqual([9]);
  });
});

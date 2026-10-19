import { describe, expect, it } from 'vitest';
import { STALE } from '../../data/navigation';
import { LastSeen, pirateGroup, pirateSightings, staleAlpha } from './lastSeen';

const MIN = 60 * 60;

describe('LastSeen', () => {
  it('draws no mark while a thing is in sight, a mark at its last position once it is gone', () => {
    const ls = new LastSeen();
    ls.update([{ key: 'pirates:pr:1,1', kind: 'pirates', pos: { x: 10, y: 20 } }], 100);
    expect(ls.marks(100)).toEqual([]);
    ls.update([{ key: 'pirates:pr:1,1', kind: 'pirates', pos: { x: 15, y: 25 } }], 160);
    ls.update([], 220);
    const [m] = ls.marks(220 + 3 * MIN);
    expect(m).toMatchObject({ kind: 'pirates', pos: { x: 15, y: 25 } });
    expect(m!.ageSeconds).toBeCloseTo(181, 6);
  });

  it('fades 1 → minAlpha over the fade time and removes the mark after it', () => {
    expect(staleAlpha(0)).toBe(1);
    expect(staleAlpha(STALE.fadeSeconds / 2)).toBeCloseTo((1 + STALE.minAlpha) / 2, 9);
    expect(staleAlpha(STALE.fadeSeconds)).toBeCloseTo(STALE.minAlpha, 9);
    const ls = new LastSeen();
    ls.update([{ key: 'comet:cm:2', kind: 'comet', pos: { x: 0, y: 0 } }], 0);
    ls.update([], 1);
    expect(ls.marks(5 * MIN)[0]!.alpha).toBeCloseTo(staleAlpha(5 * 60), 2);
    expect(ls.marks(STALE.fadeSeconds * 60 + 60)).toEqual([]);
    ls.update([], STALE.fadeSeconds * 60 + 60);
    expect(ls.size).toBe(0);
  });

  it('a thing seen again is live again (its mark goes), and clear() forgets everything', () => {
    const ls = new LastSeen();
    ls.update([{ key: 'a', kind: 'pirates', pos: { x: 0, y: 0 } }], 0);
    ls.update([], 60);
    expect(ls.marks(120)).toHaveLength(1);
    ls.update([{ key: 'a', kind: 'pirates', pos: { x: 5, y: 0 } }], 180);
    expect(ls.marks(180)).toEqual([]);
    ls.update([], 240);
    ls.clear();
    expect(ls.marks(300)).toEqual([]);
    expect(ls.size).toBe(0);
  });
});

describe('pirateSightings', () => {
  it('groups enemies by spawn group within the radar range, at the group centre', () => {
    expect(pirateGroup('pr:3,-2:1')).toBe('pr:3,-2');
    expect(pirateGroup('hp:12:0')).toBe('hp:12');
    expect(pirateGroup('zb:4,1')).toBe('zb:4,1');
    expect(pirateGroup('rf:7')).toBe('rf:7');
    const s = pirateSightings(
      [
        { id: 'pr:1,1:0', pos: { x: 100, y: 0 } },
        { id: 'pr:1,1:1', pos: { x: 120, y: 20 } },
        { id: 'hp:4:0', pos: { x: -50, y: 0 } },
        { id: 'pr:9,9:0', pos: { x: 5000, y: 0 } },
      ],
      { x: 0, y: 0 },
      800,
    );
    expect(s).toEqual([
      { key: 'pirates:pr:1,1', kind: 'pirates', pos: { x: 110, y: 10 } },
      { key: 'pirates:hp:4', kind: 'pirates', pos: { x: -50, y: 0 } },
    ]);
  });
});

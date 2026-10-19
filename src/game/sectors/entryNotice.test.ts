import { describe, expect, it } from 'vitest';
import { EntryMemory, followSector, SECTOR_HYSTERESIS, TONE_INTERVAL } from './entryNotice';

// a straight border at x = 0: A west of it, B east
const regionAt = (x: number): string => (x < 0 ? 'A' : 'B');

describe('sector hysteresis', () => {
  it('starts in the sector of the point', () => {
    expect(followSector(regionAt, null, { x: 5, y: 0 })).toBe('B');
  });

  it('switches only once the ship is the margin past the border', () => {
    let cur = followSector(regionAt, null, { x: -100, y: 0 });
    for (const x of [-10, 0, 5, SECTOR_HYSTERESIS - 1]) {
      cur = followSector(regionAt, cur, { x, y: 0 });
      expect(cur, `x ${x}`).toBe('A');
    }
    cur = followSector(regionAt, cur, { x: SECTOR_HYSTERESIS + 1, y: 0 });
    expect(cur).toBe('B');
    // and back: wiggling a little across the line keeps B
    for (const x of [10, -5, -20, 4]) {
      cur = followSector(regionAt, cur, { x, y: 0 });
      expect(cur, `x ${x}`).toBe('B');
    }
    expect(followSector(regionAt, cur, { x: -SECTOR_HYSTERESIS - 1, y: 0 })).toBe('A');
  });
});

describe('entry notice throttling', () => {
  it('a full notice on the first visit, then tones at most once per interval', () => {
    const m = new EntryMemory();
    expect(m.enter('A', 'guarded', 0)).toBe('notice');
    expect(m.enter('B', 'contested', 5)).toBe('notice');
    // back into A soon after a notice: badge only
    expect(m.enter('A', 'guarded', 8)).toBe('none');
    expect(m.enter('B', 'contested', 5 + TONE_INTERVAL)).toBe('tone');
    expect(m.enter('A', 'guarded', 5 + TONE_INTERVAL + 3)).toBe('none');
    expect(m.enter('B', 'contested', 5 + 2 * TONE_INTERVAL + 1)).toBe('tone');
  });

  it('a full notice again when the security changed since the last visit', () => {
    const m = new EntryMemory();
    m.enter('F', 'pirate', 0);
    expect(m.enter('F', 'pirate', 100)).toBe('tone');
    expect(m.enter('F', 'contested', 200)).toBe('notice');
    expect(m.enter('F', 'contested', 300)).toBe('tone');
  });

  it('primed and silently reached sectors never give a notice', () => {
    const m = new EntryMemory();
    m.prime([
      ['A', 'guarded'],
      ['B', 'quiet'],
    ]);
    m.arrive('C', 'contested');
    expect(m.enter('A', 'guarded', 50)).toBe('tone');
    expect(m.enter('B', 'quiet', 51)).toBe('none');
    expect(m.enter('C', 'contested', 52)).toBe('none');
    expect(m.hasVisited('D')).toBe(false);
    expect(m.enter('D', 'pirate', 53)).toBe('notice');
  });
});

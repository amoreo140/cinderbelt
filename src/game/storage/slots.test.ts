import { describe, expect, it } from 'vitest';
import { compareSlots, nextFreeSlot, parseSlotKey, slotKey, SLOTS_PER_DIFFICULTY, slotsByDifficulty } from './slots';

describe('slot keys', () => {
  it('round-trips a slot reference', () => {
    expect(slotKey({ difficulty: 'hardcore', index: 3 })).toBe('hardcore/3');
    expect(parseSlotKey('hard/7')).toEqual({ difficulty: 'hard', index: 7 });
    expect(parseSlotKey('easy/1')).toBeNull();
    expect(parseSlotKey('mild/-1')).toBeNull();
    expect(parseSlotKey('mild/x')).toBeNull();
  });
});

describe('nextFreeSlot', () => {
  const used = (difficulty: 'none' | 'mild' | 'hard' | 'hardcore', ...indices: number[]) => indices.map((index) => ({ difficulty, index }));

  it('has four slots per difficulty', () => {
    expect(SLOTS_PER_DIFFICULTY).toBe(4);
  });

  it('picks the lowest free index of the difficulty', () => {
    expect(nextFreeSlot([], 'mild')).toEqual({ difficulty: 'mild', index: 0 });
    expect(nextFreeSlot([...used('mild', 0, 2), ...used('none', 1)], 'mild')).toEqual({ difficulty: 'mild', index: 1 });
  });

  it('returns null for a new game when the difficulty is full', () => {
    expect(nextFreeSlot(used('hard', 0, 1, 2, 3), 'hard')).toBeNull();
  });

  it('always finds a slot for a game that fell from hardcore (limit ignored)', () => {
    expect(nextFreeSlot(used('hard', 0, 1, 2, 3), 'hard', { ignoreLimit: true })).toEqual({ difficulty: 'hard', index: 4 });
    expect(nextFreeSlot(used('hard', 0, 1, 2, 3, 4), 'hard', { ignoreLimit: true })).toEqual({ difficulty: 'hard', index: 5 });
  });
});

describe('grouping', () => {
  it('orders slots by difficulty, then index', () => {
    const slots = [
      { difficulty: 'hardcore' as const, index: 0 },
      { difficulty: 'none' as const, index: 2 },
      { difficulty: 'none' as const, index: 0 },
      { difficulty: 'hard' as const, index: 5 },
    ];
    expect([...slots].sort(compareSlots).map(slotKey)).toEqual(['none/0', 'none/2', 'hard/5', 'hardcore/0']);
  });

  it('groups items with a slot by difficulty, all four groups present', () => {
    const items = [{ slot: { difficulty: 'hard' as const, index: 1 } }, { slot: { difficulty: 'hard' as const, index: 0 } }];
    const groups = slotsByDifficulty(items);
    expect(Object.keys(groups)).toEqual(['none', 'mild', 'hard', 'hardcore']);
    expect(groups.hard.map((i) => i.slot.index)).toEqual([0, 1]);
    expect(groups.none).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { skPlural as plural } from '../../i18n/plural';
import type { SlotMeta } from '../../sim/save/meta';
import type { SlotRef } from '../../sim/save/types';
import type { SlotOverview } from './saveService';
import {
  continueTarget,
  defaultNewGameSlot,
  formatElapsed,
  formatPlayTime,
  formatSavedAt,
  newGameSlots,
  slotColumns,
  slotWritable,
} from './slotView';

function meta(slot: SlotRef, savedAt: string, extra: Partial<SlotMeta> = {}): SlotMeta {
  return {
    slot,
    gameId: `g-${slot.difficulty}-${slot.index}`,
    name: 'hra',
    version: 1,
    createdAt: savedAt,
    savedAt,
    saveReason: 'manual',
    playTimeTicks: 0,
    seed: 1,
    seedText: '1',
    deathPenalty: slot.difficulty,
    enemyDensity: 'normal',
    miningYield: 1,
    fallenFromHardcore: false,
    credits: 250,
    location: { kind: 'docked', stationId: 'home', ring: 1 },
    partCount: 7,
    hasBackup: false,
    ...extra,
  };
}

const ok = (slot: SlotRef, savedAt: string): SlotOverview => ({ slot, state: { kind: 'ok', meta: meta(slot, savedAt) } });
const corrupt = (slot: SlotRef): SlotOverview => ({
  slot,
  state: { kind: 'corrupt', meta: meta(slot, '2026-10-15T09:00:00.000Z'), error: 'checksum', details: [], backup: null },
});
const tooNew = (slot: SlotRef): SlotOverview => ({ slot, state: { kind: 'tooNew', meta: null, version: 9 } });

describe('slot columns', () => {
  it('always shows four slots per difficulty, empty ones as null', () => {
    const cols = slotColumns([ok({ difficulty: 'mild', index: 2 }, '2026-10-15T10:00:00.000Z')]);
    expect(Object.keys(cols)).toEqual(['none', 'mild', 'hard', 'hardcore']);
    for (const d of ['none', 'mild', 'hard', 'hardcore'] as const) {
      expect(cols[d].map((c) => c.slot)).toEqual([0, 1, 2, 3].map((index) => ({ difficulty: d, index })));
    }
    expect(cols.mild.map((c) => c.state?.kind ?? null)).toEqual([null, null, 'ok', null]);
  });

  it('appends fallen hardcore games beyond the fourth slot in order', () => {
    const cols = slotColumns([ok({ difficulty: 'hard', index: 6 }, 'b'), ok({ difficulty: 'hard', index: 4 }, 'a')]);
    expect(cols.hard.map((c) => c.slot.index)).toEqual([0, 1, 2, 3, 4, 6]);
    expect(newGameSlots([ok({ difficulty: 'hard', index: 4 }, 'a')], 'hard')).toHaveLength(4);
  });
});

describe('new game slot', () => {
  it('defaults to the first empty slot', () => {
    const cells = newGameSlots([ok({ difficulty: 'none', index: 0 }, 'x'), ok({ difficulty: 'none', index: 2 }, 'y')], 'none');
    expect(defaultNewGameSlot(cells)).toEqual({ difficulty: 'none', index: 1 });
  });

  it('when full, proposes overwriting the least recently saved writable slot', () => {
    const d = 'hardcore' as const;
    const cells = newGameSlots(
      [
        tooNew({ difficulty: d, index: 0 }),
        ok({ difficulty: d, index: 1 }, '2026-10-15T12:00:00.000Z'),
        ok({ difficulty: d, index: 2 }, '2026-10-14T12:00:00.000Z'),
        corrupt({ difficulty: d, index: 3 }),
      ],
      d,
    );
    expect(slotWritable(cells[0]!)).toBe(false);
    expect(defaultNewGameSlot(cells)).toEqual({ difficulty: d, index: 2 });
  });

  it('returns null when no slot can take a new game', () => {
    const d = 'mild' as const;
    const cells = newGameSlots([0, 1, 2, 3].map((index) => tooNew({ difficulty: d, index })), d);
    expect(defaultNewGameSlot(cells)).toBeNull();
  });
});

describe('continue', () => {
  it('picks the most recent loadable game and skips damaged ones', () => {
    const target = continueTarget([
      ok({ difficulty: 'none', index: 0 }, '2026-10-14T12:00:00.000Z'),
      corrupt({ difficulty: 'mild', index: 0 }),
      ok({ difficulty: 'hard', index: 1 }, '2026-10-15T08:00:00.000Z'),
      tooNew({ difficulty: 'hardcore', index: 0 }),
    ]);
    expect(target?.slot).toEqual({ difficulty: 'hard', index: 1 });
    expect(continueTarget([corrupt({ difficulty: 'mild', index: 0 })])).toBeNull();
    expect(continueTarget([])).toBeNull();
  });
});

describe('formatting', () => {
  it('play time', () => {
    expect(formatPlayTime(0)).toBe('< 1 min');
    expect(formatPlayTime(60 * 60 * 42)).toBe('42 min');
    expect(formatPlayTime(60 * 60 * 102)).toBe('1:42 h');
    expect(formatPlayTime(60 * 60 * 60 * 12 + 60 * 60 * 5)).toBe('12:05 h');
  });

  it('saved-at relative to today', () => {
    const words = { today: 'dnes', yesterday: 'včera' };
    const now = new Date(2026, 9, 15, 18, 0);
    expect(formatSavedAt(new Date(2026, 9, 15, 14, 32).toISOString(), now, words)).toBe('dnes 14:32');
    expect(formatSavedAt(new Date(2026, 9, 14, 22, 5).toISOString(), now, words)).toBe('včera 22:05');
    expect(formatSavedAt(new Date(2026, 8, 2, 9, 7).toISOString(), now, words)).toBe('2. 9. 2026 9:07');
    expect(formatSavedAt('nonsense', now, words)).toBe('nonsense');
    // yesterday across a month boundary
    expect(formatSavedAt(new Date(2026, 9, 31, 23, 0).toISOString(), new Date(2026, 10, 1, 1, 0), words)).toBe('včera 23:00');
  });

  it('elapsed since the last save', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(72_000)).toBe('1:12');
    expect(formatElapsed(3_900_000)).toBe('1 h 05 min');
  });

  it('Slovak plural forms', () => {
    expect([0, 1, 2, 4, 5, 18].map((n) => plural(n, 'diel', 'diely', 'dielov'))).toEqual(['dielov', 'diel', 'diely', 'diely', 'dielov', 'dielov']);
  });
});

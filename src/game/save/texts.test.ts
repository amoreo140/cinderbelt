import { describe, expect, it } from 'vitest';
import { sk } from '../../i18n/sk';
import { SAVE_REASONS } from '../../sim/save/types';
import { DEATH_PENALTIES } from '../../sim/settings';

describe('save texts', () => {
  it('names every difficulty and save reason', () => {
    expect(Object.keys(sk.saves.difficulties)).toEqual([...DEATH_PENALTIES]);
    expect(Object.keys(sk.saves.difficultyHints)).toEqual([...DEATH_PENALTIES]);
    expect(Object.keys(sk.saves.reasons)).toEqual([...SAVE_REASONS]);
  });

  it('explains every load error', () => {
    expect(Object.keys(sk.saves.loadErrors).sort()).toEqual(
      ['backupNotAllowed', 'checksum', 'empty', 'format', 'invalid', 'migration', 'parse', 'tooNew'].sort(),
    );
  });
});

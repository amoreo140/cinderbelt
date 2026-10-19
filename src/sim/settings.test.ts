import { describe, expect, it } from 'vitest';
import { fnv1a32 } from './math/fnv1a';
import { DEFAULT_SETTINGS, DIFFICULTY_PRESETS, matchingPreset, seedFromText } from './settings';

describe('seedFromText', () => {
  it('uses a purely numeric text directly (M1 compatibility)', () => {
    expect(seedFromText('1337')).toBe(1337);
    expect(seedFromText(' 42 ')).toBe(42);
    expect(seedFromText('4294967295')).toBe(4294967295);
  });

  it('hashes any other text with FNV-1a', () => {
    expect(seedFromText('hviezdny-prach-42')).toBe(fnv1a32('hviezdny-prach-42'));
    expect(seedFromText('4294967296')).toBe(fnv1a32('4294967296'));
    expect(seedFromText('-5')).toBe(fnv1a32('-5'));
  });
});

describe('difficulty presets', () => {
  it('maps the four presets to the spec table', () => {
    expect(DIFFICULTY_PRESETS.calm).toEqual({ deathPenalty: 'none', enemyDensity: 'low', miningYield: 2 });
    expect(DIFFICULTY_PRESETS.standard).toEqual({ deathPenalty: 'mild', enemyDensity: 'normal', miningYield: 1 });
    expect(DIFFICULTY_PRESETS.hard).toEqual({ deathPenalty: 'hard', enemyDensity: 'high', miningYield: 1 });
    expect(DIFFICULTY_PRESETS.hardcore).toEqual({ deathPenalty: 'hardcore', enemyDensity: 'high', miningYield: 1 });
  });

  it('recognises a preset or reports a custom combination', () => {
    expect(matchingPreset(DIFFICULTY_PRESETS.hard)).toBe('hard');
    expect(matchingPreset({ deathPenalty: 'hard', enemyDensity: 'low', miningYield: 1 })).toBeNull();
  });

  it('defaults to the standard preset', () => {
    expect(DEFAULT_SETTINGS).toEqual({ seedText: '', ...DIFFICULTY_PRESETS.standard, fallenFromHardcore: false });
  });
});

import { describe, expect, it } from 'vitest';
import { NEW_BADGE_SECONDS, NewBadges } from './newBadges';
import type { UiFeature } from './reveal';

const set = (...f: UiFeature[]): ReadonlySet<UiFeature> => new Set(f);

describe('NewBadges', () => {
  it('does not badge what was there at the first update', () => {
    const b = new NewBadges();
    b.update(set('hull'), 0);
    expect(b.isNew('hull', 1)).toBe(false);
  });

  it('badges a later addition for NEW_BADGE_SECONDS', () => {
    const b = new NewBadges();
    b.update(set('hull'), 0);
    b.update(set('hull', 'radar'), 10);
    expect(b.isNew('radar', 11)).toBe(true);
    expect(b.isNew('radar', 10 + NEW_BADGE_SECONDS)).toBe(false);
    expect(b.isNew('hull', 11)).toBe(false);
  });

  it('used() clears the badge', () => {
    const b = new NewBadges();
    b.update(set('hull'), 0);
    b.update(set('hull', 'radar'), 10);
    b.used('radar');
    expect(b.isNew('radar', 11)).toBe(false);
  });

  it('ignores the same set instance', () => {
    const b = new NewBadges();
    const s = set('hull');
    b.update(s, 0);
    b.update(s, 5);
    expect(b.isNew('hull', 6)).toBe(false);
  });

  it('never badges a feature twice', () => {
    const b = new NewBadges();
    b.update(set('hull'), 0);
    b.update(set('hull', 'radar'), 10);
    b.update(set('hull'), 12);
    b.update(set('hull', 'radar'), 20);
    expect(b.isNew('radar', 21)).toBe(false);
  });
});

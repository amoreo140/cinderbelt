import { describe, expect, it } from 'vitest';
import '../../i18n/allTexts';
import { setLocale } from '../../i18n';
import { tabBadge } from './StationHub';

describe('tabBadge', () => {
  const badges = { jobs: 2, market: true, shipyard: false };

  it('Jobs shows a count, Market and Shipyard a dot – only when there is something to do', async () => {
    await setLocale('en');
    expect(tabBadge('board', badges)).toEqual({ count: 2, label: '2 contracts ready to turn in' });
    expect(tabBadge('market', badges)).toMatchObject({ label: expect.any(String) });
    expect(tabBadge('market', badges)?.count).toBeUndefined();
    expect(tabBadge('shipyard', badges)).toBeUndefined();
    expect(tabBadge('board', { ...badges, jobs: 0 })).toBeUndefined();
    expect(tabBadge('overview', badges)).toBeUndefined();
    expect(tabBadge('board', undefined)).toBeUndefined();
  });

  it('the tooltip is localised and counts in the singular', async () => {
    await setLocale('en');
    expect(tabBadge('board', { ...badges, jobs: 1 })?.label).toBe('1 contract ready to turn in');
    await setLocale('sk');
    expect(tabBadge('board', { ...badges, jobs: 3 })?.label).toBe('3 zákazky na odovzdanie');
  });
});

describe('showWelcome', () => {
  it('names the home station, so it shows only there and only until the first undocking', async () => {
    const { showWelcome } = await import('./StationHub');
    const { homeStation } = await import('../../sim/world/stations');
    const home = homeStation();
    expect(showWelcome({ welcome: true }, home)).toBe(true);
    expect(showWelcome({ welcome: false }, home)).toBe(false);
    expect(showWelcome({ welcome: true }, { ...home, id: 'other' as typeof home.id })).toBe(false);
  });
});

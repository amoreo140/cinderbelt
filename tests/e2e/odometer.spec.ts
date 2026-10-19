import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// M4a T7: the credits Odometer. Selling the full cargo (fixture `cargo-full`) rolls only the changed
// digits of the hub credits in one clamp step, the chip keeps its width while they roll, the text is
// always the final value; reduced motion = no animation. Screenshots in SK and EN (slowed down so the
// roll is visible in a still), then the HUD shows the same value after undocking.

const OUT = (name: string) => `${test.info().project.outputDir}/${name}`;

/** Slows the clamp step so a screenshot catches the digits mid-roll. */
async function slowClamp(page: Page): Promise<void> {
  await page.addStyleTag({ content: ':root { --af-dur-clamp: 4000ms !important; }' });
}

async function sellAndCheck(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadFixture(page, 'cargo-full', { ticks: 30 });
  const credits = page.getByTestId('hub-credits');
  await expect(credits).toBeVisible();
  const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
  const unit = lang === 'sk' ? 'kr' : 'cr';
  const fmt = (n: number) => new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-US').format(Math.round(n));
  await expect(credits).toHaveText(`${fmt(before)} ${unit}`);
  // idle: nothing rolls
  expect(await credits.locator('.af-odo-ch[data-from]').count()).toBe(0);
  await credits.screenshot({ path: OUT(`odometer-${lang}-before.png`) });
  const idleBox = await credits.boundingBox();

  await slowClamp(page);
  await page.getByTestId('sell-all').click();
  await page.waitForFunction((b) => window.__cinder!.sim.state.credits > b, before);
  const after = await page.evaluate(() => window.__cinder!.sim.state.credits);
  // the text is the final value at once (the old digits are not in the text)
  await expect(credits).toHaveText(`${fmt(after)} ${unit}`);
  const rolling = credits.locator('.af-odo-ch[data-from]');
  expect(await rolling.count()).toBeGreaterThan(0);
  expect(await rolling.first().getAttribute('data-dir')).toBe('up');
  // only the changed positions roll
  const shown = fmt(after);
  const was = fmt(before).padStart(shown.length, ' ');
  const changed = [...shown].filter((ch, i) => was[i] !== ch).length;
  expect(await rolling.count()).toBe(changed);
  await page.waitForTimeout(1900);
  const midBox = await credits.boundingBox();
  // the chip first (fast), then the whole hub (WebGL in software takes a while)
  await credits.screenshot({ path: OUT(`odometer-${lang}-rolling.png`) });
  await page.screenshot({ path: OUT(`odometer-${lang}-hub-rolling.png`) });
  await page.waitForTimeout(4000);
  const endBox = await credits.boundingBox();
  // no layout shift while the digits roll (same number of characters → the same width)
  if (fmt(before).length === shown.length) expect(Math.abs(midBox!.width - idleBox!.width)).toBeLessThan(1.5);
  expect(Math.abs(midBox!.width - endBox!.width)).toBeLessThan(0.5);
  await credits.screenshot({ path: OUT(`odometer-${lang}-after.png`) });

  // the flight HUD shows the same credits through the same component
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await expect(page.getByTestId('hud-credits')).toHaveText(`${fmt(after)} ${unit}`);
  await page.screenshot({ path: OUT(`odometer-${lang}-hud.png`) });
  expect(errors).toEqual([]);
}

test('odometer: selling the cargo rolls the hub credits (SK)', async ({ page }) => {
  test.setTimeout(120_000);
  await sellAndCheck(page, 'sk');
});

test.describe('English', () => {
  test.use({ firstLaunchLanguage: 'en' });
  test('odometer: selling the cargo rolls the hub credits (EN)', async ({ page }) => {
    test.setTimeout(120_000);
    await sellAndCheck(page, 'en');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('odometer: reduced motion shows the new value without animation', async ({ page }) => {
    test.setTimeout(120_000);
    await loadFixture(page, 'cargo-full', { ticks: 30 });
    const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
    await page.getByTestId('sell-all').click();
    await page.waitForFunction((b) => window.__cinder!.sim.state.credits > b, before);
    const ch = page.getByTestId('hub-credits').locator('.af-odo-ch[data-from]').first();
    await expect(ch).toBeAttached();
    expect(await ch.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await ch.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });
});

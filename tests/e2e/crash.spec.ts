import { expect, test } from './test';
import type { Page } from '@playwright/test';

// A throw in the frame loop must stop at a card (issue #3), not freeze the picture silently.

async function startSavedGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-calm').click();
  await page.getByTestId('seed-input').fill('crash-test-1');
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 60_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

/** Makes the next call of a method on the live game objects throw. */
async function breakGame(page: Page, where: 'render' | 'step'): Promise<void> {
  await page.evaluate((w) => {
    const game = (window as unknown as { __cinderApp: { currentGame: Record<string, any> } }).__cinderApp.currentGame;
    const target = w === 'render' ? game.renderer : game.loop;
    const name = w === 'render' ? 'render' : 'advance';
    target[name] = () => {
      throw new Error(`injected ${w} failure`);
    };
  }, where);
}

test.describe('frame loop crash card', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('a render error saves the game, shows the card and Back to menu works', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await startSavedGame(page);
    await page.evaluate(() => {
      window.__cinder!.sim.state.credits = 4321;
    });
    await breakGame(page, 'render');
    await expect(page.getByTestId('crash-card')).toBeVisible();
    await expect(page.getByTestId('crash-save')).toHaveAttribute('data-state', 'saved');
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: 'test-results/crash-en-1280.png' });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: 'test-results/crash-en-1920.png' });

    // Esc and the pause key do not close it
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('crash-card')).toBeVisible();
    await expect(page.getByTestId('pause-menu')).toHaveCount(0);

    await page.getByTestId('crash-copy').click();
    await expect(page.getByTestId('crash-copy')).toHaveText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('injected render failure');
    expect(clip).toContain('Cinderbelt');

    await page.getByTestId('crash-menu').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('crash-card')).toHaveCount(0);

    // the slot loads again and holds the state saved at the crash
    await page.getByTestId('menu-continue').click();
    await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 60_000 });
    expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(4321);
  });

  test('a simulation error keeps the last save', async ({ page }) => {
    test.setTimeout(120_000);
    await startSavedGame(page);
    await breakGame(page, 'step');
    await expect(page.getByTestId('crash-card')).toBeVisible();
    await expect(page.getByTestId('crash-save')).toHaveAttribute('data-state', 'kept');
    await expect(page.getByTestId('crash-save')).toContainText('last save is kept');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/crash-en-kept.png' });
    await page.getByTestId('crash-menu').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });
});

test('the card speaks Slovak by default', async ({ page }) => {
  test.setTimeout(120_000);
  await startSavedGame(page);
  await breakGame(page, 'render');
  await expect(page.getByTestId('crash-card')).toBeVisible();
  await expect(page.getByTestId('crash-card')).toContainText('Hra sa zastavila');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/crash-sk-1280.png' });
});

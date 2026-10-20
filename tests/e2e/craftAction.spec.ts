import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Crafting tab: the craft action (count stepper + "Craft") stays pinned at the bottom of the detail
// plate while the detail body (part info, requirements, facts) scrolls above it – at 1280×720, at
// 1920×1080 and at a small height. Screenshots go to the test output dir (craft-action-*.png).

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

async function start(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

/** The craft button and the stepper lie fully inside the viewport and inside the detail plate. */
async function expectActionVisible(page: Page): Promise<void> {
  const vp = page.viewportSize()!;
  const detail = (await page.getByTestId('craft-detail').boundingBox())!;
  for (const id of ['craft', 'craft-count']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y, id).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, id).toBeLessThanOrEqual(vp.height);
    expect(box.x + box.width, id).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height, id).toBeLessThanOrEqual(detail.y + detail.height + 0.5);
  }
}

/** The scrolling detail body ends above the action bar – nothing scrolls underneath it. */
async function expectBodyAboveActions(page: Page): Promise<void> {
  const body = (await page.getByTestId('craft-body').boundingBox())!;
  const actions = (await page.getByTestId('craft-actions').boundingBox())!;
  expect(body.y + body.height).toBeLessThanOrEqual(actions.y + 0.5);
}

const sizes = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x560', width: 1280, height: 560 },
] as const;

for (const size of sizes) {
  test(`craft action stays visible with part info at ${size.name}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await start(page);
    await page.evaluate(() => {
      window.__cinder!.sim.state.credits = 3000;
    });

    await page.keyboard.press('Digit2');
    await page.getByTestId('market-view-craft').click();
    await page.getByRole('button', { name: 'T2 titán' }).click();
    // Gyroskop T2 has the longest part info (description, effect rows, advice)
    await page.getByTestId('recipe-gyro:2').click();
    const detail = page.getByTestId('craft-detail');
    await expect(detail.getByTestId('part-effect')).toBeVisible();
    await waitTicks(page, 10);
    await page.mouse.move(5, 5);
    await expectActionVisible(page);
    await expectBodyAboveActions(page);
    await page.screenshot({ path: testInfo.outputPath(`craft-action-${size.name}.png`) });

    // the end of the detail body (shipyard link) is reachable by scrolling and stays above the bar
    const shipyard = detail.getByRole('button', { name: /lodenic/i });
    await shipyard.scrollIntoViewIfNeeded();
    const link = (await shipyard.boundingBox())!;
    const actions = (await page.getByTestId('craft-actions').boundingBox())!;
    expect(link.y + link.height).toBeLessThanOrEqual(actions.y + 0.5);
    await expectActionVisible(page);
    await page.screenshot({ path: testInfo.outputPath(`craft-action-${size.name}-scrolled.png`) });

    // with enough resources the stepper and the button in the pinned bar are live
    await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      s.credits = 10_000;
      const cargo = s.player.cargo as Record<string, number>;
      for (const k of Object.keys(cargo)) cargo[k] = 200;
    });
    await page.getByTestId('craft-actions').getByRole('button', { name: '+' }).click();
    await expect(page.getByTestId('craft-count')).toHaveText('2');
    await expect(page.getByTestId('craft')).not.toHaveAttribute('aria-disabled', 'true');
    await expectActionVisible(page);
    await page.screenshot({ path: testInfo.outputPath(`craft-action-${size.name}-ready.png`) });
  });
}

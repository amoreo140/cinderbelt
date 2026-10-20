import { expect, test } from './test';
import { loadFixture } from './fixtures';

// Training step 4: the suggested cells are shown before the engine is turned, with a big R prompt;
// turning it (R) to the right rotation clears the prompt and the cells stay.
// Screenshots: test-results-rot-shots/rot-*.png (outside --output, which Playwright empties)
const OUT = 'test-results-rot-shots';

test('training: suggested cells + R prompt before the engine is turned', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loadFixture(page, 'training-mid');
  await expect(page.getByTestId('training-panel')).toContainText('Namontuj 2 bočné motory', { timeout: 30_000 });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.getByTestId('palette-engine').click();
  await expect(page.getByTestId('yard-ghost')).toBeVisible();
  // not turned yet: cells are there, in the warning tint, and the prompt is big and visible
  await expect(page.getByTestId('training-cell').first()).toBeVisible();
  await expect(page.locator('.tr-cell.is-turn').first()).toBeVisible();
  const prompt = page.getByTestId('yard-rotate-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('otoč trysku von z lode');
  await expect(page.getByTestId('yard-nozzle-arrow')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/rot-1-before.png` });
  const cellsBefore = await page.getByTestId('training-cell').count();
  // R until the prompt goes (the step wants one of the side rotations)
  for (let i = 0; i < 4 && (await prompt.count()) > 0; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
  }
  await expect(prompt).toHaveCount(0);
  await expect(page.locator('.tr-cell.is-turn')).toHaveCount(0);
  expect(await page.getByTestId('training-cell').count()).toBe(cellsBefore);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/rot-2-after.png` });
  expect(errors).toEqual([]);
});

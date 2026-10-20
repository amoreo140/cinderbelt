import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Part explanations: what a part does, "Na tvojej lodi" (before → after on the player's ship),
// glossary tooltips on stat labels and the one-line advice – in crafting, the parts market and the
// shipyard palette. Screenshots test-results/partinfo-*.png.

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function start(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

test('part explanations in crafting, the parts market and the shipyard palette', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await start(page);
  await page.evaluate(() => {
    window.__cinder!.sim.state.credits = 3000;
  });

  // 1. crafting: Gyroskop T2 – description, effect on the ship, glossary tooltip on the stat label
  await page.keyboard.press('Digit2');
  await page.getByTestId('market-view-craft').click();
  await page.getByRole('button', { name: 'T2 titán' }).click();
  await page.getByTestId('recipe-gyro:2').click();
  const detail = page.getByTestId('craft-detail');
  await expect(detail.getByTestId('part-about')).toContainText('Otáča loď');
  await expect(detail.getByTestId('part-about')).toContainText('Kokpit má malý vstavaný gyroskop');
  const effect = detail.getByTestId('part-effect');
  await expect(effect).toContainText('Na tvojej lodi');
  const turn = effect.locator('[data-metric="turn180"]');
  await expect(turn).toContainText('3,5 s');
  await expect(turn).toContainText('2,4 s');
  await expect(turn).toContainText('−30 %');
  await expect(turn).toHaveClass(/is-better/);
  await expect(effect.locator('[data-metric="accel"]')).toHaveClass(/is-worse/);
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/partinfo-crafting-gyro.png' });
  await detail.getByText('Krútiaci moment').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Sila, ktorou gyroskopy otáčajú loď');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/partinfo-crafting-term.png' });

  // keyboard: the term is focusable and explains itself on focus too
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();
  await effect.getByText('Otočka o 180°').focus();
  await expect(tip).toContainText('otočiť loď čelom vzad');

  // 2. crafting: another mining laser drains the battery – one line of advice
  await page.getByRole('button', { name: 'T1 železo' }).click();
  await page.getByTestId('recipe-miningLaser:1').click();
  await expect(detail.getByTestId('part-advice')).toHaveText(
    'Pozor: s týmto laserom bude energia pri ťažbe záporná (−2/s) a batéria sa vybije. Pomôže reaktor.',
  );
  await page.screenshot({ path: 'test-results/partinfo-crafting-laser.png' });

  // 3. parts market: a part row opens to its explanation
  await page.keyboard.press('Digit2');
  await page.getByRole('button', { name: 'Diely' }).click();
  const toggle = page.getByTestId('part-toggle-gyro:1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const info = page.getByTestId('part-info-gyro:1');
  await expect(info).toContainText('Otáča loď');
  await expect(info.locator('[data-metric="turn180"]')).toContainText('→');
  await info.scrollIntoViewIfNeeded();
  await waitTicks(page, 5);
  await page.screenshot({ path: 'test-results/partinfo-market-gyro.png' });
  await toggle.click();
  await expect(info).toBeHidden();

  // 4. shipyard: hover a palette row → what the part does; select it → effect on the draft
  await page.keyboard.press('Digit3');
  const gyro = page.getByTestId('palette-gyro');
  await gyro.hover();
  await expect(tip).toContainText('Otáča loď');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/partinfo-shipyard-tooltip.png' });
  await gyro.click();
  const yardDetail = page.getByTestId('yard-part-detail');
  await expect(yardDetail.getByTestId('part-effect')).toContainText('Na tvojom návrhu');
  await expect(yardDetail.locator('[data-metric="turn180"]')).toContainText('s');
  await page.mouse.move(640, 700);
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/partinfo-shipyard-detail.png' });

  expect(errors).toEqual([]);
});

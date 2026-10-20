import { expect, test } from './test';
import { loadFixture } from './fixtures';

// The station tabs: badges on the rail and the "After docking" card of the Overview (S2).

test('arrival card: sell with cargo, a quiet line without; the Market dot follows the cargo', async ({ page }) => {
  test.setTimeout(120_000);
  await loadFixture(page, 'cargo-full', { ticks: 30 });
  const hub = page.getByTestId('station-hub');
  await expect(hub).toBeVisible();
  const card = page.getByTestId('arrival-card');
  await expect(card).toBeVisible();
  const sell = card.getByTestId('sell-all');
  await expect(sell).toBeVisible();
  await expect(sell).toContainText('+');
  // the Market tab carries a dot while the ship holds cargo
  await expect(page.getByTestId('tab-market').getByRole('img')).toHaveCount(1);
  const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await sell.click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.sim.state.credits)).toBeGreaterThan(before);
  await expect(card.getByTestId('sell-all')).toHaveCount(0);
  await expect(page.getByTestId('tab-market').getByRole('img')).toHaveCount(0);
  // nothing else to do (full tank, intact ship, no contracts to hand in)
  await expect(page.getByTestId('arrival-none')).toBeVisible();
  
});

test('arrival card: repair and refuel appear with their values; the Jobs badge counts contracts to hand in', async ({ page }) => {
  test.setTimeout(120_000);
  await loadFixture(page, 'damaged', { ticks: 30 });
  const card = page.getByTestId('arrival-card');
  await expect(card.getByTestId('arrival-repair')).toBeVisible();
  await expect(card.getByTestId('arrival-repair')).toContainText('kr');
  await expect(card.getByTestId('sell-all')).toHaveCount(0);
  await expect(card.getByTestId('arrival-refuel')).toHaveCount(0);
  // a spent tank: the refuel button shows up, the Service section keeps its own button
  await page.evaluate(() => {
    window.__cinder!.sim.state.player.fuel = 100;
  });
  await expect(card.getByTestId('arrival-refuel')).toBeVisible();
  await expect(page.getByTestId('refuel-full')).toBeVisible();
  // a ready contract: the orange count on the Jobs tab and the hand-in button
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.career.contracts.push({
      id: 'home@0.990', type: 'mining', faction: 'guild', station: 'home', ring: 1, risk: 0,
      target: { kind: 'mining', resource: 'iron', amount: 10 }, modifiers: [], bonus: 0, part: null,
      serial: 990, acceptedTick: s.tick, seconds: 60, reward: 321, rep: 5, progress: 10, base: 0, ready: true,
    } as never);
  });
  const jobs = page.getByTestId('tab-board').getByRole('img');
  await expect(jobs).toHaveText('1');
  const turnIn = card.getByTestId('arrival-turnin');
  await expect(turnIn).toContainText('+321');
  
  const before = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await turnIn.click();
  await expect.poll(() => page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(before + 321);
  await expect(jobs).toHaveCount(0);
});

import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Screenshots of the UI design language (test-results/ui-*.png) – a look at every screen.

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

/** Waits for the one-shot CSS animations (modal fade / clamp) – their clock runs with rendered frames. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('UI: station hub tabs', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const p = sim.state.player;
    p.fuel = 74;
    p.cargo.iron = 52.3;
    p.cargo.copper = 31;
    p.cargo.ice = 12.9;
    sim.state.credits = 1240;
  });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await waitTicks(page, 120);
  await page.screenshot({ path: 'test-results/ui-hub-overview.png' });

  await page.keyboard.press('Digit2');
  await waitTicks(page, 20);
  await page.getByTestId('tab-shipyard').hover();
  await waitTicks(page, 20);
  await page.screenshot({ path: 'test-results/ui-hub-market.png' });

  await page.keyboard.press('Digit1');
  await waitTicks(page, 20);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'test-results/ui-hub-service.png' });
  expect(errors).toEqual([]);
});

test('UI: flight HUD and map', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.cargo.iron = 18.4;
    p.cargo.ice = 6.2;
    p.fuel = 26;
    const body = { pos: { x: 70, y: 30 }, vel: { x: 3, y: 1 }, angle: 0.4, angVel: 0 };
    p.body = body;
    p.prevBody = body;
  });
  await page.keyboard.down('KeyW');
  await waitTicks(page, 50);
  await page.keyboard.up('KeyW');
  await page.mouse.move(900, 300);
  await page.screenshot({ path: 'test-results/ui-flight.png' });

  // the controls help collapsed (K)
  await page.keyboard.press('KeyK');
  await waitTicks(page, 10);
  await page.screenshot({ path: 'test-results/ui-flight-collapsed.png' });

  await page.keyboard.press('KeyM');
  await waitTicks(page, 20);
  await page.screenshot({ path: 'test-results/ui-map.png' });
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});

test('UI: style guide page', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui-kit.html');
  await expect(page.getByTestId('ui-kit')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/ui-kit.png', fullPage: true });
  expect(errors).toEqual([]);
});

/**
 * M4a fleet screens from the `hangar` fixture: the hub head with the credits Odometer, the Hangar modal,
 * the Shipyard header (ship name + log + Hangar / Templates) and the Templates modal with an open export.
 */
async function fleetScreens(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors = collectErrors(page);
  await loadFixture(page, 'hangar', { ticks: 60 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
  await expect(page.getByTestId('hub-hangar')).toBeVisible();
  await page.getByTestId('hub-credits').screenshot({ path: `test-results/ui-odometer-${lang}.png` });

  await page.getByTestId('hub-open-hangar').click();
  await expect(page.getByTestId('hangar')).toBeVisible();
  await waitTicks(page, 20);
  await page.mouse.move(10, 10);
  await settle(page);
  await page.screenshot({ path: `test-results/ui-hangar-${lang}.png` });
  await page.getByTestId('hangar-close').click();
  await expect(page.getByTestId('hangar')).toBeHidden();

  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('yard-ship')).toBeVisible();
  await waitTicks(page, 30);
  await settle(page);
  await page.screenshot({ path: `test-results/ui-shipyard-header-${lang}.png` });

  await page.getByTestId('yard-open-templates').click();
  await expect(page.getByTestId('templates')).toBeVisible();
  await page.getByTestId('template-export-1').click();
  await expect(page.getByTestId('templates-export-code')).toBeVisible();
  await waitTicks(page, 20);
  await page.mouse.move(10, 10);
  await settle(page);
  await page.screenshot({ path: `test-results/ui-templates-${lang}.png` });
  await page.getByTestId('templates-close').click();
  await expect(page.getByTestId('templates')).toBeHidden();

  // the fighter parked at home stands on the bay deck (the bay is left out on the software preset)
  await page.evaluate(() => window.__cinder!.renderer.setGraphicsQuality('medium'));
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.bayStats().loaded, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => window.__cinder!.renderer.hangar.parkedStats().ships === 1, undefined, { timeout: 30_000 });
  await page.evaluate(() => Object.assign(window.__cinder!.renderer.hangar.view.goal, { pitch: Math.PI / 2, zoom: 0.6 }));
  await waitTicks(page, 60);
  await page.screenshot({ path: `test-results/ui-shipyard-parked-${lang}.png` });
  expect(errors).toEqual([]);
}

test('UI: hangar, shipyard header and templates (SK)', async ({ page }) => {
  test.setTimeout(120_000);
  await fleetScreens(page, 'sk');
});

test.describe('English', () => {
  test.use({ firstLaunchLanguage: 'en' });
  test('UI: hangar, shipyard header and templates (EN)', async ({ page }) => {
    test.setTimeout(120_000);
    await fleetScreens(page, 'en');
  });
});

// M4c screens (T14): the Development tab, the paint shop, the trophy
// hall, the workshop lamps in flight and the three new parts in the shipyard palette. Saved as
// ui-m4c-*-<lang>.png in `$UI_SHOTS` (default test-results).
const uiEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const UI_SHOTS = uiEnv.UI_SHOTS ?? 'test-results';

async function homeScreens(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors = collectErrors(page);
  await loadFixture(page, 'home-dev', { ticks: 30 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
  await page.keyboard.press('Digit6');
  await expect(page.getByTestId('development')).toBeVisible();
  await page.getByTestId('dev-module-paintShop').click();
  await waitTicks(page, 20);
  await page.mouse.move(10, 10);
  await settle(page);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-rozvoj-${lang}.png` });
  // the trophies won before the hall wait, greyed
  await page.getByTestId('dev-module-trophyHall').click();
  await expect(page.getByTestId('trophies-waiting')).toBeVisible();
  await waitTicks(page, 10);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-rozvoj-waiting-${lang}.png` });
  // the build confirmation
  await page.getByTestId('dev-build').click();
  await expect(page.locator('[data-modal="confirm"] button')).toBeVisible();
  await waitTicks(page, 10);
  await settle(page);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-rozvoj-confirm-${lang}.png` });
  await page.locator('[data-modal="confirm"] button').click();
  await expect(page.getByTestId('trophy-hall')).toBeVisible();
  await page.evaluate(() => window.__cinder!.home!.build!('paintShop'));
  await page.waitForFunction(() => window.__cinder!.sim.state.home.modules.has('paintShop'));

  // the trophy hall: the pedestals and the pin list
  await waitTicks(page, 20);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-trophy-hall-${lang}.png` });

  // the paint shop with a hovered paint previewed on the docked ship
  await page.getByTestId('dev-module-paintShop').click();
  await expect(page.getByTestId('paint-shop')).toBeVisible();
  await page.getByTestId('paint-navy').hover();
  await waitTicks(page, 30);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-paint-shop-${lang}.png` });
  await page.getByTestId('paint-navy').click();
  await page.getByTestId('paint-apply').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.fleet.active.paint === 'navy');
  await page.getByTestId('paint-ship-2').click();
  await page.mouse.move(10, 10);
  await waitTicks(page, 20);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-paint-shop-stored-${lang}.png` });
  expect(errors).toEqual([]);
}

async function workshopScreens(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors = collectErrors(page);
  // in flight: the refinery fills the tank, the repair module works
  await loadFixture(page, 'workshop', { ticks: 60 });
  await expect(page.getByTestId('ws-lamp-refinery')).toBeVisible();
  await page.getByTestId('ws-lamp-refinery').hover();
  await waitTicks(page, 20);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-workshop-lamps-${lang}.png` });
  // a full tank: the refinery refines ore, the refined count shows
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.fuel = p.props.fuelCapacity - 0.5;
  });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.refined.titanium >= 1, undefined, { timeout: 60_000 });
  await page.getByTestId('ws-refined').hover();
  await waitTicks(page, 20);
  await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-workshop-refined-${lang}.png` });

  // the shipyard palette with the three new parts (a fresh start, the parts in the home storage)
  await loadFixture(page, 'start', { ticks: 10 });
  await page.evaluate(() => {
    const st = window.__cinder!.sim.state.stations.get('home')!;
    for (const k of ['largeReactor:1', 'repairModule:1', 'refinery:1'] as const) st.parts[k] = (st.parts[k] ?? 0) + 1;
  });
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  for (const key of ['refinery', 'repairModule', 'largeReactor'] as const) {
    const row = page.getByTestId(`palette-${key}`);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await page.mouse.move(700, 650);
    await waitTicks(page, 15);
    await page.screenshot({ path: `${UI_SHOTS}/ui-m4c-palette-${key}-${lang}.png` });
  }
  expect(errors).toEqual([]);
}

test('UI: M4c Development tab, trophy hall and paint shop (SK)', async ({ page }) => {
  test.setTimeout(150_000);
  await homeScreens(page, 'sk');
});

test('UI: M4c workshop lamps and the new parts in the palette (SK)', async ({ page }) => {
  test.setTimeout(150_000);
  await workshopScreens(page, 'sk');
});

test.describe('English (M4c)', () => {
  test.use({ firstLaunchLanguage: 'en' });
  test('UI: M4c Development tab, trophy hall and paint shop (EN)', async ({ page }) => {
    test.setTimeout(150_000);
    await homeScreens(page, 'en');
  });
  test('UI: M4c workshop lamps and the new parts in the palette (EN)', async ({ page }) => {
    test.setTimeout(150_000);
    await workshopScreens(page, 'en');
  });
});

// M4d screens (T17) from the UI kit: the convoy trade window, the flight
// HUD with the Guild chips and the link readout, the Guild status chips, the relay / escort board slips, the
// map planner parts (route readouts, note editors, glyphs) and the full map demo with the Guild layer, notes
// and stale marks. Saved as ui-m4d-*-<lang>.png in `$UI_SHOTS`.
async function guildScreens(page: Page, lang: 'sk' | 'en'): Promise<void> {
  const errors = collectErrors(page);
  await page.goto(`/ui-kit.html${lang === 'en' ? '?lang=en' : ''}`);
  await expect(page.getByTestId('kit-cech')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
  for (const id of ['kit-cech-trade', 'kit-cech-flight', 'kit-cech-chips', 'kit-cech-slips', 'kit-map-plan'] as const) {
    const el = page.getByTestId(id);
    await el.scrollIntoViewIfNeeded();
    await expect(el).toBeVisible();
    await page.waitForTimeout(300);
    await el.screenshot({ path: `${UI_SHOTS}/ui-m4d-${id.slice(4)}-${lang}.png` });
  }
  // the whole map with the planner (route + range circles, notes, stale marks, the Guild layer) and short fuel
  for (const variant of ['', '&short'] as const) {
    await page.goto(`/ui-kit.html?mapdemo${variant}${lang === 'en' ? '&lang=en' : ''}`);
    await expect(page.getByTestId('map')).toBeVisible();
    await expect(page.getByTestId('map-route')).toBeVisible();
    if (variant) await expect(page.getByTestId('map-route-short')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${UI_SHOTS}/ui-m4d-mapdemo${variant ? '-short' : ''}-${lang}.png` });
  }
  expect(errors).toEqual([]);
}

test('UI: M4d convoy trade, Guild chips, slips and the map planner (SK)', async ({ page }) => {
  test.setTimeout(120_000);
  await guildScreens(page, 'sk');
});

test.describe('English (M4d)', () => {
  test.use({ firstLaunchLanguage: 'en' });
  test('UI: M4d convoy trade, Guild chips, slips and the map planner (EN)', async ({ page }) => {
    test.setTimeout(120_000);
    await guildScreens(page, 'en');
  });
});

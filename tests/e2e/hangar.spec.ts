import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { dockAtClamp } from './dockHelper';
import { loadFixture } from './fixtures';

// M4a "Hangar and fleet" (T10): the hangar and template flows through the real UI,
// starting from the `hangar` fixture (docked at home with the hour2 miner #1 "Furrow" – a generated name –,
// the T2 fighter #2 "Osa" parked at home, the generated miner #3 at `st:0,5`, 2 slots, 3 templates) and
// `hour2` (no slot yet, 17 600 kr). `window.__cinder.fleet` is used for state reads; the few state edits
// are setup only and say so. Screenshots go to the Playwright output folder (--output).

/**
 * Waits until the one-shot CSS animations (a modal's fade and clamp) have played. In software WebGL the
 * animation clock advances only with rendered frames, so a fixed wait can catch a modal still at opacity 0.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

const activeId = (page: Page) => page.evaluate(() => window.__cinder!.sim.state.fleet.active.id);
const credits = (page: Page) => page.evaluate(() => window.__cinder!.sim.state.credits);
const templateNames = (page: Page) => page.evaluate(() => window.__cinder!.sim.state.templates.map((t) => t.name));
/** Digits of a credits readout ("12 600 kr" → 12600) – independent of the thousands separator. */
const digits = (text: string | null) => Number((text ?? '').replace(/\D/g, ''));

/**
 * Opens the Hangar modal: from the hub overview's hangar row (shown once the station has a slot or a
 * parked ship) or from the Shipyard header. Tabs by click – in the shipyard the digits pick palette parts.
 */
async function openHangar(page: Page, via: 'hub' | 'yard' = 'hub'): Promise<void> {
  if (via === 'hub') {
    await page.getByTestId('tab-overview').click();
    await page.getByTestId('hub-open-hangar').click();
  } else {
    await page.getByTestId('tab-shipyard').click();
    await page.getByTestId('yard-open-hangar').click();
  }
  await expect(page.getByTestId('hangar')).toBeVisible();
}

/** Opens the Shipyard tab and its Templates modal from the ship header. */
async function openTemplates(page: Page): Promise<void> {
  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await page.getByTestId('yard-open-templates').click();
  await expect(page.getByTestId('templates')).toBeVisible();
}

/**
 * Points of a 16 × 9 grid over the viewport where the topmost element is NOT inside `testId` – an app
 * overlay (death card, pause menu) covers the whole screen, so no game UI (radio, HUD, panels) may draw
 * over it. Returns the offending elements' class names.
 */
async function uncovered(page: Page, testId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const cover = document.querySelector(`[data-testid="${id}"]`);
    // hit testing skips `pointer-events: none` (the radio card, most of the HUD) – drawn is what counts
    const probe = document.createElement('style');
    probe.textContent = '* { pointer-events: auto !important; }';
    document.head.append(probe);
    const bad = new Set<string>();
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 9; j++) {
        const el = document.elementFromPoint(((i + 0.5) / 16) * innerWidth, ((j + 0.5) / 9) * innerHeight);
        if (el && cover && !cover.contains(el)) bad.add(el.closest('[class]')?.getAttribute('class') ?? el.tagName);
      }
    probe.remove();
    return [...bad];
  }, testId);
}

/** The confirm button of the open confirmation dialog (theme Modal). */
const confirmButton = (page: Page) => page.locator('[data-modal="confirm"] button');

test('hangar: switch to the parked fighter, fly, dock, switch back – the miner keeps its cargo and fuel', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hangar', { ticks: 30 });
  // setup: some ore aboard the active miner, so "intact" has something to check
  await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    p.cargo.iron = 20;
    p.cargo.ice = 5.5;
  });
  const before = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    return { cargo: { ...p.cargo }, fuel: p.fuel, parts: p.grid.parts.length };
  });
  expect(await activeId(page)).toBe(1);

  await expect(page.getByTestId('hub-hangar')).toBeVisible();
  await openHangar(page);
  await expect(page.getByTestId('hangar-ship-1')).toBeVisible();
  await expect(page.getByTestId('hangar-ship-2')).toContainText('Osa');
  // the miner at the other station cannot be switched to from here
  await expect(page.getByTestId('hangar-switch-3')).toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(300);
  await shot(page, 'hangar-sk-modal');

  await page.getByTestId('hangar-switch-2').click();
  await expect.poll(() => activeId(page)).toBe(2);
  // the modal stays open with the fighter as the active card
  await expect(page.getByTestId('hangar-ship-2')).toHaveClass(/is-active/);
  expect(await page.evaluate(() => window.__cinder!.fleet!.header().name)).toBe('Osa');
  await page.getByTestId('hangar-close').click();
  await expect(page.getByTestId('hangar')).toBeHidden();

  // fly the fighter for 10 s, then dock again with the real dock key
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.down('KeyW');
  await waitTicks(page, 120);
  await page.keyboard.up('KeyW');
  await waitTicks(page, 480);
  const flown = await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.length);
  expect(flown).toBe(16);
  await shot(page, 'hangar-sk-fighter-flight');
  await dockAtClamp(page, { stationId: 'home' });
  await expect(page.getByTestId('station-hub')).toBeVisible();

  await openHangar(page);
  await expect(page.getByTestId('hangar-ship-1')).not.toHaveClass(/is-active/);
  await page.getByTestId('hangar-switch-1').click();
  await expect.poll(() => activeId(page)).toBe(1);
  const after = await page.evaluate(() => {
    const p = window.__cinder!.sim.state.player;
    return { cargo: { ...p.cargo }, fuel: p.fuel, parts: p.grid.parts.length };
  });
  expect(after).toEqual(before);
  // the fighter is parked at home again
  const osa = await page.evaluate(() => window.__cinder!.fleet!.hangar().ships.find((s) => s.id === 2)!);
  expect(osa).toMatchObject({ active: false, stationId: 'home', here: true });
  await page.mouse.move(640, 700);
  await shot(page, 'hangar-sk-switched-back');
  expect(errors).toEqual([]);
});

test('hangar: buy a slot (credits roll down by 5 000) and start a new ship from a storage cockpit', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hour2', { ticks: 30 });
  const start = await credits(page);
  expect(start).toBe(15_151);
  // no slot and no parked ship yet: the overview has no hangar row, the way in is the Shipyard header
  await expect(page.getByTestId('hub-hangar')).toHaveCount(0);

  await openHangar(page, 'yard');
  await expect(page.getByTestId('hangar-free-slot')).toHaveCount(0);
  // no slot here yet: "New ship" says why
  await expect(page.getByTestId('hangar-new-cockpit-1-buy')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('hangar-buy-slot').click();
  await expect(page.getByRole('dialog').filter({ hasText: '5' }).last()).toBeVisible();
  await confirmButton(page).click();
  await expect.poll(() => credits(page)).toBe(start - 5_000);
  await expect(page.getByTestId('hangar-free-slot')).toHaveCount(1);
  await page.getByTestId('hangar-close').click();
  // the Odometer in the hub head shows the new value
  await expect.poll(async () => digits(await page.getByTestId('hub-credits').textContent())).toBe(start - 5_000);

  // a cockpit into the home storage through the parts market
  await page.getByTestId('tab-market').click();
  await page.getByRole('button', { name: 'Diely', exact: true }).click();
  const buy = page.getByTestId('buy-part-cockpit:1');
  await buy.scrollIntoViewIfNeeded();
  await buy.click();
  await page.waitForFunction(() => (window.__cinder!.sim.state.stations.get('home')?.parts['cockpit:1'] ?? 0) >= 1);
  const afterBuy = await credits(page);

  await openHangar(page);
  const fromStorage = page.getByTestId('hangar-new-cockpit-1-storage');
  await expect(fromStorage).toBeVisible();
  await expect(fromStorage).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(300);
  await shot(page, 'hangar-sk-new-ship-offer');
  await fromStorage.click();
  await confirmButton(page).click();
  await expect.poll(() => activeId(page)).not.toBe(1);
  const ship = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { parts: s.player.grid.parts.map((p) => `${p.partId}:${p.tier}`), storage: s.stations.get('home')?.parts['cockpit:1'] ?? 0, credits: s.credits };
  });
  // a cockpit-only ship from the storage cockpit, nothing paid for it
  expect(ship).toEqual({ parts: ['cockpit:1'], storage: 0, credits: afterBuy });
  // the miner is parked in the new slot at home
  const miner = await page.evaluate(() => window.__cinder!.fleet!.hangar().ships.find((s) => s.id === 1)!);
  expect(miner).toMatchObject({ active: false, stationId: 'home', here: true });
  await expect(page.getByTestId('hangar-ship-1')).toBeVisible();
  await page.getByTestId('hangar-close').click();

  // the shipyard shows the cockpit-only ship
  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('yard-hull-points')).toContainText('1');
  await page.waitForTimeout(800);
  await shot(page, 'hangar-sk-new-ship-yard');
  expect(errors).toEqual([]);
});

test('hangar: rename the ship in the shipyard header, Storages lists the parked ships, SK → EN keeps a custom name', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hangar', { ticks: 30 });
  const generated = await page.evaluate(() => window.__cinder!.fleet!.storages().find((s) => s.id === 3)!.name);

  await page.getByTestId('tab-shipyard').click();
  await expect(page.getByTestId('yard-ship')).toBeVisible();
  await page.getByTestId('yard-ship-name').click();
  const input = page.getByTestId('yard-ship-name-input');
  await expect(input).toBeFocused();
  await input.fill('Kladivo');
  await input.press('Enter');
  await expect(page.getByTestId('yard-ship-name')).toContainText('Kladivo');
  await expect.poll(() => page.evaluate(() => window.__cinder!.fleet!.header())).toMatchObject({ name: 'Kladivo', generated: false });
  await page.waitForTimeout(500);
  await shot(page, 'hangar-sk-yard-header-renamed');

  // Storages (I): every ship with the station it stands at
  await page.getByTestId('tab-overview').click();
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('storages')).toBeVisible();
  await expect(page.getByTestId('storage-ship-2')).toContainText('Osa');
  await expect(page.getByTestId('storage-ship-2')).toContainText('Základňa Počiatok');
  await expect(page.getByTestId('storage-ship-3')).toContainText(generated);
  await expect(page.getByTestId('storage-ship-3')).toContainText('Uzol Lyra');
  await page.waitForTimeout(300);
  await shot(page, 'hangar-sk-storages');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('storages')).toBeHidden();

  // live language switch from the pause menu
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  // the pause screen covers the hub and its radio card
  expect(await uncovered(page, 'pause-menu')).toEqual([]);
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('set-language').getByRole('button', { name: 'English' }).click();
  // the English texts download first (only the active language is loaded)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-resume').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();

  const names = await page.evaluate(() => Object.fromEntries(window.__cinder!.fleet!.storages().map((s) => [s.id, s.name])));
  expect(names[1]).toBe('Kladivo');
  expect(names[2]).toBe('Osa');
  // the generated name follows the language
  expect(names[3]).not.toBe(generated);
  await openHangar(page);
  await expect(page.getByTestId('hangar-ship-1')).toContainText('Kladivo');
  await expect(page.getByTestId('hangar-ship-3')).toContainText(names[3]!);
  await expect(page.getByTestId('hangar')).toContainText('Switch');
  await page.waitForTimeout(300);
  await shot(page, 'hangar-en-modal-after-switch');
  expect(errors).toEqual([]);
});

test('hangar: dismantle the parked fighter – its parts go to the storage, the slot is free', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hangar', { ticks: 30 });
  const storedParts = () =>
    page.evaluate(() => Object.values(window.__cinder!.sim.state.stations.get('home')?.parts ?? {}).reduce((a, n) => a + (n ?? 0), 0));
  const before = await storedParts();
  const quote = await page.evaluate(() => window.__cinder!.fleet!.hangar().ships.find((s) => s.id === 2)!.dismantle!);
  const cash = await credits(page);

  await openHangar(page);
  await expect(page.getByTestId('hangar-free-slot')).toHaveCount(0);
  await page.getByTestId('hangar-dismantle-2').click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Osa' }).last();
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'hangar-sk-dismantle-confirm');
  await confirmButton(page).click();

  await expect(page.getByTestId('hangar-ship-2')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__cinder!.sim.state.fleet.stored.length)).toBe(1);
  expect(await storedParts()).toBe(before + 16 - quote.scrap);
  expect(await credits(page)).toBe(cash - quote.fee);
  await expect(page.getByTestId('hangar-free-slot')).toHaveCount(1);
  await shot(page, 'hangar-sk-dismantled');
  expect(errors).toEqual([]);
});

test('templates: save the ship, export the code, delete, import it back, build one as the draft and commit', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'hangar', { ticks: 30 });
  expect(await templateNames(page)).toEqual(['Miner', 'Fighter', 'Starter']);

  await openTemplates(page);
  await expect(page.getByTestId('templates-slots')).toContainText('3');
  await page.waitForTimeout(300);
  await shot(page, 'templates-sk-modal');

  // save the current ship under a name
  await page.getByTestId('templates-name').fill('Moja Brázda');
  await page.getByTestId('templates-save-btn').click();
  await expect.poll(() => templateNames(page)).toEqual(['Miner', 'Fighter', 'Starter', 'Moja Brázda']);
  await expect(page.getByTestId('template-3')).toContainText('Moja Brázda');
  const saved = await page.evaluate(() => window.__cinder!.sim.state.templates[3]!.parts.length);
  expect(saved).toBe(29);

  // export: a read-only code field
  await page.getByTestId('template-export-3').click();
  const field = page.getByTestId('templates-export-code');
  await expect(field).toBeVisible();
  const code = await field.inputValue();
  expect(code).toMatch(/^CB2\./);
  await page.waitForTimeout(200);
  await shot(page, 'templates-sk-export');

  // delete (confirm) …
  await page.getByTestId('template-delete-3').click();
  await confirmButton(page).click();
  await expect.poll(() => templateNames(page)).toEqual(['Miner', 'Fighter', 'Starter']);
  await expect(page.getByTestId('template-3')).toHaveCount(0);

  // … a code with a typo in it says why (the checksum catches it) …
  const typo = code.slice(0, 12) + (code[12] === 'A' ? 'B' : 'A') + code.slice(13);
  await page.getByTestId('templates-import-code').fill(typo);
  await page.getByTestId('templates-import-btn').click();
  await expect(page.getByTestId('templates-import-result')).toHaveClass(/is-bad/);
  await expect(page.getByTestId('templates-import-result')).toContainText('poškodený');
  expect(await templateNames(page)).toHaveLength(3);
  await shot(page, 'templates-sk-import-error');

  // … and the exported code brings it back
  await page.getByTestId('templates-import-code').fill(code);
  await page.getByTestId('templates-import-btn').click();
  await expect(page.getByTestId('templates-import-result')).toHaveClass(/is-ok/);
  await expect.poll(() => templateNames(page)).toEqual(['Miner', 'Fighter', 'Starter', 'Moja Brázda']);
  expect(await page.evaluate(() => window.__cinder!.sim.state.templates[3]!.parts.length)).toBe(29);
  await shot(page, 'templates-sk-imported');

  // build "Starter" as the shipyard draft: the cost lists the parts to buy; commit
  // setup: the fixture's 2 000 kr would not pay for the T1 cockpit and laser the starter layout needs
  await page.evaluate(() => {
    window.__cinder!.sim.state.credits = 20_000;
  });
  await page.getByTestId('template-apply-2').click();
  await expect(page.getByTestId('templates')).toBeHidden();
  const cost = page.getByTestId('yard-cost');
  await expect(cost).toContainText('Kokpit T1');
  await expect(cost).toContainText('Ťažobný laser T1');
  const total = digits(await page.getByTestId('yard-total').textContent());
  expect(total).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  await shot(page, 'templates-sk-applied-draft');
  const commit = page.getByTestId('yard-commit');
  await expect(commit).not.toHaveAttribute('aria-disabled', 'true');
  await commit.click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length === 14);
  await expect(page.getByTestId('toast')).toContainText('Loď prestavaná');
  expect(await credits(page)).toBe(20_000 - total);
  const tiers = await page.evaluate(() => window.__cinder!.sim.state.player.grid.parts.filter((p) => p.partId === 'cockpit').map((p) => p.tier));
  expect(tiers).toEqual([1]);
  await page.waitForTimeout(500);
  await shot(page, 'templates-sk-committed');
  expect(errors).toEqual([]);
});

test('death card: "Restore from template" respawns at the shipyard with the Templates modal open', async ({ page }) => {
  test.setTimeout(150_000);
  // the volley is aimed by position – no camera shake
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, cameraShake: false, combatZoom: false })));
  const errors = trackErrors(page);
  await loadFixture(page, 'hangar', { ticks: 30 });
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 30);
  // a scripted death: a pirate volley through the ship (as menu.spec does), fanned across the whole
  // width of the wide miner – a single line knocks off the parts in front and misses the cockpit
  await page.evaluate(() => {
    const { player, combat } = window.__cinder!.sim.state;
    player.shield = 0;
    const p = player.body.pos;
    let id = 920000;
    for (let row = -8; row <= 8; row++)
      for (let k = 0; k < 20; k++) {
        const pos = { x: p.x + 12 + k * 1.5, y: p.y + row * 0.5 };
        combat.projectiles.push({ id: id++, owner: 'e2e-pirate', pos, vel: { x: -90, y: 0 }, ttl: 600, damage: 99999, tier: 1, origin: pos });
      }
  });
  const card = page.getByTestId('death-card');
  await expect(card).toBeVisible({ timeout: 45_000 });
  const restore = page.getByTestId('death-template');
  await expect(restore).toBeVisible();
  await expect(restore).toContainText('Obnoviť zo šablóny');
  await expect(restore).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(600);
  await shot(page, 'death-sk-template-action');
  // the card covers the flight UI – the radio card and the HUD panels stay under it
  expect(await uncovered(page, 'death-card')).toEqual([]);

  await restore.click();
  await expect(card).toBeHidden();
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('templates')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { destroyed: s.player.destroyed, mode: s.player.dock.mode, deaths: s.stats.deaths, modals: window.__cinder!.fleet!.modals() };
  });
  expect(after).toMatchObject({ destroyed: false, mode: 'docked', deaths: 1, modals: { hangar: false, templates: true } });
  await page.waitForTimeout(400);
  await shot(page, 'death-sk-templates-open');
  // building a template from here is one click away
  await expect(page.getByTestId('template-apply-0')).not.toHaveAttribute('aria-disabled', 'true');
  expect(errors).toEqual([]);
});

test.describe('English', () => {
  test.use({ firstLaunchLanguage: 'en' });

  test('hangar and templates in English', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await loadFixture(page, 'hangar', { ticks: 30 });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    await openHangar(page);
    await expect(page.getByTestId('hangar')).toContainText('Hangar');
    await expect(page.getByTestId('hangar-switch-2')).toContainText('Switch');
    await page.waitForTimeout(300);
    await shot(page, 'hangar-en-modal');
    await page.getByTestId('hangar-close').click();

    await openTemplates(page);
    await expect(page.getByTestId('templates')).toContainText('Templates');
    await page.waitForTimeout(300);
    await shot(page, 'templates-en-modal');
    await page.getByTestId('template-export-0').click();
    await expect(page.getByTestId('templates-export-code')).toBeVisible();
    await page.getByTestId('templates-import-code').fill('CB2.nonsense');
    await page.getByTestId('templates-import-btn').click();
    await expect(page.getByTestId('templates-import-result')).toHaveClass(/is-bad/);
    await shot(page, 'templates-en-export-import-error');
    await page.getByTestId('templates-close').click();
    await expect(page.getByTestId('templates')).toBeHidden();
    await page.waitForTimeout(500);
    await shot(page, 'hangar-en-yard-header');
    expect(errors).toEqual([]);
  });
});

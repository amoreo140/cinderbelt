import { expect, test } from './test';
import type { Page } from '@playwright/test';

/** Collects page errors (console and exceptions). */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
}

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

/** A new game from the menu with a preset and a seed. */
async function startNewGame(page: Page, preset: string, seed: string): Promise<void> {
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await page.getByTestId(`preset-${preset}`).click();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 30_000 });
}

test('M2c: new game → play → save and quit → reload → continue restores the state', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);
  // first launch: without a save there is no Continue, the main action is New game
  await expect(page.getByTestId('menu-continue')).toHaveCount(0);
  await page.waitForTimeout(1600); // menu intro animation
  await page.screenshot({ path: 'test-results/m2c-menu.png' });

  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-calm').click();
  await expect(page.getByTestId('preset-hint')).toContainText('Smrť ťa nič nestojí');
  await page.getByTestId('seed-input').fill('tichy-prach-73');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/m2c-newgame.png' });
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 30_000 });

  const settings = await page.evaluate(() => window.__cinder!.sim.state.settings);
  expect(settings).toMatchObject({ seedText: 'tichy-prach-73', deathPenalty: 'none', enemyDensity: 'low', miningYield: 2 });
  await expect(page.getByTestId('station-hub')).toBeVisible();

  // state change: undock, a bit of flight, credits
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.evaluate(() => {
    window.__cinder!.sim.state.credits = 777;
  });
  await page.keyboard.down('KeyW');
  await waitTicks(page, 60);
  await page.keyboard.up('KeyW');
  await waitTicks(page, 10);

  // pause in flight: the simulation stands still
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const frozen = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__cinder!.sim.state.tick)).toBe(frozen);
  await page.getByTestId('pause-save').click();
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-phase', 'saved');
  await expect(page.getByTestId('pause-last-save')).toContainText('pred');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/m2c-pause.png' });

  // Esc closes the pause and the game goes on (Esc does not flip back into the pause)
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await waitTicks(page, 20);
  await expect(page.getByTestId('pause-menu')).toBeHidden();

  // Save and quit – saves in space too
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { tick: s.tick, credits: s.credits, pos: { ...s.player.body.pos }, vel: { ...s.player.body.vel }, mode: s.player.dock.mode };
  });
  await page.getByTestId('pause-quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__cinder)).toBeUndefined();
  expect(await page.locator('#game canvas').count()).toBe(0);

  // reloading the page → Continue
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('continue-slot')).toContainText('tichy-prach-73');
  await expect(page.getByTestId('continue-slot')).toContainText('777 kr');
  // saved state = the state at the moment of leaving (exactly, with no simulation run)
  const stored = await page.evaluate(async () => {
    const app = window.__cinderApp!;
    const r = await app.saveService.load({ difficulty: 'none', index: 0 });
    if (!r.ok) throw new Error(r.error);
    const s = r.sim.state;
    return { tick: s.tick, credits: s.credits, pos: { ...s.player.body.pos }, vel: { ...s.player.body.vel }, mode: s.player.dock.mode };
  });
  expect(stored).toEqual(saved);

  await page.getByTestId('menu-continue').click();
  await page.waitForFunction(() => window.__cinder !== undefined, null, { timeout: 30_000 });
  // the "Where I left off" card (M3.5a): the simulation stands still until the player continues
  await expect(page.getByTestId('resume-card')).toBeVisible();
  const restored = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { tick: s.tick, credits: s.credits, mode: s.player.dock.mode, settings: s.settings };
  });
  expect(restored.tick).toBeGreaterThanOrEqual(saved.tick);
  expect(restored.credits).toBe(777);
  expect(restored.mode).toBe('flying');
  expect(restored.settings).toMatchObject({ seedText: 'tichy-prach-73', deathPenalty: 'none', miningYield: 2 });
  expect(errors).toEqual([]);
});

test('M2c: load screen with slots by difficulty, damaged save with backup, delete with confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);

  // prepares the saves directly through the service (faster than clicking): 4 difficulties, a fallen hero, a damaged slot
  await page.evaluate(async () => {
    const saves = window.__cinderApp!.saveService;
    const make = async (difficulty: 'none' | 'mild' | 'hard' | 'hardcore', index: number, seedText: string, preset: Record<string, unknown>) => {
      const r = await saves.newGame({ slot: { difficulty, index }, seedText, choice: { deathPenalty: difficulty, ...preset } as never });
      if (!r.ok) throw new Error(r.error);
      return r;
    };
    await make('none', 0, 'hviezdny-prach-42', { enemyDensity: 'low', miningYield: 2 });
    const mild = await make('mild', 0, 'zlaty-majak-17', { enemyDensity: 'normal', miningYield: 1 });
    mild.sim.state.credits = 3480;
    mild.sim.state.tick = 60 * 60 * 102;
    await saves.save(mild.sim, mild.session, 'dock');
    await make('mild', 2, 'temny-orbit-55', { enemyDensity: 'normal', miningYield: 1 });
    const hard = await make('hard', 0, 'stary-kovac-31', { enemyDensity: 'high', miningYield: 1 });
    hard.sim.state.settings = { ...hard.sim.state.settings, fallenFromHardcore: true };
    await saves.save(hard.sim, hard.session, 'death');
    const hc = await make('hardcore', 1, 'polarny-zenit-88', { enemyDensity: 'high', miningYield: 1 });
    // the second write creates a backup, then the main record gets corrupted
    await saves.save(hc.sim, hc.session, 'manual');
    const storage = (saves as unknown as { storage: { read: (s: unknown) => Promise<{ current: { data: string } }>; replace: (s: unknown, r: unknown) => Promise<unknown> } }).storage;
    const rec = await storage.read(hc.session.slot);
    await storage.replace(hc.session.slot, { ...rec, current: { ...rec.current, data: rec.current.data.replace('"credits":', '"credits":1') } });
  });

  await page.getByTestId('menu-load').click();
  await expect(page.getByTestId('load-game')).toBeVisible();
  for (const d of ['none', 'mild', 'hard', 'hardcore']) await expect(page.getByTestId(`load-col-${d}`)).toBeVisible();
  await expect(page.getByTestId('slot-hard-0')).toContainText('Padlý hrdina');
  await page.getByTestId('slot-mild-0').click();
  await expect(page.getByTestId('load-detail')).toContainText('3 480 kr');
  await expect(page.getByTestId('load-detail')).toContainText('1:42 h');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/m2c-load.png' });

  // damaged slot → load the backup
  await page.getByTestId('slot-hardcore-1').click();
  await expect(page.getByTestId('load-detail')).toContainText('kontrolný súčet');
  await expect(page.getByTestId('load-backup')).toBeVisible();

  // deletion with confirmation
  await page.getByTestId('slot-mild-2').click();
  await page.getByTestId('load-delete').click();
  await expect(page.getByRole('dialog')).toContainText('Naozaj zmazať');
  await page.getByRole('dialog').getByRole('button', { name: 'Zmazať' }).click();
  await expect(page.getByTestId('slot-mild-2')).toContainText('Prázdny slot');

  // loading the backup of a damaged game
  await page.getByTestId('slot-hardcore-1').click();
  await page.getByTestId('load-backup').click();
  await page.waitForFunction(() => window.__cinder !== undefined, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__cinder!.sim.state.settings.seedText)).toBe('polarny-zenit-88');
  expect(errors.filter((e) => !e.includes('Load failed'))).toEqual([]);
});

test('interface size slider scales the root font size', async ({ page }) => {
  await openMenu(page);
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  const root = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await root()).toBe('16px');
  await page.getByTestId('set-ui-scale').focus();
  await page.keyboard.press('End');
  await expect.poll(root).toBe('24px');
});

test('M2c: settings persist across reloads and apply to the game', async ({ page }) => {
  const errors = trackErrors(page);
  await openMenu(page);
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('set-master').fill('0.4');
  await page.getByTestId('set-zoom').fill('1.5');
  await page.getByTestId('set-help').getByRole('button', { name: 'Zbalená', exact: true }).click();
  await page.getByTestId('set-motion').getByRole('button', { name: 'Zapnutá' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', '');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/m2c-settings.png' });

  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}'));
  expect(stored).toMatchObject({ masterVolume: 0.4, zoomSensitivity: 1.5, showControlsHelp: false, reducedMotion: 'on' });
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('set-master')).toHaveValue('0.4');

  // restore defaults
  await page.getByTestId('settings-reset').click();
  await expect(page.getByTestId('set-master')).toHaveValue('0.9');
  await expect(page.locator('html')).not.toHaveAttribute('data-reduced-motion', '');
  expect(errors).toEqual([]);
});

test('M2c: leaving to the menu and starting again does not leak the game', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);
  await startNewGame(page, 'standard', 'leak-test-1');
  await waitTicks(page, 20);
  type Stats = { created: number; geometries: number; textures: number; programs: number };
  const stats: Stats[] = [];
  // 5 menu → Continue cycles: one WebGL renderer for all games (I6), shaders are not recompiled
  // and the GPU resources of the previous game are released
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.getByTestId('pause-quit').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    expect(await page.locator('#game canvas').count()).toBe(0);
    await page.getByTestId('menu-continue').click();
    await page.waitForFunction(() => window.__cinder !== undefined, null, { timeout: 30_000 });
    // a loaded game starts with the "Where I left off" card (M3.5a) – the simulation stands still until the player continues
    await page.getByTestId('resume-continue').click();
    await waitTicks(page, 20);
    expect(await page.locator('#game canvas').count()).toBe(1);
    stats.push((await page.evaluate(() => window.__cinderApp!.rendererStats()))!);
  }
  expect(stats.map((s) => s.created)).toEqual([1, 1, 1, 1, 1]);
  const [second, , , , last] = stats;
  expect(last!.programs).toBeLessThanOrEqual(second!.programs);
  expect(last!.geometries).toBeLessThanOrEqual(second!.geometries + 4);
  expect(last!.textures).toBeLessThanOrEqual(second!.textures + 2);
  const heap = await page.evaluate(() => (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  console.log('renderer stats per cycle', JSON.stringify(stats), 'JS heap', heap);
  // a new game into an occupied slot asks about overwriting; F5 saves anywhere
  await page.keyboard.press('F5');
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-phase', 'saved');
  expect(await page.evaluate(() => window.__cinderApp!.appState)).toEqual({ kind: 'game', overlay: null });
  expect(errors).toEqual([]);
});

test('M2c: hardcore death shows the death card and moves the game to Hard as a fallen hero', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);
  await startNewGame(page, 'hardcore', 'posledny-let-01');
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 30);

  // a volley of pirate shots from the front through the middle of the ship (the station is behind the ship) – parts fall off until the cockpit comes
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const { player, combat } = sim.state;
    player.shield = 0;
    const p = player.body.pos;
    for (let k = 0; k < 40; k++) {
      const pos = { x: p.x + 12 + k * 1.5, y: p.y };
      combat.projectiles.push({ id: 900000 + k, owner: 'e2e-pirate', pos, vel: { x: -90, y: 0 }, ttl: 600, damage: 99999, tier: 1, origin: pos });
    }
  });
  await expect(page.getByTestId('death-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('death-card')).toContainText('Padlý hrdina');
  // no pause during the card, the game stands still
  expect(await page.evaluate(() => window.__cinderApp!.appState)).toEqual({ kind: 'game', overlay: 'death' });
  await page.waitForTimeout(600); // karta „zacvakne“
  await page.screenshot({ path: 'test-results/m2c-death.png' });

  await page.getByTestId('death-continue').click();
  await expect(page.getByTestId('death-card')).toBeHidden();
  await expect(page.getByTestId('station-hub')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { destroyed: s.player.destroyed, mode: s.player.dock.mode, settings: s.settings, deaths: s.stats.deaths };
  });
  expect(after).toMatchObject({ destroyed: false, mode: 'docked', deaths: 1, settings: { deathPenalty: 'hard', fallenFromHardcore: true } });

  // the save moved to Hard (the hardcore slot is empty)
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-phase', 'saved');
  const slots = await page.evaluate(async () => (await window.__cinderApp!.saveService.overview()).map((o) => `${o.slot.difficulty}/${o.slot.index}:${o.state.kind}`));
  expect(slots).toEqual(['hard/0:ok']);
  expect(errors).toEqual([]);
});

test('I1: reloading the page during the death sequence does not dodge the penalty (hardcore still falls to Hard)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openMenu(page);
  await startNewGame(page, 'hardcore', 'posledny-let-02');
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 30);
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const { player, combat } = sim.state;
    player.shield = 0;
    const p = player.body.pos;
    for (let k = 0; k < 40; k++) {
      const pos = { x: p.x + 12 + k * 1.5, y: p.y };
      combat.projectiles.push({ id: 900000 + k, owner: 'e2e-pirate', pos, vel: { x: -90, y: 0 }, ttl: 600, damage: 99999, tier: 1, origin: pos });
    }
  });
  await page.waitForFunction(() => window.__cinder!.sim.state.player.destroyed, null, { timeout: 30_000 });
  // the wreckage is saved at once (before the death card) – the player reloads the page during the explosion
  await page.waitForFunction(async () => (await window.__cinderApp!.saveService.latest())?.saveReason === 'death');
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-continue').click();
  await expect(page.getByTestId('death-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('death-card')).toContainText('Padlý hrdina');
  await page.getByTestId('death-continue').click();
  await expect(page.getByTestId('station-hub')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    return { destroyed: s.player.destroyed, deaths: s.stats.deaths, settings: s.settings };
  });
  expect(after).toMatchObject({ destroyed: false, deaths: 1, settings: { deathPenalty: 'hard', fallenFromHardcore: true } });
  await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-phase', 'saved');
  const slots = await page.evaluate(async () => (await window.__cinderApp!.saveService.overview()).map((o) => `${o.slot.difficulty}/${o.slot.index}:${o.state.kind}`));
  expect(slots).toEqual(['hard/0:ok']);
  expect(errors).toEqual([]);
});

test('C2: abandoning the ship from the pause menu (danger confirmation) runs the death sequence', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await openMenu(page);
  await startNewGame(page, 'standard', 'opustena-lod-01');
  // the ship cannot be abandoned in the dock
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-scuttle')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await waitTicks(page, 10);

  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Opustiť loď?' });
  await page.getByTestId('pause-scuttle').click();
  await expect(confirm).toBeVisible();
  // dangerous action: focus is on "Back"; Esc in the dialog only cancels the confirmation, the pause stays
  await expect(confirm.getByRole('button', { name: 'Späť' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-scuttle').click();
  await confirm.getByRole('button', { name: 'Opustiť loď' }).click();
  await expect(page.getByTestId('death-card')).toBeVisible({ timeout: 30_000 });
  // a voluntary scuttle is never cheaper than a tow: the card names the Guild's tow fee
  await expect(page.getByTestId('death-card')).toContainText('Cech odtiahne vrak');
  await page.screenshot({ path: `${test.info().project.outputDir}/c2-scuttle-death-card.png` });
  await page.getByTestId('death-continue').click();
  await expect(page.getByTestId('station-hub')).toBeVisible();
  expect(await page.evaluate(() => window.__cinder!.sim.state.stats.deaths)).toBe(1);
  expect(errors).toEqual([]);
});

test('M5: a second tab cannot open the game another tab is playing until it is left', async ({ page, context }) => {
  test.setTimeout(90_000);
  await openMenu(page);
  await startNewGame(page, 'hard', 'dve-karty-01');
  await expect(page.getByTestId('station-hub')).toBeVisible();

  const second = await context.newPage();
  const errors = trackErrors(second);
  await openMenu(second);
  await second.getByTestId('menu-continue').click();
  await expect(second.getByTestId('menu-error')).toContainText('inej karte');
  expect(await second.evaluate(() => window.__cinderApp!.appState)).toMatchObject({ kind: 'menu' });

  // the first tab leaves to the menu → the lock is released and the second tab opens the game
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });
  await second.getByTestId('menu-continue').click();
  await second.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 30_000 });
  expect(await second.evaluate(() => window.__cinder!.sim.state.settings.seedText)).toBe('dve-karty-01');
  expect(errors).toEqual([]);
});

test('M2c: "New game here" from the load screen preselects the slot and its difficulty', async ({ page }) => {
  await openMenu(page);
  await page.getByTestId('menu-load').click();
  await page.getByTestId('slot-hard-2').click();
  await page.getByTestId('load-new-here').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await expect(page.getByTestId('preset-hard')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ng-slot-2')).toHaveAttribute('aria-checked', 'true');
  // Esc goes back to the menu
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-game')).toBeHidden();
  await expect(page.getByTestId('menu-new')).toBeFocused();
});

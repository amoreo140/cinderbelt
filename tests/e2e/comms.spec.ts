import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { approachClamp } from './dockHelper';
import { loadFixture } from './fixtures';

// Communicator (part A): station traffic control answers a docking request,
// a pirate demands a toll in the comm panel (pay / refuse with the buttons and with Y / X), a captain
// taunts during a fight, the issuer speaks for a contract in the dock, the comm log (L) keeps the
// history and the Radio setting switches it all back to toasts.
// Screenshots: test-results-comms-shots/comms-*.png

// screenshots outside the --output folder (Playwright empties that one at every run)
const OUT = 'test-results-comms-shots';

function collectErrors(page: Page): string[] {
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

async function play(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, null, { timeout: 90_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    const g = window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean };
    g.helpOpen = false;
    g.helpTouched = true;
  });
}

/** Undock and place the stopped ship at a point (chunks load around it). */
async function flyTo(page: Page, pos: { x: number; y: number }): Promise<void> {
  if (await page.getByTestId('station-hub').isVisible()) {
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('station-hub')).toBeHidden();
  }
  await page.evaluate(([x, y]) => {
    const { sim } = window.__cinder!;
    const body = { pos: { x, y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    sim.state.player.body = body;
    sim.state.player.prevBody = body;
    sim.state.player.dampers = true;
    sim.state.world.update(body.pos);
  }, [pos.x, pos.y] as const);
  await waitTicks(page, 30);
}

/** Clear the radio so the next message shows at once (the start of a flight has its own chatter). */
async function quietRadio(page: Page): Promise<void> {
  await page.evaluate(() => (window.__cinder!.game as unknown as { comms: { queue: { clear(): void } } }).comms.queue.clear());
}

/** A toll demand by a Hammer-led group next to the ship (as the sim stages it). */
async function stageToll(page: Page, group: string, credits: number): Promise<void> {
  await page.evaluate(
    async ([path, g, kr]) => {
      const en = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/combat/enemies');
      const s = window.__cinder!.sim.state;
      s.combat.enemies = [];
      const p = s.player.body.pos;
      const home = { x: p.x + 50, y: p.y + 10 };
      for (const [i, kind] of (['hammer', 'jackal', 'jackal'] as const).entries()) {
        const e = en.createEnemy({ id: `${g}:${i}`, kind, tier: 1, pos: { x: home.x + i * 8, y: home.y + (i % 2) * 6 }, angle: Math.PI, home, orbit: 1 });
        e.ai.mode = 'hail';
        s.combat.enemies.push(e);
      }
      s.credits = kr;
      s.pirates.toll = { group: g, amount: 650, until: s.tick + 20 * 60 };
    },
    ['/src/sim/combat/enemies.ts', group, credits] as const,
  );
}

test('radio: traffic control answers docking, the toll is answered in the comm panel, the log keeps it all', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await play(page);
  const panel = page.getByTestId('comm-panel');

  // the issuer of a contract speaks in the dock (the old toast is the note)
  await page.keyboard.press('Digit6');
  const offerId = await page.evaluate(() => window.__cinder!.sim.state.career.boards.get('home')!.offers[0]!.id);
  await page.getByTestId(`accept-${offerId}`).click();
  await expect(page.getByTestId('comm-speaker')).toContainText('kontrakty');
  await expect(page.getByTestId('comm-text')).toContainText('Kontrakt prijatý');
  await expect(page.getByTestId('toast')).toBeHidden();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/comms-docked-contract.png` });

  // a docking request too far from the clamp: the station's traffic control says no, at once
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('station-hub')).toBeHidden();
  await approachClamp(page, { stationId: 'home', offset: 7 });
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('comm-speaker')).toHaveText('Základňa Počiatok · riadenie');
  await expect(page.getByTestId('comm-text')).toContainText('Príliš ďaleko od dokovacej svorky');
  await expect(page.locator('[data-speaker="traffic:home"]')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/comms-dock-rejected.png` });

  // a toll demand in the outer belts: the pirate speaks, the panel has the answers (and the HUD band is gone)
  await flyTo(page, { x: 1300, y: -900 });
  await quietRadio(page);
  await stageToll(page, 'pr:99,99', 4000);
  await expect(panel.getByTestId('toll')).toBeVisible();
  await expect(page.getByTestId('comm-speaker')).toHaveText('Kladivo Hrdze');
  await expect(page.getByTestId('comm-text')).toContainText('650 kr');
  await expect(page.locator('.pr-toll')).toHaveCount(0);
  await expect(page.getByTestId('toll-pay')).toBeVisible();
  await expect(page.getByTestId('toll-refuse')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/comms-toll.png` });
  // pay with the button in the panel
  await page.getByTestId('toll-pay').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(3350);
  await expect(panel.getByTestId('toll')).toHaveCount(0);
  await expect(page.getByTestId('comm-text')).toContainText('Mýto zaplatené');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/comms-toll-paid.png` });

  // another group: refuse with the X key – they attack
  await stageToll(page, 'pr:98,98', 100);
  await expect(panel.getByTestId('toll')).toBeVisible();
  await expect(page.getByTestId('toll-pay')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('KeyX');
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null);
  await expect(page.getByTestId('comm-text')).toContainText('Mýto odmietnuté');
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(100);

  // a named captain taunts when he joins the fight (the combat HUD around it)
  await page.evaluate(async (path) => {
    const cap = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/captains/captains');
    const s = window.__cinder!.sim.state;
    s.combat.enemies = [];
    s.pirates.toll = null;
    const p = s.player.body.pos;
    s.combat.enemies.push(cap.createCaptainEnemy(5, 3, { x: p.x + 70, y: p.y + 20 }, Math.PI));
  }, '/src/sim/captains/captains.ts');
  await quietRadio(page);
  await expect(page.locator('[data-speaker="cap:5"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.cm-panel.is-danger')).toBeVisible();
  await page.mouse.move(820, 330);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/comms-combat-captain.png` });

  // the comm log (L): everything said so far, newest first
  await page.keyboard.press('KeyL');
  const log = page.getByTestId('comm-log');
  await expect(log).toBeVisible();
  const items = log.getByTestId('comm-log-item');
  expect(await items.count()).toBeGreaterThanOrEqual(5);
  await expect(log).toContainText('Kladivo Hrdze');
  await expect(log).toContainText('Základňa Počiatok · riadenie');
  await expect(log).toContainText('Mýto zaplatené');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/comms-log.png` });
  await page.keyboard.press('Escape');
  await expect(log).toBeHidden();
  // Esc closed the log, not the game
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

test('radio setting: "off" brings the toasts back, "important" keeps danger and drops station chatter', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await play(page);
  // the setting lives in Settings → Controls
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-settings').click();
  const radio = page.getByTestId('set-radio');
  await expect(radio).toBeVisible();
  await radio.getByRole('button', { name: 'Vypnuté' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/comms-settings.png` });
  await page.getByTestId('sheet-back').click();
  await page.getByTestId('pause-resume').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();

  // off: a docking rejection is a toast again, the radio stays silent
  await page.getByTestId('undock').click();
  await expect(page.getByTestId('station-hub')).toBeHidden();
  // the first flight's notices (a distress call nearby, its journal entry) pass first
  await waitTicks(page, 360);
  await approachClamp(page, { stationId: 'home', offset: 7 });
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('toast')).toContainText('Príliš ďaleko od dokovacej svorky');
  await expect(page.getByTestId('comm-panel')).toHaveCount(0);
  // the toll is the old band in the HUD
  await flyTo(page, { x: 1300, y: -900 });
  await stageToll(page, 'pr:97,97', 4000);
  await expect(page.locator('.pr-toll')).toBeVisible();
  await expect(page.getByTestId('comm-panel')).toHaveCount(0);
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null);
  await expect(page.getByTestId('toast')).toContainText('Mýto zaplatené');

  // important only: station traffic is a toast, a pirate still speaks
  await page.evaluate(() => (window.__cinder!.game as unknown as { setRadio(s: string): void }).setRadio('important'));
  await stageToll(page, 'pr:96,96', 4000);
  await expect(page.getByTestId('comm-panel').getByTestId('toll')).toBeVisible();
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null);
  await expect(page.getByTestId('comm-text')).toContainText('Mýto zaplatené');
  // … and the station's answer to a docking request is a toast
  await flyTo(page, { x: 40, y: 0 });
  await approachClamp(page, { stationId: 'home', offset: 7 });
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('toast')).toContainText('Príliš ďaleko od dokovacej svorky');
  await expect(page.locator('[data-speaker="traffic:home"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// --- part B: the Guild instructor of the training and the scripted first contacts ---------------------

/** A new game from the menu with the Guild Training (as a player starts it). */
async function newTrainingGame(page: Page, seed: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-standard').click();
  await page.getByTestId('seed-input').fill(seed);
  await page.getByTestId('ng-training').getByRole('button', { name: 'Hrať výcvik' }).click();
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 120_000 });
  await page.evaluate(() => {
    const g = window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean };
    g.helpOpen = false;
    g.helpTouched = true;
  });
}

/** The step panel and the comm panel never cover each other. */
async function noOverlap(page: Page): Promise<void> {
  const step = await page.getByTestId('training-panel').boundingBox();
  const radio = await page.getByTestId('comm-panel').boundingBox();
  expect(step).not.toBeNull();
  expect(radio).not.toBeNull();
  const apart = step!.y + step!.height <= radio!.y || radio!.y + radio!.height <= step!.y || step!.x + step!.width <= radio!.x || radio!.x + radio!.width <= step!.x;
  expect(apart, `step panel ${JSON.stringify(step)} vs radio ${JSON.stringify(radio)}`).toBe(true);
}

/** Screenshot at 1280×720 and at 1920×1080, both checked for overlap (the window size is restored). */
async function shotBoth(page: Page, name: string): Promise<void> {
  // the message typed out (its full height is reserved from the start)
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-rest')].every((e) => !e.textContent), null, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await noOverlap(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  await noOverlap(page);
  await page.screenshot({ path: `${OUT}/${name}-1080.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
}

/** The instructor's idle clock as if the player had done nothing for a minute. */
async function idleMinute(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ins = (window.__cinder!.game as unknown as { comms: { instructor: { idleSince: number } } }).comms.instructor;
    ins.idleSince -= 61;
  });
}

/** Places the stopped ship at a point (chunks load around it). */
async function placeShip(page: Page, pos: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const s = window.__cinder!.sim.state;
    const body = { pos: { x, y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    s.player.body = body;
    s.player.prevBody = body;
    s.world.update(body.pos);
  }, [pos.x, pos.y] as const);
}

test('radio part B: the Guild instructor talks the training through – intro, nudge, praise with the reward', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await newTrainingGame(page, 'komunikator-b');
  const step = page.getByTestId('training-panel');

  // step 1, docked: the instructor introduces himself; the step panel keeps the title, the keys and the reward
  await expect(page.getByTestId('comm-speaker')).toHaveText('Majster Bartoš', { timeout: 20_000 });
  await expect(page.locator('[data-speaker="instructor"]')).toBeVisible();
  await expect(page.getByTestId('comm-text')).toContainText('bóji');
  await expect(step).toContainText('Doleť k bóji Cechu');
  await expect(step).toContainText('Odmena');
  await expect(step.locator('.tr-note')).toHaveCount(0);
  await shotBoth(page, 'b-step1-docked');

  // in flight the panel is compact: W / S / A-D, no prose (the instructor says it)
  await page.getByTestId('undock').click();
  await expect(page.getByTestId('station-hub')).toBeHidden();
  await expect(step).toContainText('brzdenie spätným motorom');
  await expect(step).not.toContainText('Tlmiče (Z) brzdia samy');
  await waitTicks(page, 30);
  // a minute without progress: a nudge
  await quietRadio(page);
  await idleMinute(page);
  await expect(page.getByTestId('comm-speaker')).toHaveText('Majster Bartoš', { timeout: 20_000 });
  await shotBoth(page, 'b-step1-nudge');

  // step 1 done at the buoy: praise with the reward and the intro of step 2 in one message
  await page.evaluate(() => {
    const b = window.__cinder!.sim.state.career.training.sites!.buoyA;
    const s = window.__cinder!.sim.state;
    const body = { pos: { ...b }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    s.player.body = body;
    s.player.prevBody = body;
    s.world.update(b);
  });
  await expect(page.getByTestId('comm-text')).toContainText('50 kr', { timeout: 20_000 });
  await expect(page.getByTestId('comm-text')).toContainText(/želez/i);
  await expect(step).toContainText('Vyťaž 20 železa');
  // the step toast is gone: the instructor said it
  await expect(page.getByTestId('toast')).toBeHidden();
  // by the training rock for the screenshot
  const rock = await page.evaluate(() => window.__cinder!.sim.state.career.training.sites!.rockPos);
  await placeShip(page, { x: rock.x - 14, y: rock.y });
  await shotBoth(page, 'b-step2-praise');

  // step 2 done (the iron mined): praise and the dock step – one of the longest messages in flight
  await page.evaluate(() => {
    window.__cinder!.sim.state.stats.mined.iron += 20;
  });
  await expect(page.getByTestId('comm-text')).toContainText('100 kr', { timeout: 20_000 });
  await expect(step).toContainText('Pristaň doma');
  await shotBoth(page, 'b-step3-praise');

  // step 5 (the brake buoy) in flight
  await page.evaluate(() => {
    window.__cinder!.sim.state.career.training.step = 4;
  });
  await expect(page.getByTestId('comm-text')).toContainText('druhej bóji', { timeout: 20_000 });
  await expect(step).toContainText('Zastav pri druhej bóji');
  await shotBoth(page, 'b-step5-brake');

  // the log keeps what the instructor said
  await page.keyboard.press('KeyL');
  await expect(page.getByTestId('comm-log')).toContainText('Majster Bartoš');
  await page.keyboard.press('KeyL');
  expect(errors).toEqual([]);
});

test('radio part B: step 4 in the dock and in the shipyard (training-mid fixture)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'training-mid');
  // a loaded game mid-training: the instructor says what the current step is about
  await expect(page.getByTestId('comm-speaker')).toHaveText('Majster Bartoš', { timeout: 20_000 });
  await expect(page.getByTestId('comm-text')).toContainText('motor');
  await expect(page.getByTestId('training-panel')).toContainText('Namontuj 2 bočné motory');
  await shotBoth(page, 'b-step4-docked');
  // the shipyard editor: the radio waits, the step panel guides the editor
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('comm-panel')).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/b-step4-shipyard.png` });
  expect(errors).toEqual([]);
});

test("radio part B: the first pirates – the taunt, the instructor's warning, the retort", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await newTrainingGame(page, 'komunikator-b-pirates');
  await page.getByTestId('undock').click();
  await expect(page.getByTestId('station-hub')).toBeHidden();
  await waitTicks(page, 60);
  await quietRadio(page);
  // a Jackal pair in front of the ship notices it (the sim raises the alert)
  await page.evaluate(async (path) => {
    const en = (await import(/* @vite-ignore */ path)) as typeof import('../../src/sim/combat/enemies');
    const s = window.__cinder!.sim.state;
    const p = s.player.body.pos;
    const home = { x: p.x + 70, y: p.y - 20 };
    for (let i = 0; i < 2; i++) s.combat.enemies.push(en.createEnemy({ id: `pr:9,9:${i}`, kind: 'jackal', tier: 1, pos: { x: home.x + i * 8, y: home.y + i * 5 }, angle: Math.PI, home, orbit: 1 }));
  }, '/src/sim/combat/enemies.ts');
  await expect(page.locator('[data-speaker="pirate:jackal"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.cm-panel.is-danger')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/b-pirates-1-taunt.png` });
  // the training hull would not survive the wait: the pair keeps its distance (a truce) from now on
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.pirates.paid.set('pr:9,9', s.tick + 60 * 600);
  });
  await expect(page.locator('[data-speaker="instructor"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('comm-text')).toContainText('Hrdz');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/b-pirates-2-warning.png` });
  await expect(page.locator('[data-speaker="pirate:jackal"]')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/b-pirates-3-retort.png` });
  expect(errors).toEqual([]);
});

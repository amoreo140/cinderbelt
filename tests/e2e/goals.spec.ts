import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { dockAtClamp } from './dockHelper';

// M3.5a "Why": Board (contracts, factions, quests), Goals (strip + panel), "First day", Depots
// with a courier, the "Where I left off" card and the course of one contract from accepting to handing in.
// Screenshots: test-results-m35a/m35a-*.png

const OUT = 'test-results-m35a';

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

async function play(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
}

/** Game time at the start of an epoch in which the home sector has 2 modifiers (local conditions). */
async function busySector(page: Page): Promise<void> {
  await page.evaluate(async (paths) => {
    const sector = (await import(paths[0]!)) as typeof import('../../src/sim/sector/sector');
    const data = (await import(paths[1]!)) as typeof import('../../src/data/sector');
    const regions = (await import(paths[2]!)) as typeof import('../../src/sim/regions/sectors');
    const { sim } = window.__cinder!;
    const home = regions.sectorIdAt(sim.state.seed, 0, 0);
    for (let e = 2; e < 4000; e++) {
      const mods = sector.sectorState(sim.state.seed, home, e).modifiers;
      // P1 no longer has the warning (the ion season belongs to P2+, M3.5b) – 2 modifiers are enough
      if (mods.length === 2) {
        sim.state.tick = e * data.SECTOR_EPOCH_TICKS + 600;
        sim.state.career.boards.clear();
        return;
      }
    }
    throw new Error('no busy sector');
  }, ['/src/sim/sector/sector.ts', '/src/data/sector.ts', '/src/sim/regions/sectors.ts']);
}

test('M3.5a: board tab with contract slips, factions and wanted captains', async ({ page }) => {
  // ~50 s alone; six full-screen shots of the hub under a software renderer take much longer on a busy machine
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await play(page);
  await busySector(page);
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    sim.state.career.rep.guild = { points: 720, level: 3, assignments: {} };
    sim.state.career.rep.institute = { points: 140, level: 1, assignments: {} };
    sim.state.career.boards.clear();
    sim.state.credits = 3480;
  });
  await waitTicks(page, 30);
  await page.screenshot({ path: `${OUT}/m35a-overview.png` });
  await page.keyboard.press('Digit6');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('board-sector')).not.toContainText('Pokojná');
  const offers = await page.locator('[data-testid^="offer-"]').count();
  expect(offers).toBeGreaterThanOrEqual(3);
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/m35a-board.png` });
  await page.locator('.hub-body').evaluate((el) => el.scrollTo(0, 420));
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-board-offers.png` });

  // factions: Institute 1 with points for level 2, a Guild assignment (level 3 = the maximum of this version)
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    // M3.5b: the Institute 2 assignment is with the scanner (5 anomaly scans or a hideout)
    sim.state.career.rep.institute = { points: 260, level: 1, assignments: { 'inst2-anomalies': 1 } };
    sim.state.career.rep.guild = { points: 720, level: 2, assignments: {} };
    sim.state.stations.get('home')!.resources.titanium = 45;
  });
  await page.getByRole('button', { name: 'Frakcie' }).click();
  await expect(page.getByTestId('faction-institute')).toContainText('Úroveň 1');
  await expect(page.getByTestId('faction-institute')).toContainText('alebo');
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-factions.png` });
  // Guild assignment "deliver 300 Ti" – hands in 45 from the depot
  await page.getByTestId('deliver-guild').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.rep.guild.assignments['guild3-titanium'] === 45);

  await page.getByRole('button', { name: 'Hľadaní' }).click();
  await expect(page.locator('[data-testid^="captain-"]')).toHaveCount(6);
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-wanted.png` });
  expect(errors).toEqual([]);
});

test('M3.5a: one contract from acceptance to turn-in (buoy survey)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await play(page);
  // Institute survey a little way from home (a slip on the station board)
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    const board = sim.state.career.boards.get('home')!;
    board.offers.unshift({
      id: `home@${board.epoch}.90`,
      type: 'survey',
      faction: 'institute',
      station: 'home',
      ring: 1,
      risk: 0,
      target: { kind: 'survey', points: [{ x: 70, y: -70 }, { x: 125, y: -40 }, { x: 115, y: -105 }] },
      modifiers: [],
      bonus: 0,
      part: null,
    });
  });
  await page.keyboard.press('Digit6');
  const offerId = await page.evaluate(() => window.__cinder!.sim.state.career.boards.get('home')!.offers[0]!.id);
  await page.getByTestId(`accept-${offerId}`).click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.contracts.length === 1);
  await expect(page.getByTestId('contract-1')).toContainText('Rozmiestni bóju 1/3');
  // the issuer speaks on the radio; the old toast text is the message's note
  await expect(page.getByTestId('comm-text')).toContainText('Kontrakt prijatý');
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-contract-accepted.png` });
  const reward = await page.evaluate(() => window.__cinder!.sim.state.career.contracts[0]!.reward);

  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await expect(page.getByTestId('objective-band')).toContainText('Rozmiestni bóju 1/3');
  // the contract target on the map too
  await page.keyboard.press('KeyM');
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/m35a-map.png` });
  await page.keyboard.press('KeyM');

  // three points: the ship at the point, F releases a buoy
  for (let i = 0; i < 3; i++) {
    await page.evaluate((index) => {
      const { sim } = window.__cinder!;
      const c = sim.state.career.contracts[0]!;
      if (c.target.kind !== 'survey') throw new Error('not a survey');
      const p = c.target.points[index]!;
      const body = { pos: { x: p.x - 4, y: p.y }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
    }, i);
    await expect(page.getByTestId('dock-prompt')).toContainText('vypustiť meraciu bóju');
    if (i === 1) {
      await waitTicks(page, 30);
      await page.screenshot({ path: `${OUT}/m35a-contract-buoy.png` });
    }
    await page.keyboard.press('KeyF');
    await page.waitForFunction((n) => window.__cinder!.sim.state.career.contracts[0]!.progress === n, i + 1);
  }
  await expect(page.getByTestId('comm-text')).toContainText('Kontrakt splnený');
  await waitTicks(page, 20);
  await page.screenshot({ path: `${OUT}/m35a-contract-ready.png` });

  // back home by the dock clamp and turn the contract in
  await dockAtClamp(page, { stationId: 'home' });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await waitTicks(page, 5);
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('board')).toBeVisible();
  const credits = await page.evaluate(() => window.__cinder!.sim.state.credits);
  await expect(page.getByTestId('turnin-1')).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('turnin-1').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.contracts.length === 0);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(credits + reward);
  await expect(page.getByTestId('comm-text')).toContainText('Kontrakt odovzdaný');
  expect(await page.evaluate(() => window.__cinder!.sim.state.career.rep.institute.points)).toBeGreaterThan(0);
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-contract-done.png` });
  expect(errors).toEqual([]);
});

test('M3.5a: objectives band and panel', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    sim.state.career.rep.guild = { points: 300, level: 1, assignments: { 'guild2-deliveries': 2 } };
    sim.state.stats.mined.iron += 12;
  });
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await expect(page.getByTestId('objective-band')).toContainText('Vyťaž náklad');
  // the second line: "First chart" until the first chart is sold (sectors §6.6), then today's next goal –
  // the story (Echo-0) comes before the next ship part
  await expect(page.getByTestId('objective-band')).toContainText('Prvá mapa');
  await waitTicks(page, 30);
  await page.screenshot({ path: `${OUT}/m35a-objectives-band.png` });

  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('objectives-panel')).toBeVisible();
  await expect(page.getByTestId('objective-career:guild')).toContainText('ALEBO');
  await expect(page.getByTestId('objective-main:ring2')).toContainText('hĺbky 2');
  await expect(page.getByTestId('objectives-panel')).toContainText('Zameraj Ozvenu-0');
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-objectives.png` });
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('objectives-panel')).toBeHidden();
  // aj z pauzy: Ciele a Sklady
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.screenshot({ path: `${OUT}/m35a-pause.png` });
  await page.getByTestId('pause-storages').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await expect(page.getByTestId('storages')).toBeVisible();
  // the first frame after a pause the game drops key presses (the Esc that closed the pause)
  await waitTicks(page, 10);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('storages')).toBeHidden();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  expect(errors).toEqual([]);
});

test('M3.5a: storages overview and courier', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  const other = await page.evaluate(async (path) => {
    const st = (await import(path)) as typeof import('../../src/sim/world/stations');
    const { sim } = window.__cinder!;
    const [g1] = st.guaranteedStationChunks(sim.state.seed);
    const s = st.stationAt(sim.state.seed, g1.cx, g1.cy)!;
    sim.state.world.discovered.add(s.id);
    sim.state.career.rep.guild = { points: 260, level: 2, assignments: {} };
    sim.state.stations.set(s.id, { resources: { iron: 0, copper: 0, ice: 0, titanium: 84 }, parts: { 'engine:2': 3 } });
    const home = sim.state.stations.get('home')!;
    home.resources.iron = 140;
    home.resources.copper = 36.5;
    sim.state.credits = 2500;
    return s.id;
  }, '/src/sim/world/stations.ts');
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('storages')).toBeVisible();
  await expect(page.getByTestId(`storage-${other}`)).toContainText('Motor');
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-storages.png` });
  await page.getByTestId('storages-search').fill('titán');
  await expect(page.getByTestId('storage-home')).toHaveCount(0);
  await page.getByTestId('storages-search').fill('');
  await page.getByTestId('courier-home').click();
  await expect(page.getByTestId('courier-form')).toBeVisible();
  await waitTicks(page, 10);
  await page.screenshot({ path: `${OUT}/m35a-courier.png` });
  await page.getByTestId('courier-send').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.shipments.length === 1);
  await expect(page.getByTestId('shipment')).toBeVisible();
  expect(await page.evaluate(() => window.__cinder!.sim.state.stations.get('home')!.resources.iron)).toBe(0);
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('storages')).toBeHidden();
  expect(errors).toEqual([]);
});

test('M3.5a: “where I left off” card after loading a saved game', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-standard').click();
  await page.getByTestId('seed-input').fill('kde-som-skoncil-1');
  // the training would keep the Board tab locked
  await page.getByTestId('ng-training').getByRole('button', { name: 'Preskočiť výcvik' }).click();
  await page.getByTestId('new-game-start').click();
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 5, null, { timeout: 30_000 });
  await expect(page.getByTestId('station-hub')).toBeVisible();
  // a contract from the board and a flight with cargo
  const offer = await page.evaluate(() => window.__cinder!.sim.state.career.boards.get('home')!.offers[0]!.id);
  await page.keyboard.press('Digit6');
  await page.getByTestId(`accept-${offer}`).click();
  await page.waitForFunction(() => window.__cinder!.sim.state.career.contracts.length === 1);
  await page.getByTestId('undock').click();
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.evaluate(() => {
    const { sim } = window.__cinder!;
    sim.state.player.cargo.iron = 42;
    sim.state.player.cargo.copper = 18;
    sim.state.tick += 60 * 60 * 40;
  });
  await waitTicks(page, 10);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('menu-continue').click();
  await expect(page.getByTestId('resume-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('resume-card')).toContainText('Si v lete');
  await expect(page.getByTestId('resume-card')).toContainText('42 Železo');
  await expect(page.getByTestId('resume-card')).toContainText('Prijatý kontrakt');
  // the simulation stands still until the player continues
  const frozen = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__cinder!.sim.state.tick)).toBe(frozen);
  await page.screenshot({ path: `${OUT}/m35a-resume.png` });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('resume-card')).toBeHidden();
  await waitTicks(page, 10);
  expect(errors).toEqual([]);
});

test('M3.5a: ui kit – contract slips, objective band and sector state', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui-kit.html');
  const section = page.locator('.kit-section', { hasText: 'Contracts and goals' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await section.screenshot({ path: `${OUT}/m35a-kit.png` });
  expect(errors).toEqual([]);
});

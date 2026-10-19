import { expect, test } from './test';
import type { Page } from '@playwright/test';

// M3.8 – flight feel and damage feedback: a crash into an asteroid costs a part (toast, the gap in the
// silhouette, the status line), the shipyard restores the design, the collision warning and the
// flight-path marker. Screenshots go to the Playwright output folder (--output).

const MODULES = { dock: '/src/sim/station/dock.ts', stations: '/src/sim/world/stations.ts' } as const;

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });

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

async function startFlying(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying');
  await page.keyboard.press('KeyK'); // help collapsed – the screenshots need the screen
}

/**
 * An asteroid well away from home and pirates, the ship `gap` units in front of it flying at `speed`.
 * The ship waits there still for a moment first – the camera and the new rocks catch up (software
 * WebGL draws the first frames of a new area slowly).
 */
async function aimAtAsteroid(page: Page, gap: number, speed: number, weakBow: boolean): Promise<{ id: string }> {
  await place(page, gap, 0, false);
  await page.waitForTimeout(2500);
  return place(page, gap, speed, weakBow);
}

async function place(page: Page, gap: number, speed: number, weakBow: boolean): Promise<{ id: string }> {
  return page.evaluate(
    ({ gap, speed, weakBow }) => {
      const { sim } = window.__cinder!;
      const world = sim.state.world;
      const player = sim.state.player;
      // somewhere quiet in ring 1, then the nearest big rock there
      const spot = { x: 900, y: 700 };
      const set = (pos: { x: number; y: number }, vel: { x: number; y: number }) => {
        const body = { pos, vel, angle: 0, angVel: 0 };
        player.body = body;
        player.prevBody = body;
      };
      set(spot, { x: 0, y: 0 });
      world.update(spot);
      const rocks = world
        .asteroids()
        .map((a) => ({ a, r: world.radiusOf(a) }))
        .filter((x) => x.r > 3 && x.r < 9)
        .sort((p, q) => Math.hypot(p.a.pos.x - spot.x, p.a.pos.y - spot.y) - Math.hypot(q.a.pos.x - spot.x, q.a.pos.y - spot.y));
      const rock = rocks[0]!;
      // fly along +x into the rock's centre
      set({ x: rock.a.pos.x - rock.r - player.props.boundingRadius - gap, y: rock.a.pos.y }, { x: speed, y: 0 });
      sim.state.combat.enemies = [];
      sim.state.combat.projectiles = [];
      player.dampers = false;
      if (weakBow) {
        // the bow parts are worn – the impact takes one of them off
        for (const p of player.grid.parts) if (p.x === 2) player.hp.set(p.id, 2);
      }
      return { id: rock.a.id };
    },
    { gap, speed, weakBow },
  );
}

test('M3.8: a crash costs a part – toast, gap in the silhouette, status line', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await startFlying(page);
  await page.mouse.move(640, 200);

  await aimAtAsteroid(page, 6, 30, true);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.grid.parts.length < 14, undefined, { timeout: 30_000 });
  // freeze right after the loss so the toast and the flash are in the shot
  await page.waitForTimeout(250);
  await expect(page.getByTestId('toast')).toContainText('Stratený diel');
  const status = page.getByTestId('damaged-parts');
  await expect(status).toContainText('stratený');
  expect(Number(await status.getAttribute('data-missing'))).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="ship-silhouette"] .is-missing').first()).toBeAttached();
  await shot(page, 'm38-crash-part-lost');
  // zoomed console crop
  await page.getByTestId('ship-status').screenshot({ path: `${test.info().project.outputDir}/m38-crash-status.png` });

  // --- home: the overview offers the restore, the shipyard rebuilds the design in one click
  // (the lost laser is bought: a player whose ship is worth more than a laser gets no Guild loan)
  await page.evaluate(() => {
    window.__cinder!.sim.state.credits = 5000;
  });
  await dockHome(page);
  await expect(page.getByTestId('design-gap')).toBeVisible();
  await expect(page.getByTestId('design-gap')).toContainText('Ťažobný laser');
  await shot(page, 'm38-hub-design-gap');
  await page.getByTestId('design-gap-restore').click();
  await expect(page.getByTestId('shipyard')).toBeVisible();
  await expect(page.getByTestId('yard-restore-band')).toHaveAttribute('data-applied', 'true');
  await expect(page.getByTestId('toast')).toContainText('Návrh obnovený');
  await page.waitForTimeout(400);
  await shot(page, 'm38-shipyard-restored');
  // back one step: the band offers the restore again and the hangar shows the red sockets
  await page.getByTestId('yard-undo').click();
  await expect(page.getByTestId('yard-restore-band')).toHaveAttribute('data-applied', 'false');
  await page.waitForTimeout(400);
  await shot(page, 'm38-shipyard-sockets');
  await page.getByTestId('yard-restore-design').click();
  await expect(page.getByTestId('yard-commit')).toBeEnabled();
  await page.getByTestId('yard-commit').click();
  await page.waitForFunction(() => {
    const p = window.__cinder!.sim.state.player;
    return p.grid.parts.length === 14 && p.blueprint === p.grid;
  });
  // only the worn engines are left – the band now offers to swap them
  await expect(page.getByTestId('yard-restore-band')).toContainText('poškoden');
  await shot(page, 'm38-shipyard-committed');

  expect(errors).toEqual([]);
});

test('M3.8: collision warning, flight-path marker, stopping point and speed streaks', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await startFlying(page);
  await page.mouse.move(640, 160);

  // --- on course for a rock at speed: the band over the ship, the ring on the rock, a beep
  // (zoomed out a little so the rock ahead is in the shot)
  await page.mouse.wheel(0, 900);
  await aimAtAsteroid(page, 46, 20, false);
  await expect(page.getByTestId('collision-warning')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('collision-warning')).toContainText('Kolízia');
  await page.waitForFunction(() => window.__cinder!.renderer.flightMarkerStats().obstacle);
  await page.evaluate(() => window.__cinder!.game.setPaused(true));
  await page.waitForTimeout(700);
  await shot(page, 'm38-collision-warning');
  await page.evaluate(() => window.__cinder!.game.setPaused(false));

  // closer = more urgent (red)
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="collision-warning"]')?.getAttribute('data-urgency') ?? 0) > 0.6, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__cinder!.game.setPaused(true));
  await page.waitForTimeout(700);
  await shot(page, 'm38-collision-critical');
  await page.evaluate(() => window.__cinder!.game.setPaused(false));

  // --- drifting sideways with the bow ahead: the marker shows the real path, the bar where the dampers stop
  await flyAt(page, { x: 1400, y: -2600 }, { x: 9, y: 9 }, 0, true);
  await page.waitForFunction(() => {
    const s = window.__cinder!.renderer.flightMarkerStats();
    return s.prograde && s.stop;
  });
  await expect(page.getByTestId('collision-warning')).toHaveCount(0);
  await page.evaluate(() => window.__cinder!.game.setPaused(true));
  await page.waitForTimeout(700);
  await shot(page, 'm38-flight-marker');
  await page.evaluate(() => window.__cinder!.game.setPaused(false));

  // --- full speed: the dust streaks past (no rocks out here)
  await flyAt(page, { x: 1400, y: -2600 }, { x: 0, y: 38 }, Math.PI / 2, false);
  await page.keyboard.down('KeyW');
  await waitTicks(page, 20);
  await page.evaluate(() => window.__cinder!.game.setPaused(true));
  await page.waitForTimeout(700);
  await shot(page, 'm38-speed-streaks');
  await page.evaluate(() => window.__cinder!.game.setPaused(false));
  await page.keyboard.up('KeyW');

  // the marker can be switched off in the settings
  await page.evaluate(() => window.__cinder!.game.setFlightSettings({ marker: false, shake: true, reducedMotion: false }));
  await page.waitForFunction(() => !window.__cinder!.renderer.flightMarkerStats().prograde);

  expect(errors).toEqual([]);
});

test('M3.8: flight assist settings', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('set-flight-marker').getByRole('button', { name: 'Vypnuté' }).click();
  await page.getByTestId('set-camera-shake').getByRole('button', { name: 'Vypnuté' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}'));
  expect(stored).toMatchObject({ flightMarker: false, cameraShake: false });
  await page.waitForTimeout(300);
  await shot(page, 'm38-settings');
  expect(errors).toEqual([]);
});

test('M3.8: style guide section', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/ui-kit.html');
  await expect(page.getByTestId('ui-kit')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const section = page.locator('.kit-section').filter({ has: page.locator('h2', { hasText: 'Flight and damage' }) });
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await section.screenshot({ path: `${test.info().project.outputDir}/m38-ui-kit.png` });
  expect(errors).toEqual([]);
});

/** Put the ship at `pos` (still for a moment so the camera catches up), then give it the velocity. */
async function flyAt(page: Page, pos: { x: number; y: number }, vel: { x: number; y: number }, angle: number, dampers: boolean): Promise<void> {
  const set = (v: { x: number; y: number }) =>
    page.evaluate(
      ({ pos, v, angle, dampers }) => {
        const { sim } = window.__cinder!;
        const p = sim.state.player;
        const body = { pos, vel: v, angle, angVel: 0 };
        p.body = body;
        p.prevBody = body;
        p.dampers = dampers;
        sim.state.combat.enemies = [];
      },
      { pos, v, angle, dampers },
    );
  await set({ x: 0, y: 0 });
  await page.waitForTimeout(2500);
  await set(vel);
}

/** Dock at home directly (the trip itself is not what these tests check). */
async function dockHome(page: Page): Promise<void> {
  await page.evaluate(async (modules) => {
    const { dockPose } = (await import(/* @vite-ignore */ modules.dock)) as typeof import('../../src/sim/station/dock');
    const { homeStation } = (await import(/* @vite-ignore */ modules.stations)) as typeof import('../../src/sim/world/stations');
    const { sim, game } = window.__cinder!;
    const home = homeStation();
    sim.state.world.update(home.pos);
    const events = sim.enterDocked(home.id, dockPose(home, sim.state.player.props.boundingRadius));
    game.applyEvents([{ type: 'docked', stationId: home.id }, ...events]);
  }, MODULES);
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked');
}

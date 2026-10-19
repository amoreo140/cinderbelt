import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// Readability pass, task A: the wider flight camera with the combat
// zoom-out (R1), red off-screen pirate arrows merging into an arc (R2), red brackets with HP and shield
// bars under pirates (R3) and the station arrow's dock icon. Screenshots go to the Playwright output.

const MODULES = { enemies: '/src/sim/combat/enemies.ts' } as const;
type EnemiesModule = typeof import('../../src/sim/combat/enemies');
type Stats = { count: number; hostile: number; target: string | null; viewDistance: number; combatZoom: boolean };

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/${name}.png` });
const stats = (page: Page) => page.evaluate(() => (window.__cinder!.renderer as unknown as { enemyMarkerStats(): Stats }).enemyMarkerStats());

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

test('R1/R3: pirates attack – the camera pulls back, red brackets under them', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await loadFixture(page, 'pirates-near', { ticks: 2 });
  // the default flight zoom is wider than before (28 → 48)
  const first = await stats(page);
  expect(first.hostile).toBeGreaterThanOrEqual(1);
  // a bracket under every ship of the pirate list – red for the hostile ones, amber for the rest (the
  // fixture's sector also has a scavenger, which never attacks: sectors stage 1a). The brackets are
  // those of the last drawn frame: read them with the list in one go (between two frames) – the spawn
  // check right after the load adds a second patrol group, and a list read a frame later than the
  // brackets would not match.
  await page.waitForFunction(
    () => (window.__cinder!.renderer as unknown as { enemyMarkerStats(): Stats }).enemyMarkerStats().count === window.__cinder!.sim.state.combat.enemies.length,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => {
    const s = (window.__cinder!.renderer as unknown as { enemyMarkerStats(): Stats }).enemyMarkerStats();
    return s.combatZoom && s.viewDistance > 70;
  }, undefined, { timeout: 60_000 });
  await shot(page, 'citatelnost-combat-zoom');
  expect(errors).toEqual([]);
});

test('R1/R2: without the combat zoom – arrows at the edge, a pack merges into an arc, dock icon', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await page.addInitScript(() => localStorage.setItem('cinderbelt.settings', JSON.stringify({ v: 1, combatZoom: false, cameraShake: false })));
  await loadFixture(page, 'pirates-near', { ticks: 2 });
  await waitTicks(page, 20);
  expect((await stats(page)).viewDistance).toBe(48);
  // the pirates ~100 u away are off screen at the default zoom: one red arrow each
  await expect(page.getByTestId('edge-hostile').first().locator('.af-edge-arrow-head')).toBeVisible({ timeout: 30_000 });
  // the station arrow is orange with a dock icon (a different shape from the pirate arrows)
  await expect(page.getByTestId('station-arrow').locator('.hud-arrow-dock')).toBeVisible();

  // a pack of five frozen Jackals to the east → one arc with the count; a lone one stays an arrow
  await page.evaluate(
    async ({ modules }) => {
      const { createEnemy } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
      const { sim } = window.__cinder!;
      const p = sim.state.player.body.pos;
      sim.state.combat.enemies = [];
      const add = (id: string, dx: number, dy: number) => {
        const pos = { x: p.x + dx, y: p.y + dy };
        const e = createEnemy({ id, kind: 'jackal', tier: 1, pos, angle: Math.PI, home: pos, orbit: 1 });
        e.props = { ...e.props, thrust: { forward: 0, backward: 0, left: 0, right: 0 }, torque: 0 };
        e.ai.mode = 'attack';
        sim.state.combat.enemies.push(e);
      };
      for (const [i, [dx, dy]] of [[110, 10], [120, -14], [95, 28], [130, 2], [100, -30]].entries()) add(`pr:e2e:${i}`, dx!, dy!);
      add('pr:e2e:lone', -70, -80);
    },
    { modules: MODULES },
  );
  await expect(page.getByTestId('edge-hostile-group')).toHaveAttribute('data-count', '5', { timeout: 30_000 });
  await expect(page.getByTestId('edge-hostile-group')).toContainText('5');
  await expect(page.getByTestId('edge-hostile')).toHaveCount(1);
  await shot(page, 'citatelnost-arrows-pack');

  // brackets: every pirate has one (the six above plus what the sector itself keeps spawning around the
  // fixture – a patrol and a scavenger out of the arrow reach), the one under the cursor is the target
  const brackets = await page.evaluate(() => ({
    count: (window.__cinder!.renderer as unknown as { enemyMarkerStats(): Stats }).enemyMarkerStats().count,
    enemies: window.__cinder!.sim.state.combat.enemies.length,
  }));
  expect(brackets.count).toBeGreaterThanOrEqual(6);
  expect(brackets.count).toBe(brackets.enemies);
  await page.evaluate(() => {
    // bring the lone one on screen next to the ship, then aim at it
    const { sim } = window.__cinder!;
    const e = sim.state.combat.enemies.find((x) => x.id === 'pr:e2e:lone')!;
    const p = sim.state.player.body.pos;
    e.body = { ...e.body, pos: { x: p.x - 18, y: p.y - 6 } };
    e.prevBody = e.body;
  });
  const at = await page.evaluate(() => window.__cinder!.renderer.worldToScreen(window.__cinder!.sim.state.combat.enemies.find((e) => e.id === 'pr:e2e:lone')!.body.pos));
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => (window.__cinder!.renderer as unknown as { enemyMarkerStats(): Stats }).enemyMarkerStats().target === 'pr:e2e:lone', undefined, { timeout: 30_000 });
  await shot(page, 'citatelnost-bracket-target');
  expect(errors).toEqual([]);
});

test('R1: the combat zoom-out switch in the settings', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.locator('.st-row', { has: page.getByTestId('set-combat-zoom') })).toContainText('Bojové oddialenie');
  await page.getByTestId('set-combat-zoom').getByRole('button', { name: 'Vypnuté' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}'));
  expect(stored).toMatchObject({ combatZoom: false });
  expect(errors).toEqual([]);
});

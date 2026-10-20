import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// SL2 E1 T12 – the hull shell end to end: the "Ship hulls" setting switches the flight ship's shell and its
// nav lights (visible at camera distance 48 and 100), pirates of the three clans fly shelled hulls and show
// torn edges when parts are shot off, the hangar hall's parked ships and the hangar / template cards carry
// the outline, the shipyard shows the "Turn 180°" row, the V-layer lever arms and the mirror axis.
// Mirror mode in detail (pairs, undo, blocked copy, Shift+M) is mirror.spec.ts; perf and the rebuild
// queue are hullShell.perf.spec.ts. Screenshots for the art review go to HULL_SHOT_DIR (default: the
// test output dir).

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const MODULES = {
  enemies: '/src/sim/combat/enemies.ts',
  properties: '/src/sim/ship/properties.ts',
  clans: '/src/sim/pirates/clans.ts',
  sites: '/src/sim/pirates/sites.ts',
} as const;
type EnemiesModule = typeof import('../../src/sim/combat/enemies');
type PropertiesModule = typeof import('../../src/sim/ship/properties');
type ClansModule = typeof import('../../src/sim/pirates/clans');
type SitesModule = typeof import('../../src/sim/pirates/sites');

interface ShellInfo {
  on: boolean;
  pieces: number;
  tornEdges: number;
}
interface CombatShip {
  id: string;
  wreck: boolean;
  clan: string | null;
  navPoints: number;
  shell: ShellInfo;
}

/** The full art-review set (2× pixels, both distances, crops, close-ups) only with HULL_SHOT_DIR – else one frame per state. */
const ART = !!env.HULL_SHOT_DIR;
const shotDir = () => env.HULL_SHOT_DIR ?? test.info().outputDir;
const shot = (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => page.screenshot({ path: `${shotDir()}/${name}.png`, clip });

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
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 90_000 });
}

const frames = (page: Page, n = 4) =>
  page.evaluate(
    (k) =>
      new Promise((resolve) => {
        let i = 0;
        const f = () => (++i >= k ? resolve(null) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

const setZoom = (page: Page, d: number) =>
  page.evaluate((v) => {
    (window.__cinder!.renderer as unknown as { rig: { distance: number } }).rig.distance = v;
  }, d);
const hideUi = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    document.getElementById('ui')!.style.display = h ? 'none' : '';
  }, hidden);
const setPaused = (page: Page, paused: boolean) => page.evaluate((p) => (window.__cinder!.game as unknown as { setPaused(p: boolean): void }).setPaused(p), paused);

/**
 * A halted game redraws with a zero frame time – the camera does not follow a moved ship or a new zoom:
 * a few manual frames of 0.25 s settle it (the scene drawn, the sim untouched).
 */
const settle = (page: Page) =>
  page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as { render(alpha: number, dt: number, aim: null): void };
    for (let i = 0; i < 12; i++) r.render(1, 0.25, null);
  });

const playerShell = (page: Page) =>
  page.evaluate(
    () =>
      (
        window.__cinder!.renderer as unknown as {
          shipView: { shellInfo: ShellInfo };
        }
      ).shipView.shellInfo,
  );
const navLights = (page: Page) => page.evaluate(() => (window.__cinder!.renderer as unknown as { navLightCount(): number }).navLightCount());
const combatShips = (page: Page) =>
  page.evaluate(
    () =>
      (
        window.__cinder!.renderer as unknown as {
          combatStats(): { ships: CombatShip[] };
        }
      ).combatStats().ships,
  );

/** Screen clip (CSS px) of `w` × `h` around a sim point, kept inside the 1280 × 720 viewport. */
async function clipAt(page: Page, at: { x: number; y: number }, w: number, h: number) {
  const c = await page.evaluate((q) => window.__cinder!.renderer.worldToScreen(q), at);
  return {
    x: Math.min(1280 - w, Math.max(0, c.x - w / 2)),
    y: Math.min(720 - h, Math.max(0, c.y - h / 2)),
    width: w,
    height: h,
  };
}
const playerPos = (page: Page) => page.evaluate(() => ({ ...window.__cinder!.sim.state.player.body.pos }));

/** The "Ship hulls" row of the in-game settings (pause menu → settings), then back to the game. */
async function shellSetting(page: Page, on: boolean): Promise<void> {
  // the first key after a resume may be discarded (Game.setPaused): retry until the pause menu is up
  await expect(async () => {
    if (!(await page.getByTestId('pause-settings').isVisible())) await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-settings')).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId('pause-settings').click();
  await page
    .getByTestId('set-hull-shell')
    .getByRole('button', { name: on ? 'Zapnuté' : 'Vypnuté', exact: true })
    .click();
  await page.getByTestId('sheet-back').click();
  await page.getByTestId('pause-resume').click();
}

/** Flight screenshots at 48 and 100: the sim halted, the UI hidden, a full frame and a crop around the ship. */
async function flightShots(page: Page, tag: string): Promise<void> {
  await setPaused(page, true);
  await hideUi(page, true);
  for (const d of ART ? [48, 100] : [48]) {
    await setZoom(page, d);
    await settle(page);
    await page.waitForTimeout(600);
    await shot(page, `flight-${tag}-${d}`);
    await shot(page, `flight-${tag}-${d}-crop`, await clipAt(page, await playerPos(page), 360, 260));
  }
  await hideUi(page, false);
  await setPaused(page, false);
}

// independent pages: the four tests may run side by side
test.describe.configure({ mode: 'parallel' });

test.describe('hull shell', () => {
  // High: the clan decorations and grooves of the shell, nav lights on pirates too
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // (no combat zoom-out: the screenshots pick their own camera distance)
      if (!localStorage.getItem('cinderbelt.settings')) localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: 'high', combatZoom: false }));
    });
  });

  // the art review crops (HULL_SHOT_DIR): twice the pixels
  test.describe('flight views', () => {
    test.use({ deviceScaleFactor: ART ? 2 : 1 });

    test('flight: the setting toggles the shell and the nav lights; lights at camera distance 48 and 100', async ({ page }) => {
      test.setTimeout(ART ? 900_000 : 240_000);
      const errors = collectErrors(page);
      await loadFixture(page, 'hour1', { ticks: 20 });
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 60_000 });
      await waitTicks(page, 120);
      // out of the station's clutter (the screenshots), stopped
      await page.evaluate(() => {
        const p = window.__cinder!.sim.state.player;
        p.body = {
          ...p.body,
          pos: { x: p.body.pos.x + 160, y: p.body.pos.y + 220 },
          vel: { x: 0, y: 0 },
          angVel: 0,
        };
        p.prevBody = p.body;
      });
      await waitTicks(page, 10);

      // default on: the shell is built, nav lights drawn at both distances
      let shell = await playerShell(page);
      expect(shell.on).toBe(true);
      expect(shell.pieces).toBeGreaterThan(0);
      expect(shell.tornEdges).toBe(0);
      for (const d of [48, 100]) {
        await setZoom(page, d);
        await frames(page, 4);
        expect(await navLights(page)).toBeGreaterThanOrEqual(3);
      }
      await flightShots(page, 'shell-on');

      // the setting off: bare parts with connectors, no nav lights; stored
      await shellSetting(page, false);
      await expect.poll(async () => (await playerShell(page)).on).toBe(false);
      await frames(page, 4);
      expect(await navLights(page)).toBe(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cinderbelt.settings') ?? '{}').hullShell)).toBe(false);
      await flightShots(page, 'shell-off');

      // and on again
      await shellSetting(page, true);
      await expect.poll(async () => (await playerShell(page)).on).toBe(true);
      await expect.poll(() => navLights(page)).toBeGreaterThanOrEqual(3);
      expect(errors).toEqual([]);
    });

    test('pirates: one ship of each clan, shelled with nav lights, torn edges after parts are shot off', async ({ page }) => {
      test.setTimeout(ART ? 1_200_000 : 240_000);
      const errors = collectErrors(page);
      await loadFixture(page, 'pirates-near', { ticks: 10 });
      // the world's pirates leave; a frozen hammer of each clan (its home in the clan's territory) spawns
      // next to the player, attacking, the player's shield made big enough to outlast them
      const ids = await page.evaluate(async (modules) => {
        const { createEnemy } = (await import(/* @vite-ignore */ modules.enemies)) as EnemiesModule;
        const { fortressClan } = (await import(/* @vite-ignore */ modules.clans)) as ClansModule;
        const { fortressSites } = (await import(/* @vite-ignore */ modules.sites)) as SitesModule;
        const { sim } = window.__cinder!;
        const { combat, player, seed } = sim.state;
        for (const e of combat.enemies) combat.defeated.set(e.id, sim.state.tick);
        combat.enemies = [];
        combat.projectiles = [];
        player.props = {
          ...player.props,
          shield: {
            ...player.props.shield,
            capacity: 1e6,
            regen: 1e5,
            regenDelay: 0,
            energyPerPoint: 0,
          },
        };
        player.shield = 1e6;
        const c = player.body.pos;
        const out: { id: string; clan: string }[] = [];
        for (const [i, clan] of (['rust', 'cauldron', 'slantedStar'] as const).entries()) {
          const site = fortressSites(seed).find((s) => fortressClan(seed, s.index) === clan);
          if (!site) continue;
          const pos = { x: c.x - 16 + i * 16, y: c.y + 14 };
          const e = createEnemy({
            id: `pr:shell:${i}`,
            kind: 'hammer',
            tier: 2,
            pos,
            angle: -Math.PI / 2,
            home: { ...site.pos },
            orbit: 1,
          });
          e.props = {
            ...e.props,
            thrust: { forward: 0, backward: 0, left: 0, right: 0 },
            torque: 0,
          };
          e.ai.mode = 'attack';
          combat.enemies.push(e);
          out.push({ id: e.id, clan });
        }
        return out;
      }, MODULES);
      expect(ids.map((x) => x.clan)).toEqual(['rust', 'cauldron', 'slantedStar']);

      await setZoom(page, 40);
      await waitTicks(page, 40);
      // only the spec's own hammers count: the fixture lies in a pirate sector whose own patrol keeps
      // spawning around the ship (more of it under load, when more ticks pass before a poll)
      const ownIds = new Set(ids.map((x) => x.id));
      const ownShips = async () => (await combatShips(page)).filter((s) => ownIds.has(s.id));
      // every clan's hull is shelled with its own clan, nav lights on its lip
      await expect
        .poll(async () =>
          (await ownShips())
            .filter((s) => !s.wreck && s.shell.on && s.navPoints > 0)
            .map((s) => s.clan)
            .sort(),
        )
        .toEqual(['cauldron', 'rust', 'slantedStar']);

      // the enemy rings and bars (their layer sets its own visibility every frame: scaled to nothing
      // instead) and, for the close-ups, the player's ship
      type Scaled = { scale: { setScalar(s: number): void } };
      const markers = (shown: boolean) =>
        page.evaluate((v) => {
          (window.__cinder!.renderer as unknown as { enemyMarkers: { object: Scaled } }).enemyMarkers.object.scale.setScalar(v ? 1 : 1e-6);
        }, shown);
      const playerShip = (shown: boolean) =>
        page.evaluate((v) => {
          (window.__cinder!.renderer as unknown as { shipView: { group: Scaled } }).shipView.group.scale.setScalar(v ? 1 : 1e-6);
        }, shown);
      // the three pirates at camera distance 48 and 100, each one cropped; and close up (20) one by one
      const pirateShots = async (tag: string) => {
        await setPaused(page, true);
        await hideUi(page, true);
        await markers(false);
        const poses = await page.evaluate(
          (list) =>
            list.map((x) => ({
              ...x,
              pos: {
                ...window.__cinder!.sim.state.combat.enemies.find((e) => e.id === x.id)!.body.pos,
              },
            })),
          ids,
        );
        for (const d of ART ? [48, 100] : [48]) {
          await setZoom(page, d);
          await settle(page);
          await page.waitForTimeout(600);
          await shot(page, `pirates-${tag}-${d}`);
          for (const p of poses) await shot(page, `pirate-${p.clan}-${tag}-${d}`, await clipAt(page, p.pos, d === 48 ? 160 : 110, d === 48 ? 140 : 100));
        }
        // close: the (hidden) player ship moved onto each pirate in turn, the camera follows it
        await setZoom(page, 20);
        await playerShip(false);
        for (const p of ART ? poses : []) {
          await page.evaluate((pos) => {
            const pl = window.__cinder!.sim.state.player;
            pl.body = { ...pl.body, pos: { ...pos } };
            pl.prevBody = pl.body;
          }, p.pos);
          await settle(page);
          await page.waitForTimeout(600);
          await shot(page, `pirate-${p.clan}-${tag}-close`, await clipAt(page, p.pos, 360, 300));
        }
        await page.evaluate((pos) => {
          const pl = window.__cinder!.sim.state.player;
          pl.body = { ...pl.body, pos };
          pl.prevBody = pl.body;
        }, home);
        await playerShip(true);
        await setZoom(page, 40);
        await markers(true);
        await hideUi(page, false);
        await setPaused(page, false);
      };
      const home = await playerPos(page);
      await pirateShots('whole');

      // three outer parts shot off each (never the cockpit): torn edges, the shell rebuilt
      await page.evaluate(
        async ({ ids, modules }) => {
          const { computeProperties } = (await import(/* @vite-ignore */ modules.properties)) as PropertiesModule;
          for (const e of window.__cinder!.sim.state.combat.enemies) {
            if (!ids.includes(e.id)) continue;
            const cockpit = e.grid.parts.find((p) => p.partId === 'cockpit')!;
            const far = e.grid.parts
              .filter((p) => p !== cockpit)
              .sort((a, b) => Math.hypot(b.x - cockpit.x, b.y - cockpit.y) - Math.hypot(a.x - cockpit.x, a.y - cockpit.y))
              .slice(0, 3);
            e.grid = {
              parts: e.grid.parts.filter((p) => !far.includes(p)),
              nextId: e.grid.nextId,
            };
            e.props = {
              ...computeProperties(e.grid),
              thrust: e.props.thrust,
              torque: e.props.torque,
            };
            e.gridVersion++;
          }
        },
        { ids: ids.map((x) => x.id), modules: MODULES },
      );
      await expect.poll(async () => (await ownShips()).filter((s) => !s.wreck && s.shell.on && s.shell.tornEdges > 0).length).toBe(3);
      await pirateShots('torn');
      expect(errors).toEqual([]);
    });
  });

  test('hangar: parked ships shelled in the hall; hangar and template cards show the hull outline', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await loadFixture(page, 'hangar', { ticks: 30 });

    // hangar card: every ship's silhouette has the hull outline path under its cells
    await page.getByTestId('tab-overview').click();
    await page.getByTestId('hub-open-hangar').click();
    const hangar = page.getByTestId('hangar');
    await expect(hangar).toBeVisible();
    for (const id of [1, 2, 3]) {
      const hull = page.getByTestId(`hangar-ship-${id}`).locator('svg.af-sil path.af-sil-hull');
      await expect(hull).toHaveCount(1);
      expect((await hull.getAttribute('d'))?.length ?? 0).toBeGreaterThan(10);
    }
    await shot(page, 'hangar-modal');
    await hangar.screenshot({ path: `${shotDir()}/hangar-cards.png` });
    await page.getByTestId('hangar-close').click();
    await expect(hangar).toBeHidden();

    // the shipyard's hall: the Osa parked on the bay deck, built with the shell
    await page.getByTestId('tab-shipyard').click();
    await expect(page.getByTestId('shipyard')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window.__cinder!.renderer.hangar as unknown as {
              parkedStats(): { ships: number; visible: boolean };
            }
          ).parkedStats(),
        ),
      )
      .toMatchObject({ ships: 1, visible: true });
    const parked = await page.evaluate(() =>
      (
        window.__cinder!.renderer.hangar as unknown as {
          parked: { entries: { view: { shellInfo: ShellInfo } }[] };
        }
      ).parked.entries.map((e) => e.view.shellInfo),
    );
    expect(parked).toHaveLength(1);
    expect(parked[0]!.on).toBe(true);
    // the camera pulled back so the parked ship beside the platform is in the frame
    await page.mouse.move(800, 480);
    await page.evaluate(() => window.__cinder!.renderer.hangar.zoomBy(1600));
    await waitTicks(page, 40);
    await shot(page, 'hangar-hall');

    // template cards
    await page.getByTestId('yard-open-templates').click();
    const templates = page.getByTestId('templates');
    await expect(templates).toBeVisible();
    const hulls = templates.locator('svg.af-sil path.af-sil-hull');
    await expect(hulls).toHaveCount(3);
    await templates.screenshot({ path: `${shotDir()}/template-cards.png` });
    expect(errors).toEqual([]);
  });

  test('shipyard: the 180° turn row, V-layer lever arms and the mirror axis with a pair of side engines', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await loadFixture(page, 'start', { ticks: 10 });
    await page.evaluate(() => {
      const s = window.__cinder!.sim.state;
      s.credits = 3000;
      const parts = s.stations.get('home')!.parts;
      parts['armor:1'] = 4;
      parts['engine:1'] = 2;
    });
    await page.keyboard.press('Digit3');
    await expect(page.getByTestId('shipyard')).toBeVisible();
    await waitTicks(page, 20);

    // "Turn 180°: x,y s" – a sane value for the starter ship
    const turn = page.getByTestId('stat-turn180');
    await expect(turn).toContainText('Otočenie 180°');
    const seconds = Number(((await turn.locator('.yd-stat-value').textContent()) ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(5);

    // the layers are on by default: the lever-arm lines from the centre of mass; V hides them
    const lever = () =>
      page.evaluate(() => {
        let visible = false;
        let found = false;
        window.__cinder!.renderer.hangar.scene.traverse((o) => {
          if (o.name !== 'lever-arms') return;
          found = true;
          let v = true;
          for (let p: typeof o | null = o; p; p = p.parent) v &&= p.visible;
          visible ||= v;
        });
        return { found, visible };
      });
    await expect.poll(lever).toEqual({ found: true, visible: true });
    await page.mouse.move(800, 480);
    await waitTicks(page, 5);
    await shot(page, 'shipyard-layers');
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await lever()).visible).toBe(false);
    await page.keyboard.press('KeyV');
    await expect.poll(async () => (await lever()).visible).toBe(true);

    // mirror mode: an armour stroke and a side engine at (1, 3) nozzle out – the copies land mirrored
    const cell = (x: number, y: number) => page.evaluate(([cx, cy]) => window.__cinder!.renderer.hangarCellToScreen(cx, cy, -0.37), [x, y] as const);
    const partAt = (x: number, y: number) =>
      page.evaluate(
        ([cx, cy]) =>
          (
            window.__cinder!.game as unknown as {
              yard: {
                draft: {
                  grid: {
                    parts: {
                      partId: string;
                      x: number;
                      y: number;
                      rot: number;
                    }[];
                  };
                };
              };
            }
          ).yard.draft.grid.parts.find((p) => p.x === cx && p.y === cy) ?? null,
        [x, y] as const,
      );
    await page.mouse.move(640, 300);
    await page.keyboard.press('KeyM');
    await expect(page.getByTestId('yard-mirror')).toHaveClass(/is-on/);
    await page.getByTestId('palette-armor').click();
    const a = await cell(1, 2);
    const b = await cell(2, 2);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await partAt(2, -2))?.partId).toBe('armor');
    await page.getByTestId('palette-engine').click();
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyR');
    await expect.poll(() => page.evaluate(() => (window.__cinder!.game as unknown as { yard: { rot: number } }).yard.rot)).toBe(3);
    await page.keyboard.up('Shift');
    const e = await cell(1, 3);
    await page.mouse.move(e.x, e.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await partAt(1, 3))?.rot).toBe(3);
    expect(await partAt(1, -3)).toMatchObject({ partId: 'engine', rot: 1 });
    await page.keyboard.press('Escape'); // palette part off
    await page.mouse.move(800, 480);
    await waitTicks(page, 10);
    await shot(page, 'shipyard-mirror');
    // the axis on the seam (os ±½)
    await page.getByTestId('yard-mirror-axis').click();
    await expect(page.getByTestId('yard-mirror-axis')).toHaveClass(/is-on/);
    await page.mouse.move(800, 480);
    await waitTicks(page, 10);
    await shot(page, 'shipyard-mirror-seam');
    expect(errors).toEqual([]);
  });
});

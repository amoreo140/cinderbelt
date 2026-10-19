import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { loadFixture } from './fixtures';

// M3.6 "Fortress": tractor beam with a container, cutting a wreck, the toll demand, the pirate
// attention indicator, the fortress attack and the effective cannon arcs in the shipyard.
// Screenshots: test-results-m36/m36-*.png

const OUT = 'test-results-m36';

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
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const);
}

/** Wait for rendered frames (software WebGL is slow – a screenshot right after a move can be stale). */
async function waitFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

async function play(page: Page): Promise<void> {
  await page.goto('/?play');
  await page.waitForFunction(() => (window.__cinder?.sim.state.tick ?? 0) > 10);
  await expect(page.getByTestId('station-hub')).toBeVisible();
  await page.evaluate(() => {
    (window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean }).helpOpen = false;
    (window.__cinder!.game as unknown as { helpTouched: boolean }).helpTouched = true;
  });
}

/** Undock and place the stopped ship at a point (chunks load around it). */
async function flyTo(page: Page, pos: { x: number; y: number }, angle = 0): Promise<void> {
  if (await page.getByTestId('station-hub').isVisible()) {
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('station-hub')).toBeHidden();
  }
  await page.evaluate(
    ([x, y, a]) => {
      const { sim } = window.__cinder!;
      const body = { pos: { x, y }, vel: { x: 0, y: 0 }, angle: a, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.dampers = true;
      sim.state.world.update(body.pos);
    },
    [pos.x, pos.y, angle] as const,
  );
  await waitTicks(page, 40);
  await page.waitForTimeout(700);
}

/** Replace the player ship (salvager / fighter) – full battery. */
async function setShip(page: Page, parts: [string, number, number, number?, number?][]): Promise<void> {
  await page.evaluate(
    async ([gridPath, propsPath, list]) => {
      const g = (await import(gridPath as string)) as typeof import('../../src/sim/ship/grid');
      const pr = (await import(propsPath as string)) as typeof import('../../src/sim/ship/properties');
      const { sim } = window.__cinder!;
      const grid = g.createGrid(list as Parameters<typeof g.createGrid>[0]);
      const p = sim.state.player;
      p.grid = grid;
      p.props = pr.computeProperties(grid);
      p.gridVersion++;
      p.energy = p.props.batteryCapacity;
      p.shield = p.props.shield.capacity;
      p.fuel = p.props.fuelCapacity;
    },
    ['/src/sim/ship/grid.ts', '/src/sim/ship/properties.ts', parts] as const,
  );
}

async function aimAt(page: Page, pos: { x: number; y: number }): Promise<void> {
  const p = await page.evaluate(([x, y]) => window.__cinder!.renderer.worldToScreen({ x, y }), [pos.x, pos.y] as const);
  await page.mouse.move(p.x, p.y);
}

const SALVAGER: [string, number, number, number?, number?][] = [
  ['cockpit', 0, 0],
  ['miningLaser', 1, 0],
  ['tractorBeam', 0, 1],
  ['cannon', 1, 1],
  ['reactor', -1, 0],
  ['reactor', -1, 1],
  ['cargo', 0, -1],
  ['engine', -2, 0],
  ['engine', -1, -1],
];

test('M3.6: tractor beam pulls a container to the ship and F loads it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  // a quiet spot in the home ring (no rocks nearby)
  const spot = await page.evaluate(() => {
    const { sim } = window.__cinder!;
    for (let r = 320; r < 560; r += 20) {
      for (let a = 0; a < 64; a++) {
        const p = { x: Math.cos(a / 10) * r, y: Math.sin(a / 10) * r };
        sim.state.world.update(p);
        if (sim.state.world.circlesNear(p, 140).length === 0 && sim.state.world.stationCirclesNear(p, 220).length === 0) return p;
      }
    }
    return { x: 0, y: 400 };
  });
  await flyTo(page, spot, Math.PI / 2);
  await setShip(page, SALVAGER);
  await page.evaluate(
    async ([path, x, y]) => {
      const m = (await import(path as string)) as typeof import('../../src/sim/salvage/containers');
      const { sim } = window.__cinder!;
      const loot = { cargo: { iron: 0, copper: 18, ice: 0, titanium: 9 }, parts: { 'engine:1': 1 } };
      sim.state.combat.containers.push(m.createContainer(77001, { x: (x as number) + 12, y: (y as number) + 16 }, { x: 0, y: 0 }, loot));
    },
    ['/src/sim/salvage/containers.ts', spot.x, spot.y] as const,
  );
  await waitTicks(page, 30);
  await aimAt(page, { x: spot.x + 12, y: spot.y + 16 });
  await page.keyboard.press('KeyT');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.tractor !== null);
  await page.waitForTimeout(900);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-tractor.png` });
  await expect(page.getByTestId('tractor-status')).toContainText('Ťahá');
  await page.waitForFunction(() => {
    const s = window.__cinder!.sim.state;
    const c = s.combat.containers[0];
    return !!c && Math.hypot(c.body.pos.x - s.player.body.pos.x, c.body.pos.y - s.player.body.pos.y) < 6;
  }, undefined, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('salvage-prompt')).toHaveAttribute('data-kind', 'container');
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-tractor-close.png` });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.combat.containers.length === 0);
  expect(await page.evaluate(() => window.__cinder!.sim.state.player.cargo.copper)).toBeCloseTo(18, 0);
  expect(errors).toEqual([]);
});

test('M3.6: cutting a wreck – scan shows the joints, the laser cuts one and a piece drifts free', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await play(page);
  const poi = await page.evaluate(async (path) => {
    const m = (await import(path)) as typeof import('../../src/sim/discovery/testing');
    const p = m.findPoi(window.__cinder!.sim.state.seed, 'wreck', (x) => x.size === 2 && x.cls === 'freighter');
    return { id: p.id, pos: p.pos };
  }, '/src/sim/discovery/testing.ts');
  await flyTo(page, { x: poi.pos.x - 30, y: poi.pos.y - 2 });
  await setShip(page, SALVAGER);
  await page.evaluate(() => {
    // no scavengers or pirates for this shot
    window.__cinder!.sim.state.combat.enemies = [];
  });
  await page.waitForFunction((id) => window.__cinder!.sim.state.combat.wrecks.some((w) => w.poi === id), poi.id);
  // an edge joint (not a tank or reactor) and a spot 8 units out from it, facing it
  const joint = await page.evaluate(
    async ([dPath, gPath, sPath, id]) => {
      const d = (await import(dPath as string)) as typeof import('../../src/sim/salvage/dismantle');
      const geo = (await import(gPath as string)) as typeof import('../../src/sim/combat/geometry');
      const grid = (await import(sPath as string)) as typeof import('../../src/sim/ship/grid');
      const s = window.__cinder!.sim.state;
      const w = s.combat.wrecks.find((x) => x.poi === id)!;
      const joints = d.jointParts(w.grid);
      // a joint the laser reaches first from 8 units out (no other cell in front of it)
      for (const p of w.grid.parts) {
        if (!joints.has(p.id) || p.partId === 'fuelTank' || p.partId === 'reactor') continue;
        const at = geo.gridToWorld(w.body, w.props.centerOfMass, grid.partCenter(p));
        // prefer the ship south of the joint – the wreck is then above it on screen, clear of the console
        for (const k of [18, 17, 19, 16, 20, 15, 21, 14, 22, 13, 23, 12, 0, 11, 1, 10, 2, 9, 3, 8, 4, 7, 5, 6]) {
          const a = (k / 24) * Math.PI * 2;
          const from = { x: at.x + Math.cos(a) * 8, y: at.y + Math.sin(a) * 8 };
          const hit = geo.raycastGrid(geo.cellOwners(w.grid), geo.worldToGrid(w.body, w.props.centerOfMass, from), geo.worldToGrid(w.body, w.props.centerOfMass, at));
          if (hit?.partId === p.id) return { pos: at, ship: from, hulk: w.body.pos };
        }
      }
      throw new Error('no reachable joint');
    },
    ['/src/sim/salvage/dismantle.ts', '/src/sim/combat/geometry.ts', '/src/sim/ship/grid.ts', poi.id] as const,
  );
  await flyTo(page, joint.ship, Math.atan2(joint.pos.y - joint.ship.y, joint.pos.x - joint.ship.x));
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.combat.enemies = [];
    s.combat.containers = [];
  });
  // scan (hold Tab on the wreck)
  await aimAt(page, joint.hulk);
  await page.keyboard.down('Tab');
  await page.waitForFunction((id) => window.__cinder!.sim.state.discovery.scanned.has(id), poi.id, { timeout: 25_000 });
  await page.keyboard.up('Tab');
  await page.waitForTimeout(400);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-wreck-scanned.png` });
  await aimAt(page, joint.pos);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction((id) => (window.__cinder!.sim.state.combat.wrecks.find((w) => w.poi === id)?.cutting?.progress ?? 0) > 0.45, poi.id, { timeout: 25_000 });
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-wreck-cutting.png` });
  await page.waitForFunction(() => window.__cinder!.sim.state.discovery.cut.size > 0, undefined, { timeout: 25_000 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(900);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-wreck-cut.png` });
  expect(await page.evaluate(() => window.__cinder!.sim.state.combat.wrecks.filter((w) => w.from).length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('M3.6: pirate attention in the nav band, a raid countdown and a toll demand', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  const site = await page.evaluate(async (path) => {
    const m = (await import(path)) as typeof import('../../src/sim/pirates/sites');
    return m.fortressSites(window.__cinder!.sim.state.seed)[1]!;
  }, '/src/sim/pirates/sites.ts');
  await flyTo(page, { x: site.beacon.pos.x - 150, y: site.beacon.pos.y + 60 });
  await setShip(page, SALVAGER);
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.combat.enemies = [];
    s.pirates.attention = 47;
  });
  await page.mouse.move(700, 300);
  await waitTicks(page, 10);
  await expect(page.getByTestId('attention')).toHaveAttribute('data-level', '1');
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-attention.png` });
  // the clan challenge at the beacon (F) – a raid countdown
  await flyTo(page, { x: site.beacon.pos.x - 6, y: site.beacon.pos.y });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.raid !== null);
  await waitTicks(page, 12);
  await expect(page.getByTestId('attention-raid')).toBeVisible();
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-challenge.png` });
  // a toll demand by a Hammer-led group (staged next to the ship)
  await page.evaluate(async (path) => {
    const en = (await import(path)) as typeof import('../../src/sim/combat/enemies');
    const s = window.__cinder!.sim.state;
    const p = s.player.body.pos;
    const home = { x: p.x + 50, y: p.y + 10 };
    const group = 'pr:99,99';
    for (const [i, kind] of (['hammer', 'jackal', 'jackal'] as const).entries()) {
      const e = en.createEnemy({ id: `${group}:${i}`, kind, tier: 1, pos: { x: home.x + i * 8, y: home.y + (i % 2) * 6 }, angle: Math.PI, home, orbit: 1 });
      e.ai.mode = 'hail';
      s.combat.enemies.push(e);
    }
    s.credits = 4000;
    s.pirates.toll = { group, amount: 650, until: s.tick + 20 * 60 };
  }, '/src/sim/combat/enemies.ts');
  await waitTicks(page, 30);
  await expect(page.getByTestId('toll')).toBeVisible();
  await page.waitForTimeout(400);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-toll.png` });
  await page.keyboard.press('KeyY');
  await page.waitForFunction(() => window.__cinder!.sim.state.pirates.toll === null);
  expect(await page.evaluate(() => window.__cinder!.sim.state.credits)).toBe(3350);
  await expect(page.getByTestId('toll')).toBeHidden();
  expect(errors).toEqual([]);
});

test('M3.6: attacking the Rust fortress – shielded core, generators, the fall', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  // flying in front of the fortress nearest home (the `fortress` test save position)
  await loadFixture(page, 'fortress');
  const site = await page.evaluate(async (path) => {
    const m = (await import(path)) as typeof import('../../src/sim/pirates/sites');
    const f = [...m.fortressSites(window.__cinder!.sim.state.seed)].sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
    // beside the generator (east or west – whichever is farther from the rock), level with it on screen
    const g = m.fortressToWorld(f, m.FORTRESS_LAYOUT.shieldGens[0]!);
    const east = { x: g.x + 22, y: g.y };
    const west = { x: g.x - 22, y: g.y };
    const back = Math.hypot(east.x - f.pos.x, east.y - f.pos.y) > Math.hypot(west.x - f.pos.x, west.y - f.pos.y) ? east : west;
    return { back, id: f.id, pos: f.pos, angle: f.angle, front: { x: f.pos.x - 38, y: f.pos.y - 6 }, gen0: m.fortressToWorld(f, m.FORTRESS_LAYOUT.shieldGens[0]!) };
  }, '/src/sim/pirates/sites.ts');
  const fighter: [string, number, number, number?, number?][] = [
    ['cockpit', 0, 0, 0, 2],
    ['cannon', 1, 1, 0, 2],
    ['cannon', 1, -1, 0, 2],
    ['armor', 1, 0, 0, 2],
    ['shield', 0, 1, 0, 2],
    ['reactor', -1, 0, 0, 2],
    ['reactor', 0, -1, 0, 2],
    ['engine', -2, 0, 0, 2],
    ['engine', -1, 1, 0, 2],
    ['engine', -1, -1, 0, 2],
  ];
  const toward = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(to.y - from.y, to.x - from.x);
  await flyTo(page, site.front, toward(site.front, site.pos));
  await setShip(page, fighter);
  // keep the shot readable: no pirate groups around; the turrets do fire, the test ship shrugs it off
  await page.evaluate(() => {
    const s = window.__cinder!.sim.state;
    s.combat.enemies = [];
    setInterval(() => {
      s.player.hp.clear();
      s.player.shield = s.player.props.shield.capacity;
      s.combat.enemies = s.combat.enemies.filter((e) => !e.id.startsWith('pr:'));
    }, 100);
  });
  // zoom the camera out so the whole fortress is in the frame
  const view = await page.locator('#game canvas').boundingBox();
  await page.mouse.move(view!.x + view!.width / 2, view!.y + view!.height / 2);
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 260);
  await page.waitForTimeout(500);
  await aimAt(page, site.pos);
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction(() => window.__cinder!.sim.state.combat.projectiles.length > 3);
  await page.waitForTimeout(700);
  await page.mouse.up({ button: 'left' });
  await expect(page.getByTestId('fortress-band')).toBeVisible();
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-fortress-shield.png` });
  // behind the rock: the generators
  await flyTo(page, site.back, toward(site.back, site.gen0));
  await aimAt(page, site.gen0);
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction((id) => {
    const f = window.__cinder!.sim.state.pirates.fortresses.get(id);
    return !!f && f.gens[0]! < 320;
  }, site.id, { timeout: 15_000 });
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-fortress-generators.png` });
  await page.mouse.up({ button: 'left' });
  // generators down (staged) – the core is open
  await page.evaluate((id) => {
    const s = window.__cinder!.sim.state;
    const f = s.pirates.fortresses.get(id)!;
    f.gens = [0, 0];
    f.core = 60;
  }, site.id);
  await flyTo(page, site.front, toward(site.front, site.pos));
  await page.waitForTimeout(300);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-fortress-open.png` });
  await aimAt(page, site.pos);
  await page.mouse.down({ button: 'left' });
  await page.waitForFunction((id) => window.__cinder!.sim.state.pirates.fortresses.get(id)?.destroyed !== null, site.id, { timeout: 20_000 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(350);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-fortress-destroyed.png` });
  await page.waitForTimeout(1500);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-fortress-chest.png` });
  expect(await page.evaluate(() => window.__cinder!.sim.state.discovery.keyItems.has('resonator'))).toBe(true);
  expect(errors).toEqual([]);
});

test('M3.6: the shipyard shows the effective cannon arcs and the map shows fortresses', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await play(page);
  // a cannon next to the cockpit: its arc is trimmed by the hull
  await page.evaluate(async (path) => {
    const g = (await import(path)) as typeof import('../../src/sim/ship/grid');
    const s = window.__cinder!.sim.state;
    const grid = g.createGrid([
      ['cockpit', 0, 0],
      ['miningLaser', 1, 0],
      ['cannon', 1, 1],
      ['armor', 2, 1],
      ['cargo', 0, 1],
      ['cargo', 0, -1],
      ['engine', -1, 0],
      ['cannon', 0, 2, 1],
    ]);
    s.player.grid = grid;
    s.respawn = { ...s.respawn, grid };
    s.player.gridVersion++;
    s.stations.get('home')!.parts['cannon:1'] = 2;
  }, '/src/sim/ship/grid.ts');
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('shipyard')).toBeVisible();
  // the layers (V) are on by default: thrust arrows, laser and the effective cannon arcs
  await page.waitForTimeout(600);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-shipyard-arcs.png` });
  await expect(page.getByTestId('stat-cannonArc')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await flyTo(page, { x: 0, y: 500 });
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('map')).toBeVisible();
  // zoom out to the outer belt (fortresses, their clan beacons)
  for (let i = 0; i < 5; i++) await page.locator('.mp-zoom-btn').nth(1).click();
  await page.waitForTimeout(300);
  await waitFrames(page);
  await page.screenshot({ path: `${OUT}/m36-map.png` });
  await page.keyboard.press('KeyM');
  expect(errors).toEqual([]);
});

test('M3.6: UI kit – pirate attention, toll, tractor, fortress band and the cannon reticle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui-kit.html');
  await expect(page.getByTestId('ui-kit')).toBeVisible();
  const section = page.locator('section', { hasText: 'Pirates and salvage' }).last();
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await section.screenshot({ path: `${OUT}/m36-ui-kit.png` });
  expect(errors).toEqual([]);
});

test('pirate clans: ships load their clan part set, a wreck keeps the clan shapes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await loadFixture(page, 'pirates-near');
  type Ships = { id: string; wreck: boolean; clan: string | null; clanParts: number }[];
  // every pirate view is built from its clan's models (the set loads lazily on first sight)
  await page.waitForFunction(() => {
    const { sim, renderer } = window.__cinder!;
    const ships = (renderer.combatStats() as unknown as { ships: Ships }).ships.filter((s) => !s.wreck);
    const enemies = sim.state.combat.enemies;
    return enemies.length > 0 && ships.length === enemies.length && ships.every((s) => s.clanParts === enemies.find((e) => e.id === s.id)?.grid.parts.length);
  }, undefined, { timeout: 60_000 });
  const check = await page.evaluate(async () => {
    const { enemyClan } = (await import('/src/sim/pirates/clans.ts' as string)) as typeof import('../../src/sim/pirates/clans');
    const { sim, renderer } = window.__cinder!;
    const st = sim.state;
    const ships = (renderer.combatStats() as unknown as { ships: Ships }).ships;
    return st.combat.enemies.map((e) => ({ id: e.id, view: ships.find((s) => s.id === e.id)?.clan, sim: enemyClan(st.seed, e, st.combat.enemies) }));
  });
  for (const c of check) {
    expect(['rust', 'cauldron', 'slantedStar']).toContain(c.view);
    expect(c.view, c.id).toBe(c.sim);
  }
  // the first pirate breaks up where it flies: its wreck keeps the clan (derelict livery)
  const clan = await page.evaluate(async () => {
    const { createWreck, emptyLoot } = (await import('/src/sim/combat/wrecks.ts' as string)) as typeof import('../../src/sim/combat/wrecks');
    const st = window.__cinder!.sim.state;
    const e = st.combat.enemies[0]!;
    const w = createWreck(st.combat.nextId++, e.grid.parts.slice(0, 6), e, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
    st.combat.defeated.set(e.id, st.tick);
    st.combat.enemies = st.combat.enemies.filter((x) => x !== e);
    st.combat.wrecks.push(w);
    return { id: `wreck#${w.id}`, clan: (window.__cinder!.renderer.combatStats() as unknown as { ships: Ships }).ships.find((s) => s.id === e.id)?.clan };
  });
  await page.waitForFunction(
    (id) => (window.__cinder!.renderer.combatStats() as unknown as { ships: Ships }).ships.some((s) => s.id === id && s.clanParts === 6),
    clan.id,
    { timeout: 20_000 },
  );
  const wreck = await page.evaluate((id) => (window.__cinder!.renderer.combatStats() as unknown as { ships: Ships }).ships.find((s) => s.id === id), clan.id);
  expect(wreck?.clan).toBe(clan.clan);
  expect(errors).toEqual([]);
});

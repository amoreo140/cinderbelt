import type { Page } from '@playwright/test';

// Test save positions (tests/fixtures/saves/README.md): boot the dev build straight into a fixture
// with `?fixture=<name>` – no menu, no saving (like `?play`) – instead of playing there in the spec.

/** The fixtures `npm run fixtures` generates (tests/fixtures/saves/<name>.json). */
export type FixtureName =
  | 'start'
  | 'training-mid'
  | 'after-training'
  | 'hour1'
  | 'hour2'
  | 'dock-approach'
  | 'pirates-near'
  | 'fortress'
  | 'rich-rock'
  | 'damaged'
  | 'wreck-salvage'
  | 'cargo-full'
  | 'hangar'
  | 'derelict'
  | 'derelict-dock'
  | 'graveyard'
  | 'comet'
  | 'gunner'
  | 'shapes'
  | 'shapes-fight'
  | 'home-dev'
  | 'home-built'
  | 'workshop'
  | 'relay-ready'
  | 'relay-hold'
  | 'relay-fight'
  | 'secured'
  | 'convoy-near'
  | 'convoy-linked'
  | 'escort'
  | 'watch-fight'
  | 'map-notes';

export interface LoadFixtureOptions {
  /** Extra URL parameters (e.g. `{ lang: 'en' }`). */
  params?: Record<string, string>;
  /** Simulation steps to run after the load before returning (the scene and the HUD catch up). */
  ticks?: number;
  /** Collapse the controls help (it covers the top right of the scene in screenshots). Default true. */
  collapseHelp?: boolean;
  timeout?: number;
}

/**
 * Opens the game in the given fixture and waits until the simulation runs. Then use
 * `window.__cinder` (sim, renderer, game) as with `?play`.
 */
export async function loadFixture(page: Page, name: FixtureName, options: LoadFixtureOptions = {}): Promise<void> {
  const { ticks = 5, collapseHelp = true, timeout = 90_000 } = options;
  const query = new URLSearchParams({ fixture: name, ...options.params });
  await page.goto(`/?${query.toString()}`);
  const loaded = await page.waitForFunction(() => window.__cinderFixture ?? null, undefined, { timeout });
  const status = (await loaded.jsonValue()) as string;
  if (status !== name) throw new Error(`loadFixture(${name}): ${status}`);
  await page.waitForFunction(() => !!window.__cinder, undefined, { timeout });
  if (collapseHelp) {
    await page.evaluate(() => {
      const game = window.__cinder!.game as unknown as { helpOpen: boolean; helpTouched: boolean };
      game.helpOpen = false;
      game.helpTouched = true;
    });
  }
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout });
}

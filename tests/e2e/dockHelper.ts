import { expect, type Page } from '@playwright/test';

// Docking as a manoeuvre for the e2e specs: the ship must be by the
// dock clamp (≤ 4 u from the docking point), slow (≤ 3 u/s) and with the bow along the dock axis
// (±35°). These helpers put the flying ship on that approach and dock with the real F key, so every
// spec docks by the same rules the player does.

const MODULES = { dock: '/src/sim/station/dock.ts', stations: '/src/sim/world/stations.ts' } as const;

export interface ClampApproach {
  /** Station id (default: the nearest loaded station). */
  stationId?: string;
  /** Distance out from the docking point along the dock axis (u). */
  offset?: number;
  /** Sideways offset from the axis (u). */
  side?: number;
  /** Bow angle off the station-facing heading (rad). */
  turn?: number;
  /** Speed along the axis towards the station (u/s). */
  speed?: number;
}

async function waitTicks(page: Page, ticks: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__cinder!.sim.state.tick);
  await page.waitForFunction(([t, n]) => window.__cinder!.sim.state.tick >= t + n, [t0, ticks] as const, { timeout: 60_000 });
}

/**
 * Puts the flying ship on the approach to a dock clamp (stopped, 2 u out on the axis, bow at the station
 * by default) and lets the HUD catch up. Returns the docking point.
 */
export async function approachClamp(page: Page, a: ClampApproach = {}): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    async ({ modules, a }) => {
      const { dockHeading, dockPoint } = (await import(/* @vite-ignore */ modules.dock)) as typeof import('../../src/sim/station/dock');
      const { stationById } = (await import(/* @vite-ignore */ modules.stations)) as typeof import('../../src/sim/world/stations');
      const { sim } = window.__cinder!;
      const p = sim.state.player;
      if (p.dock.mode !== 'flying') throw new Error(`approachClamp: the ship is ${p.dock.mode}`);
      const stations = sim.state.world.stations();
      const near = (s: (typeof stations)[number]) => Math.hypot(s.pos.x - p.body.pos.x, s.pos.y - p.body.pos.y);
      // a station far away is not loaded yet – its definition comes from the seed, the chunk loads around the ship
      const st = a.stationId ? (stations.find((s) => s.id === a.stationId) ?? stationById(sim.state.seed, a.stationId)) : [...stations].sort((x, y) => near(x) - near(y))[0];
      if (!st) throw new Error(`approachClamp: station ${a.stationId ?? '(nearest)'} not loaded`);
      const pt = dockPoint(st, p.props.boundingRadius);
      const out = { x: Math.cos(st.portAngle), y: Math.sin(st.portAngle) };
      const off = a.offset ?? 2;
      const side = a.side ?? 0;
      const speed = a.speed ?? 0;
      const body = {
        pos: { x: pt.x + out.x * off - out.y * side, y: pt.y + out.y * off + out.x * side },
        vel: { x: -out.x * speed, y: -out.y * speed },
        angle: dockHeading(st) + (a.turn ?? 0),
        angVel: 0,
      };
      p.body = body;
      p.prevBody = body;
      // the dampers would brake a requested approach speed
      if (speed > 0) p.dampers = false;
      return pt;
    },
    { modules: MODULES, a },
  );
  await waitTicks(page, 5);
  return point;
}

/** Approach the clamp, check the readout says "ready", press F and wait for the latch to dock the ship. */
export async function dockAtClamp(page: Page, a: ClampApproach = {}): Promise<void> {
  await approachClamp(page, a);
  await expect(page.getByTestId('dock-approach')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'docked', null, { timeout: 30_000 });
}

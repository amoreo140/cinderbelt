// The honest balance-bot pilot played through the saboteur Driver (deaths, counters), with optional
// hooks: a saboteur can run its own station business right after every docking, or take over a
// flight tick (e.g. scuttle instead of flying home). Used for the honest baseline of every exploit
// loop and for "does the player recover" checks.
import { RESOURCE_IDS } from '../../../src/data/resources';
import { BotLog, DEFAULT_BOT_OPTIONS, Pilot, type BotOptions } from '../pilot';
import { Driver, TPS } from './harness';
import { netWorth } from './value';

export interface PilotHooks {
  /** Runs once whenever the ship has just docked, before the pilot's own station business. */
  onDocked?: (d: Driver) => void;
  /** Runs every flying tick before the pilot; return true when it handled the tick itself. */
  inFlight?: (d: Driver, pilot: Pilot) => boolean;
}

export interface PilotRun {
  seconds: number;
  worthStart: number;
  worthEnd: number;
  /** Net worth gained per game hour. */
  perHour: number;
  /** Game seconds (from the start of this run) of the first sale after ore was mined, or null. */
  firstOreSale: number | null;
  /** Soft-lock reported by the pilot (null = it kept playing). */
  aborted: string | null;
  mined: number;
  deaths: number;
}

const minedTotal = (d: Driver): number => RESOURCE_IDS.reduce((s, r) => s + d.state.stats.mined[r], 0);

export function runPilot(d: Driver, seconds: number, hooks: PilotHooks = {}, options: Partial<BotOptions> = {}): PilotRun {
  const pilot = new Pilot(d.sim, { ...DEFAULT_BOT_OPTIONS, ...options }, new BotLog());
  const start = d.state.tick;
  const end = start + Math.round(seconds * TPS);
  const worthStart = netWorth(d.state).total;
  const mined0 = minedTotal(d);
  const deaths0 = d.counts.death ?? 0;
  let firstOreSale: number | null = null;
  let wasDocked = false;
  while (d.state.tick < end && !pilot.aborted) {
    const docked = d.state.player.dock.mode === 'docked';
    if (docked && !wasDocked && hooks.onDocked) hooks.onDocked(d);
    wasDocked = d.state.player.dock.mode === 'docked';
    if (!wasDocked && d.state.player.dock.mode === 'flying' && hooks.inFlight?.(d, pilot)) continue;
    const before = d.state.player.cargo;
    const ore = RESOURCE_IDS.some((r) => before[r] > 1e-6) || minedTotal(d) > mined0;
    const events = d.step(pilot.command());
    pilot.onEvents(events);
    if (firstOreSale === null && ore && minedTotal(d) > mined0) {
      for (const e of events) if (e.type === 'creditsChanged' && e.reason === 'sell' && e.delta > 0) firstOreSale = (d.state.tick - start) / TPS;
    }
  }
  const secs = (d.state.tick - start) / TPS;
  const worthEnd = netWorth(d.state).total;
  return {
    seconds: secs,
    worthStart,
    worthEnd,
    perHour: secs > 0 ? ((worthEnd - worthStart) * 3600) / secs : 0,
    firstOreSale,
    aborted: pilot.aborted,
    mined: minedTotal(d) - mined0,
    deaths: (d.counts.death ?? 0) - deaths0,
  };
}

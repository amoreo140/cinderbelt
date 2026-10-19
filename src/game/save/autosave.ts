// Autosave scheduler (M2, 9.2) – pure, time = game steps (ticks).
//
// Wiring in Game.ts (not hooked up yet):
//   const scheduler = new AutosaveScheduler(sim.state.tick);
//   // in the loop after every sim.step(cmd):
//   const reason = scheduler.afterStep(sim.state.tick, events, sim.state.player.dock.mode);
//   if (reason) void saves.save(sim, session, reason).then(showIndicatorOrToast);
//   // manual "Save game" in the pause / "Save and leave" (the sim stands, no step arrives):
//   void saves.save(sim, session, 'manual' | 'quit'); scheduler.markSaved(sim.state.tick);
//   // document.visibilitychange → hidden (best effort, the loop stops):
//   void saves.save(sim, session, 'interval'); scheduler.markSaved(sim.state.tick);
//   // after loading / a new game: scheduler.reset(sim.state.tick)
// Pause and menu do not call sim.step → game time stands, the interval is not counted.
import type { SaveReason } from '../../sim/save/types';
import type { SimEvent } from '../../sim/Simulation';
import type { DockState } from '../../sim/station/dock';

/** 2 minutes of game time at 60 steps per second. */
export const AUTOSAVE_INTERVAL_TICKS = 7200;

export class AutosaveScheduler {
  private lastSaveTick: number;
  private requested: SaveReason | null = null;
  private readonly intervalTicks: number;

  constructor(startTick: number, options: { intervalTicks?: number } = {}) {
    this.lastSaveTick = startTick;
    this.intervalTicks = options.intervalTicks ?? AUTOSAVE_INTERVAL_TICKS;
  }

  /**
   * Call after every simulation step with its events. Returns the reason if a save should happen now
   * (at most one save per step): dock > request > interval. The interval is postponed during
   * a transitional docking – docking ends with a `docked` event and a "dock" save.
   */
  afterStep(tick: number, events: readonly SimEvent[], dockMode: DockState['mode']): SaveReason | null {
    let reason: SaveReason | null = null;
    if (events.some((e) => e.type === 'docked')) reason = 'dock';
    else if (this.requested) reason = this.requested;
    else if (dockMode !== 'docking' && tick - this.lastSaveTick >= this.intervalTicks) reason = 'interval';
    if (reason) this.markSaved(tick);
    return reason;
  }

  /** A request to save at the nearest step (e.g. a hub button while the simulation runs). */
  request(reason: SaveReason): void {
    this.requested = reason;
  }

  /** Take the pending request right away (when no step arrives – pause, hidden tab). */
  takeRequest(): SaveReason | null {
    const r = this.requested;
    this.requested = null;
    return r;
  }

  /** A save outside the scheduler (manual, on leaving, death) – the interval starts over. */
  markSaved(tick: number): void {
    this.lastSaveTick = tick;
    this.requested = null;
  }

  /** New / loaded game. */
  reset(tick: number): void {
    this.markSaved(tick);
  }
}

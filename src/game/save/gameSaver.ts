// Saving one running game (I1, M3 from the M2a–M3b code review): holds the session (the slot can
// change by a fall from hardcore), saves a destroyed ship only as a "death" save and while a slot move
// runs further saves wait so they do not recreate the old slot.
import type { SaveReason } from '../../sim/save/types';
import type { Simulation } from '../../sim/Simulation';
import type { GameSession, SaveOutcome, SaveService } from './saveService';

/** Runs a save; a synchronous throw or a rejection ends as a failed outcome (callers show it, nothing stays "saving"). */
export async function settleSave(run: () => Promise<SaveOutcome | null>): Promise<SaveOutcome | null> {
  try {
    return await run();
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

export class GameSaver {
  private current: GameSession;
  private move: Promise<unknown> | null = null;

  constructor(
    private readonly saves: SaveService,
    session: GameSession,
  ) {
    this.current = { ...session, slot: { ...session.slot } };
  }

  /** The current session (after a move from hardcore it has a new slot). */
  get session(): GameSession {
    return this.current;
  }

  /** A move of the game into a slot of another difficulty is running. */
  get moving(): boolean {
    return this.move !== null;
  }

  /**
   * Saves the game. The snapshot and the write are queued right away (synchronously), except waiting for a running
   * slot move. The wreck of the ship is saved only with the reason `death` (others return null) – the next start
   * then shows the death card and the penalty is applied; closing the card does not bypass it.
   * When the difficulty in the settings differs from the slot (fall from hardcore), the game is moved.
   */
  save(sim: Simulation, reason: SaveReason): Promise<SaveOutcome | null> {
    if (sim.state.player.destroyed && reason !== 'death') return Promise.resolve(null);
    if (this.move) return this.move.then(() => this.save(sim, reason));
    if (sim.state.settings.deathPenalty !== this.current.slot.difficulty) return this.moveSlot(sim, reason);
    return this.saves.save(sim, this.current, reason);
  }

  private moveSlot(sim: Simulation, reason: SaveReason): Promise<SaveOutcome> {
    const job = this.saves.fallFromHardcore(sim, this.current, reason).then(({ session, outcome }) => {
      this.current = session;
      this.move = null;
      return outcome;
    }, (e: unknown) => {
      this.move = null;
      throw e;
    });
    this.move = job;
    return job;
  }
}

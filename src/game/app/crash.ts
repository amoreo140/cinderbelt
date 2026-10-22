// Crash handling helpers (issue #3): what the app does when the frame loop throws, and when a stray
// window error deserves a toast. Pure – App.ts wires them to the browser.

/** What a throw in the frame loop means for the running game. */
export interface CrashInfo {
  error: unknown;
  /** false = the throw happened inside the fixed-step simulation advance (the state may be half-updated). */
  simIntact: boolean;
}

/** What the crash card tells the player about their progress. */
export type CrashSave = 'saving' | 'saved' | 'kept' | 'unsaved';

export interface CrashView {
  save: CrashSave;
  /** ms since the last save of the game (null = unknown); shown with `kept`. */
  sinceSave: number | null;
  /** Text for "Copy error details" (version, message, stack). */
  report: string;
}

/**
 * Emergency save of a crashed game: only a game with a saved slot, a living ship (the death sequence has
 * its own save) and a simulation that was not caught mid-step. Otherwise the last good save stays.
 */
export function shouldEmergencySave(game: { hasSession: boolean; dying: boolean; simIntact: boolean }): boolean {
  return game.hasSession && !game.dying && game.simIntact;
}

/** The save line of the card before any emergency save result is known. */
export function initialCrashSave(game: { hasSession: boolean }, willSave: boolean): CrashSave {
  if (!game.hasSession) return 'unsaved';
  return willSave ? 'saving' : 'kept';
}

/** Text of "Copy error details": app version, user agent, message and stack. */
export function crashReport(version: string, error: unknown, userAgent = ''): string {
  const lines = [`Cinderbelt ${version}`];
  if (userAgent) lines.push(userAgent);
  lines.push('', errorText(error));
  return lines.join('\n');
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const head = `${error.name}: ${error.message}`;
    return error.stack ? (error.stack.startsWith(head) ? error.stack : `${head}\n${error.stack}`) : head;
  }
  try {
    return typeof error === 'string' ? error : JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Browser noise that is not worth a toast (nothing the player or we can act on). */
export function isBenignError(message: string, error: unknown): boolean {
  if (/^ResizeObserver loop/i.test(message)) return true;
  // a cross-origin script error: the browser hides everything
  if (error == null && (message === '' || /^Script error\.?$/i.test(message))) return true;
  return false;
}

/** At most one toast per `gapMs`. */
export class ToastThrottle {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private readonly gapMs = 10_000) {}

  take(now: number): boolean {
    if (now - this.last < this.gapMs) return false;
    this.last = now;
    return true;
  }
}

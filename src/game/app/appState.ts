// App state machine (M2): menu → new game / load → game ⇄ pause → menu.
// Pure – App.ts switches screens by it, stops the simulation and creates/destroys the Game instances.

/** Main menu screens. */
export type MenuPage = 'home' | 'newGame' | 'load' | 'settings' | 'about';
/** Overlay above the running game (the simulation stands for every one except null). */
export type GameOverlay = 'pause' | 'load' | 'settings' | 'death' | 'crash';

export type AppState =
  | { kind: 'boot' }
  | { kind: 'menu'; page: MenuPage }
  | { kind: 'game'; overlay: GameOverlay | null };

export type AppEvent =
  /** Models and storage are ready. */
  | { type: 'ready' }
  /** A menu subscreen, or Load / Settings from the pause. */
  | { type: 'open'; page: MenuPage }
  /** Esc / Back: subscreen → menu home, pause subscreen → pause, pause → game. */
  | { type: 'back' }
  | { type: 'pause' }
  | { type: 'resume' }
  /** A new, loaded or continued game is running (also loading another game from the pause). */
  | { type: 'gameStarted' }
  /** Save and leave to the menu. */
  | { type: 'quitToMenu' }
  /** Cockpit destroyed – the death card, the simulation stands. */
  | { type: 'died' }
  /** Penalty applied, the game continues at the respawn station. */
  | { type: 'respawned' }
  /** The frame loop threw and stopped – the crash card (nothing but Back to menu leaves it). */
  | { type: 'crashed' }
  /** Back to menu from the crash card (no save). */
  | { type: 'leaveCrash' }
  /** Loading another game from the pause menu failed after the running game was stopped – back to the menu. */
  | { type: 'startFailed' };

export const INITIAL_APP_STATE: AppState = { kind: 'boot' };

/** The next state, or null if the event makes no sense in this state (ignored). */
export function transition(state: AppState, event: AppEvent): AppState | null {
  switch (state.kind) {
    case 'boot':
      return event.type === 'ready' ? { kind: 'menu', page: 'home' } : null;

    case 'menu':
      switch (event.type) {
        case 'open':
          return state.page === 'home' && event.page !== 'home' ? { kind: 'menu', page: event.page } : null;
        case 'back':
          return state.page !== 'home' ? { kind: 'menu', page: 'home' } : null;
        case 'gameStarted':
          // Continue (home), Start game (new game), Load (loading)
          return state.page === 'home' || state.page === 'newGame' || state.page === 'load' ? { kind: 'game', overlay: null } : null;
        default:
          return null;
      }

    case 'game': {
      const { overlay } = state;
      switch (event.type) {
        case 'pause':
          return overlay === null ? { kind: 'game', overlay: 'pause' } : null;
        case 'resume':
          return overlay === 'pause' ? { kind: 'game', overlay: null } : null;
        case 'open':
          if (overlay !== 'pause') return null;
          return event.page === 'load' || event.page === 'settings' ? { kind: 'game', overlay: event.page } : null;
        case 'back':
          if (overlay === 'load' || overlay === 'settings') return { kind: 'game', overlay: 'pause' };
          if (overlay === 'pause') return { kind: 'game', overlay: null };
          return null;
        case 'gameStarted':
          return overlay === 'load' ? { kind: 'game', overlay: null } : null;
        case 'quitToMenu':
          return overlay === 'pause' ? { kind: 'menu', page: 'home' } : null;
        case 'died':
          return overlay !== 'death' && overlay !== 'crash' ? { kind: 'game', overlay: 'death' } : null;
        case 'respawned':
          return overlay === 'death' ? { kind: 'game', overlay: null } : null;
        case 'crashed':
          return overlay !== 'crash' ? { kind: 'game', overlay: 'crash' } : null;
        case 'leaveCrash':
          return overlay === 'crash' ? { kind: 'menu', page: 'home' } : null;
        case 'startFailed':
          return { kind: 'menu', page: 'home' };
        default:
          return null;
      }
    }
  }
}

/** Is the simulation running (stepping and taking flight input)? */
export const simulationRunning = (state: AppState): boolean => state.kind === 'game' && state.overlay === null;

/** Does a game instance exist (the scene is drawn under the pause too)? */
export const gameActive = (state: AppState): boolean => state.kind === 'game';

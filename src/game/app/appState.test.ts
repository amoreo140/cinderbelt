import { describe, expect, it } from 'vitest';
import { gameActive, INITIAL_APP_STATE, simulationRunning, transition, type AppEvent, type AppState } from './appState';

const run = (events: AppEvent[], from: AppState = INITIAL_APP_STATE): AppState => {
  let state = from;
  for (const e of events) {
    const next = transition(state, e);
    if (!next) throw new Error(`invalid ${e.type} in ${JSON.stringify(state)}`);
    state = next;
  }
  return state;
};

describe('app state machine', () => {
  it('boots into the main menu', () => {
    expect(run([{ type: 'ready' }])).toEqual({ kind: 'menu', page: 'home' });
    expect(transition(INITIAL_APP_STATE, { type: 'pause' })).toBeNull();
  });

  it('menu → new game → game ⇄ pause → menu', () => {
    const playing = run([{ type: 'ready' }, { type: 'open', page: 'newGame' }, { type: 'gameStarted' }]);
    expect(playing).toEqual({ kind: 'game', overlay: null });
    expect(simulationRunning(playing)).toBe(true);
    const paused = run([{ type: 'pause' }], playing);
    expect(paused).toEqual({ kind: 'game', overlay: 'pause' });
    expect(simulationRunning(paused)).toBe(false);
    expect(gameActive(paused)).toBe(true);
    expect(run([{ type: 'resume' }], paused)).toEqual(playing);
    expect(run([{ type: 'back' }], paused)).toEqual(playing);
    const menu = run([{ type: 'quitToMenu' }], paused);
    expect(menu).toEqual({ kind: 'menu', page: 'home' });
    expect(gameActive(menu)).toBe(false);
  });

  it('continue starts a game straight from the home page; load from the load page', () => {
    expect(run([{ type: 'ready' }, { type: 'gameStarted' }])).toEqual({ kind: 'game', overlay: null });
    expect(run([{ type: 'ready' }, { type: 'open', page: 'load' }, { type: 'gameStarted' }])).toEqual({ kind: 'game', overlay: null });
    expect(transition({ kind: 'menu', page: 'settings' }, { type: 'gameStarted' })).toBeNull();
  });

  it('menu sub-pages open only from home and go back home', () => {
    for (const page of ['newGame', 'load', 'settings', 'about'] as const) {
      const s = run([{ type: 'ready' }, { type: 'open', page }]);
      expect(s).toEqual({ kind: 'menu', page });
      expect(transition(s, { type: 'open', page: 'load' })).toBeNull();
      expect(run([{ type: 'back' }], s)).toEqual({ kind: 'menu', page: 'home' });
    }
    expect(transition({ kind: 'menu', page: 'home' }, { type: 'back' })).toBeNull();
  });

  it('pause opens load and settings; back returns to the pause menu', () => {
    const paused: AppState = { kind: 'game', overlay: 'pause' };
    for (const page of ['load', 'settings'] as const) {
      const s = run([{ type: 'open', page }], paused);
      expect(s).toEqual({ kind: 'game', overlay: page });
      expect(run([{ type: 'back' }], s)).toEqual(paused);
      expect(transition(s, { type: 'resume' })).toBeNull();
      expect(transition(s, { type: 'quitToMenu' })).toBeNull();
    }
    expect(transition(paused, { type: 'open', page: 'newGame' })).toBeNull();
    expect(transition({ kind: 'game', overlay: null }, { type: 'open', page: 'load' })).toBeNull();
  });

  it('loading another game from the pause menu replaces the running game', () => {
    expect(run([{ type: 'gameStarted' }], { kind: 'game', overlay: 'load' })).toEqual({ kind: 'game', overlay: null });
    expect(transition({ kind: 'game', overlay: 'pause' }, { type: 'gameStarted' })).toBeNull();
  });

  it('death shows a card and stops the simulation until respawn', () => {
    const dead = run([{ type: 'died' }], { kind: 'game', overlay: null });
    expect(dead).toEqual({ kind: 'game', overlay: 'death' });
    expect(simulationRunning(dead)).toBe(false);
    expect(transition(dead, { type: 'pause' })).toBeNull();
    expect(transition(dead, { type: 'back' })).toBeNull();
    expect(transition(dead, { type: 'quitToMenu' })).toBeNull();
    expect(run([{ type: 'respawned' }], dead)).toEqual({ kind: 'game', overlay: null });
  });

  it('cannot pause twice or resume a running game', () => {
    expect(transition({ kind: 'game', overlay: 'pause' }, { type: 'pause' })).toBeNull();
    expect(transition({ kind: 'game', overlay: null }, { type: 'resume' })).toBeNull();
    expect(transition({ kind: 'game', overlay: null }, { type: 'quitToMenu' })).toBeNull();
  });
  it('a crash opens a card that only Back to menu leaves', () => {
    const playing: AppState = { kind: 'game', overlay: null };
    const crashed = run([{ type: 'crashed' }], playing);
    expect(crashed).toEqual({ kind: 'game', overlay: 'crash' });
    expect(simulationRunning(crashed)).toBe(false);
    expect(gameActive(crashed)).toBe(true);
    // also over the pause or the death card
    expect(run([{ type: 'crashed' }], { kind: 'game', overlay: 'pause' })).toEqual(crashed);
    expect(run([{ type: 'crashed' }], { kind: 'game', overlay: 'death' })).toEqual(crashed);
    // Esc (back), pause, resume, a death or a second crash do not close or replace it
    for (const type of ['back', 'pause', 'resume', 'died', 'respawned', 'crashed', 'quitToMenu', 'gameStarted'] as const) {
      expect(transition(crashed, { type })).toBeNull();
    }
    expect(transition(crashed, { type: 'open', page: 'settings' })).toBeNull();
    expect(run([{ type: 'leaveCrash' }], crashed)).toEqual({ kind: 'menu', page: 'home' });
    expect(transition(playing, { type: 'leaveCrash' })).toBeNull();
    expect(transition({ kind: 'menu', page: 'home' }, { type: 'crashed' })).toBeNull();
  });

  it('a failed start returns from any game screen to the menu, and is ignored elsewhere', () => {
    expect(transition({ kind: 'game', overlay: 'load' }, { type: 'startFailed' })).toEqual({ kind: 'menu', page: 'home' });
    expect(transition({ kind: 'game', overlay: null }, { type: 'startFailed' })).toEqual({ kind: 'menu', page: 'home' });
    expect(transition({ kind: 'menu', page: 'load' }, { type: 'startFailed' })).toBeNull();
  });
});

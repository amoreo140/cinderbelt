import './styles.css';
import { prewarmAudioContext } from './audio';
import { App } from './game/app/App';
import { RuntimeLoad } from './game/app/runtimeLoad';
import { whenIdle } from './ui/lazy';
import { loadUserSettings } from './game/settings/userSettings';
import { openSaveStorage } from './game/storage/open';
import { showBootError } from './bootError';
import { setLocale, loadTexts } from './i18n';
import { applyFirstLocale } from './i18n/firstLocale';

const gameElement = document.getElementById('game');
const uiElement = document.getElementById('ui');
if (!gameElement || !uiElement) throw new Error('Missing the #game or #ui element');

/** `?play` (dev only) skips the menu and starts a game with seed 1337 without saving – e2e tests. */
function quickStartSeed(): string | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(location.search);
  return params.has('play') ? params.get('play') || '1337' : null;
}

function settingsStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The UI language before the first screen (the loading bar): only its texts are downloaded; the App
 * applies later changes. A language that does not download is retried once, then another one is used;
 * rejects when none does.
 */
async function initialLocale(): Promise<void> {
  await applyFirstLocale(loadUserSettings(settingsStore()).language, { load: loadTexts, set: setLocale });
}

/** `?fixture=<name>` (dev only): straight into a test save position (tests/fixtures/saves). */
function fixtureName(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null;
}

async function boot(game: HTMLElement, ui: HTMLElement): Promise<void> {
  // the game runtime (three.js, renderer, Game, models – runtime.ts) is not needed for the menu: it
  // downloads behind it, or at once – before the language's texts – when the boot goes straight into a game
  const runtime = new RuntimeLoad();
  const quickStart = quickStartSeed();
  const fixture = fixtureName();
  const direct = quickStart !== null || fixture !== null;
  if (direct) void runtime.start().catch(() => {});
  await initialLocale();
  // the game asks for persistent storage only at the first save (long-term design 9.9)
  const storage = await openSaveStorage({ requestPersist: false });
  if (!storage.available) console.warn('Save storage unavailable, saves stay in memory:', storage.error);
  const app = new App({ gameElement: game, uiElement: ui, runtime, storage, version: __APP_VERSION__ });
  // the AudioContext blocks the main thread for ~80 ms when created: after the menu's first frames; it stays
  // suspended until the first gesture, which then only resumes it
  whenIdle(() => {
    if (!direct) void runtime.start().catch((e: unknown) => console.warn('Game runtime download failed (retried at the game start):', e));
    prewarmAudioContext();
  }, 400);
  if (import.meta.env.DEV && fixture !== null) {
    try {
      const { loadFixtureSim } = await import('./game/devFixtures');
      await app.startSimulation(await loadFixtureSim(fixture));
      window.__cinderFixture = fixture;
      return;
    } catch (e) {
      console.error(e);
      window.__cinderFixture = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  app.start(quickStart);
}

boot(gameElement, uiElement).catch((e: unknown) => showBootError(uiElement, loadUserSettings(settingsStore()).language, e));

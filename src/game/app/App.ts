// Application: main menu, new game, loading, pause, settings, saving and death (M2c).
// Holds the state machine (appState.ts), the storage and one running Game instance. Game knows nothing
// about the menu – it gets the simulation and hooks (pause, step, F5); on return to the menu it is
// stopped and released.
import { render } from 'preact';
import { RESOURCE_IDS } from '../../data/resources';
import { setLocale, tx } from '../../i18n';
import type { RenderContext } from '../../render/RenderContext';
import { applyDeath } from '../../sim/death/death';
import type { SaveReason, SlotRef } from '../../sim/save/types';
import { DIFFICULTY_PRESETS } from '../../sim/settings';
import { Simulation, type SimEvent } from '../../sim/Simulation';
import { stationById } from '../../sim/world/stations';
import { showLoading } from '../../ui/Loading';
import { renderAppOverlay } from '../../ui/menu/AppOverlay';
import type { DeathInfo, NewGameRequest, OverlayData, OverlayHandlers, SaveIndicatorState } from '../../ui/menu/types';
import { formatStationName } from '../../ui/stationName';
import type { ToastTone } from '../../ui/theme';
import { deathView } from '../combatView';
import type { Game } from '../Game';
import { GameAudio } from '../GameAudio';
import { musicScreenFor } from '../musicSituation';
import { randomSeedText } from '../newGame/seedWords';
import { loadSkipTraining, saveSkipTraining } from '../newGame/trainingPref';
import { AutosaveScheduler } from '../save/autosave';
import { GameSaver, settleSave } from '../save/gameSaver';
import { releaseOnThrow, SlotLocks, type SlotLock } from '../save/slotLock';
import { sameSlot } from '../storage/slots';
import { loadWarningTexts } from '../save/loadWarnings';
import { SaveService, type GameSession, type SaveOutcome, type SlotOverview } from '../save/saveService';
import { continueTarget } from '../save/slotView';
import {
  DEFAULT_USER_SETTINGS,
  applyRenderSettings,
  loadUserSettings,
  prefersReducedMotion,
  sanitizeUserSettings,
  saveUserSettings,
  type UserSettings,
} from '../settings/userSettings';
import { downloadTextFile, readFileText } from '../storage/fileTransfer';
import { requestPersistentStorage } from '../storage/indexedDbStorage';
import type { StorageHandle } from '../storage/open';
import { transition, gameActive, INITIAL_APP_STATE, simulationRunning, type AppEvent, type AppState } from './appState';
import { crashReport, initialCrashSave, isBenignError, shouldEmergencySave, ToastThrottle, type CrashInfo, type CrashView } from './crash';
import type { GameRuntime, RuntimeLoad } from './runtimeLoad';

declare global {
  interface Window {
    /** Debug access to the app for tests (dev mode only). */
    __cinderApp?: App;
  }
}

export interface AppOptions {
  gameElement: HTMLElement;
  uiElement: HTMLElement;
  /** The game runtime's download (code + models): the menu runs without it, a game start waits for it. */
  runtime: RuntimeLoad;
  storage: StorageHandle;
  version: string;
}

/** How long the scene (explosion) runs after the ship is destroyed before the card shows. */
const DEATH_CARD_DELAY_MS = 1400;
/** How long the "Saved" indicator stays. */
const INDICATOR_HOLD_MS = 1400;
const INDICATOR_FADE_MS = 400;

/** Station name by id (also outside the active chunks). */
function stationLabel(sim: Simulation, id: string): string {
  const s = stationById(sim.state.seed, id);
  return s ? formatStationName(s) : id;
}

const localStore = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export class App {
  private state: AppState = INITIAL_APP_STATE;
  private readonly saves: SaveService;
  private readonly audio: GameAudio;
  private settings: UserSettings;
  private readonly gameUi: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly lifetime = new AbortController();

  private game: Game | null = null;
  /** The loaded game runtime (null until the first game start finds it downloaded). */
  private runtime: GameRuntime | null = null;
  /** One WebGL renderer for all games (created on the first start, destroyed by dispose). */
  private renderContext: RenderContext | null = null;
  /** Saving of the running game (session, slot move after a hardcore fall); null = a game without saving. */
  private saver: GameSaver | null = null;
  private scheduler: AutosaveScheduler | null = null;
  private lastSaveAt: number | null = null;

  private slots: SlotOverview[] | null = null;
  private persistent: boolean | null;
  private bannerDismissed = false;
  private busy: string | null = null;
  private menuError: string | null = null;
  private newGameSlot: SlotRef | null = null;
  private toast: { text: string; tone: ToastTone } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private indicator: SaveIndicatorState = null;
  private indicatorTimers: ReturnType<typeof setTimeout>[] = [];
  private pauseTicker: ReturnType<typeof setInterval> | null = null;
  /** Ship destroyed – waiting for the card / confirmation (pause and autosave are blocked). */
  private dying = false;
  private deathTimer: ReturnType<typeof setTimeout> | null = null;
  private death: DeathInfo | null = null;
  /** The frame loop crashed (the crash card is up); null = no crash. */
  private crash: CrashView | null = null;
  private readonly errorToasts = new ToastThrottle();
  private readonly systemReducedMotion: MediaQueryList | null;
  /** Guard against the same game in two tabs (Web Locks) and the lock on the running game's slot. */
  private readonly locks = new SlotLocks();
  private slotLock: SlotLock | null = null;
  /** A newer game version in another tab closed the storage – further writes will fail. */
  private storageClosed = false;

  constructor(private readonly options: AppOptions) {
    this.saves = new SaveService(options.storage.storage, { gameVersion: options.version });
    options.storage.storage.onClosed?.(() => {
      this.storageClosed = true;
      this.flash(tx().app.storage.closedElsewhere, 'error', 10_000);
    });
    // persistent storage: state detected on open; if not granted yet, it is requested on the first save
    this.persistent = options.storage.available ? (options.storage.persistent ? true : null) : false;
    this.settings = loadUserSettings(localStore());
    setLocale(this.settings.language);
    applyRenderSettings(this.settings);
    this.audio = new GameAudio(window, {
      volumes: this.volumes(),
      muted: this.settings.muted,
      onMuteChange: (muted) => this.updateSettings({ muted }, false),
    });

    this.gameUi = document.createElement('div');
    this.gameUi.className = 'app-layer app-game-ui';
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'af-root app-layer app-overlay';
    options.uiElement.append(this.gameUi, this.overlayEl);

    this.systemReducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.applyMotion();
    this.applyUiScale();

    const signal = this.lifetime.signal;
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
    document.addEventListener('visibilitychange', () => this.onHidden(document.visibilityState === 'hidden'), { signal });
    window.addEventListener('pagehide', () => this.onHidden(true), { signal });
    this.systemReducedMotion?.addEventListener('change', () => this.applyMotion(), { signal });
    window.addEventListener('error', (e) => this.onStrayError(e.message, e.error), { signal });
    window.addEventListener('unhandledrejection', (e) => this.onStrayError(String((e.reason as { message?: unknown } | null)?.message ?? e.reason ?? ''), e.reason ?? new Error('Unhandled rejection')), { signal });
    if (import.meta.env.DEV) window.__cinderApp = this;
  }

  /** Starts the menu (or the game directly – `quickStart` = quick-start seed without saving, tests only). */
  start(quickStart?: string | null): void {
    this.dispatch({ type: 'ready' });
    if (quickStart != null) this.startUnsaved(quickStart);
    else void this.refreshSlots();
  }

  /**
   * Starts a given simulation without saving (dev `?fixture=` – test save positions); resolves once the
   * game exists (its first frame follows after the shader warm-up).
   */
  startSimulation(sim: Simulation): Promise<void> {
    this.dispatch({ type: 'ready' });
    return this.launchWhenLoaded(sim);
  }

  /**
   * The sky and planets around a game's start position download alongside the runtime (perf O14);
   * `warm` = the game starts once the runtime is in.
   */
  private prefetchZone(seed: number, pos: { x: number; y: number }, warm = false): void {
    this.options.runtime.prefetchZone(seed, pos, warm);
  }

  /**
   * The game runtime (code + models, runtime.ts). The menu runs without it; when a game start finds it
   * still downloading, the loading overlay with the models' progress covers the wait.
   */
  private async gameRuntime(): Promise<GameRuntime> {
    if (this.runtime) return this.runtime;
    const load = this.options.runtime;
    const overlay = showLoading(this.options.uiElement);
    overlay.update(load.progress.loaded, load.progress.total);
    const off = load.onProgress(overlay.update);
    try {
      this.runtime = await load.start();
      return this.runtime;
    } finally {
      off();
      overlay.remove();
    }
  }

  /** The runtime for a game start from the menu; false (with a message) when it did not download. */
  private async runtimeReady(): Promise<boolean> {
    try {
      await this.gameRuntime();
      return true;
    } catch (e) {
      console.error('Game runtime failed to load:', e);
      this.flash(tx().loading.failed, 'error', 6000);
      return false;
    }
  }

  /** A game without saving once the runtime is in (quick start, test fixtures); resolves when it exists. */
  private async launchWhenLoaded(sim: Simulation): Promise<void> {
    this.prefetchZone(sim.state.seed, sim.state.player.body.pos, true);
    this.options.runtime.prewarmWorld(sim.state);
    await this.gameRuntime();
    if (!this.lifetime.signal.aborted) void this.launch(sim, null);
  }

  /** Full shutdown (tests / HMR). */
  dispose(): void {
    this.stopGame();
    (this.renderContext ?? this.runtime?.context)?.dispose();
    this.renderContext = null;
    this.adoptLock(null);
    this.lifetime.abort();
    for (const t of this.indicatorTimers) clearTimeout(t);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.pauseTicker) clearInterval(this.pauseTicker);
    this.audio.dispose();
    // unmount the Preact tree (components, timers, listeners) before the element is discarded
    render(null, this.overlayEl);
    this.gameUi.remove();
    this.overlayEl.remove();
    if (import.meta.env.DEV && window.__cinderApp === this) delete window.__cinderApp;
  }

  get appState(): AppState {
    return this.state;
  }

  get currentGame(): Game | null {
    return this.game;
  }

  get saveService(): SaveService {
    return this.saves;
  }

  /** The renderer and its GPU resources (tests for leaks between games); null = no game has run yet. */
  rendererStats(): ReturnType<RenderContext['stats']> | null {
    return this.renderContext?.stats() ?? null;
  }

  // ───────────── state machine ─────────────

  private dispatch(event: AppEvent): boolean {
    const next = transition(this.state, event);
    if (!next) return false;
    const prev = this.state;
    this.state = next;
    this.game?.setPaused(!simulationRunning(next));
    this.audio.setMusicScreen(musicScreenFor(next));

    const paused = next.kind === 'game' && next.overlay !== null;
    if (paused && !this.pauseTicker) this.pauseTicker = setInterval(() => this.render(), 1000);
    if (!paused && this.pauseTicker) {
      clearInterval(this.pauseTicker);
      this.pauseTicker = null;
    }
    const opensSlots =
      (next.kind === 'menu' && (prev.kind !== 'menu' || next.page !== prev.page)) ||
      (next.kind === 'game' && next.overlay === 'load' && (prev.kind !== 'game' || prev.overlay !== 'load'));
    if (opensSlots) void this.refreshSlots();
    if (next.kind === 'menu' && next.page === 'home') this.newGameSlot = null;
    this.render();
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || this.busy) return;
    const s = this.state;
    if (s.kind === 'menu' && s.page !== 'home') {
      e.preventDefault();
      this.dispatch({ type: 'back' });
    } else if (s.kind === 'game' && s.overlay && s.overlay !== 'death' && s.overlay !== 'crash') {
      e.preventDefault();
      this.dispatch({ type: 'back' });
    }
  }

  // ───────────── game ─────────────

  /** Starts a game; resolves when its first frame runs (after the shader warm-up – keep the busy overlay up). */
  private launch(sim: Simulation, session: GameSession | null, resumeCard = false): Promise<void> {
    this.stopGame();
    this.saver = session ? new GameSaver(this.saves, session) : null;
    this.scheduler = new AutosaveScheduler(sim.state.tick);
    this.lastSaveAt = session ? performance.now() : null;
    this.dying = false;
    this.death = null;
    const runtime = this.runtime;
    if (!runtime) throw new Error('launch() before the game runtime loaded (await gameRuntime() first)');
    this.renderContext ??= runtime.context;
    const game: Game = (this.game = new runtime.Game(this.options.gameElement, this.gameUi, runtime.library, {
      sim,
      renderContext: this.renderContext,
      audio: this.audio,
      helpOpen: this.settings.showControlsHelp,
      zoomSensitivity: this.settings.zoomSensitivity,
      flight: this.flightSettings(),
      graphics: this.settings.graphicsQuality,
      backgroundBrightness: this.settings.backgroundBrightness,
      radio: this.settings.radio,
      // a loaded game starts with the "Where you left off" card (M3.5a)
      resumeCard,
      gameName: session?.name ?? '',
      hooks: {
        onPauseRequest: () => {
          if (!this.dying) this.dispatch({ type: 'pause' });
        },
        afterStep: (events) => this.afterStep(events),
        onQuickSave: () => void this.quickSave(),
        onCrash: (info) => this.onCrash(game, info),
      },
    }));
    const ready = game.start();
    this.menuError = null;
    this.dispatch({ type: 'gameStarted' });
    // saves only in the tab's memory – the player must know right away (export is in the pause menu)
    if (session && !this.options.storage.available) this.game.notify(tx().app.storage.unavailable, 'error', 6);
    // a save stored right after the ship was destroyed (e.g. a closed tab) – the penalty applies at once
    if (sim.state.player.destroyed) this.beginDeath(0);
    return ready;
  }

  private stopGame(): void {
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.deathTimer = null;
    this.crash = null;
    const game = this.game;
    this.game = null;
    this.saver = null;
    this.scheduler = null;
    this.dying = false;
    this.death = null;
    try {
      game?.stop();
    } catch (e) {
      // a game that crashed may have a broken renderer: stopping it must not take the menu down too
      console.error('Stopping the game failed:', e);
      render(null, this.gameUi);
    }
  }

  /** The frame loop threw: stop at the card, save the progress when the state can be trusted. */
  private onCrash(game: Game, info: CrashInfo): void {
    if (this.game !== game || this.crash) return;
    const hasSession = this.session !== null;
    const willSave = shouldEmergencySave({ hasSession, dying: this.dying, simIntact: info.simIntact });
    this.crash = {
      save: initialCrashSave({ hasSession }, willSave),
      sinceSave: this.lastSaveAt === null ? null : performance.now() - this.lastSaveAt,
      report: crashReport(this.options.version, info.error, typeof navigator === 'undefined' ? '' : navigator.userAgent),
    };
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.deathTimer = null;
    try {
      this.dispatch({ type: 'crashed' });
    } catch (e) {
      console.error('Showing the crash card failed:', e);
    }
    if (willSave) void this.emergencySave(game);
  }

  private async emergencySave(game: Game): Promise<void> {
    let saved = false;
    try {
      // the normal path: an invalid snapshot is refused there and the slot keeps its previous save as the backup
      const outcome = await this.save('interval');
      saved = outcome?.status === 'saved' || outcome?.status === 'superseded';
    } catch (e) {
      console.error('Emergency save failed:', e);
    }
    if (this.game !== game || !this.crash) return;
    this.crash = { ...this.crash, save: saved ? 'saved' : 'kept', sinceSave: this.lastSaveAt === null ? null : performance.now() - this.lastSaveAt };
    this.render();
  }

  /** Crash card: Back to menu – no save, the slot lock goes, the player can load the slot again. */
  private leaveCrash(): void {
    if (!this.crash) return;
    this.stopGame();
    this.adoptLock(null);
    this.dispatch({ type: 'leaveCrash' });
  }

  private async copyCrashReport(): Promise<boolean> {
    const text = this.crash?.report;
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // no clipboard permission (or an insecure context): the old way
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      } finally {
        area.remove();
      }
    }
  }

  /** An error outside the frame loop (window `error` / `unhandledrejection`): log it and tell the player once in a while. */
  private onStrayError(message: string, error: unknown): void {
    if (isBenignError(message, error)) return;
    console.error('Unhandled error:', error ?? message);
    if (this.crash) return;
    if (!this.errorToasts.take(performance.now())) return;
    this.flash(tx().app.crash.toast, 'error', 5000);
  }

  /** Quick start without saving (`?play` in dev mode – e2e tests). */
  private startUnsaved(seedText: string): void {
    const text = seedText.trim() || '1337';
    const sim = new Simulation({
      seed: Number.isSafeInteger(Number(text)) ? Number(text) : 1337,
      settings: { seedText: text, ...DIFFICULTY_PRESETS.standard, fallenFromHardcore: false },
    });
    // the quick start (e2e) skips the Guild Training – a new Simulation has none; its tests start it themselves
    void this.launchWhenLoaded(sim);
  }

  private afterStep(events: readonly SimEvent[]): void {
    const sim = this.game?.simulation;
    if (!sim) return;
    // a finished Guild Training: the next new game offers to skip it (M3.7)
    if (events.some((e) => e.type === 'trainingStep' && e.done)) saveSkipTraining(localStore(), true);
    if (!this.dying && events.some((e) => e.type === 'playerDestroyed')) {
      // the wreck is saved right away (a synchronously queued write) – reloading the page during the
      // death sequence does not dodge the penalty: the next start shows the death card again
      this.persistDestroyed();
      this.beginDeath(DEATH_CARD_DELAY_MS);
      return;
    }
    if (!this.scheduler || !this.session || this.dying) return;
    const reason = this.scheduler.afterStep(sim.state.tick, events, sim.state.player.dock.mode);
    if (reason) void this.save(reason);
  }

  // ───────────── saving ─────────────

  private get session(): GameSession | null {
    return this.saver?.session ?? null;
  }

  /** Saves the running game (snapshot now, write asynchronously) and shows the indicator. */
  private async save(reason: SaveReason): Promise<SaveOutcome | null> {
    const sim = this.game?.simulation;
    const saver = this.saver;
    if (!sim || !saver) return null;
    // the ship's wreck only as a "death" save (persistDestroyed); regular saves wait for the penalty
    if (sim.state.player.destroyed && reason !== 'death') return null;
    this.scheduler?.markSaved(sim.state.tick);
    this.showIndicator('saving');
    const outcome = await this.runSave(saver, sim, reason);
    if (outcome) this.afterSave(outcome);
    return outcome;
  }

  private runSave(saver: GameSaver, sim: Simulation, reason: SaveReason): Promise<SaveOutcome | null> {
    return settleSave(() => saver.save(sim, reason));
  }

  /** Saves the destroyed ship (no indicator – the explosion is running); the penalty applies on next start. */
  private persistDestroyed(): void {
    const sim = this.game?.simulation;
    if (!sim || !this.saver || !sim.state.player.destroyed) return;
    void this.runSave(this.saver, sim, 'death').then((outcome) => {
      if (outcome?.status === 'failed') console.error('Saving the destroyed ship failed:', outcome.error);
    });
  }

  private afterSave(outcome: SaveOutcome): void {
    if (outcome.status === 'superseded') return;
    if (outcome.status === 'failed') {
      console.error('Save failed:', outcome.error);
      this.showIndicator('failed');
      this.game?.notify(this.storageClosed ? tx().app.storage.closedElsewhere : tx().saves.saveFailed, 'error', this.storageClosed ? 8 : 4);
      return;
    }
    // after a hardcore fall the game is in a new slot – the lock goes with it
    void this.followSlot();
    this.lastSaveAt = performance.now();
    this.showIndicator('saved');
    void this.requestPersistence();
  }

  /** On the first save, ask the browser for persistent storage (long-term design 9.9). */
  private async requestPersistence(): Promise<void> {
    if (this.persistent !== null || !this.options.storage.available) return;
    this.persistent = await requestPersistentStorage();
    this.render();
  }

  private async quickSave(): Promise<void> {
    if (!this.session || !simulationRunning(this.state) || this.dying) return;
    await this.save('manual');
  }

  private showIndicator(phase: 'saving' | 'saved' | 'failed'): void {
    for (const t of this.indicatorTimers) clearTimeout(t);
    this.indicatorTimers = [];
    this.indicator = { phase, leaving: false };
    if (phase !== 'saving') {
      this.indicatorTimers.push(
        setTimeout(() => {
          this.indicator = { phase, leaving: true };
          this.render();
        }, INDICATOR_HOLD_MS),
        setTimeout(() => {
          this.indicator = null;
          this.render();
        }, INDICATOR_HOLD_MS + INDICATOR_FADE_MS),
      );
    }
    this.render();
  }

  /** The tab is hidden / closing – save while we still can (best effort). */
  private onHidden(hidden: boolean): void {
    if (!hidden || !this.game || !this.session) return;
    if (this.dying) {
      // closing the tab does not dodge the penalty: the wreck is saved and the player makes the choice
      // (evacuation) on the next start – a hidden tab does not pick it for them
      this.persistDestroyed();
      return;
    }
    void this.save('interval');
  }

  // ───────────── death ─────────────

  private beginDeath(delayMs: number): void {
    const game = this.game;
    if (!game || this.dying) return;
    this.dying = true;
    if (this.state.kind === 'game' && this.state.overlay !== null) this.dispatch({ type: 'resume' });
    const show = () => {
      this.deathTimer = null;
      if (this.game !== game) return;
      const view = deathView(game.simulation);
      const name = (id: string) => stationLabel(game.simulation, id);
      const player = game.simulation.state.player;
      const lostCargo: DeathInfo['lostCargo'] = {};
      if (view.loses.cargo) for (const r of RESOURCE_IDS) if (player.cargo[r] >= 0.05) lostCargo[r] = player.cargo[r];
      this.death = {
        view,
        blackBox: game.blackBox(),
        lostCargo,
        lostSalvage: view.loses.salvageParts > 0 ? { ...player.salvage } : {},
        respawnName: name(view.respawnStationId),
        evacuationName: view.evacuationStationId ? name(view.evacuationStationId) : null,
        template: game.deathTemplate(view.respawnStationId, view.evacuationStationId).view,
      };
      this.dispatch({ type: 'died' });
    };
    if (delayMs > 0) this.deathTimer = setTimeout(show, delayMs);
    else show();
  }

  /** The death card's "Rebuild from a template" (M4a): respawn at a shipyard, then the Templates modal there. */
  private respawnFromTemplate(): void {
    const game = this.game;
    if (!game || !this.death) return;
    const target = game.deathTemplate(this.death.view.respawnStationId, this.death.view.evacuationStationId);
    if (!target.view || target.view.reason) return;
    // the penalty and the respawn run synchronously at the start of finishDeath (only the save waits)
    void this.finishDeath(target.evacuate);
    game.openTemplatesAfterRespawn();
  }

  /** Applies the penalty (applyDeath), saves (on hardcore, a move to Hard) and continues at the station. */
  private async finishDeath(evacuate: boolean): Promise<void> {
    const game = this.game;
    if (!game || !this.dying) return;
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.deathTimer = null;
    const sim = game.simulation;
    const outcome = applyDeath(sim, { evacuate });
    game.applyEvents(outcome.events);
    this.dying = false;
    this.death = null;
    if (this.state.kind === 'game' && this.state.overlay === 'death') this.dispatch({ type: 'respawned' });
    if (outcome.fellFromHardcore) game.notify(tx().death.fellFromHardcore, 'info', 5);
    const saver = this.saver;
    if (!saver) return;
    this.scheduler?.markSaved(sim.state.tick);
    this.showIndicator('saving');
    // on a hardcore fall GameSaver moves the game to Hard; further saves wait for the move
    const saved = await this.runSave(saver, sim, 'death');
    if (saved) this.afterSave(saved);
  }

  // ───────────── slots ─────────────

  private async refreshSlots(): Promise<void> {
    try {
      this.slots = await this.saves.overview();
    } catch (e) {
      console.error('Reading saves failed:', e);
      this.slots = [];
    }
    // "Continue" is the likely next game: its zone downloads behind the menu with the runtime
    const meta = !this.game ? continueTarget(this.slots) : null;
    if (meta) {
      const at = meta.location.kind === 'space' ? meta.location.pos : stationById(meta.seed, meta.location.stationId)?.pos;
      if (at) this.prefetchZone(meta.seed, at);
    }
    this.render();
  }

  private flash(text: string, tone: ToastTone = 'info', ms = 3000): void {
    if (this.state.kind === 'game' && this.state.overlay === null) {
      this.game?.notify(text, tone, ms / 1000);
      return;
    }
    this.toast = { text, tone };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.render();
    }, ms);
    this.render();
  }

  private async withBusy<T>(text: string, job: () => Promise<T>): Promise<T> {
    this.busy = text;
    this.render();
    try {
      return await job();
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async loadSlot(slot: SlotRef, which: 'current' | 'backup', fromContinue = false): Promise<void> {
    if (this.busy) return;
    await this.withBusy(tx().app.load.loading, async () => {
      const fail = (text: string) => {
        if (fromContinue) {
          this.menuError = `${tx().app.menu.continueFailed} ${text}`;
          this.render();
        } else {
          this.flash(text, 'error', 5000);
        }
      };
      // the game's code and models (they download behind the menu – usually done by now)
      if (!(await this.runtimeReady())) return;
      // another tab is playing the same game – loading would overwrite its saves (and it ours)
      const lock = await this.lockSlot(slot);
      if (!lock) {
        fail(tx().app.load.openElsewhere);
        return;
      }
      const before = this.game;
      try {
        await releaseOnThrow(lock, (l) => l === this.slotLock, async () => {
          // from the pause menu: save the game in progress first so the progress is not lost
          if (this.game && this.session) {
            await this.save('quit');
            await this.saves.flush();
          }
          const result = await this.saves.load(slot, which);
          if (!result.ok) {
            if (lock !== this.slotLock) lock.release();
            console.error('Load failed:', result.error, result.details.join('; '));
            fail(result.error === 'tooNew' ? tx().saves.loadErrors.tooNew(result.version ?? 0) : tx().saves.loadErrors[result.error]);
            void this.refreshSlots();
            return;
          }
          const ready = this.launch(result.sim, result.session, !result.sim.state.player.destroyed);
          this.adoptLock(lock);
          // backup and repairs on load (ship replaced, hull budget exceeded) – the player must know
          const notes = loadWarningTexts(result.warnings, (id) => stationLabel(result.sim, id));
          if (which === 'backup') notes.unshift(tx().app.load.loadedBackup);
          if (notes.length > 0) this.game?.notify(notes.join(' '), 'info', 4 + 2 * notes.length);
          // the loading overlay stays up over the shader warm-up
          await ready;
        });
      } catch (e) {
        this.startFailed('Load failed:', e, before, fail);
      }
    });
  }

  private async newGame(request: NewGameRequest): Promise<void> {
    if (this.busy) return;
    await this.withBusy(tx().app.menu.starting, async () => {
      if (!(await this.runtimeReady())) return;
      const lock = await this.lockSlot(request.slot);
      if (!lock) {
        this.flash(tx().app.load.openElsewhere, 'error', 5000);
        return;
      }
      const before = this.game;
      try {
        await releaseOnThrow(lock, (l) => l === this.slotLock, async () => {
          saveSkipTraining(localStore(), request.skipTraining);
          const result = await this.saves.newGame({ slot: request.slot, seedText: request.seedText, choice: request.choice, training: !request.skipTraining });
          if (!result.ok) {
            if (lock !== this.slotLock) lock.release();
            this.flash(tx().app.newGame.failed, 'error', 5000);
            return;
          }
          const ready = this.launch(result.sim, result.session);
          this.adoptLock(lock);
          this.afterSave(result.outcome);
          await ready;
        });
      } catch (e) {
        this.startFailed('New game failed:', e, before, (text) => this.flash(text, 'error', 5000));
      }
    });
  }

  /**
   * Loading or creating a game threw (a lock that was not adopted is already released): stop the half-started
   * game (`before` = the game running when the attempt began), leave a game screen that has no game behind it,
   * tell the player and log the error.
   */
  private startFailed(what: string, error: unknown, before: Game | null, fail: (text: string) => void): void {
    console.error(what, error);
    // a game that kept running (the throw came before launch() replaced it) stays as it is
    if (this.game !== before || (!before && this.saver)) {
      this.stopGame();
      this.adoptLock(null);
      if (this.state.kind === 'game') this.dispatch({ type: 'startFailed' });
    }
    fail(tx().app.load.startFailed);
    void this.refreshSlots();
  }

  private async quit(): Promise<void> {
    if (this.busy) return;
    await this.withBusy(tx().saves.saving, async () => {
      try {
        if (this.session) {
          await this.save('quit');
          await this.saves.flush();
        }
      } catch (e) {
        // the failure is already shown by the save; it must not keep the player in the game
        console.error('Saving on quit failed:', e);
      }
      this.stopGame();
      this.adoptLock(null);
      this.dispatch({ type: 'quitToMenu' });
    });
  }

  private async exportSlot(slot: SlotRef): Promise<void> {
    try {
      const file = await this.saves.exportSlot(slot);
      if (!file) return;
      downloadTextFile(file.fileName, file.text);
      this.flash(tx().app.load.exported(file.fileName), 'ok');
    } catch (e) {
      console.error('Export failed:', e);
      this.flash(tx().app.load.exportFailed, 'error');
    }
  }

  private async exportCurrent(): Promise<void> {
    if (!this.session) return;
    await this.save('manual');
    await this.saves.flush();
    if (this.session) await this.exportSlot(this.session.slot);
  }

  private async importFile(file: File): Promise<void> {
    const text = await readFileText(file).catch(() => null);
    const result = text === null ? ({ ok: false, error: 'json', details: [] } as const) : await this.saves.importFile(text);
    if (result.ok) {
      const name = tx().app.load.slotName(tx().saves.difficulties[result.meta.slot.difficulty], result.meta.slot.index);
      this.flash(result.usedBackup ? `${tx().app.load.imported(result.meta.name, name)}. ${tx().app.load.importedBackup}` : tx().app.load.imported(result.meta.name, name), 'ok', 4000);
    } else {
      const e = result.error;
      const text =
        e === 'json' || e === 'noFreeSlot' || e === 'slotLocked' || e === 'writeFailed'
          ? tx().saves.importErrors[e]
          : e === 'tooNew'
            ? tx().saves.loadErrors.tooNew(result.version ?? 0)
            : tx().saves.loadErrors[e];
      this.flash(text, 'error', 5000);
    }
    await this.refreshSlots();
  }

  private async deleteSlot(slot: SlotRef): Promise<void> {
    const lock = await this.lockSlot(slot);
    if (!lock) {
      this.flash(tx().app.load.openElsewhere, 'error', 5000);
      return;
    }
    try {
      await this.saves.delete(slot);
      this.flash(tx().app.load.deleted, 'ok');
    } catch (e) {
      console.error('Delete failed:', e);
      this.flash(tx().app.load.deleteFailed, 'error');
    } finally {
      if (lock !== this.slotLock) lock.release();
    }
    await this.refreshSlots();
  }

  // ───────────── slot locks (two tabs) ─────────────

  /** Slot lock for this tab (the running game's slot is already locked); null = another tab plays the slot. */
  private lockSlot(slot: SlotRef): Promise<SlotLock | null> {
    if (this.slotLock && sameSlot(this.slotLock.slot, slot)) return Promise.resolve(this.slotLock);
    return this.locks.lock(slot);
  }

  /** Lock of the running game (null = no saved game); the old one is released. */
  private adoptLock(lock: SlotLock | null): void {
    if (lock === this.slotLock) return;
    this.slotLock?.release();
    this.slotLock = lock;
  }

  /** The game moved to another slot (a hardcore fall) – lock the new slot, release the old one. */
  private async followSlot(): Promise<void> {
    const slot = this.session?.slot;
    if (!slot || !this.slotLock || sameSlot(this.slotLock.slot, slot)) return;
    const lock = await this.locks.lock(slot);
    if (lock && this.session && sameSlot(this.session.slot, slot)) this.adoptLock(lock);
    else lock?.release();
  }

  // ───────────── settings ─────────────

  private volumes() {
    return {
      master: this.settings.masterVolume,
      sfx: this.settings.sfxVolume,
      ambient: this.settings.ambientVolume,
      music: this.settings.musicVolume,
    };
  }

  private updateSettings(patch: Partial<UserSettings>, applyAudio = true): void {
    this.settings = sanitizeUserSettings({ ...this.settings, ...patch });
    saveUserSettings(localStore(), this.settings);
    // live switch: the menu re-renders once the language's texts are in (at once when they are loaded
    // already), the game UI on its next 10 Hz frame
    void setLocale(this.settings.language).then(() => {
      if (!this.lifetime.signal.aborted) this.render();
    });
    if (applyAudio) this.audio.configure(this.volumes(), this.settings.muted);
    this.game?.setZoomSensitivity(this.settings.zoomSensitivity);
    this.game?.setGraphicsQuality(this.settings.graphicsQuality);
    this.game?.setBackgroundBrightness(this.settings.backgroundBrightness);
    this.game?.setRadio(this.settings.radio);
    applyRenderSettings(this.settings);
    this.applyMotion();
    this.applyUiScale();
    this.render();
  }

  private applyUiScale(): void {
    document.documentElement.style.setProperty('--af-ui-scale', String(this.settings.uiScale));
    // media and container queries see the window's pixels, not the scaled rem: CSS that needs to know the UI is large asks this
    document.documentElement.toggleAttribute('data-ui-large', this.settings.uiScale >= 1.25);
  }

  private applyMotion(): void {
    const reduce = prefersReducedMotion(this.settings, this.systemReducedMotion?.matches ?? false);
    document.documentElement.toggleAttribute('data-reduced-motion', reduce);
    this.game?.setFlightSettings(this.flightSettings());
  }

  /** Flight assist switches for the game (M3.8): marker, camera shake, reduced motion; M4d notes in flight. */
  private flightSettings(): { marker: boolean; shake: boolean; reducedMotion: boolean; combatZoom: boolean; notesInFlight: boolean } {
    return {
      marker: this.settings.flightMarker,
      shake: this.settings.cameraShake,
      combatZoom: this.settings.combatZoom,
      notesInFlight: this.settings.notesInFlight,
      reducedMotion: prefersReducedMotion(this.settings, this.systemReducedMotion?.matches ?? false),
    };
  }

  // ───────────── overlay ─────────────

  private readonly handlers: OverlayHandlers = {
    open: (page) => {
      if (page === 'newGame') this.newGameSlot = null;
      this.dispatch({ type: 'open', page });
    },
    back: () => {
      this.dispatch({ type: 'back' });
    },
    continueGame: () => {
      const meta = continueTarget(this.slots ?? []);
      if (meta) void this.loadSlot(meta.slot, 'current', true);
    },
    newGame: (request) => void this.newGame(request),
    newGameInto: (slot) => {
      this.dispatch({ type: 'back' });
      // the slot must be set before the New game screen renders (it reads it on creation)
      this.newGameSlot = slot;
      this.dispatch({ type: 'open', page: 'newGame' });
    },
    loadSlot: (slot, which) => void this.loadSlot(slot, which),
    deleteSlot: (slot) => void this.deleteSlot(slot),
    exportSlot: (slot) => void this.exportSlot(slot),
    importFile: (file) => void this.importFile(file),
    resume: () => {
      this.dispatch({ type: 'resume' });
    },
    saveNow: () => void this.save('manual'),
    exportCurrent: () => void this.exportCurrent(),
    quit: () => void this.quit(),
    scuttle: () => {
      // continue and destroy the cockpit on the next step – death then runs as after being destroyed in combat
      if (!this.game || this.dying) return;
      this.dispatch({ type: 'resume' });
      this.game.requestScuttle();
    },
    openCareer: (panel) => {
      if (!this.game || this.dying) return;
      this.dispatch({ type: 'resume' });
      this.game.openCareerPanel(panel);
    },
    respawn: (evacuate) => void this.finishDeath(evacuate),
    respawnFromTemplate: () => this.respawnFromTemplate(),
    leaveCrash: () => this.leaveCrash(),
    copyCrashReport: () => this.copyCrashReport(),
    setSettings: (patch) => this.updateSettings(patch),
    // a reset keeps the language: the player chose it and the rest of the screen depends on it
    resetSettings: () => this.updateSettings({ ...DEFAULT_USER_SETTINGS, language: this.settings.language }),
    dismissBanner: () => {
      this.bannerDismissed = true;
      this.render();
    },
    randomSeed: () => randomSeedText(),
    click: () => this.audio.click(),
    hover: () => this.audio.hover(),
  };

  private render(): void {
    const sim = this.game?.simulation;
    const data: OverlayData = {
      state: this.state,
      version: this.options.version,
      slots: this.slots,
      continueMeta: continueTarget(this.slots ?? []),
      storage: { available: this.options.storage.available, persistent: this.persistent, bannerDismissed: this.bannerDismissed },
      settings: this.settings,
      graphicsLevel: this.game?.graphicsLevel ?? null,
      busy: this.busy,
      menuError: this.state.kind === 'menu' && this.state.page === 'home' ? this.menuError : null,
      toast: this.toast,
      indicator: gameActive(this.state) || this.indicator?.phase === 'failed' ? this.indicator : null,
      pause:
        sim && this.state.kind === 'game'
          ? {
              saving: this.session !== null,
              sinceSave: this.lastSaveAt === null ? null : performance.now() - this.lastSaveAt,
              settings: sim.state.settings,
              slot: this.session?.slot ?? null,
              canScuttle: sim.state.player.dock.mode === 'flying' && !sim.state.player.destroyed && !this.dying,
            }
          : null,
      death: this.death,
      crash: this.crash,
      currentSlot: this.session?.slot ?? null,
      newGameSlot: this.newGameSlot,
      skipTraining: loadSkipTraining(localStore()),
    };
    renderAppOverlay(this.overlayEl, data, this.handlers);
  }
}


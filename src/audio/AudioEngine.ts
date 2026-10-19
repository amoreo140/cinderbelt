// Main interface of the audio module. The game calls setThrust/setMiningLaser every frame
// and the play* methods on events. Before the unlock (a gesture) every call is a safe no-op.

import type { ResourceId } from '../data/resources';
import { ambientParamsForRing, normalizeRing, type Ring } from './ambientParams';
import { COMBAT_MIN_INTERVAL, combatRecipe, type CombatSound } from './combatRecipes';
import { type AudioGraph, createGraphBuilder, type GraphBuilder } from './graph';
import { type LaserInput, normalizeThrust, type NormalizedThrust, type ThrustInput } from './loopParams';
import { clamp01, masterGain, mulberry32, type Rng, volumeToGain } from './math';
import { ImpactLimiter, KeyedRateLimiter, RateLimiter } from './rateLimiter';
import {
  ALERT_COOLDOWN,
  type AlertKind,
  alertRecipe,
  BLIP_MIN_INTERVAL,
  COMMS_MIN_INTERVAL,
  commsRecipe,
  type CommsSoundKind,
  dampersRecipe,
  dockRecipe,
  impactRecipe,
  nextBlipStep,
  resourceBlipRecipe,
  SECTOR_TONE_MIN_INTERVAL,
  sectorEntryRecipe,
  type SectorTone,
  type SfxEvent,
  UI_MIN_INTERVAL,
  type UiSound,
  uiRecipe,
} from './recipes';
import { playRecipe } from './sfxPlayer';
import { EngineThrustVoice } from './voices/engineThrust';
import { MiningLaserVoice } from './voices/miningLaser';
import { SpaceAmbienceVoice } from './voices/spaceAmbience';
import type { MusicSituation } from './music/musicDirector';
import type { MusicPlayerOptions } from './music/MusicPlayer';
import { MusicSystem } from './music/MusicSystem';

export interface AudioVolumes {
  /** 0..1 – overall volume. */
  master: number;
  /** 0..1 – effects (engine, laser, impacts, UI…). */
  sfx: number;
  /** 0..1 – non-tonal space ambience under the music. */
  ambient: number;
  /** 0..1 – music. */
  music: number;
}

export type AudioEngineState = 'locked' | 'running' | 'suspended' | 'closed' | 'unsupported';

/** Minimal document interface for watching the tab visibility. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Minimal target interface for the unlock gestures (window, document, element). */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions | boolean): void;
}

export interface AudioEngineOptions {
  /** AudioContext factory (tests inject a fake one). */
  createContext?: () => AudioContext;
  /** Tab visibility source; null turns automatic suspending off. */
  visibility?: VisibilitySource | null;
  /** Time in seconds for the sound rate limiting. */
  now?: () => number;
  /** Random generator (deterministic from the seed by default). */
  random?: Rng;
  seed?: number;
  volumes?: Partial<AudioVolumes>;
  muted?: boolean;
  /** Music: where the manifest lives and how files load (tests inject fakes); false = no music. */
  music?: Partial<MusicPlayerOptions> | false;
  /** How often the music director decides (ms). */
  musicTickMs?: number;
  /** Runs a task when the page is idle (prepare() builds the graph this way); tests inject a queue. */
  idle?: (task: IdleTask) => void;
}

export interface ImpactOptions {
  /** Stereo position -1..1 (e.g. by the side of the impact). */
  pan?: number;
}

export const DEFAULT_VOLUMES: AudioVolumes = { master: 0.9, sfx: 0.9, ambient: 0.5, music: 0.6 };
/** Where the music manifest is served from (public/assets/music/). */
export const MUSIC_MANIFEST_URL = `${import.meta.env.BASE_URL}assets/music/manifest.json`;

/** How much the music dips under combat sounds (dB at full gain); others do not duck. */
const MUSIC_DUCK: Partial<Record<CombatSound, number>> = {
  explosionLarge: 5,
  breakup: 3,
  partLost: 4,
  alert: 4,
};
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const;
const VOLUME_SMOOTHING = 0.03;

function createAudioContext(): AudioContext {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is not available');
  return new Ctor({ latencyHint: 'interactive' });
}

/** A context created ahead of time by prewarmAudioContext(), handed to the first engine that asks. */
let prewarmed: AudioContext | null = null;

/**
 * Creates the AudioContext early – `new AudioContext()` blocks the main thread for ~80 ms, so the
 * app calls this on the loading screen. The context stays suspended until the first user gesture
 * resumes it; the first AudioEngine with the default factory takes it over.
 */
export function prewarmAudioContext(): void {
  if (prewarmed) return;
  try {
    prewarmed = createAudioContext();
  } catch {
    prewarmed = null;
  }
}

function defaultContextFactory(): AudioContext {
  const ctx = prewarmed;
  prewarmed = null;
  return ctx && ctx.state !== 'closed' ? ctx : createAudioContext();
}

/** An idle task; `deadline` (when given) says how much idle time is left in this slot. */
export type IdleTask = (deadline?: { timeRemaining(): number }) => void;

function defaultIdle(task: IdleTask): void {
  const g = globalThis as { requestIdleCallback?: (cb: IdleTask, options?: { timeout: number }) => number };
  // the timeout keeps the preparation going on a busy main thread (a slow laptop in combat)
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(task, { timeout: 150 });
  else setTimeout(task, 16);
}

function defaultVisibility(): VisibilitySource | null {
  return typeof document !== 'undefined' ? document : null;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  /** The graph being built by prepare() (not active until the unlock). */
  private builder: GraphBuilder | null = null;
  private preparing = false;
  private unsupported = false;
  private disposed = false;
  private suspendedByVisibility = false;

  private volumes: AudioVolumes;
  private muted: boolean;

  private engineVoice: EngineThrustVoice | null = null;
  private laserVoice: MiningLaserVoice | null = null;
  private ambienceVoice: SpaceAmbienceVoice | null = null;
  private music: MusicSystem | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSituation: Partial<MusicSituation> = {};
  private thrust: NormalizedThrust = { main: 0, reverse: 0, side: 0 };
  private laser: LaserInput = { active: false, hitting: false, resource: null };
  private ambientWanted = false;
  private ambientRing: Ring = 1;

  private readonly blipLimiter = new RateLimiter(BLIP_MIN_INTERVAL);
  private blipStep = 0;
  private lastBlipAt = Number.NEGATIVE_INFINITY;
  private readonly impactLimiter = new ImpactLimiter(0.08);
  private readonly alertLimiter = new KeyedRateLimiter<AlertKind>((k) => ALERT_COOLDOWN[k]);
  private readonly uiLimiter = new KeyedRateLimiter<UiSound>((k) => UI_MIN_INTERVAL[k]);
  private readonly combatLimiter = new KeyedRateLimiter<CombatSound>((k) => COMBAT_MIN_INTERVAL[k]);

  private readonly createContext: () => AudioContext;
  private readonly visibility: VisibilitySource | null;
  private readonly now: () => number;
  private readonly rand: Rng;
  private readonly musicOptions: Partial<MusicPlayerOptions> | false;
  private readonly musicTickMs: number;
  private readonly idle: (task: IdleTask) => void;
  private readonly unlockDetachers = new Set<() => void>();

  constructor(options: AudioEngineOptions = {}) {
    this.createContext = options.createContext ?? defaultContextFactory;
    this.visibility = options.visibility === undefined ? defaultVisibility() : options.visibility;
    this.now = options.now ?? defaultNow;
    this.rand = options.random ?? mulberry32(options.seed ?? 0x5eed);
    this.musicOptions = options.music ?? {};
    this.musicTickMs = options.musicTickMs ?? 250;
    this.idle = options.idle ?? defaultIdle;
    this.volumes = { ...DEFAULT_VOLUMES, ...options.volumes };
    this.muted = options.muted ?? false;
    this.visibility?.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ---------------- lifecycle ----------------

  get state(): AudioEngineState {
    if (this.unsupported) return 'unsupported';
    if (this.disposed) return 'closed';
    if (!this.ctx) return 'locked';
    const s = this.ctx.state as string;
    return s === 'running' ? 'running' : s === 'closed' ? 'closed' : 'suspended';
  }

  /** The AudioContext once unlocked (e.g. for a visualisation). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Unlocks the sound – must be called from a user gesture handler (click, key).
   * The first call activates the graph: the one built by prepare(), otherwise it creates the
   * AudioContext and the whole graph right here.
   */
  unlock(): Promise<boolean> {
    if (this.disposed || this.unsupported) return Promise.resolve(false);
    if (!this.ensureGraph()) return Promise.resolve(false);
    const ctx = this.ctx!;
    if (ctx.state === 'suspended' && !this.visibility?.hidden) {
      // resume() is called synchronously inside the gesture
      return ctx.resume().then(
        () => this.state === 'running',
        () => false,
      );
    }
    return Promise.resolve(this.state === 'running');
  }

  /**
   * Registers the unlock on the first gesture (pointerdown/keydown/touchend).
   * The listeners stay active so the sound resumes after a system interruption
   * (e.g. iOS); the returned function removes them.
   */
  attachUnlock(target: GestureTarget | null = typeof window !== 'undefined' ? window : null): () => void {
    if (!target) return () => {};
    const handler = () => {
      if (this.state === 'running') return;
      void this.unlock();
    };
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, handler, { capture: true, passive: true });
    const detach = () => {
      for (const type of UNLOCK_EVENTS) target.removeEventListener(type, handler, { capture: true });
      this.unlockDetachers.delete(detach);
    };
    this.unlockDetachers.add(detach);
    return detach;
  }

  /**
   * Builds the AudioContext (suspended until a gesture) and the graph ahead of time in bounded steps
   * (as many as fit an idle slot, at least one), so the first gesture only resumes the context. Without it the first
   * gesture pays 100–400 ms for the context, the noise buffers and the reverb (audit 2026-10-16, #7).
   * The engine stays 'locked' until unlock(); an unlock during preparation finishes the rest at once.
   */
  prepare(): void {
    if (this.preparing || this.graph || this.disposed || this.unsupported) return;
    this.preparing = true;
    const run: IdleTask = (deadline) => {
      if (this.disposed || this.graph) return;
      if (!this.builder) {
        try {
          this.builder = createGraphBuilder(this.createContext(), this.rand);
        } catch {
          // no Web Audio here (yet) – unlock() tries again and reports 'unsupported'
          this.preparing = false;
          return;
        }
      } else {
        do {
          if (this.builder.step()) return;
        } while ((deadline?.timeRemaining() ?? 0) > 8);
      }
      this.idle(run);
    };
    this.idle(run);
  }

  /** Releases all resources. The instance cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const detach of [...this.unlockDetachers]) detach();
    this.visibility?.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.music?.dispose();
    this.music = null;
    this.engineVoice?.dispose();
    this.laserVoice?.dispose();
    this.ambienceVoice?.dispose();
    this.engineVoice = null;
    this.laserVoice = null;
    this.ambienceVoice = null;
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => {});
    const pending = this.builder?.ctx as AudioContext | undefined;
    if (pending && pending !== this.ctx && pending.state !== 'closed') void pending.close().catch(() => {});
    this.builder = null;
    this.graph = null;
  }

  private ensureGraph(): boolean {
    if (this.graph) return true;
    try {
      // the graph prepared in idle time (finish() runs whatever is still left), or all of it now
      const builder = this.builder ?? createGraphBuilder(this.createContext(), this.rand);
      this.builder = null;
      this.ctx = builder.ctx as AudioContext;
      this.graph = builder.finish();
    } catch {
      this.unsupported = true;
      this.ctx = null;
      this.graph = null;
      return false;
    }
    this.applyVolumes(true);
    // restore the states set before the unlock
    if (this.thrust.main > 0 || this.thrust.reverse > 0 || this.thrust.side !== 0) this.setThrust(this.thrust);
    if (this.laser.active) this.setMiningLaser(this.laser);
    if (this.ambientWanted) this.startAmbient(this.ambientRing);
    this.startMusic();
    return true;
  }

  private readonly onVisibilityChange = (): void => {
    const ctx = this.ctx;
    if (!ctx || this.disposed || !this.visibility) return;
    if (this.visibility.hidden) {
      if (ctx.state === 'running') {
        this.suspendedByVisibility = true;
        void ctx.suspend().catch(() => {});
      }
    } else if (this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      void ctx.resume().catch(() => {});
    }
  };

  // ---------------- volume ----------------

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setVolumes(volumes: Partial<AudioVolumes>): void {
    const next = { ...this.volumes };
    if (volumes.master !== undefined) next.master = clamp01(volumes.master);
    if (volumes.sfx !== undefined) next.sfx = clamp01(volumes.sfx);
    if (volumes.ambient !== undefined) next.ambient = clamp01(volumes.ambient);
    if (volumes.music !== undefined) next.music = clamp01(volumes.music);
    this.volumes = next;
    this.applyVolumes(false);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes(false);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyVolumes(immediate: boolean): void {
    const g = this.graph;
    if (!g) return;
    const t = g.ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) {
        param.cancelScheduledValues(t);
        param.setValueAtTime(value, t);
      } else {
        param.setTargetAtTime(value, t, VOLUME_SMOOTHING);
      }
    };
    set(g.master.gain, masterGain(this.volumes.master, this.muted));
    const sfx = volumeToGain(this.volumes.sfx);
    const amb = volumeToGain(this.volumes.ambient);
    set(g.sfx.dry.gain, sfx);
    set(g.sfx.wet.gain, sfx);
    set(g.ambient.dry.gain, amb);
    set(g.ambient.wet.gain, amb);
    set(g.music.gain, volumeToGain(this.volumes.music));
    // inaudible music releases its decoded PCM (and decodes nothing) until the volume comes back
    this.music?.setAudible(this.musicAudible());
  }

  private musicAudible(): boolean {
    return !this.muted && this.volumes.master > 0 && this.volumes.music > 0;
  }

  // ---------------- continuous sounds (every frame) ----------------

  /**
   * Engine thrust. A number = the main engine 0..1; an object = thruster groups
   * (main/reverse 0..1, side -1..1 with the side in stereo).
   */
  setThrust(input: ThrustInput | number): void {
    this.thrust = normalizeThrust(input);
    const g = this.graph;
    if (!g) return;
    const t = this.thrust;
    if (!this.engineVoice) {
      if (t.main === 0 && t.reverse === 0 && t.side === 0) return;
      this.engineVoice = new EngineThrustVoice(g);
    }
    this.engineVoice.set(t, g.ctx.currentTime);
  }

  /** Mining laser: an active beam, a rock hit and the resource (changes the tuning). */
  setMiningLaser(input: LaserInput): void {
    this.laser = { active: input.active, hitting: input.hitting ?? false, resource: input.resource ?? this.laser.resource ?? null };
    const g = this.graph;
    if (!g) return;
    if (!this.laserVoice) {
      if (!this.laser.active) return;
      this.laserVoice = new MiningLaserVoice(g);
    }
    this.laserVoice.set(this.laser, g.ctx.currentTime);
  }

  // ---------------- one-shot sounds ----------------

  /** An impact of intensity 0..1. Returns true if the sound played. */
  playImpact(intensity: number, options: ImpactOptions = {}): boolean {
    const i = clamp01(intensity);
    if (!this.graph || i <= 0.01) return false;
    if (!this.impactLimiter.tryAcquire(i, this.now())) return false;
    const played = this.play(impactRecipe(i), { pan: options.pan === undefined ? undefined : options.pan * 0.6 });
    if (played && i >= 0.5) this.duckMusic(3 + 3 * i);
    return played;
  }

  /** A soft "blip" on collecting a resource; quick series climb the scale, spam is limited. */
  playResourceCollected(resource: ResourceId): boolean {
    const now = this.now();
    if (!this.graph || !this.blipLimiter.tryAcquire(now)) return false;
    this.blipStep = nextBlipStep(this.blipStep, now - this.lastBlipAt);
    this.lastBlipAt = now;
    return this.play(resourceBlipRecipe(resource, this.blipStep));
  }

  /** An alert (cargo full, out of fuel). Has its own cooldown – may be called every frame. */
  playAlert(kind: AlertKind): boolean {
    if (!this.graph || !this.alertLimiter.tryAcquire(kind, this.now())) return false;
    const played = this.play(alertRecipe(kind));
    if (played) this.duckMusic(5, 0.4);
    return played;
  }

  playDampers(on: boolean): boolean {
    return this.play(dampersRecipe(on));
  }

  playUi(kind: UiSound): boolean {
    if (!this.graph || !this.uiLimiter.tryAcquire(kind, this.now())) return false;
    return this.play(uiRecipe(kind));
  }

  /** A radio message opens (communicator); `duck` dips the music a little for danger and story. */
  playComms(kind: CommsSoundKind, duck = false): boolean {
    const now = this.now();
    if (!this.graph || now - this.lastCommsAt < COMMS_MIN_INTERVAL) return false;
    this.lastCommsAt = now;
    const played = this.play(commsRecipe(kind));
    if (played && duck) this.duckMusic(3, 1.6);
    return played;
  }
  private lastCommsAt = -Infinity;

  /** Entering a sector (sectors §5.2): its own short chime per security; `notice` = a first visit. */
  playSectorEntry(security: SectorTone, notice: boolean): boolean {
    const now = this.now();
    if (!this.graph || now - this.lastSectorToneAt < SECTOR_TONE_MIN_INTERVAL) return false;
    this.lastSectorToneAt = now;
    return this.play(sectorEntryRecipe(security, notice));
  }
  private lastSectorToneAt = -Infinity;

  playDock(): boolean {
    const played = this.play(dockRecipe(true));
    if (played) this.duckMusic(3, 0.4);
    return played;
  }

  playUndock(): boolean {
    const played = this.play(dockRecipe(false));
    if (played) this.duckMusic(3, 0.4);
    return played;
  }

  /**
   * Combat sound (M3a). `gain` 0..1 dims distant sources, `pan` −1..1 places them in the stereo
   * image; identical sounds keep a minimum spacing (gunfire does not blur into noise).
   */
  playCombat(
    kind: CombatSound,
    options: { pan?: number; gain?: number; intensity?: number; resource?: ResourceId | null } = {},
  ): boolean {
    const g = this.graph;
    const gain = clamp01(options.gain ?? 1);
    if (!g || g.ctx.state !== 'running' || gain <= 0.01) return false;
    if (!this.combatLimiter.tryAcquire(kind, this.now())) return false;
    const played = playRecipe(g, g.sfx, combatRecipe(kind, options), { pan: options.pan, gain });
    const duck = MUSIC_DUCK[kind];
    if (played && duck) this.duckMusic(duck * Math.max(0.5, gain));
    return played;
  }

  private play(events: SfxEvent[], options: { pan?: number } = {}): boolean {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return false;
    return playRecipe(g, g.sfx, events, options);
  }

  // ---------------- ambient ----------------

  /** Starts the ambience (before the unlock it is remembered and started after the gesture). */
  startAmbient(ring?: number): void {
    this.ambientWanted = true;
    if (ring !== undefined) this.ambientRing = normalizeRing(ring);
    const g = this.graph;
    if (!g) return;
    const params = ambientParamsForRing(this.ambientRing);
    if (!this.ambienceVoice) this.ambienceVoice = new SpaceAmbienceVoice(g, params);
    else this.ambienceVoice.setParams(params, g.ctx.currentTime);
    this.ambienceVoice.start(g.ctx.currentTime);
  }

  stopAmbient(): void {
    this.ambientWanted = false;
    this.ambienceVoice?.stop();
  }

  /** Mood by ring 1..4 – the transition is slow and smooth. Safe to call every frame. */
  setAmbientRing(ring: number): void {
    const r = normalizeRing(ring);
    if (r === this.ambientRing) return;
    this.ambientRing = r;
    if (this.ambienceVoice && this.graph) this.ambienceVoice.setParams(ambientParamsForRing(r), this.graph.ctx.currentTime);
  }

  get ambientState(): { running: boolean; ring: Ring } {
    return { running: this.ambientWanted, ring: this.ambientRing };
  }

  // ---------------- music ----------------

  /**
   * What the game is doing (screen, docked, ring, threat, near an Echo…); the director picks the mood
   * and the track from it. Safe to call every frame and before unlock.
   */
  setMusicSituation(situation: Partial<MusicSituation>): void {
    if (this.music) this.music.setSituation(situation);
    else this.pendingSituation = { ...this.pendingSituation, ...situation };
  }

  /** Dips the music for a moment under an important sound (dB). */
  duckMusic(db: number, hold?: number): void {
    this.music?.duck(db, hold);
  }

  /** The music system once audio is unlocked (demo page, tests); null before or without music. */
  get musicSystem(): MusicSystem | null {
    return this.music;
  }

  private startMusic(): void {
    const g = this.graph;
    if (!g || this.music || this.musicOptions === false) return;
    this.music = new MusicSystem(g.ctx, g.music, {
      manifestUrl: MUSIC_MANIFEST_URL,
      audible: this.musicAudible(),
      idle: this.idle,
      ...this.musicOptions,
      random: this.rand,
    });
    this.music.setSituation(this.pendingSituation);
    this.pendingSituation = {};
    void this.music.start();
    this.musicTimer = setInterval(() => {
      if (this.graph?.ctx.state === 'running') this.music?.tick();
    }, this.musicTickMs);
  }

  // ---------------- tools ----------------

  /** Creates an AnalyserNode connected to the master output (e.g. for the demo visualisation). */
  createAnalyser(fftSize = 2048): AnalyserNode | null {
    const g = this.graph;
    if (!g) return null;
    const analyser = g.ctx.createAnalyser();
    analyser.fftSize = fftSize;
    g.master.connect(analyser);
    return analyser;
  }
}

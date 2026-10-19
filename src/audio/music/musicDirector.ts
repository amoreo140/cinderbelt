// Adaptive music director: picks the mood from the game situation (with hysteresis so the music does
// not flip at every ring border or stray shot) and the track within the mood (never the same one twice
// in a row). Pure logic – it only emits commands; MusicPlayer turns them into Web Audio.
//
// Moods: menu (main menu theme, loops) · calm (home belt, mining, docked) · adventure (outer rings, long
// travel) · combat (pirates; loops, intensity layers follow the threat) · mystery (near Kovaci Echoes).
// Calm, adventure and mystery tracks play once through and fade out, then a quiet gap of 20–60 s
// (only the space ambience) before the next track – the music stays special instead of wallpaper.

import { LOOPING_MOODS, type MusicMood } from './manifest';

export type MusicScreen = 'menu' | 'game' | 'paused' | 'overlay';

export interface MusicSituation {
  /** menu = main menu; paused = pause / settings / load over the game; overlay = death card. */
  screen: MusicScreen;
  docked: boolean;
  /** Depth 1..4 of the player's sector (sectors design §5.2; the ring before stage 1a). */
  ring: number;
  /**
   * In the frontier: an unguarded sector of depth ≥ 2 (§5.2) – the adventure music. Unset: ring ≥ 2.
   */
  frontier?: boolean;
  /** Units from the home station. */
  distanceFromHome: number;
  /** Units per second. */
  speed: number;
  /** 0 = no threat, 1 = heavy fight. */
  combatThreat: number;
  /** Near a Kovaci Echo / ruin. */
  nearMystery: boolean;
}

export const MENU_SITUATION: MusicSituation = {
  screen: 'menu',
  docked: false,
  ring: 1,
  distanceFromHome: 0,
  speed: 0,
  combatThreat: 0,
  nearMystery: false,
};

export interface DirectorTrack {
  id: string;
  mood: MusicMood;
  /** Seconds of one pass. */
  duration: number;
}

export type MusicCommand =
  /** Start the track from the top; every other playing track fades out over the same time. */
  | { type: 'play'; trackId: string; fade: number }
  /** Fade out everything that plays. */
  | { type: 'stop'; fade: number }
  /** Combat intensity 0..1 (drives the stem layers). */
  | { type: 'intensity'; value: number }
  /** Overall music level and lowpass (docked = softer and muffled, pause = dipped). */
  | { type: 'level'; gain: number; lowpassHz: number; seconds: number };

export const MUSIC_TIMING = {
  /** Threat above this starts combat music at once. */
  combatEnterThreat: 0.05,
  /** Seconds without threat before combat music ends. */
  combatHold: 9,
  /** Seconds near an Echo before the mystery mood starts, and seconds away before it ends. */
  mysteryEnter: 1.5,
  mysteryHold: 6,
  /** Seconds a calm/adventure change must hold before the music follows. */
  exploreHold: 6,
  /** Sustained fast travel (speed, seconds) away from home counts as an adventure in the home belt. */
  travelSpeed: 22,
  travelTime: 25,
  travelMinDistance: 600,
  /** Crossfades. */
  fade: 3,
  combatFadeIn: 1.6,
  combatFadeOut: 4,
  menuFade: 2.5,
  /** Fade over the end of a play-once track. */
  endFade: 6,
  /** Quiet gap between play-once tracks (s). */
  gapMin: 20,
  gapMax: 60,
  /** Intensity smoothing time constants (s): fast up, slow down. */
  intensityUp: 0.5,
  intensityDown: 5,
  /** Lowest intensity while the combat mood plays (the base layer always sounds). */
  combatFloor: 0.15,
} as const;

export interface MusicLevel {
  gain: number;
  lowpassHz: number;
}

/** Open (no filtering) lowpass frequency. */
export const OPEN_LOWPASS = 20000;

export const MUSIC_LEVELS = {
  open: { gain: 1, lowpassHz: OPEN_LOWPASS },
  /** Inside the station: about −5 dB and gently muffled. */
  docked: { gain: 0.56, lowpassHz: 2600 },
  /** Pause / settings: strongly dipped and muffled. */
  paused: { gain: 0.3, lowpassHz: 900 },
  /** Death card: silent. */
  overlay: { gain: 0, lowpassHz: OPEN_LOWPASS },
} as const satisfies Record<string, MusicLevel>;

/** Moods whose tracks loop for as long as the mood lasts. */
const LOOPING = LOOPING_MOODS;

/** Where to look for a track when a mood has none of its own. */
const FALLBACK: Record<MusicMood, readonly MusicMood[]> = {
  menu: ['menu', 'calm', 'adventure'],
  calm: ['calm', 'adventure'],
  adventure: ['adventure', 'calm'],
  mystery: ['mystery', 'calm'],
  combat: ['combat'],
};

export type DirectorPhase = 'idle' | 'playing' | 'gap';

interface Playing {
  trackId: string;
  /** End of the audible pass (fade-out starts here), null = loops. */
  endAt: number | null;
}

export class MusicDirector {
  private tracks: DirectorTrack[] = [];
  private moodNow: MusicMood | null = null;
  private playing: Playing | null = null;
  private gapUntil: number | null = null;
  private readonly lastByMood = new Map<MusicMood, string>();
  private lastTrackId: string | null = null;

  private lastNow: number | null = null;
  private lastThreatAt = Number.NEGATIVE_INFINITY;
  private nearSince: number | null = null;
  private farSince: number | null = null;
  private exploreMood: 'calm' | 'adventure' = 'calm';
  private exploreCandidate: 'calm' | 'adventure' = 'calm';
  private exploreSince = 0;
  private travelSince: number | null = null;

  private intensityNow = 0;
  private intensitySent = -1;
  private levelSent: MusicLevel | null = null;

  constructor(
    tracks: readonly DirectorTrack[] = [],
    private readonly random: () => number = Math.random,
  ) {
    this.setTracks(tracks);
  }

  /** The catalogue (e.g. once the manifest has loaded). The next update starts music if none plays. */
  setTracks(tracks: readonly DirectorTrack[]): void {
    this.tracks = tracks.filter((t) => t.duration > 0);
    if (this.playing && !this.tracks.some((t) => t.id === this.playing!.trackId)) this.playing = null;
  }

  /** Forgets what plays (e.g. after tracks were played by hand); the next update starts afresh. */
  reset(): void {
    this.moodNow = null;
    this.playing = null;
    this.gapUntil = null;
    this.levelSent = null;
    this.intensitySent = -1;
    this.lastNow = null;
  }

  get mood(): MusicMood | null {
    return this.moodNow;
  }

  get trackId(): string | null {
    return this.playing?.trackId ?? null;
  }

  get intensity(): number {
    return this.intensityNow;
  }

  get phase(): DirectorPhase {
    return this.playing ? 'playing' : this.gapUntil !== null ? 'gap' : 'idle';
  }

  /** Seconds until the next track starts (gap), or null. */
  gapRemaining(now: number): number | null {
    return this.gapUntil === null ? null : Math.max(0, this.gapUntil - now);
  }

  /** One step; `now` in seconds (audio clock). Returns the commands for the player, in order. */
  update(s: MusicSituation, now: number): MusicCommand[] {
    const out: MusicCommand[] = [];
    const dt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;

    this.updateLevel(s, out);

    // the mood only follows a live game (or the menu); pause and the death card freeze it
    if (s.screen === 'menu' || s.screen === 'game') {
      const mood = this.targetMood(s, now);
      if (mood !== this.moodNow) {
        const prev = this.moodNow;
        this.moodNow = mood;
        if (mood === 'combat') this.intensityNow = Math.max(MUSIC_TIMING.combatFloor, Math.min(1, s.combatThreat));
        this.updateIntensity(s, 0, out);
        this.start(mood, now, fadeBetween(prev, mood), out);
        return out;
      }
    }
    this.updateIntensity(s, dt, out);

    const mood = this.moodNow;
    if (!mood) return out;
    if (this.playing) {
      if (this.playing.endAt !== null && now >= this.playing.endAt) {
        out.push({ type: 'stop', fade: MUSIC_TIMING.endFade });
        this.playing = null;
        this.gapUntil = now + MUSIC_TIMING.endFade + lerp(MUSIC_TIMING.gapMin, MUSIC_TIMING.gapMax, this.random());
      }
    } else if (this.gapUntil === null || now >= this.gapUntil) {
      this.start(mood, now, MUSIC_TIMING.fade, out);
    }
    return out;
  }

  // ---------------- mood ----------------

  private targetMood(s: MusicSituation, now: number): MusicMood {
    if (s.screen === 'menu') {
      this.resetGameTimers();
      return 'menu';
    }
    const T = MUSIC_TIMING;
    if (s.combatThreat >= T.combatEnterThreat) this.lastThreatAt = now;
    if (s.nearMystery) {
      this.nearSince ??= now;
      this.farSince = null;
    } else {
      this.farSince ??= now;
      this.nearSince = null;
    }
    const explore = this.updateExplore(s, now);

    if (s.docked) return 'calm';
    const combat =
      this.moodNow === 'combat' ? now - this.lastThreatAt < T.combatHold : s.combatThreat >= T.combatEnterThreat;
    if (combat) return 'combat';
    const mystery =
      this.moodNow === 'mystery'
        ? s.nearMystery || (this.farSince !== null && now - this.farSince < T.mysteryHold)
        : this.nearSince !== null && now - this.nearSince >= T.mysteryEnter;
    if (mystery) return 'mystery';
    return explore;
  }

  private updateExplore(s: MusicSituation, now: number): 'calm' | 'adventure' {
    const T = MUSIC_TIMING;
    if (s.speed >= T.travelSpeed && s.distanceFromHome >= T.travelMinDistance && !s.docked) this.travelSince ??= now;
    else this.travelSince = null;
    const travelling = this.travelSince !== null && now - this.travelSince >= T.travelTime;
    const frontier = s.frontier ?? s.ring >= 2;
    const wanted: 'calm' | 'adventure' = !s.docked && (frontier || travelling) ? 'adventure' : 'calm';
    if (wanted !== this.exploreCandidate) {
      this.exploreCandidate = wanted;
      this.exploreSince = now;
    }
    // docking settles the music at once; anything else has to hold for a while
    if (s.docked || this.moodNow === null || this.moodNow === 'menu') this.exploreMood = wanted;
    else if (wanted !== this.exploreMood && now - this.exploreSince >= T.exploreHold) this.exploreMood = wanted;
    return this.exploreMood;
  }

  private resetGameTimers(): void {
    this.lastThreatAt = Number.NEGATIVE_INFINITY;
    this.nearSince = null;
    this.farSince = null;
    this.travelSince = null;
    this.exploreMood = 'calm';
    this.exploreCandidate = 'calm';
  }

  // ---------------- tracks ----------------

  private start(mood: MusicMood, now: number, fade: number, out: MusicCommand[]): void {
    this.gapUntil = null;
    const track = this.pick(mood);
    if (!track) {
      // nothing to play for this mood: let the current music fade instead of a wrong-mood loop
      if (this.playing) out.push({ type: 'stop', fade });
      this.playing = null;
      return;
    }
    this.lastByMood.set(mood, track.id);
    this.lastTrackId = track.id;
    this.playing = {
      trackId: track.id,
      endAt: LOOPING.has(mood) ? null : now + Math.max(1, track.duration - MUSIC_TIMING.endFade),
    };
    out.push({ type: 'play', trackId: track.id, fade });
  }

  /** A track for the mood: not the one this mood played last, nor the one just heard, if there is a choice. */
  private pick(mood: MusicMood): DirectorTrack | null {
    for (const m of FALLBACK[mood]) {
      const pool = this.tracks.filter((t) => t.mood === m);
      if (pool.length === 0) continue;
      const avoid = new Set([this.lastByMood.get(mood), this.lastTrackId, this.playing?.trackId]);
      const fresh = pool.filter((t) => !avoid.has(t.id));
      const choice = fresh.length > 0 ? fresh : pool.filter((t) => t.id !== this.lastByMood.get(mood));
      const from = choice.length > 0 ? choice : pool;
      return from[Math.min(from.length - 1, Math.floor(this.random() * from.length))]!;
    }
    return null;
  }

  // ---------------- intensity and level ----------------

  private updateIntensity(s: MusicSituation, dt: number, out: MusicCommand[]): void {
    const T = MUSIC_TIMING;
    if (this.moodNow === 'combat' && s.screen !== 'menu') {
      const target = Math.max(T.combatFloor, Math.min(1, s.combatThreat));
      const tau = target > this.intensityNow ? T.intensityUp : T.intensityDown;
      this.intensityNow += (target - this.intensityNow) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
    } else if (this.moodNow !== 'combat') {
      this.intensityNow = 0;
    }
    if (Math.abs(this.intensityNow - this.intensitySent) >= 0.02) {
      this.intensitySent = this.intensityNow;
      out.push({ type: 'intensity', value: this.intensityNow });
    }
  }

  private updateLevel(s: MusicSituation, out: MusicCommand[]): void {
    const level =
      s.screen === 'paused'
        ? MUSIC_LEVELS.paused
        : s.screen === 'overlay'
          ? MUSIC_LEVELS.overlay
          : s.screen === 'game' && s.docked
            ? MUSIC_LEVELS.docked
            : MUSIC_LEVELS.open;
    const prev = this.levelSent;
    if (prev && prev.gain === level.gain && prev.lowpassHz === level.lowpassHz) return;
    this.levelSent = level;
    // pausing dips quickly, everything else eases
    const seconds = prev === null ? 0 : s.screen === 'paused' || s.screen === 'overlay' ? 0.6 : 2;
    out.push({ type: 'level', gain: level.gain, lowpassHz: level.lowpassHz, seconds });
  }
}

function fadeBetween(from: MusicMood | null, to: MusicMood): number {
  const T = MUSIC_TIMING;
  if (from === null) return T.menuFade;
  if (to === 'combat') return T.combatFadeIn;
  if (from === 'combat') return T.combatFadeOut;
  if (from === 'menu' || to === 'menu') return T.menuFade;
  return T.fade;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

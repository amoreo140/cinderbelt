// Music = director (what should play) + player (Web Audio). Ticks a few times per second on the audio
// clock, so the music keeps evolving in menus and pauses when the game loop does not run.

import type { Rng } from '../math';
import type { MusicManifest } from './manifest';
import { MENU_SITUATION, type MusicCommand, MusicDirector, type MusicSituation } from './musicDirector';
import { MusicPlayer, type MusicPlayerOptions } from './MusicPlayer';

export interface MusicSystemOptions extends MusicPlayerOptions {
  random: Rng;
}

export class MusicSystem {
  readonly director: MusicDirector;
  readonly player: MusicPlayer;
  private situation: MusicSituation = { ...MENU_SITUATION };
  private autoMode = true;
  private started = false;
  /** Last commands (demo page log). */
  readonly log: { at: number; cmd: MusicCommand }[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    output: AudioNode,
    options: MusicSystemOptions,
  ) {
    this.director = new MusicDirector([], options.random);
    this.player = new MusicPlayer(ctx, output, options);
  }

  /** Loads the manifest and hands the catalogue to the director. */
  start(): Promise<MusicManifest | null> {
    this.started = true;
    return this.player.loadManifest().then((m) => {
      if (m) this.director.setTracks(m.tracks);
      return m;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  get currentSituation(): MusicSituation {
    return this.situation;
  }

  setSituation(patch: Partial<MusicSituation>): void {
    this.situation = { ...this.situation, ...patch };
  }

  /** false = the director stops deciding (demo page plays tracks by hand). */
  get auto(): boolean {
    return this.autoMode;
  }

  setAuto(auto: boolean): void {
    if (auto && !this.autoMode) this.director.reset();
    this.autoMode = auto;
  }

  tick(): void {
    if (!this.autoMode) return;
    const now = this.ctx.currentTime;
    for (const cmd of this.director.update(this.situation, now)) {
      this.player.apply(cmd);
      if (cmd.type !== 'intensity') {
        this.log.push({ at: now, cmd });
        if (this.log.length > 40) this.log.shift();
      }
    }
  }

  /** Is the music heard at all (master and music volume above 0, not muted)? See MusicPlayer.setAudible. */
  setAudible(audible: boolean): void {
    this.player.setAudible(audible);
  }

  duck(db: number, hold?: number): void {
    this.player.duck(db, hold);
  }

  dispose(): void {
    this.player.dispose();
  }
}

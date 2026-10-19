// Web Audio side of the music: loads the manifest and the Ogg (Opus) files, plays tracks with all stems
// started together, crossfades between "decks", and applies intensity layers, level/lowpass and ducking.
//
// Memory: a decoded track is 48 kHz float PCM – 384 KB per second of stereo, ~55 MB for a 2.5 minute piece
// and ~100 MB for a three-stem combat cue. So:
// - tracks that loop (menu, combat) are decoded lazily when they start and released when they have faded
//   out; at most `cacheTracks` (2: the current one and a prefetched next one) stay decoded;
// - a layered track decodes only the layers the intensity is about to need (a quiet fight holds the base
//   alone); a late layer joins on the deck's clock, sample-aligned with the others;
// - tracks played once (calm, adventure, mystery) are streamed through an <audio> element into the graph
//   (MediaElementAudioSourceNode) and never decoded whole; where streaming fails they are decoded instead.
//   Loops stay decoded: an element neither loops gaplessly nor keeps several stems on one sample;
// - while the music is inaudible (master or music volume 0, muted) the player sleeps: the tracks go on as a
//   silent clock and nothing is decoded or streamed; raising the volume wakes the audible track in an idle
//   moment, at the position it has reached, with a short fade-in.
// The stems stay stereo: the generator (tools/music/build.py, MONO_SIDE_DB) encodes a stem mono only when
// its side signal is negligible, and none currently qualifies.
//
// Chain: deck (per-stem gains → deck gain) → lowpass → level → duck → output (the music channel).

import { type MusicManifest, type MusicStem, type MusicTrack, parseMusicManifest, resolveMusicUrl, stemGain } from './manifest';
import type { MusicCommand } from './musicDirector';
import { OPEN_LOWPASS } from './musicDirector';

/** The part of HTMLMediaElement the player uses (tests inject a stand-in). */
export interface MusicMediaElement {
  currentTime: number;
  loop: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

/** A streamed file: the element and its output node in the audio graph. */
export interface MusicStream {
  media: MusicMediaElement;
  node: AudioNode;
}

export interface MusicPlayerOptions {
  manifestUrl: string;
  /** Loads and decodes one file (tests inject a fake). Default: fetch + decodeAudioData. */
  load?: (url: string) => Promise<AudioBuffer>;
  /** Fetches and parses the manifest JSON (tests inject a fake). Default: fetch. */
  loadManifest?: (url: string) => Promise<unknown>;
  /** How many tracks stay decoded (the playing ones are never evicted). Default 2: current + next. */
  cacheTracks?: number;
  /**
   * Opens a file for streaming (tracks played once). Default: an <audio> element and a
   * MediaElementAudioSourceNode where the context supports them; null = always decode.
   */
  createStream?: ((url: string) => MusicStream) | null;
  /** false = start asleep (the music is inaudible): nothing loads until setAudible(true). Default true. */
  audible?: boolean;
  /** Runs a task in an idle moment (the wake-up after the volume is raised). Default: requestIdleCallback. */
  idle?: (task: () => void) => void;
}

interface DeckStem {
  minIntensity: number;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  /** Its file is being decoded to join the started deck. */
  loading: boolean;
}

interface Deck {
  track: MusicTrack;
  gain: GainNode;
  stems: DeckStem[];
  /** Streamed instead of decoded (one stem). */
  stream: MusicStream | null;
  /** Audio time of the track's position 0 (null while loading); unused for streams (the element knows). */
  startedAt: number | null;
  /** While silent (asleep, or loading after the wake-up): the audio time of position 0 the track keeps to. */
  origin: number | null;
  /** Loop points of the deck's clock (the buffers' own once started). */
  loopStart: number;
  loopEnd: number;
  /** Bumped when the deck falls asleep or wakes up: callbacks of an earlier run are void. */
  run: number;
  /** Fading out / cancelled – never started again. */
  stopping: boolean;
  /** Disconnected and its stream released. */
  released: boolean;
  /** Fade-in still to apply once loaded. */
  fade: number;
  /** A/B switch: the deck it takes over from, at that deck's position, once it is ready. */
  follow: Deck | null;
}

interface StemSlot {
  promise: Promise<AudioBuffer>;
  /** Set once decoded. */
  buffer: AudioBuffer | null;
}

/** A track's decoded stems (by stem index; a layer not needed yet has no slot). */
interface CacheEntry {
  slots: (StemSlot | undefined)[];
}

/** Start sources a little ahead so all stems begin on the same sample. */
const START_AHEAD = 0.06;
const INTENSITY_TC = 0.25;
const DUCK_ATTACK_TC = 0.015;
const DUCK_RELEASE_TC = 0.27;
/** Crossfade when switching to another encoding of the same track (demo A/B). */
const SWITCH_FADE = 0.08;
/** Seconds of a loop's tail blended into its start (must match SEAM_FADE in tools/music/build.py). */
export const SEAM_FADE = 0.02;
/** A layer is decoded once the intensity comes this close to its threshold (the director eases it up). */
export const LAYER_AHEAD = 0.1;
/** How long the music must stay inaudible before the player sleeps (a slider dragged through 0 does not). */
export const SLEEP_DELAY_MS = 2000;
/** Fade-in of the track woken up by raising the volume. */
const WAKE_FADE = 0.6;

export class MusicPlayer {
  private readonly lowpass: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly duckGain: GainNode;
  private readonly decks: Deck[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private manifestValue: MusicManifest | null = null;
  private manifestPromise: Promise<MusicManifest | null> | null = null;
  private manifestUrlValue: string;
  private intensityValue = 0;
  private disposed = false;
  /** Inaudible: decks keep a silent clock and hold no sources, streams or PCM. */
  private asleep: boolean;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending deck removals after a stream's fade-out (cancelled on dispose). */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  private readonly loadFile: (url: string) => Promise<AudioBuffer>;
  private readonly fetchManifest: (url: string) => Promise<unknown>;
  private readonly cacheTracks: number;
  private createStream: ((url: string) => MusicStream) | null;
  private readonly idle: (task: () => void) => void;

  constructor(
    private readonly ctx: BaseAudioContext,
    output: AudioNode,
    options: MusicPlayerOptions,
  ) {
    this.manifestUrlValue = options.manifestUrl;
    this.loadFile = options.load ?? ((url) => defaultLoad(ctx, url));
    this.fetchManifest = options.loadManifest ?? defaultManifest;
    this.cacheTracks = Math.max(1, options.cacheTracks ?? 2);
    this.createStream = options.createStream === undefined ? defaultStream(ctx) : options.createStream;
    this.idle = options.idle ?? defaultIdle;
    this.asleep = options.audible === false;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = OPEN_LOWPASS;
    this.lowpass.Q.value = 0.5;
    this.level = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.lowpass.connect(this.level);
    this.level.connect(this.duckGain);
    this.duckGain.connect(output);
    // a suspended context (hidden tab) stops the graph but not an <audio> element: keep them together
    (ctx as Partial<EventTarget>).addEventListener?.('statechange', this.onStateChange);
  }

  get manifest(): MusicManifest | null {
    return this.manifestValue;
  }

  /** The manifest the files come from. */
  get manifestUrl(): string {
    return this.manifestUrlValue;
  }

  get intensity(): number {
    return this.intensityValue;
  }

  /** Loads the manifest once; null (no music) when it is missing or broken. */
  loadManifest(): Promise<MusicManifest | null> {
    this.manifestPromise ??= this.fetchManifest(this.manifestUrlValue).then(
      (raw) => {
        this.manifestValue = parseMusicManifest(raw);
        return this.manifestValue;
      },
      () => null,
    );
    return this.manifestPromise;
  }

  /**
   * Switches to another manifest with the same tracks in other files (the music lab's A/B between
   * encodings): the audible track goes on from the same position in the new files. False (and nothing
   * changes) when that manifest cannot be loaded.
   */
  async switchSource(manifestUrl: string): Promise<boolean> {
    let parsed: MusicManifest | null;
    try {
      parsed = parseMusicManifest(await this.fetchManifest(manifestUrl));
    } catch {
      return false;
    }
    if (!parsed || this.disposed) return false;
    this.manifestUrlValue = manifestUrl;
    this.manifestValue = parsed;
    this.manifestPromise = Promise.resolve(parsed);
    // decks still playing keep their own buffers until they fade out
    this.cache.clear();
    // asleep: the silent deck loads the new files once it wakes up
    if (this.asleep) return true;
    const active = this.activeDeck();
    const track = active ? this.track(active.track.id) : null;
    if (active && track) {
      if (active.startedAt !== null) this.launch(track, SWITCH_FADE, active);
      else {
        // still loading the old files: load the new ones instead (at the position a woken deck keeps)
        const origin = active.origin;
        this.fadeOutDeck(active, this.ctx.currentTime, 0);
        this.launch(track, active.fade, null, origin);
      }
    }
    return true;
  }

  track(id: string): MusicTrack | null {
    return this.manifestValue?.tracks.find((t) => t.id === id) ?? null;
  }

  /** Starts decoding a track in the background (e.g. the mood likely next); streamed tracks need nothing. */
  prefetch(id: string): void {
    if (this.asleep || this.disposed) return;
    const track = this.track(id);
    if (track && !this.streams(track)) void Promise.all(track.stems.map((_, i) => this.stemBuffer(track, i))).catch(() => {});
  }

  /**
   * Is the music heard at all (master and music volume above 0, not muted)? Turning it off sleeps after
   * SLEEP_DELAY_MS: the playing track goes on as a silent clock and its PCM, streams and sources are
   * released. Turning it on wakes the audible track in an idle moment, at the position it has reached.
   */
  setAudible(audible: boolean): void {
    if (this.disposed) return;
    if (audible) {
      if (this.sleepTimer !== null) clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
      this.wake();
    } else if (!this.asleep && this.sleepTimer === null) {
      this.sleepTimer = setTimeout(() => this.sleep(), SLEEP_DELAY_MS);
    }
  }

  /** Asleep: inaudible, nothing decoded or streamed (tests, demo page). */
  get sleeping(): boolean {
    return this.asleep;
  }

  apply(cmd: MusicCommand): void {
    switch (cmd.type) {
      case 'play':
        this.play(cmd.trackId, cmd.fade);
        break;
      case 'stop':
        this.stop(cmd.fade);
        break;
      case 'intensity':
        this.setIntensity(cmd.value);
        break;
      case 'level':
        this.setLevel(cmd.gain, cmd.lowpassHz, cmd.seconds);
        break;
    }
  }

  /** Crossfade: the track fades in from its top, everything else fades out over the same time. */
  play(trackId: string, fade: number): void {
    if (this.disposed) return;
    const track = this.track(trackId);
    if (!track) return;
    const now = this.ctx.currentTime;
    const active = this.activeDeck();
    if (active && active.track.id === trackId) {
      // already playing: just make sure it is up
      this.ramp(active.gain.gain, track.gain, now, fade);
      return;
    }
    for (const deck of this.decks) if (!deck.stopping) this.fadeOutDeck(deck, now, fade);
    this.launch(track, fade, null);
  }

  /** Fades out everything. */
  stop(fade: number): void {
    const now = this.ctx.currentTime;
    for (const deck of this.decks) if (!deck.stopping) this.fadeOutDeck(deck, now, fade);
  }

  setIntensity(value: number): void {
    this.intensityValue = Math.min(1, Math.max(0, value));
    const now = this.ctx.currentTime;
    for (const deck of this.decks) {
      deck.stems.forEach((s, i) => s.gain.gain.setTargetAtTime(layerGain(deck.track, deck.track.stems[i]!, this.intensityValue), now, INTENSITY_TC));
      this.ensureLayers(deck);
    }
  }

  setLevel(gain: number, lowpassHz: number, seconds: number): void {
    const now = this.ctx.currentTime;
    if (seconds <= 0) {
      this.level.gain.cancelScheduledValues(now);
      this.level.gain.setValueAtTime(gain, now);
      this.lowpass.frequency.cancelScheduledValues(now);
      this.lowpass.frequency.setValueAtTime(lowpassHz, now);
      return;
    }
    this.level.gain.setTargetAtTime(gain, now, seconds / 3);
    this.lowpass.frequency.setTargetAtTime(lowpassHz, now, seconds / 3);
  }

  /** Dips the music under an important sound (dB below, hold seconds) and lets it come back. */
  duck(db: number, hold = 0.15): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const target = volumeToGainDb(-Math.abs(db));
    const param = this.duckGain.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(Math.min(target, param.value), now, DUCK_ATTACK_TC);
    param.setTargetAtTime(1, now + DUCK_ATTACK_TC * 4 + hold, DUCK_RELEASE_TC);
  }

  /** The audible track, its position within the loop (s) and how it plays, for the demo page. */
  nowPlaying(): { track: MusicTrack; position: number; streamed: boolean; silent: boolean } | null {
    const deck = this.activeDeck();
    if (!deck || (deck.startedAt === null && deck.origin === null)) return null;
    return { track: deck.track, position: this.position(deck), streamed: deck.stream !== null, silent: deck.startedAt === null };
  }

  /** Stems of the audible track with their current gain (demo page). */
  stemLevels(): { id: string; minIntensity: number; gain: number }[] {
    const deck = this.activeDeck();
    if (!deck) return [];
    return deck.track.stems.map((s, i) => ({ id: s.id, minIntensity: s.minIntensity, gain: deck.stems[i]!.gain.gain.value }));
  }

  /** Is a deck (loaded or loading) of this track playing and not fading out? */
  isPlaying(trackId: string): boolean {
    return this.activeDeck()?.track.id === trackId;
  }

  /** Bytes of decoded PCM the player holds (cache and playing decks), as float32 samples. */
  decodedBytes(): number {
    const held = new Set<AudioBuffer>();
    for (const entry of this.cache.values()) for (const slot of entry.slots) if (slot?.buffer) held.add(slot.buffer);
    for (const deck of this.decks) for (const s of deck.stems) if (s.source?.buffer) held.add(s.source.buffer);
    let bytes = 0;
    for (const b of held) bytes += b.length * b.numberOfChannels * 4;
    return bytes;
  }

  /** Ids of the tracks whose decoded buffers are cached (tests, demo page). */
  cachedTracks(): string[] {
    return [...this.cache.keys()];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sleepTimer !== null) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    (this.ctx as Partial<EventTarget>).removeEventListener?.('statechange', this.onStateChange);
    for (const deck of [...this.decks]) this.removeDeck(deck);
    for (const n of [this.lowpass, this.level, this.duckGain]) n.disconnect();
    this.cache.clear();
  }

  // ---------------- internals ----------------

  private activeDeck(): Deck | null {
    for (let i = this.decks.length - 1; i >= 0; i--) if (!this.decks[i]!.stopping) return this.decks[i]!;
    return null;
  }

  /** Position (s) of a started (or silently running) deck in its track at audio time `at`, wrapped into the loop. */
  private position(deck: Deck, at = this.ctx.currentTime): number {
    if (deck.stream) return deck.stream.media.currentTime;
    const origin = deck.startedAt ?? deck.origin;
    if (origin === null) return 0;
    return loopPosition(at - origin, deck.loopStart, deck.loopEnd);
  }

  private streams(track: MusicTrack): boolean {
    return !track.loop && track.stems.length === 1 && this.createStream !== null;
  }

  /**
   * A new deck for the track; it starts once its files are ready (taking over from `follow`, if given;
   * `origin` = the audio time of position 0 to keep to, instead of starting from the top).
   */
  private launch(track: MusicTrack, fade: number, follow: Deck | null, origin: number | null = null): void {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.lowpass);
    const deck: Deck = {
      track,
      gain,
      stems: track.stems.map((s) => {
        const g = this.ctx.createGain();
        g.gain.value = layerGain(track, s, this.intensityValue);
        g.connect(gain);
        return { minIntensity: s.minIntensity, gain: g, source: null, loading: false };
      }),
      stream: null,
      startedAt: null,
      origin,
      loopStart: track.loopStart,
      loopEnd: track.loopEnd,
      run: 0,
      stopping: false,
      released: false,
      fade,
      follow,
    };
    this.decks.push(deck);
    if (this.asleep) this.doze(deck);
    else this.load(deck);
  }

  private load(deck: Deck): void {
    if (this.streams(deck.track)) this.startStream(deck);
    else this.decodeAndStart(deck);
  }

  /**
   * Decodes the deck's first layer and starts it; the other layers the intensity needs join one at a time
   * (ensureLayers), so their PCM does not land on the main thread in one frame and the deck starts sooner.
   */
  private decodeAndStart(deck: Deck): void {
    const run = deck.run;
    const first = Math.max(0, deck.track.stems.findIndex((s) => this.layerNeeded(s)));
    this.stemBuffer(deck.track, first).then(
      (buffer) => {
        if (deck.run === run) this.startDeck(deck, first, buffer);
      },
      () => {
        if (deck.run === run) this.removeDeck(deck);
      },
    );
  }

  private layerNeeded(stem: MusicStem): boolean {
    return stem.minIntensity <= 0 || this.intensityValue >= stem.minIntensity - LAYER_AHEAD;
  }

  /** Joins the layers of a started deck the intensity now needs: decoded ones at once, the rest one by one. */
  private ensureLayers(deck: Deck): void {
    if (deck.startedAt === null || deck.stopping || deck.released || deck.stream) return;
    if (deck.stems.some((s) => s.loading)) return;
    const slots = this.cache.get(deck.track.id)?.slots;
    for (let i = 0; i < deck.stems.length; i++) {
      const stem = deck.stems[i]!;
      if (stem.source || !this.layerNeeded(deck.track.stems[i]!)) continue;
      const ready = slots?.[i]?.buffer;
      if (ready) {
        this.joinLayer(deck, i, ready);
        continue;
      }
      stem.loading = true;
      const run = deck.run;
      this.stemBuffer(deck.track, i).then(
        (buffer) => {
          if (deck.run !== run) return;
          stem.loading = false;
          if (this.disposed || deck.stopping || deck.released || deck.startedAt === null) return;
          this.joinLayer(deck, i, buffer);
          this.ensureLayers(deck);
        },
        () => {
          if (deck.run === run) stem.loading = false;
        },
      );
      return;
    }
  }

  /** A layer joining a playing deck: on the deck's clock (sample-aligned), easing in from silence. */
  private joinLayer(deck: Deck, i: number, buffer: AudioBuffer): void {
    const at = this.ctx.currentTime + START_AHEAD;
    if (!this.startStem(deck, i, buffer, at, this.position(deck, at))) return;
    const g = deck.stems[i]!.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.setTargetAtTime(layerGain(deck.track, deck.track.stems[i]!, this.intensityValue), at, INTENSITY_TC);
  }

  private startStem(deck: Deck, i: number, buffer: AudioBuffer, at: number, offset: number): boolean {
    const stem = deck.stems[i];
    if (!stem || stem.source) return false;
    const lp = loopPoints(deck.track, buffer);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = lp.whole ? 0 : lp.start;
    src.loopEnd = lp.whole ? 0 : lp.end;
    src.connect(stem.gain);
    src.start(at, offset);
    stem.source = src;
    return true;
  }

  /** The moment a deck starts: on an A/B switch the deck it follows fades out and hands over its position. */
  private takeOver(deck: Deck): number {
    const follow = deck.follow;
    deck.follow = null;
    if (!follow) return 0;
    const offset = follow.startedAt !== null && !follow.released ? this.position(follow) : 0;
    const now = this.ctx.currentTime;
    for (const d of this.decks) if (d !== deck && !d.stopping) this.fadeOutDeck(d, now, deck.fade);
    return offset;
  }

  private startDeck(deck: Deck, stem: number, buffer: AudioBuffer): void {
    if (this.disposed || deck.stopping || !this.decks.includes(deck)) return;
    const lp = loopPoints(deck.track, buffer);
    deck.loopStart = lp.start;
    deck.loopEnd = lp.end;
    const at = this.ctx.currentTime + START_AHEAD;
    // a woken deck goes on from where its silent clock is; otherwise from the top (or the A/B position)
    const offset = deck.origin !== null ? this.position(deck, at) : this.takeOver(deck);
    this.startStem(deck, stem, buffer, at, offset);
    deck.startedAt = at - offset;
    deck.origin = null;
    this.fadeIn(deck, at);
    this.ensureLayers(deck);
  }

  private startStream(deck: Deck): void {
    const url = resolveMusicUrl(this.manifestUrlValue, deck.track.stems[0]!.file);
    let stream: MusicStream;
    try {
      stream = this.createStream!(url);
    } catch {
      this.createStream = null;
      this.decodeAndStart(deck);
      return;
    }
    deck.stream = stream;
    stream.node.connect(deck.stems[0]!.gain);
    // the director fades a play-once track out before its end; looping is only a fallback (with a gap)
    stream.media.loop = true;
    const follow = deck.follow;
    if (deck.origin !== null) stream.media.currentTime = loopPosition(this.ctx.currentTime - deck.origin, deck.loopStart, deck.loopEnd);
    else if (follow && follow.startedAt !== null) stream.media.currentTime = this.position(follow);
    const run = deck.run;
    stream.media.play().then(
      () => {
        if (deck.run !== run || this.disposed || deck.stopping || !this.decks.includes(deck)) return;
        this.takeOver(deck);
        const at = this.ctx.currentTime;
        deck.startedAt = at;
        deck.origin = null;
        this.fadeIn(deck, at);
        if (this.ctx.state === 'suspended') stream.media.pause();
      },
      (err: unknown) => {
        // fell asleep meanwhile: the stream is already released
        if (deck.run !== run) return;
        const cancelled = this.disposed || deck.stopping || !this.decks.includes(deck);
        // a pause()/removal before playback started rejects play() with an AbortError – that is our own
        // cancellation (a mood change faded the deck), not a sign that streaming does not work here
        if (cancelled || isAbortError(err)) {
          this.releaseStream(deck);
          if (!cancelled) this.decodeAndStart(deck);
          return;
        }
        // no streaming here (codec, autoplay policy): decode this track and every later one instead
        this.createStream = null;
        this.releaseStream(deck);
        this.decodeAndStart(deck);
      },
    );
  }

  private fadeIn(deck: Deck, at: number): void {
    deck.gain.gain.setValueAtTime(0, at);
    deck.gain.gain.linearRampToValueAtTime(deck.track.gain, at + Math.max(0.05, deck.fade));
  }

  private fadeOutDeck(deck: Deck, now: number, fade: number): void {
    deck.stopping = true;
    if (deck.startedAt === null) {
      // never started (still loading): drop it
      this.removeDeck(deck);
      return;
    }
    const end = now + Math.max(0.05, fade);
    const g = deck.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, end);
    if (deck.stream) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.removeDeck(deck);
      }, (end - now + 0.05) * 1000);
      this.timers.add(timer);
      return;
    }
    for (const s of deck.stems) {
      if (!s.source) continue;
      try {
        s.source.stop(end + 0.05);
      } catch {
        // already stopped
      }
    }
    const first = deck.stems.find((s) => s.source)?.source;
    if (first) first.onended = () => this.removeDeck(deck);
    else this.removeDeck(deck);
  }

  /** Disconnects a deck and releases what it holds: its stream, and its decoded buffers unless still used. */
  private removeDeck(deck: Deck): void {
    const i = this.decks.indexOf(deck);
    if (i >= 0) this.decks.splice(i, 1);
    deck.stopping = true;
    if (deck.released) return;
    deck.released = true;
    this.releaseSources(deck);
    for (const s of deck.stems) s.gain.disconnect();
    deck.gain.disconnect();
    // a faded-out track gives its PCM back (a prefetched track that never played keeps its slot)
    if (!this.decks.some((d) => d.track.id === deck.track.id)) this.cache.delete(deck.track.id);
  }

  /** Stops and drops the deck's buffer sources and its stream (the gain chain stays). */
  private releaseSources(deck: Deck): void {
    for (const s of deck.stems) {
      const src = s.source;
      if (!src) continue;
      s.source = null;
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.releaseStream(deck);
  }

  // ---------------- sleep (inaudible music) ----------------

  /** Inaudible for a while: the audible deck goes silent (keeping its clock), the rest and all PCM go. */
  private sleep(): void {
    this.sleepTimer = null;
    if (this.asleep || this.disposed) return;
    this.asleep = true;
    const active = this.activeDeck();
    if (active) this.doze(active);
    for (const deck of [...this.decks]) if (deck !== active) this.removeDeck(deck);
    this.cache.clear();
  }

  /** A deck becomes a silent clock: it keeps its position, but holds no sources, stream or decode. */
  private doze(deck: Deck): void {
    const now = this.ctx.currentTime;
    const follow = deck.follow;
    const from = deck.startedAt !== null ? deck : follow && follow.startedAt !== null && !follow.released ? follow : null;
    // a decoded deck keeps its own clock; a stream's element knows where it is
    if (from) deck.origin = from.stream ? now - from.stream.media.currentTime : from.startedAt;
    else deck.origin ??= now;
    deck.follow = null;
    deck.run++;
    this.releaseSources(deck);
    deck.startedAt = null;
    for (const s of deck.stems) s.loading = false;
    const g = deck.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
  }

  /** Audible again: the silent audible deck loads (in an idle moment) and fades in where its clock is. */
  private wake(): void {
    if (!this.asleep) return;
    this.asleep = false;
    const deck = this.activeDeck();
    if (!deck) return;
    const run = ++deck.run;
    this.idle(() => {
      if (this.disposed || this.asleep || deck.run !== run || deck.stopping || !this.decks.includes(deck)) return;
      deck.fade = WAKE_FADE;
      this.load(deck);
    });
  }

  private releaseStream(deck: Deck): void {
    const stream = deck.stream;
    if (!stream) return;
    deck.stream = null;
    try {
      stream.media.pause();
      stream.media.removeAttribute('src');
      stream.media.load();
    } catch {
      // nothing to release
    }
    stream.node.disconnect();
  }

  private readonly onStateChange = (): void => {
    const running = this.ctx.state === 'running';
    for (const deck of this.decks) {
      if (!deck.stream || deck.startedAt === null) continue;
      if (running) deck.stream.media.play().catch(() => {});
      else deck.stream.media.pause();
    }
  };

  private ramp(param: AudioParam, value: number, now: number, seconds: number): void {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.05, seconds));
  }

  /** One decoded stem of a track (cached per track; least recently used tracks beyond the budget are dropped). */
  private stemBuffer(track: MusicTrack, index: number): Promise<AudioBuffer> {
    let entry = this.cache.get(track.id);
    if (entry) {
      // refresh LRU order
      this.cache.delete(track.id);
      this.cache.set(track.id, entry);
    } else {
      entry = { slots: [] };
      this.cache.set(track.id, entry);
      this.evict();
    }
    const slots = entry.slots;
    const cached = slots[index];
    if (cached) return cached.promise;
    const file = resolveMusicUrl(this.manifestUrlValue, track.stems[index]!.file);
    const slot: StemSlot = {
      promise: this.loadFile(file).then((buffer) => {
        smoothLoopSeam(buffer, track.loopStart, track.loopEnd);
        slot.buffer = buffer;
        return buffer;
      }),
      buffer: null,
    };
    slot.promise.catch(() => {
      if (slots[index] === slot) slots[index] = undefined;
    });
    slots[index] = slot;
    return slot.promise;
  }

  private evict(): void {
    if (this.cache.size <= this.cacheTracks) return;
    const busy = new Set(this.decks.map((d) => d.track.id));
    for (const id of [...this.cache.keys()]) {
      if (this.cache.size <= this.cacheTracks) break;
      if (!busy.has(id)) this.cache.delete(id);
    }
  }
}

/**
 * How a buffer loops: a circular file of exactly one pass over the whole buffer (0/0 on the source, sample
 * exact); a file with a tail past the loop end (or an intro) between the manifest's points.
 */
function loopPoints(track: MusicTrack, buffer: AudioBuffer): { whole: boolean; start: number; end: number } {
  const { loopStart, loopEnd, duration } = track;
  const whole = loopStart <= 0.001 && Math.abs(loopEnd - duration) < 0.01 && buffer.duration - loopEnd < SEAM_FADE / 2;
  return whole ? { whole, start: 0, end: buffer.duration } : { whole, start: loopStart, end: Math.min(loopEnd, buffer.duration) };
}

/** Position after `elapsed` seconds of a source that plays from 0 and then loops between the points. */
function loopPosition(elapsed: number, loopStart: number, loopEnd: number): number {
  const e = Math.max(0, elapsed);
  const loop = loopEnd - loopStart;
  return e < loopEnd || loop <= 0 ? e : loopStart + ((e - loopStart) % loop);
}

/**
 * A lossy codec decodes the last and the first sample of a loop with independent errors, which leaves a
 * small step at the seam. The files carry a tail past the loop end (the loop start again, encoded as the
 * continuation of the end); blending it into the first SEAM_FADE seconds makes the seam join two samples
 * decoded one after the other. No-op for a file without a tail. Mutates the buffer; true when applied.
 */
export function smoothLoopSeam(buffer: AudioBuffer, loopStart: number, loopEnd: number, fade = SEAM_FADE): boolean {
  const sr = buffer.sampleRate;
  const start = Math.round(loopStart * sr);
  const end = Math.round(loopEnd * sr);
  const n = Math.min(Math.round(fade * sr), buffer.length - end, end - start);
  if (n < 2) return false;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      d[start + i] = d[end + i]! * (1 - t) + d[start + i]! * t;
    }
  }
  return true;
}

/**
 * Gain of one layer: the stem's own ramp, and for a multi-stem track a lift of the quiet low-intensity
 * mix (the base alone is ~6 dB under the full cue): +3 dB at intensity 0 easing to 0 dB at 1.
 */
export function layerGain(track: Pick<MusicTrack, 'stems'>, stem: Pick<MusicStem, 'minIntensity'>, intensity: number): number {
  const g = stemGain(stem, intensity);
  if (track.stems.length < 2) return g;
  return g * volumeToGainDb(LOW_INTENSITY_LIFT_DB * (1 - Math.min(1, Math.max(0, intensity))));
}

/** dB added to a layered track at intensity 0. */
export const LOW_INTENSITY_LIFT_DB = 3;

const volumeToGainDb = (db: number): number => Math.pow(10, db / 20);

async function defaultLoad(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`music ${url}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

async function defaultManifest(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`music manifest: ${res.status}`);
  return res.json();
}

function defaultIdle(task: () => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(() => task(), { timeout: 500 });
  else setTimeout(task, 16);
}

/** <audio> + MediaElementAudioSourceNode, where the browser and the context have them. */
function defaultStream(ctx: BaseAudioContext): ((url: string) => MusicStream) | null {
  if (typeof Audio !== 'function' || !('createMediaElementSource' in ctx)) return null;
  const audioCtx = ctx as AudioContext;
  return (url) => {
    const media = new Audio();
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.src = url;
    return { media, node: audioCtx.createMediaElementSource(media) };
  };
}

/** play() rejected because the media was paused/removed before it started – our own cancellation. */
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

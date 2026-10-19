import { describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeBuffer, FakeBufferSource, FakeGain, FakeNode } from '../testing/fakeAudio';
import { LAYER_AHEAD, LOW_INTENSITY_LIFT_DB, MusicPlayer, type MusicPlayerOptions, type MusicStream, SEAM_FADE, SLEEP_DELAY_MS, smoothLoopSeam } from './MusicPlayer';

const MANIFEST = {
  version: 1,
  tracks: [
    { id: 'calm', mood: 'calm', duration: 4, loopStart: 0, loopEnd: 4, gain: 0.8, stems: [{ id: 'full', file: 'calm.opus', minIntensity: 0 }] },
    {
      id: 'fight',
      mood: 'combat',
      duration: 2,
      loopStart: 0,
      loopEnd: 2,
      gain: 1,
      stems: [
        { id: 'base', file: 'fight-base.opus', minIntensity: 0 },
        { id: 'drive', file: 'fight-drive.opus', minIntensity: 0.3 },
        { id: 'lead', file: 'fight-lead.opus', minIntensity: 0.65 },
      ],
    },
  ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Buffer source that remembers its start() arguments. */
class RecordingSource extends FakeBufferSource {
  startArgs: number[] = [];
  override start(...args: number[]): void {
    super.start();
    this.startArgs = args;
  }
}

/** Fake context with start() arguments and state change events. */
class TestContext extends FakeAudioContext {
  private readonly listeners = new Set<() => void>();
  override createBufferSource() {
    const s = new RecordingSource(this, 'bufferSource');
    this.nodes.push(s);
    return s;
  }
  addEventListener(_type: string, fn: () => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
  setState(state: 'running' | 'suspended'): void {
    this.state = state;
    for (const fn of this.listeners) fn();
  }
}

class FakeMedia {
  currentTime = 0;
  loop = false;
  playing = false;
  released = false;
  constructor(
    readonly src: string,
    private readonly fail: boolean,
  ) {}
  play(): Promise<void> {
    if (this.fail) return Promise.reject(new Error('NotSupportedError'));
    this.playing = true;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
  }
  load(): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.released = true;
  }
}

function setup(over: Partial<MusicPlayerOptions> & { streaming?: 'ok' | 'fail' } = {}) {
  const ctx = new TestContext();
  const out = ctx.createGain();
  const loads: string[] = [];
  const media: FakeMedia[] = [];
  const { streaming, ...options } = over;
  const createStream =
    streaming === undefined
      ? null
      : (url: string): MusicStream => {
          const m = new FakeMedia(url, streaming === 'fail');
          media.push(m);
          return { media: m, node: new FakeNode(ctx, 'mediaSource') as unknown as AudioNode };
        };
  const player = new MusicPlayer(ctx as unknown as AudioContext, out as unknown as AudioNode, {
    manifestUrl: '/assets/music/manifest.json',
    loadManifest: () => Promise.resolve(structuredClone(MANIFEST)),
    load: (url) => {
      loads.push(url);
      const seconds = url.includes('fight') ? 2 : 4;
      return Promise.resolve(new FakeBuffer(2, seconds * ctx.sampleRate, ctx.sampleRate) as unknown as AudioBuffer);
    },
    cacheTracks: 2,
    createStream,
    ...options,
  });
  const sources = () => ctx.nodes.filter((n): n is RecordingSource => n instanceof RecordingSource);
  return { ctx, player, loads, sources, media };
}

describe('MusicPlayer', () => {
  it('loads the manifest and plays a track as a seamless loop with a fade-in', async () => {
    const { player, loads, sources } = setup();
    expect((await player.loadManifest())!.tracks).toHaveLength(2);
    player.play('calm', 3);
    await flush();
    expect(loads).toEqual(['/assets/music/calm.opus']);
    const [src] = sources();
    expect(src!.started).toBe(true);
    // circular file: the whole buffer loops (0/0)
    expect([src!.loop, src!.loopStart, src!.loopEnd]).toEqual([true, 0, 0]);
    expect(player.nowPlaying()!.track.id).toBe('calm');
    expect(player.isPlaying('calm')).toBe(true);
  });

  it('keeps explicit loop points that differ from the whole file', async () => {
    const { player, sources } = setup();
    const m = await player.loadManifest();
    Object.assign(m!.tracks[0]!, { loopStart: 1, loopEnd: 3 });
    player.play('calm', 1);
    await flush();
    expect([sources()[0]!.loopStart, sources()[0]!.loopEnd]).toEqual([1, 3]);
  });

  it('crossfades: the old deck ramps to zero and stops, the new one ramps to its gain', async () => {
    const { player, sources, ctx } = setup();
    await player.loadManifest();
    player.play('calm', 3);
    await flush();
    const calmSrc = sources()[0]!;
    const calmDeckGain = calmSrc.connections[0] as FakeGain; // stem gain
    ctx.currentTime = 10;
    player.setIntensity(1);
    player.play('fight', 2);
    await flush();
    expect(calmSrc.stopped).toBe(true);
    const deck = calmDeckGain.connections[0] as FakeGain;
    expect(deck.gain.lastTarget).toBe(0);
    const fight = sources().slice(1);
    expect(fight).toHaveLength(3);
    expect(fight.every((s) => s.started)).toBe(true);
    expect(player.nowPlaying()!.track.id).toBe('fight');
  });

  it('stem layers follow the intensity', async () => {
    const { player, sources } = setup();
    await player.loadManifest();
    player.setIntensity(0.2);
    player.play('fight', 1);
    await flush();
    // base, and the drive layer (0.3) close enough to be decoded already; the lead (0.65) is not
    expect(sources()).toHaveLength(2);
    player.apply({ type: 'intensity', value: 1 });
    await flush();
    expect(sources()).toHaveLength(3);
    const stemGains = sources().map((s) => s.connections[0] as FakeGain);
    expect(stemGains.map((g) => g.gain.lastTarget)).toEqual([1, 1, 1]);
    // the base alone gets a lift (+3 dB at 0 easing to 0 dB at 1)
    const lift = (i: number) => Math.pow(10, (LOW_INTENSITY_LIFT_DB * (1 - i)) / 20);
    player.apply({ type: 'intensity', value: 0.2 });
    expect(stemGains[0]!.gain.lastTarget).toBeCloseTo(lift(0.2));
    expect(stemGains.slice(1).map((g) => g.gain.lastTarget)).toEqual([0, 0]);
    player.apply({ type: 'intensity', value: 0.5 });
    expect(stemGains.map((g) => g.gain.lastTarget!)).toEqual([lift(0.5), lift(0.5), 0]);
  });

  it('a stop before the files are loaded never starts them', async () => {
    const { player, sources } = setup();
    await player.loadManifest();
    player.play('calm', 2);
    player.stop(1);
    await flush();
    expect(sources()).toHaveLength(0);
    expect(player.nowPlaying()).toBeNull();
  });

  it('ducks and recovers, sets level and lowpass', async () => {
    const { player, ctx } = setup();
    const gains = () => ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain);
    player.duck(6);
    const duck = gains().find((g) => g.gain.calls.some((c) => c.method === 'setTargetAtTime' && Math.abs(c.args[0]! - 0.501) < 0.01));
    expect(duck).toBeDefined();
    expect(duck!.gain.lastTarget).toBe(1);
    player.apply({ type: 'level', gain: 0.3, lowpassHz: 900, seconds: 0.6 });
    const filter = ctx.nodes.find((n) => n.kind === 'biquad') as unknown as { frequency: { lastTarget: number } };
    expect(filter.frequency.lastTarget).toBe(900);
  });

  it('keeps only a few tracks decoded', async () => {
    const { player, loads } = setup();
    const m = await player.loadManifest();
    m!.tracks.push({ ...m!.tracks[0]!, id: 'calm2', stems: [{ id: 'full', file: 'calm2.opus', minIntensity: 0 }] });
    player.prefetch('calm');
    player.prefetch('fight');
    player.prefetch('calm2');
    await flush();
    player.prefetch('calm');
    await flush();
    // calm was evicted by the budget of 2 and loads again
    expect(loads.filter((u) => u.endsWith('/calm.opus'))).toHaveLength(2);
  });

  it('a missing manifest means silence, not an error', async () => {
    const ctx = new FakeAudioContext();
    const player = new MusicPlayer(ctx as unknown as AudioContext, ctx.createGain() as unknown as AudioNode, {
      manifestUrl: 'x/manifest.json',
      loadManifest: () => Promise.reject(new Error('404')),
    });
    expect(await player.loadManifest()).toBeNull();
    player.play('calm', 1);
    expect(player.nowPlaying()).toBeNull();
  });
  it('holds two decoded tracks by default (the current one and a prefetched next one)', async () => {
    const { player, loads } = setup({ cacheTracks: undefined });
    const m = await player.loadManifest();
    m!.tracks.push({ ...m!.tracks[0]!, id: 'calm2', stems: [{ id: 'full', file: 'calm2.opus', minIntensity: 0 }] });
    player.prefetch('calm');
    player.prefetch('fight');
    await flush();
    expect(player.cachedTracks()).toEqual(['calm', 'fight']);
    player.prefetch('calm2');
    await flush();
    expect(player.cachedTracks()).toEqual(['fight', 'calm2']);
    expect(loads).toHaveLength(5);
  });

  it('decodes nothing before a track plays', async () => {
    const { player, loads } = setup();
    await player.loadManifest();
    expect(loads).toEqual([]);
    expect(player.decodedBytes()).toBe(0);
  });

  it('gives the decoded buffers back once a track has faded out', async () => {
    const { player, ctx, sources } = setup();
    await player.loadManifest();
    player.setIntensity(1);
    player.play('fight', 1);
    await flush();
    // three stereo stems of 2 s, float32
    const fightBytes = 3 * 2 * 2 * ctx.sampleRate * 4;
    const calmBytes = 2 * 4 * ctx.sampleRate * 4;
    expect(player.decodedBytes()).toBe(fightBytes);
    player.play('calm', 2);
    await flush();
    // both decks hold their buffers during the crossfade
    expect(player.decodedBytes()).toBe(fightBytes + calmBytes);
    const fight = sources().slice(0, 3);
    expect(fight.every((s) => s.stopped)).toBe(true);
    fight[0]!.onended!();
    expect(player.cachedTracks()).toEqual(['calm']);
    expect(player.decodedBytes()).toBe(calmBytes);
    // replaying the cue decodes it again
    player.play('fight', 1);
    await flush();
    expect(sources().slice(4).every((s) => s.started)).toBe(true);
  });

  it('restarting the same track keeps its buffers', async () => {
    const { player, sources, loads } = setup();
    await player.loadManifest();
    player.setIntensity(1);
    player.play('fight', 1);
    await flush();
    player.stop(0.3);
    player.play('fight', 1);
    await flush();
    sources()[0]!.onended!();
    expect(player.cachedTracks()).toEqual(['fight']);
    expect(loads).toHaveLength(3);
  });

  it('streams a play-once track instead of decoding it', async () => {
    const { player, loads, media, ctx } = setup({ streaming: 'ok' });
    await player.loadManifest();
    player.play('calm', 2);
    await flush();
    expect(loads).toEqual([]);
    expect(media).toHaveLength(1);
    expect(media[0]!.src).toBe('/assets/music/calm.opus');
    expect(media[0]!.playing).toBe(true);
    expect(player.decodedBytes()).toBe(0);
    media[0]!.currentTime = 1.25;
    expect(player.nowPlaying()).toMatchObject({ position: 1.25, streamed: true });
    // a hidden tab suspends the context: the element pauses with it
    ctx.setState('suspended');
    expect(media[0]!.playing).toBe(false);
    ctx.setState('running');
    expect(media[0]!.playing).toBe(true);
    // fading out releases the element
    player.stop(0);
    await wait(150);
    expect(media[0]!.released).toBe(true);
    expect(player.nowPlaying()).toBeNull();
  });

  it('looping tracks are always decoded, even where streaming works', async () => {
    const { player, loads, media } = setup({ streaming: 'ok' });
    await player.loadManifest();
    player.play('fight', 1);
    await flush();
    expect(media).toHaveLength(0);
    // a quiet fight: only the base layer
    expect(loads).toEqual(['/assets/music/fight-base.opus']);
  });

  it('falls back to decoding when the browser cannot stream', async () => {
    const { player, loads, media, sources } = setup({ streaming: 'fail' });
    await player.loadManifest();
    player.play('calm', 2);
    await flush();
    await flush();
    expect(media[0]!.released).toBe(true);
    expect(loads).toEqual(['/assets/music/calm.opus']);
    expect(sources()[0]!.started).toBe(true);
    expect(player.nowPlaying()).toMatchObject({ streamed: false });
  });

  it('a stream cancelled before it starts (AbortError) keeps streaming on for later tracks', async () => {
    const ctx = new TestContext();
    const media: { src: string; paused: boolean }[] = [];
    const loads: string[] = [];
    // play() stays pending until pause() aborts it, like a real <audio> element still buffering
    const createStream = (url: string): MusicStream => {
      let reject: (e: unknown) => void = () => {};
      const m = {
        src: url,
        paused: false,
        currentTime: 0,
        loop: false,
        play: () =>
          new Promise<void>((_res, rej) => {
            reject = rej;
          }),
        pause: () => {
          m.paused = true;
          reject(Object.assign(new Error('The play() request was interrupted by a call to pause()'), { name: 'AbortError' }));
        },
        load: () => {},
        removeAttribute: () => {},
      };
      media.push(m);
      return { media: m as unknown as HTMLMediaElement, node: new FakeNode(ctx, 'mediaSource') as unknown as AudioNode };
    };
    const player = new MusicPlayer(ctx as unknown as AudioContext, ctx.createGain() as unknown as AudioNode, {
      manifestUrl: '/assets/music/manifest.json',
      loadManifest: () => {
        const m = structuredClone(MANIFEST);
        m.tracks.push({ ...m.tracks[0]!, id: 'calm2', stems: [{ id: 'full', file: 'calm2.opus', minIntensity: 0 }] });
        return Promise.resolve(m);
      },
      load: (url) => {
        loads.push(url);
        return Promise.resolve(new FakeBuffer(2, 4 * ctx.sampleRate, ctx.sampleRate) as unknown as AudioBuffer);
      },
      createStream,
    });
    await player.loadManifest();
    player.play('calm', 2);
    await flush();
    // a mood change drops the not-yet-started deck: its element is paused → play() rejects with AbortError
    player.play('calm2', 2);
    await flush();
    await flush();
    expect(media[0]!.paused).toBe(true);
    expect(media.map((m) => m.src)).toEqual(['/assets/music/calm.opus', '/assets/music/calm2.opus']);
    // nothing was decoded: the cancellation did not switch the session to decoding
    expect(loads).toEqual([]);
  });

  it('a file with a tail past the loop end loops between the loop points with the seam blended', async () => {
    const ctx = new TestContext();
    const sr = ctx.sampleRate;
    const tail = 0.1;
    const player = new MusicPlayer(ctx as unknown as AudioContext, ctx.createGain() as unknown as AudioNode, {
      manifestUrl: '/m/manifest.json',
      loadManifest: () => Promise.resolve({ tracks: [{ ...MANIFEST.tracks[1], loop: true }] }),
      load: () => {
        const b = new FakeBuffer(1, Math.round((2 + tail) * sr), sr);
        b.getChannelData(0).fill(1, 0, 2 * sr);
        return Promise.resolve(b as unknown as AudioBuffer);
      },
      createStream: null,
    });
    await player.loadManifest();
    player.play('fight', 1);
    await flush();
    const src = ctx.nodes.find((n): n is RecordingSource => n instanceof RecordingSource)!;
    expect([src.loopStart, src.loopEnd]).toEqual([0, 2]);
    // the start fades from the tail (silent here) into the loop (1)
    const d = src.buffer!.getChannelData(0);
    const n = Math.round(SEAM_FADE * sr);
    expect(d[0]).toBeCloseTo(0.5 / n);
    expect(d[n - 1]).toBeCloseTo(1 - 0.5 / n);
    expect(d[n]).toBe(1);
  });

  it('smoothLoopSeam leaves a file without a tail alone', () => {
    const b = new FakeBuffer(2, 800, 8000);
    b.getChannelData(1).fill(0.5);
    expect(smoothLoopSeam(b as unknown as AudioBuffer, 0, 0.1)).toBe(false);
    expect(b.getChannelData(1)[0]).toBe(0.5);
  });

  it('switching the source continues the track at the same position from the new files', async () => {
    const { player, ctx, loads, sources } = setup();
    await player.loadManifest();
    player.setIntensity(1);
    player.play('fight', 1);
    await flush();
    const old = sources();
    const startedAt = old[0]!.startArgs[0]!;
    ctx.currentTime = startedAt + 2.5; // 0.5 s into the second pass
    expect(await player.switchSource('/dev/hq/manifest.json')).toBe(true);
    await flush();
    expect(loads.slice(3)).toEqual(['/dev/hq/fight-base.opus', '/dev/hq/fight-drive.opus', '/dev/hq/fight-lead.opus']);
    const fresh = sources().slice(3);
    expect(fresh.every((s) => s.started)).toBe(true);
    expect(fresh[0]!.startArgs[1]).toBeCloseTo(0.5);
    expect(old.every((s) => s.stopped)).toBe(true);
    expect(player.manifestUrl).toBe('/dev/hq/manifest.json');
    expect(player.nowPlaying()!.track.id).toBe('fight');
  });

  it('a source that cannot be loaded changes nothing', async () => {
    const { player } = setup({ loadManifest: (url) => (url.includes('hq') ? Promise.reject(new Error('404')) : Promise.resolve(MANIFEST)) });
    await player.loadManifest();
    expect(await player.switchSource('/hq/manifest.json')).toBe(false);
    expect(player.manifestUrl).toBe('/assets/music/manifest.json');
  });

  it('decodes a layer only once the intensity nears it; it joins on the deck clock, easing in', async () => {
    const { player, ctx, loads, sources } = setup();
    await player.loadManifest();
    player.setIntensity(0.15);
    player.play('fight', 1);
    await flush();
    expect(loads).toEqual(['/assets/music/fight-base.opus']);
    const base = sources()[0]!;
    const startedAt = base.startArgs[0]! - base.startArgs[1]!;
    // just under the drive's look-ahead: still nothing
    player.setIntensity(0.3 - LAYER_AHEAD - 0.01);
    await flush();
    expect(loads).toHaveLength(1);
    ctx.currentTime = startedAt + 2.7; // 0.7 s into the second pass of the 2 s loop
    player.setIntensity(0.3 - LAYER_AHEAD);
    await flush();
    expect(loads).toEqual(['/assets/music/fight-base.opus', '/assets/music/fight-drive.opus']);
    const drive = sources()[1]!;
    const [at, offset] = drive.startArgs;
    // the same clock as the base: (at - startedAt) wrapped into the loop
    expect(offset).toBeCloseTo((at! - startedAt) % 2);
    const g = drive.connections[0] as FakeGain;
    expect(g.gain.calls.some((c) => c.method === 'setValueAtTime' && c.args[0] === 0)).toBe(true);
    // 3 decoded stereo stems would be 3x the base
    expect(player.decodedBytes()).toBe(2 * 2 * 2 * ctx.sampleRate * 4);
    // the layer stays for the deck's life (no churn when the fight calms down)
    player.setIntensity(0.15);
    player.setIntensity(0.3);
    await flush();
    expect(loads).toHaveLength(2);
  });

  it('starts asleep when inaudible: nothing is decoded or streamed, the track keeps a silent clock', async () => {
    const { player, loads, media, sources, ctx } = setup({ audible: false, streaming: 'ok', idle: (task) => task() });
    await player.loadManifest();
    player.play('fight', 1);
    player.play('calm', 1);
    await flush();
    expect(loads).toEqual([]);
    expect(media).toHaveLength(0);
    expect(sources()).toHaveLength(0);
    expect(player.decodedBytes()).toBe(0);
    expect(player.isPlaying('calm')).toBe(true);
    ctx.currentTime = 1.5;
    expect(player.nowPlaying()).toMatchObject({ position: 1.5, silent: true });
    // the volume comes up: the audible track wakes at its position (streamed here)
    player.setAudible(true);
    await flush();
    expect(media).toHaveLength(1);
    expect(media[0]!.currentTime).toBeCloseTo(1.5);
    expect(media[0]!.playing).toBe(true);
    expect(player.nowPlaying()).toMatchObject({ silent: false, streamed: true });
  });

  it('falls asleep a while after the volume goes to 0, releasing the PCM, and wakes where the loop is', async () => {
    vi.useFakeTimers();
    try {
      const idle: (() => void)[] = [];
      const { player, ctx, sources, loads } = setup({ idle: (task) => idle.push(task) });
      await player.loadManifest();
      player.setIntensity(1);
      player.play('fight', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(sources()).toHaveLength(3);
      const startedAt = sources()[0]!.startArgs[0]! - sources()[0]!.startArgs[1]!;
      expect(player.decodedBytes()).toBeGreaterThan(0);
      // a slider dragged through 0 and back does nothing
      player.setAudible(false);
      await vi.advanceTimersByTimeAsync(SLEEP_DELAY_MS / 2);
      player.setAudible(true);
      await vi.advanceTimersByTimeAsync(SLEEP_DELAY_MS);
      expect(player.sleeping).toBe(false);
      expect(player.decodedBytes()).toBeGreaterThan(0);
      // staying at 0 sleeps
      player.setAudible(false);
      await vi.advanceTimersByTimeAsync(SLEEP_DELAY_MS + 10);
      expect(player.sleeping).toBe(true);
      expect(sources().every((s) => s.stopped)).toBe(true);
      expect(player.decodedBytes()).toBe(0);
      expect(player.cachedTracks()).toEqual([]);
      expect(player.isPlaying('fight')).toBe(true);
      // intensity changes while asleep decode nothing
      player.setIntensity(0.5);
      await vi.advanceTimersByTimeAsync(0);
      expect(loads).toHaveLength(3);
      // waking waits for an idle moment, then decodes and starts at the silent clock's position
      ctx.currentTime = startedAt + 5.25; // 1.25 s into the third pass
      player.setAudible(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(loads).toHaveLength(3);
      idle.shift()!();
      await vi.advanceTimersByTimeAsync(0);
      // intensity 0.5: base and drive
      expect(loads.slice(3)).toEqual(['/assets/music/fight-base.opus', '/assets/music/fight-drive.opus']);
      const woke = sources().slice(3);
      expect(woke).toHaveLength(2);
      const [at, offset] = woke[0]!.startArgs;
      expect(offset).toBeCloseTo((at! - startedAt) % 2);
      expect(player.nowPlaying()).toMatchObject({ silent: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a mood change while asleep just moves the silent clock; dispose cancels the pending timers', async () => {
    vi.useFakeTimers();
    try {
      const { player, ctx, loads, media } = setup({ audible: false, streaming: 'ok' });
      await player.loadManifest();
      player.play('fight', 1);
      ctx.currentTime = 3;
      player.play('calm', 2);
      expect(player.nowPlaying()).toMatchObject({ position: 0 });
      expect(loads).toEqual([]);
      player.setAudible(true);
      await vi.advanceTimersByTimeAsync(20);
      expect(media).toHaveLength(1);
      // the stream's fade-out removal and a pending sleep die with the player
      player.stop(0.2);
      player.setAudible(false);
      player.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

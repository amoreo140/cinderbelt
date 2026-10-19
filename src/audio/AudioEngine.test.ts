import { afterEach, describe, expect, it } from 'vitest';
import { AudioEngine, type AudioEngineOptions } from './AudioEngine';
import { mulberry32 } from './math';
import { FakeAudioContext, FakeDocument, FakeGain } from './testing/fakeAudio';

interface Setup {
  engine: AudioEngine;
  ctx: () => FakeAudioContext;
  contexts: FakeAudioContext[];
  doc: FakeDocument;
  clock: { t: number };
}

const engines: AudioEngine[] = [];

function setup(options: Partial<AudioEngineOptions> & { initialState?: 'running' | 'suspended' } = {}): Setup {
  const contexts: FakeAudioContext[] = [];
  const doc = new FakeDocument();
  const clock = { t: 100 };
  const engine = new AudioEngine({
    createContext: () => {
      const c = new FakeAudioContext(options.initialState ?? 'running');
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    visibility: doc,
    now: () => clock.t,
    random: mulberry32(1),
    music: false,
    ...options,
  });
  engines.push(engine);
  return { engine, ctx: () => contexts[0]!, contexts, doc, clock };
}

/** Master output gain node (the first gain connected to the compressor). */
function masterNode(ctx: FakeAudioContext): FakeGain {
  const compressor = ctx.nodes.find((n) => n.kind === 'compressor')!;
  return ctx.nodes.find((n) => n instanceof FakeGain && n.connections.includes(compressor)) as FakeGain;
}

afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

describe('AudioEngine lifecycle', () => {
  it('does not create an AudioContext until unlocked', () => {
    const { engine, contexts } = setup();
    engine.setThrust(1);
    engine.setMiningLaser({ active: true, hitting: true, resource: 'ice' });
    expect(engine.playImpact(1)).toBe(false);
    expect(engine.playResourceCollected('iron')).toBe(false);
    expect(engine.playAlert('cargoFull')).toBe(false);
    expect(contexts).toHaveLength(0);
    expect(engine.state).toBe('locked');
  });

  it('unlock creates exactly one context and resumes a suspended one', async () => {
    const { engine, contexts } = setup({ initialState: 'suspended' });
    expect(await engine.unlock()).toBe(true);
    expect(await engine.unlock()).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.resumeCalls).toBe(1);
    expect(engine.state).toBe('running');
  });

  it('attachUnlock unlocks on the first gesture', async () => {
    const { engine, contexts } = setup();
    const target = new FakeDocument();
    const detach = engine.attachUnlock(target);
    expect(target.listenerCount('pointerdown')).toBe(1);
    target.dispatch('keydown');
    await Promise.resolve();
    expect(contexts).toHaveLength(1);
    target.dispatch('pointerdown');
    expect(contexts).toHaveLength(1);
    detach();
    expect(target.listenerCount('pointerdown')).toBe(0);
  });

  it('reports unsupported when the context cannot be created', async () => {
    const engine = new AudioEngine({
      createContext: () => {
        throw new Error('no audio');
      },
      visibility: null,
    });
    engines.push(engine);
    expect(await engine.unlock()).toBe(false);
    expect(engine.state).toBe('unsupported');
    expect(engine.playImpact(1)).toBe(false);
  });

  it('suspends when the tab is hidden and resumes when visible again', async () => {
    const { engine, ctx, doc } = setup();
    await engine.unlock();
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    expect(ctx().state).toBe('suspended');
    expect(engine.playUi('click')).toBe(false);
    doc.hidden = false;
    doc.dispatch('visibilitychange');
    expect(ctx().state).toBe('running');
    expect(ctx().resumeCalls).toBe(1);
  });

  it('does not resume on visibility if it was not suspended by hiding', async () => {
    const { engine, ctx, doc } = setup();
    await engine.unlock();
    doc.hidden = false;
    doc.dispatch('visibilitychange');
    expect(ctx().resumeCalls).toBe(0);
  });

  it('dispose closes the context and removes listeners', async () => {
    const { engine, ctx, doc } = setup();
    const target = new FakeDocument();
    engine.attachUnlock(target);
    await engine.unlock();
    engine.dispose();
    expect(ctx().state).toBe('closed');
    expect(doc.listenerCount('visibilitychange')).toBe(0);
    expect(target.listenerCount('keydown')).toBe(0);
    expect(engine.state).toBe('closed');
    expect(await engine.unlock()).toBe(false);
  });
});

describe('AudioEngine prepare (graph built before the first gesture)', () => {
  /** A manual idle queue: tasks run only when the test drains it. */
  function idleQueue() {
    const tasks: (() => void)[] = [];
    return {
      idle: (task: () => void) => void tasks.push(task),
      runOne: () => tasks.shift()?.(),
      drain: () => {
        let n = 0;
        while (tasks.length > 0 && n++ < 100) tasks.shift()!();
        return n;
      },
      get size() {
        return tasks.length;
      },
    };
  }
  const internalGraph = (engine: AudioEngine) => (engine as unknown as { graph: { noise: Record<string, { getChannelData(c: number): Float32Array }> } | null }).graph;

  it('builds the context and the graph in idle steps without unlocking', async () => {
    const q = idleQueue();
    const { engine, contexts } = setup({ initialState: 'suspended', idle: q.idle });
    engine.prepare();
    expect(contexts).toHaveLength(0);
    // several bounded steps, not one long task
    expect(q.drain()).toBeGreaterThan(5);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.count('convolver')).toBe(1);
    expect(engine.state).toBe('locked');
    expect(engine.playUi('click')).toBe(false);
    expect(contexts[0]!.resumeCalls).toBe(0);
    // the gesture only activates and resumes: no second context, no second graph
    expect(await engine.unlock()).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.count('convolver')).toBe(1);
    expect(contexts[0]!.resumeCalls).toBe(1);
    expect(engine.state).toBe('running');
    expect(engine.playUi('click')).toBe(true);
  });

  it('an unlock during preparation finishes the graph at once and later idle steps do nothing', async () => {
    const q = idleQueue();
    const { engine, contexts } = setup({ idle: q.idle });
    engine.prepare();
    q.runOne();
    q.runOne();
    expect(await engine.unlock()).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.count('convolver')).toBe(1);
    q.drain();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.count('convolver')).toBe(1);
  });

  it('the prepared graph is identical to one built inside the gesture (same random sequence)', async () => {
    const q = idleQueue();
    const prepared = setup({ idle: q.idle });
    prepared.engine.prepare();
    q.drain();
    await prepared.engine.unlock();
    const direct = setup();
    await direct.engine.unlock();
    const a = internalGraph(prepared.engine)!.noise;
    const b = internalGraph(direct.engine)!.noise;
    for (const color of ['white', 'pink', 'brown', 'crackle']) expect(a[color]!.getChannelData(0)).toEqual(b[color]!.getChannelData(0));
    const ir = (c: FakeAudioContext) => (c.nodes.find((n) => n.kind === 'convolver') as unknown as { buffer: { getChannelData(c: number): Float32Array } }).buffer;
    expect(ir(prepared.ctx()).getChannelData(1)).toEqual(ir(direct.ctx()).getChannelData(1));
  });

  it('dispose during preparation closes the prepared context', () => {
    const q = idleQueue();
    const { engine, contexts } = setup({ idle: q.idle });
    engine.prepare();
    q.runOne();
    engine.dispose();
    expect(contexts[0]!.state).toBe('closed');
    q.drain();
    expect(contexts).toHaveLength(1);
  });

  it('a failed early context creation leaves the decision to unlock', async () => {
    const q = idleQueue();
    let fail = true;
    const contexts: FakeAudioContext[] = [];
    const engine = new AudioEngine({
      createContext: () => {
        if (fail) throw new Error('not yet');
        const c = new FakeAudioContext('running');
        contexts.push(c);
        return c as unknown as AudioContext;
      },
      visibility: null,
      music: false,
      idle: q.idle,
    });
    engines.push(engine);
    engine.prepare();
    q.drain();
    expect(engine.state).toBe('locked');
    fail = false;
    expect(await engine.unlock()).toBe(true);
    expect(contexts).toHaveLength(1);
  });
});

describe('AudioEngine volume', () => {
  it('applies initial master volume on unlock (squared curve)', async () => {
    const { engine, ctx } = setup({ volumes: { master: 0.5 } });
    await engine.unlock();
    expect(masterNode(ctx()).gain.value).toBeCloseTo(0.25);
  });

  it('mute sets master gain to zero and unmute restores it', async () => {
    const { engine, ctx } = setup({ volumes: { master: 1 } });
    await engine.unlock();
    engine.setMuted(true);
    expect(masterNode(ctx()).gain.lastTarget).toBe(0);
    expect(engine.toggleMute()).toBe(false);
    expect(masterNode(ctx()).gain.lastTarget).toBe(1);
  });

  it('clamps volumes and keeps them when set before unlock', async () => {
    const { engine, ctx } = setup();
    engine.setVolumes({ master: 2, sfx: -1 });
    expect(engine.getVolumes()).toMatchObject({ master: 1, sfx: 0 });
    engine.setMuted(true);
    await engine.unlock();
    expect(masterNode(ctx()).gain.value).toBe(0);
  });
});

describe('AudioEngine sounds', () => {
  it('creates the engine loop lazily on first non-zero thrust', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const before = ctx().count('oscillator');
    engine.setThrust(0);
    expect(ctx().count('oscillator')).toBe(before);
    engine.setThrust({ main: 0.5, side: -1 });
    const after = ctx().count('oscillator');
    expect(after).toBeGreaterThan(before);
    // later frames create nothing more
    for (let i = 0; i < 10; i++) engine.setThrust(i / 10);
    expect(ctx().count('oscillator')).toBe(after);
  });

  it('restores thrust and laser requested before unlock', async () => {
    const { engine, ctx } = setup();
    engine.setThrust(0.8);
    engine.setMiningLaser({ active: true, resource: 'copper' });
    await engine.unlock();
    // engine (5 oscillators) + laser (5 oscillators)
    expect(ctx().count('oscillator')).toBeGreaterThanOrEqual(10);
  });

  it('rate-limits resource blips during continuous mining', async () => {
    const { engine, clock } = setup();
    await engine.unlock();
    let played = 0;
    for (let frame = 0; frame < 60; frame++) {
      clock.t += 1 / 60;
      if (engine.playResourceCollected('iron')) played++;
    }
    expect(played).toBeGreaterThan(5);
    expect(played).toBeLessThan(10);
  });

  it('alerts have a cooldown per kind', async () => {
    const { engine, clock } = setup();
    await engine.unlock();
    expect(engine.playAlert('cargoFull')).toBe(true);
    expect(engine.playAlert('cargoFull')).toBe(false);
    expect(engine.playAlert('outOfFuel')).toBe(true);
    clock.t += 3;
    expect(engine.playAlert('cargoFull')).toBe(true);
  });

  it('plays impacts, ignores zero intensity and pans when asked', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    expect(engine.playImpact(0)).toBe(false);
    expect(engine.playImpact(0.7, { pan: 1 })).toBe(true);
    expect(ctx().count('panner')).toBeGreaterThan(0);
  });

  it('plays combat sounds with distance gain, stereo pan and a per-sound rate limit (M3a)', async () => {
    const { engine, ctx, clock } = setup();
    expect(engine.playCombat('shot')).toBe(false);
    await engine.unlock();
    expect(engine.playCombat('shot', { pan: -0.5 })).toBe(true);
    expect(engine.playCombat('shot')).toBe(false);
    expect(engine.playCombat('explosionLarge', { gain: 0.6 })).toBe(true);
    expect(engine.playCombat('hit', { gain: 0 })).toBe(false);
    expect(ctx().count('panner')).toBeGreaterThan(0);
    clock.t += 0.1;
    expect(engine.playCombat('shot')).toBe(true);
  });

  it('several pirates spotting the player in the same step sound one alert (M23)', async () => {
    const { engine, clock } = setup();
    await engine.unlock();
    // three enemyAlert events in one simulation step -> a single alert
    expect([engine.playCombat('alert'), engine.playCombat('alert'), engine.playCombat('alert')]).toEqual([true, false, false]);
    clock.t += 1;
    expect(engine.playCombat('alert')).toBe(false);
    clock.t += 2;
    expect(engine.playCombat('alert')).toBe(true);
  });

  it('plays ui, dampers and dock sounds', async () => {
    const { engine, clock } = setup();
    await engine.unlock();
    expect(engine.playUi('hover')).toBe(true);
    expect(engine.playUi('hover')).toBe(false);
    clock.t += 0.1;
    expect(engine.playUi('hover')).toBe(true);
    expect(engine.playDampers(true)).toBe(true);
    expect(engine.playDampers(false)).toBe(true);
    expect(engine.playDock()).toBe(true);
    expect(engine.playUndock()).toBe(true);
  });

  it('ambient started before unlock starts after unlock and follows the ring', async () => {
    const { engine, ctx } = setup();
    engine.startAmbient(3);
    expect(engine.ambientState).toEqual({ running: true, ring: 3 });
    await engine.unlock();
    // a non-tonal bed: two noise loops, no pitched oscillators beyond slow LFOs
    expect(ctx().count('bufferSource')).toBeGreaterThanOrEqual(2);
    engine.setAmbientRing(4.2);
    expect(engine.ambientState.ring).toBe(4);
    engine.stopAmbient();
    expect(engine.ambientState.running).toBe(false);
  });

  it('createAnalyser returns null before unlock and a node after', async () => {
    const { engine } = setup();
    expect(engine.createAnalyser()).toBeNull();
    await engine.unlock();
    expect(engine.createAnalyser()).not.toBeNull();
  });
});

describe('AudioEngine music', () => {
  const manifest = {
    version: 1,
    tracks: [
      { id: 'menu', mood: 'menu', duration: 4, stems: [{ id: 'full', file: 'menu.ogg' }] },
      { id: 'calm', mood: 'calm', duration: 4, stems: [{ id: 'full', file: 'calm.ogg' }] },
    ],
  };

  function musicSetup() {
    const loads: string[] = [];
    const s = setup({
      music: {
        manifestUrl: '/m/manifest.json',
        loadManifest: () => Promise.resolve(manifest),
        load: (url) => {
          loads.push(url);
          return Promise.resolve({ duration: 4, length: 32000, numberOfChannels: 2, sampleRate: 8000 } as unknown as AudioBuffer);
        },
      },
      musicTickMs: 60_000,
    });
    return { ...s, loads };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('starts with the audio, takes the situation set before unlock and plays the menu theme', async () => {
    const { engine, loads } = musicSetup();
    engine.setMusicSituation({ screen: 'menu' });
    expect(engine.musicSystem).toBeNull();
    await engine.unlock();
    await flush();
    engine.musicSystem!.tick();
    await flush();
    expect(engine.musicSystem!.director.mood).toBe('menu');
    expect(loads).toEqual(['/m/menu.ogg']);
    engine.setMusicSituation({ screen: 'game' });
    engine.musicSystem!.tick();
    await flush();
    expect(engine.musicSystem!.director.trackId).toBe('calm');
  });

  it('has its own volume and can be switched off', async () => {
    const { engine, ctx } = musicSetup();
    engine.setVolumes({ music: 0.5 });
    expect(engine.getVolumes().music).toBe(0.5);
    await engine.unlock();
    // the music channel: a gain fed into the master gain
    const master = masterNode(ctx());
    const channels = ctx().nodes.filter((n) => n instanceof FakeGain && n.connections.includes(master)) as FakeGain[];
    expect(channels.some((g) => Math.abs(g.gain.value - 0.25) < 1e-9)).toBe(true);
    const off = setup({ music: false });
    await off.engine.unlock();
    expect(off.engine.musicSystem).toBeNull();
  });

  it('inaudible music (volume 0 or muted) decodes nothing and sleeps; raising the volume wakes it', async () => {
    const { engine, loads } = musicSetup();
    engine.setVolumes({ master: 0 });
    engine.setMusicSituation({ screen: 'menu' });
    await engine.unlock();
    await flush();
    engine.musicSystem!.tick();
    await flush();
    expect(engine.musicSystem!.player.sleeping).toBe(true);
    expect(engine.musicSystem!.player.isPlaying('menu')).toBe(true);
    expect(loads).toEqual([]);
    engine.setVolumes({ master: 0.5 });
    expect(engine.musicSystem!.player.sleeping).toBe(false);
    // the wake-up runs in an idle moment (a timeout without requestIdleCallback)
    await new Promise((r) => setTimeout(r, 40));
    await flush();
    expect(loads).toEqual(['/m/menu.ogg']);
    engine.setMuted(true);
    engine.setVolumes({ music: 0 });
    engine.setMuted(false);
    // music still at 0: stays inaudible, the player falls asleep after its delay
    expect(engine.musicSystem!.player.sleeping).toBe(false);
  });

  it('important sounds duck the music', async () => {
    const { engine } = musicSetup();
    await engine.unlock();
    const duck = engine.musicSystem!.player as unknown as { duckGain: FakeGain };
    expect(engine.playAlert('cargoFull')).toBe(true);
    expect(duck.duckGain.gain.calls.some((c) => c.method === 'setTargetAtTime' && c.args[0]! < 0.6)).toBe(true);
  });
});

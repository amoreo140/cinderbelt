// Music lab (music-demo.html): every track of the manifest by mood, crossfades, combat intensity
// layers and a mood simulator that feeds the real MusicDirector. A dev page, not part of the game.
import { render } from 'preact';
import { useEffect, useId, useReducer, useState } from 'preact/hooks';
import { assetUrl } from '../render/assets/url';
import { Button, Heading, Lamp, litSegments, Panel, Segmented } from '../ui/theme';
import { AudioEngine, MUSIC_MANIFEST_URL } from './AudioEngine';
import { MUSIC_MOODS, type MusicMood, type MusicTrack } from './music/manifest';
import { MENU_SITUATION, type MusicSituation, OPEN_LOWPASS } from './music/musicDirector';
import './musicDemo.css';

const engine = new AudioEngine({ seed: 7, volumes: { master: 0.9, music: 0.8, ambient: 0.5 } });
engine.attachUnlock(window);
engine.setMusicSituation(MENU_SITUATION);

/**
 * A/B of the encodings: the original 80 kb/s renders are written by `python tools/music/build.py` into the
 * git-ignored tools/music/out/hq/, which only the dev server serves; the production build has no
 * reference set and hides the switch.
 */
const REFERENCE_MANIFEST_URL: string | null = import.meta.env.DEV ? `${import.meta.env.BASE_URL}tools/music/out/hq/manifest.json` : null;
type Variant = 'compressed' | 'original';

const MOOD_NAMES: Record<MusicMood, string> = {
  menu: 'Main menu',
  calm: 'Calm – mining, home belt',
  adventure: 'Adventure – outer rings',
  combat: 'Combat – pirates (intensity layers)',
  mystery: 'Forge-smiths – Echoes and ruins',
};

type Preset = 'menu' | 'calm' | 'adventure' | 'combat' | 'mystery' | 'docked' | 'paused' | 'death';

const GAME: MusicSituation = { ...MENU_SITUATION, screen: 'game', ring: 1, distanceFromHome: 400 };
function presetSituation(p: Preset, threat: number): MusicSituation {
  switch (p) {
    case 'menu':
      return MENU_SITUATION;
    case 'calm':
      return GAME;
    case 'adventure':
      return { ...GAME, ring: 2, distanceFromHome: 2200, speed: 30 };
    case 'combat':
      return { ...GAME, ring: 2, distanceFromHome: 2000, combatThreat: Math.max(0.06, threat) };
    case 'mystery':
      return { ...GAME, distanceFromHome: 950, nearMystery: true };
    case 'docked':
      return { ...GAME, docked: true, distanceFromHome: 0 };
    case 'paused':
      return { ...GAME, screen: 'paused' };
    case 'death':
      return { ...GAME, screen: 'overlay' };
  }
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'menu', label: 'Menu' },
  { id: 'calm', label: 'Home Belt' },
  { id: 'adventure', label: 'Ring 2' },
  { id: 'combat', label: 'Pirates' },
  { id: 'mystery', label: 'Echo' },
  { id: 'docked', label: 'Docked' },
  { id: 'paused', label: 'Pause' },
  { id: 'death', label: 'Death' },
];

const SEGMENTS = 24;

function Slider(p: { label: string; value: number; format: (v: number) => string; onChange: (v: number) => void; testId: string }) {
  const id = useId();
  const lit = litSegments(p.value, SEGMENTS);
  return (
    <div class="md-row">
      <label for={id}>{p.label}</label>
      <div class="af-slider">
        <div class="af-slider-track" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} class={i < lit ? 'is-on' : ''} />
          ))}
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p.value}
          data-testid={p.testId}
          onInput={(e) => p.onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <span class="md-value">{p.format(p.value)}</span>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Peak and RMS of the master output in dBFS. */
function useMeter(): { peak: number; rms: number } {
  const [level, setLevel] = useState({ peak: -96, rms: -96 });
  useEffect(() => {
    let analyser: AnalyserNode | null = null;
    let data: Float32Array<ArrayBuffer> | null = null;
    const id = setInterval(() => {
      analyser ??= engine.createAnalyser(2048);
      if (!analyser) return;
      data ??= new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      let sum = 0;
      for (const v of data) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      const db = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -96);
      setLevel({ peak: db(peak), rms: db(Math.sqrt(sum / data.length)) });
    }, 80);
    return () => clearInterval(id);
  }, []);
  return level;
}

function Meter({ db }: { db: number }) {
  const n = 30;
  const lit = Math.round(Math.max(0, Math.min(1, (db + 48) / 48)) * n);
  return (
    <div class="md-meter" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const at = -48 + (48 * (i + 1)) / n;
        const cls = i < lit ? `is-on${at > -1 ? ' is-bad' : at > -9 ? ' is-warn' : ''}` : '';
        return <span key={i} class={cls} />;
      })}
    </div>
  );
}

/** A layer's gain 0..1 as lit segments. */
function GainBar({ gain }: { gain: number }) {
  const n = 30;
  const lit = litSegments(gain, n);
  return (
    <div class="md-meter md-meter--gain" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={i < lit ? 'is-on' : ''} />
      ))}
    </div>
  );
}

/** Compressed (shipped) vs original encodings, switched in place at the same position. */
function Comparison() {
  const [variant, setVariant] = useState<Variant>('compressed');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!REFERENCE_MANIFEST_URL) return;
    fetch(REFERENCE_MANIFEST_URL, { cache: 'no-cache' }).then(
      (r) => setAvailable(r.ok && (r.headers.get('content-type') ?? '').includes('json')),
      () => setAvailable(false),
    );
  }, []);
  const music = engine.musicSystem;
  const now = music?.player.nowPlaying() ?? null;
  const choose = (v: Variant) => {
    if (!music || busy || v === variant || !REFERENCE_MANIFEST_URL) return;
    setBusy(true);
    void music.player.switchSource(v === 'original' ? REFERENCE_MANIFEST_URL : MUSIC_MANIFEST_URL).then((ok) => {
      if (ok) setVariant(v);
      setBusy(false);
    });
  };
  return (
    <Panel material="band" cut="md" class="md-panel" as="section" testId="md-compare">
      <Heading
        aside={
          REFERENCE_MANIFEST_URL && available ? (
            <Segmented
              label="Encoding"
              options={[
                { value: 'original' as Variant, label: 'Original' },
                { value: 'compressed' as Variant, label: 'Compressed' },
              ]}
              value={variant}
              onChange={choose}
            />
          ) : undefined
        }
      >
        Quality comparison
      </Heading>
      {!REFERENCE_MANIFEST_URL && <p class="md-hint">The comparison with the original is only available on the dev server (npm run dev).</p>}
      {REFERENCE_MANIFEST_URL && available === false && (
        <p class="md-hint">
          Reference files are missing - run <code>python tools/music/build.py --encode-only</code> (it writes them to tools/music/out/hq/).
        </p>
      )}
      {REFERENCE_MANIFEST_URL && available && (
        <p class="md-hint">
          Compressed (game): full mixes 56 kb/s, combat layers 48 kb/s. Original: 80 kb/s, layers 64/56/56 kb/s. Switching continues
          the playing track at the same position.
        </p>
      )}
      <dl class="md-kv">
        <dt>Listening to</dt>
        <dd data-testid="md-variant">{variant === 'original' ? 'the original (80 kb/s)' : 'the compressed version'}</dd>
        <dt>Playback</dt>
        <dd data-testid="md-playback">{now ? (now.streamed ? 'stream (<audio>), not decoded' : 'decoded in memory, seamless loop') : '–'}</dd>
        <dt>Decoded PCM</dt>
        <dd data-testid="md-decoded">{music ? mib(music.player.decodedBytes()) : '–'}</dd>
      </dl>
    </Panel>
  );
}

function TrackRow({ track, playing, position, onPlay, onStop }: { track: MusicTrack; playing: boolean; position: number; onPlay: () => void; onStop: () => void }) {
  const loopLen = track.loopEnd - track.loopStart;
  const pass = playing ? Math.floor(position / loopLen) + 1 : 0;
  return (
    <div class={`md-track af-cut2${playing ? ' is-on' : ''}`} data-testid={`track-${track.id}`}>
      <div>
        <div class="md-track-name">
          {playing && <Lamp state="info" />} {track.title}
        </div>
        <div class="md-track-meta">
          {track.key} · {track.bpm} BPM{track.meter ? ` · ${track.meter}` : ''} · {time(track.duration)} · {track.stems.length > 1 ? `${track.stems.length} layers` : 'full mix'}
        </div>
      </div>
      <div class="md-track-actions">
        <Button size="sm" variant={playing ? 'secondary' : 'primary'} onClick={onPlay} testId={`play-${track.id}`}>
          {playing ? 'From the start' : 'Crossfade to this'}
        </Button>
        {playing && (
          <Button size="sm" variant="ghost" onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      {playing && (
        <>
          <div class="md-progress">
            <span style={{ width: `${((position % loopLen) / loopLen) * 100}%` }} />
          </div>
          <div class="md-progress-time">
            {time(position % loopLen)} / {time(loopLen)} · loop pass {pass}
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [volumes, setVolumes] = useState(engine.getVolumes());
  const [fade, setFade] = useState<number>(3);
  const [preset, setPreset] = useState<Preset>('menu');
  const [threat, setThreat] = useState(0.5);
  const [ambience, setAmbience] = useState(false);
  const meter = useMeter();

  useEffect(() => {
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, []);

  const music = engine.musicSystem;
  const manifest = music?.player.manifest ?? null;
  const now = music?.player.nowPlaying() ?? null;
  const auto = music?.auto ?? true;
  const director = music?.director;
  const ctxTime = engine.context?.currentTime ?? 0;

  const vol = (key: 'master' | 'music' | 'ambient') => (v: number) => {
    engine.setVolumes({ [key]: v });
    setVolumes(engine.getVolumes());
  };

  const playTrack = (track: MusicTrack) => {
    if (!music) return;
    music.setAuto(false);
    // by hand: full level and no muffling, whatever the simulator left behind
    music.player.setLevel(1, OPEN_LOWPASS, 0.3);
    if (music.player.isPlaying(track.id)) music.player.stop(0.3);
    music.player.play(track.id, fade);
  };

  const choose = (p: Preset) => {
    setPreset(p);
    engine.setMusicSituation(presetSituation(p, threat));
    music?.setAuto(true);
  };

  const setIntensity = (v: number) => {
    setThreat(v);
    if (auto) {
      if (preset === 'combat') engine.setMusicSituation(presetSituation('combat', v));
    } else music?.player.setIntensity(v);
  };

  const state = engine.state;
  return (
    <div class="md af-root">
      <div class="md-bg" style={{ backgroundImage: `url(${assetUrl('assets/skybox/ring1_bg.webp')})` }} />
      <header class="md-head">
        <img class="md-logo" src={assetUrl('assets/ui/logo_small.png')} alt="Cinderbelt" />
        <div>
          <h1 class="md-title">Music lab</h1>
          <p class="md-sub">
            Every track of the manifest by mood, crossfades, combat intensity layers and a situation simulator that drives the real
            music director from the game.
          </p>
        </div>
        <div class="md-status" data-testid="md-status">
          <Lamp state={state === 'running' ? 'ok' : 'warn'} />
          {state === 'running' ? 'Audio running' : 'Audio is locked - click anywhere'}
        </div>
      </header>

      <div class="md-grid">
        <Panel material="band" cut="lg" trim="top" class="md-panel" as="section" testId="md-tracks">
          <Heading aside={<Segmented label="Crossfade" options={[{ value: 0.5, label: '0.5 s' }, { value: 3, label: '3 s' }, { value: 6, label: '6 s' }]} value={fade} onChange={setFade} />}>
            Tracks
          </Heading>
          {!music && <p class="md-hint">Click anywhere - the browser only plays audio after a gesture.</p>}
          {music && !manifest && <p class="md-hint">Loading the manifest (public/assets/music/manifest.json)...</p>}
          {manifest && manifest.tracks.length === 0 && <p class="md-hint">The manifest contains no tracks.</p>}
          {manifest &&
            MUSIC_MOODS.map((mood) => {
              const tracks = manifest.tracks.filter((t) => t.mood === mood);
              if (tracks.length === 0) return null;
              return (
                <div class="md-mood" key={mood}>
                  <div class="af-label">{MOOD_NAMES[mood]}</div>
                  {tracks.map((t) => (
                    <TrackRow
                      key={t.id}
                      track={t}
                      playing={now?.track.id === t.id}
                      position={now?.track.id === t.id ? now.position : 0}
                      onPlay={() => playTrack(t)}
                      onStop={() => music?.player.stop(fade)}
                    />
                  ))}
                </div>
              );
            })}
        </Panel>

        <div class="md-col">
          <Comparison />

          <Panel material="band" cut="md" class="md-panel" as="section">
            <Heading>Output</Heading>
            <div class="md-rows">
              <div class="md-row">
                <span>Level</span>
                <Meter db={meter.peak} />
                <span class="md-value" data-testid="md-peak">{meter.peak > -90 ? `${meter.peak.toFixed(1)} dB` : '–'}</span>
              </div>
              <div class="md-row">
                <span>RMS</span>
                <Meter db={meter.rms} />
                <span class="md-value">{meter.rms > -90 ? `${meter.rms.toFixed(1)} dB` : '–'}</span>
              </div>
              <Slider label="Master" value={volumes.master} format={pct} onChange={vol('master')} testId="md-vol-master" />
              <Slider label="Music" value={volumes.music} format={pct} onChange={vol('music')} testId="md-vol-music" />
              <Slider label="Space ambience" value={volumes.ambient} format={pct} onChange={vol('ambient')} testId="md-vol-ambient" />
            </div>
            <div class="md-buttons">
              <Button
                size="sm"
                variant={ambience ? 'secondary' : 'ghost'}
                onClick={() => {
                  if (ambience) engine.stopAmbient();
                  else engine.startAmbient();
                  setAmbience(!ambience);
                }}
              >
                {ambience ? 'Turn space ambience off' : 'Turn space ambience on'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => engine.duckMusic(6, 0.3)}>
                Ducking test (-6 dB)
              </Button>
            </div>
          </Panel>

          <Panel material="band" cut="md" class="md-panel" as="section" testId="md-intensity">
            <Heading>Combat intensity</Heading>
            <Slider label="Threat" value={threat} format={(v) => v.toFixed(2)} onChange={setIntensity} testId="md-threat" />
            {music &&
              music.player.stemLevels().map((s) => (
                <div class="md-stem" key={s.id}>
                  <span>{s.id}</span>
                  <GainBar gain={s.gain} />
                  <span class="md-value">{pct(s.gain)}</span>
                </div>
              ))}
            <p class="md-hint">
              The combat track's layers are added by threat (the base always, the others from their own threshold). In director mode the
              threat is smoothed - up fast, down slowly.
            </p>
          </Panel>

          <Panel material="band" cut="md" class="md-panel" as="section" testId="md-director">
            <Heading aside={<Lamp state={auto ? 'ok' : 'off'} label={auto ? 'director' : 'manual'} />}>Situation simulator</Heading>
            <div class="md-buttons">
              {PRESETS.map((p) => (
                <Button key={p.id} size="sm" variant={auto && preset === p.id ? 'primary' : 'secondary'} onClick={() => choose(p.id)} testId={`preset-${p.id}`}>
                  {p.label}
                </Button>
              ))}
            </div>
            <dl class="md-kv" style={{ marginTop: '0.75rem' }}>
              <dt>Mode</dt>
              <dd>{auto ? 'the director decides' : 'manual playback'}</dd>
              <dt>Mood</dt>
              <dd data-testid="md-mood">{director?.mood ?? '–'}</dd>
              <dt>Track</dt>
              <dd>{director?.trackId ?? '–'}</dd>
              <dt>Phase</dt>
              <dd>
                {director?.phase ?? '–'}
                {director?.phase === 'gap' ? ` (next in ${Math.ceil(director.gapRemaining(ctxTime) ?? 0)} s)` : ''}
              </dd>
              <dt>Intensity</dt>
              <dd>{(director?.intensity ?? 0).toFixed(2)}</dd>
            </dl>
            <ul class="md-log">
              {[...(music?.log ?? [])].reverse().map((e, i) => (
                <li key={i}>
                  {e.at.toFixed(1)} s · {e.cmd.type}
                  {e.cmd.type === 'play' ? ` ${e.cmd.trackId} (${e.cmd.fade} s)` : ''}
                  {e.cmd.type === 'stop' ? ` (${e.cmd.fade} s)` : ''}
                  {e.cmd.type === 'level' ? ` ${Math.round(e.cmd.gain * 100)} %, ${e.cmd.lowpassHz} Hz` : ''}
                </li>
              ))}
            </ul>
            <p class="md-hint">
              Combat kicks in at once and ends 9 s after the threat; ring 2 must last 6 s; an Echo 1.5 s. Calm, adventure and mystery
              tracks play once, then there are 20-60 s of silence.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('music-demo')!);

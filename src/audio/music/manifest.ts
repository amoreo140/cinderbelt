// Music manifest (public/assets/music/manifest.json): the pre-rendered tracks, their mood, loop points
// and stems. Pure parsing and validation – a malformed entry is skipped, a broken file means no music.

export type MusicMood = 'menu' | 'calm' | 'adventure' | 'combat' | 'mystery';
export const MUSIC_MOODS: readonly MusicMood[] = ['menu', 'calm', 'adventure', 'combat', 'mystery'];
/** Moods whose tracks loop seamlessly for as long as the mood lasts; the others play once. */
export const LOOPING_MOODS: ReadonlySet<MusicMood> = new Set<MusicMood>(['menu', 'combat']);

export interface MusicStem {
  id: string;
  /** Path relative to the manifest's folder. */
  file: string;
  /** Intensity (0..1) at which the stem starts to fade in; 0 = always on. */
  minIntensity: number;
}

export interface MusicTrack {
  id: string;
  title: string;
  mood: MusicMood;
  bpm: number;
  key: string;
  /** Time signature, e.g. "4/4" or "6/8" ('' when unknown). */
  meter: string;
  /** Seconds. */
  duration: number;
  /**
   * Loop points (s). A file may run past loopEnd: that tail is the audio that follows loopEnd (the loop
   * start again), encoded so the codec sees the seam; the player blends it into the loop start.
   */
  loopStart: number;
  loopEnd: number;
  /** Loops seamlessly in the game (decoded whole); false = played once (the player may stream it). */
  loop: boolean;
  /** Linear trim of the whole track. */
  gain: number;
  /** Sample-aligned layers of equal length; their sum is the full mix. */
  stems: MusicStem[];
}

export interface MusicManifest {
  version: number;
  tracks: MusicTrack[];
}

/** Over how much intensity a stem fades in above its `minIntensity`. */
export const STEM_FADE_SPAN = 0.15;

/** Gain 0..1 of a stem at the given intensity (smooth ramp over [min, min + span]). */
export function stemGain(stem: Pick<MusicStem, 'minIntensity'>, intensity: number): number {
  if (stem.minIntensity <= 0) return 1;
  const x = (intensity - stem.minIntensity) / STEM_FADE_SPAN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseStem(raw: unknown): MusicStem | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const file = str(raw.file);
  if (!id || !file || file.includes('..')) return null;
  const minIntensity = Math.min(1, Math.max(0, num(raw.minIntensity) ?? 0));
  return { id, file, minIntensity };
}

function parseTrack(raw: unknown): MusicTrack | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const mood = raw.mood as MusicMood;
  const duration = num(raw.duration);
  if (!id || !MUSIC_MOODS.includes(mood) || duration === null || duration <= 0) return null;
  const stems = Array.isArray(raw.stems) ? raw.stems.map(parseStem).filter((s): s is MusicStem => s !== null) : [];
  if (stems.length === 0) return null;
  let loopStart = num(raw.loopStart) ?? 0;
  let loopEnd = num(raw.loopEnd) ?? duration;
  if (loopStart < 0 || loopEnd > duration + 0.01 || loopEnd - loopStart < 1) {
    loopStart = 0;
    loopEnd = duration;
  }
  return {
    id,
    title: str(raw.title) ?? id,
    mood,
    bpm: num(raw.bpm) ?? 0,
    key: str(raw.key) ?? '',
    meter: str(raw.meter) ?? '',
    duration,
    loopStart,
    loopEnd: Math.min(loopEnd, duration),
    loop: typeof raw.loop === 'boolean' ? raw.loop : LOOPING_MOODS.has(mood),
    gain: Math.min(2, Math.max(0, num(raw.gain) ?? 1)),
    // the always-on base first, then the layers in order of intensity
    stems: [...stems].sort((a, b) => a.minIntensity - b.minIntensity),
  };
}

/** Parses a manifest; null when it is not one. Invalid tracks are dropped, duplicate ids keep the first. */
export function parseMusicManifest(raw: unknown): MusicManifest | null {
  if (!isObj(raw) || !Array.isArray(raw.tracks)) return null;
  const seen = new Set<string>();
  const tracks: MusicTrack[] = [];
  for (const t of raw.tracks) {
    const track = parseTrack(t);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    tracks.push(track);
  }
  return { version: num(raw.version) ?? 1, tracks };
}

/** URL of a stem file next to the manifest. */
export function resolveMusicUrl(manifestUrl: string, file: string): string {
  const slash = manifestUrl.lastIndexOf('/');
  return (slash >= 0 ? manifestUrl.slice(0, slash + 1) : '') + file;
}

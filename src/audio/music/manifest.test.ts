import { describe, expect, it } from 'vitest';
import { parseMusicManifest, resolveMusicUrl, STEM_FADE_SPAN, stemGain } from './manifest';

const track = (over: Record<string, unknown> = {}) => ({
  id: 'calm-home-belt',
  title: 'Home Belt',
  mood: 'calm',
  bpm: 84,
  key: 'D major',
  meter: '4/4',
  duration: 137.14,
  loopStart: 0,
  loopEnd: 137.14,
  gain: 1,
  stems: [{ id: 'full', file: 'calm-home-belt.opus', minIntensity: 0 }],
  ...over,
});

describe('parseMusicManifest', () => {
  it('reads a valid manifest', () => {
    const m = parseMusicManifest({ version: 1, sampleRate: 44100, tracks: [track({ loop: false })] });
    expect(m).toEqual({ version: 1, tracks: [track({ loop: false })] });
  });

  it('a track loops when the manifest says so, else by its mood (menu and combat loop)', () => {
    const m = parseMusicManifest({
      tracks: [track({ id: 'a' }), track({ id: 'b', mood: 'combat' }), track({ id: 'c', mood: 'menu', loop: false }), track({ id: 'd', loop: true })],
    });
    expect(m!.tracks.map((t) => t.loop)).toEqual([false, true, false, true]);
  });

  it('is null for something that is not a manifest', () => {
    expect(parseMusicManifest(null)).toBeNull();
    expect(parseMusicManifest('x')).toBeNull();
    expect(parseMusicManifest({ tracks: 'nope' })).toBeNull();
  });

  it('drops invalid tracks and duplicate ids, keeps the rest', () => {
    const m = parseMusicManifest({
      tracks: [
        track(),
        track(),
        track({ id: 'bad-mood', mood: 'party' }),
        track({ id: 'no-stems', stems: [] }),
        track({ id: 'bad-duration', duration: -1 }),
        track({ id: 'escape', stems: [{ id: 'x', file: '../secret.opus' }] }),
        42,
      ],
    });
    expect(m!.tracks.map((t) => t.id)).toEqual(['calm-home-belt']);
  });

  it('repairs loop points and fills defaults', () => {
    const m = parseMusicManifest({
      tracks: [{ id: 'a', mood: 'combat', duration: 60, loopEnd: 999, gain: 7, stems: [{ id: 'lead', file: 'l.opus', minIntensity: 0.7 }, { id: 'base', file: 'b.opus' }] }],
    });
    const t = m!.tracks[0]!;
    expect([t.loopStart, t.loopEnd]).toEqual([0, 60]);
    expect(t.gain).toBe(2);
    expect(t.title).toBe('a');
    // the always-on base comes first
    expect(t.stems.map((s) => s.id)).toEqual(['base', 'lead']);
  });
});

describe('stemGain', () => {
  it('base stems are always on, layers ramp smoothly above their threshold', () => {
    expect(stemGain({ minIntensity: 0 }, 0)).toBe(1);
    const lead = { minIntensity: 0.65 };
    expect(stemGain(lead, 0.6)).toBe(0);
    expect(stemGain(lead, 0.65)).toBe(0);
    expect(stemGain(lead, 0.65 + STEM_FADE_SPAN / 2)).toBeCloseTo(0.5);
    expect(stemGain(lead, 0.65 + STEM_FADE_SPAN)).toBe(1);
    expect(stemGain(lead, 1)).toBe(1);
  });
});

describe('resolveMusicUrl', () => {
  it('resolves next to the manifest', () => {
    expect(resolveMusicUrl('/assets/music/manifest.json', 'a.opus')).toBe('/assets/music/a.opus');
    expect(resolveMusicUrl('manifest.json', 'a.opus')).toBe('a.opus');
  });
});

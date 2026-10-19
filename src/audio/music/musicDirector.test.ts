import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../math';
import {
  type DirectorTrack,
  MENU_SITUATION,
  type MusicCommand,
  MusicDirector,
  MUSIC_LEVELS,
  MUSIC_TIMING,
  type MusicSituation,
} from './musicDirector';

const TRACKS: DirectorTrack[] = [
  { id: 'menu', mood: 'menu', duration: 120 },
  { id: 'calm-a', mood: 'calm', duration: 150 },
  { id: 'calm-b', mood: 'calm', duration: 140 },
  { id: 'calm-c', mood: 'calm', duration: 130 },
  { id: 'adv-a', mood: 'adventure', duration: 120 },
  { id: 'adv-b', mood: 'adventure', duration: 110 },
  { id: 'combat', mood: 'combat', duration: 70 },
  { id: 'myst', mood: 'mystery', duration: 100 },
];

const GAME: MusicSituation = { ...MENU_SITUATION, screen: 'game' };

/** Runs the director at a fixed step and collects the commands with their time. */
function run(director: MusicDirector, from: number, to: number, situation: MusicSituation | ((t: number) => MusicSituation), step = 0.25) {
  const out: { t: number; cmd: MusicCommand }[] = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    const s = typeof situation === 'function' ? situation(t) : situation;
    for (const cmd of director.update(s, t)) out.push({ t, cmd });
  }
  return out;
}

const plays = (log: { t: number; cmd: MusicCommand }[]) =>
  log.filter((e) => e.cmd.type === 'play').map((e) => ({ t: e.t, ...(e.cmd as Extract<MusicCommand, { type: 'play' }>) }));

describe('MusicDirector moods', () => {
  it('plays the menu theme in the menu and calm music in the home belt', () => {
    const d = new MusicDirector(TRACKS, mulberry32(1));
    expect(plays(run(d, 0, 1, MENU_SITUATION))).toEqual([{ t: 0, type: 'play', trackId: 'menu', fade: MUSIC_TIMING.menuFade }]);
    const log = run(d, 1.25, 3, GAME);
    expect(d.mood).toBe('calm');
    expect(plays(log)[0]!.trackId).toMatch(/^calm-/);
    expect(plays(log)[0]!.fade).toBe(MUSIC_TIMING.menuFade);
  });

  it('switches to adventure only after the outer ring holds for a while', () => {
    const d = new MusicDirector(TRACKS, mulberry32(2));
    run(d, 0, 5, GAME);
    expect(d.mood).toBe('calm');
    const outer = { ...GAME, ring: 2, distanceFromHome: 1700 };
    run(d, 5.25, 5 + MUSIC_TIMING.exploreHold - 1, outer);
    expect(d.mood).toBe('calm');
    const log = run(d, 5 + MUSIC_TIMING.exploreHold - 0.75, 5 + MUSIC_TIMING.exploreHold + 1, outer);
    expect(d.mood).toBe('adventure');
    expect(plays(log)[0]).toMatchObject({ fade: MUSIC_TIMING.fade });
    expect(plays(log)[0]!.trackId).toMatch(/^adv-/);
  });

  it('a Guarded sector of depth 2 is no frontier: the music stays calm', () => {
    const d = new MusicDirector(TRACKS, mulberry32(2));
    run(d, 0, 5, GAME);
    run(d, 5.25, 5 + MUSIC_TIMING.exploreHold + 2, { ...GAME, ring: 2, frontier: false, distanceFromHome: 1700 });
    expect(d.mood).toBe('calm');
    run(d, 5 + MUSIC_TIMING.exploreHold + 2.25, 5 + 2 * MUSIC_TIMING.exploreHold + 4, { ...GAME, ring: 2, frontier: true, distanceFromHome: 1800 });
    expect(d.mood).toBe('adventure');
  });

  it('a short dip back over the ring border does not flip the music', () => {
    const d = new MusicDirector(TRACKS, mulberry32(3));
    const outer = { ...GAME, ring: 2, distanceFromHome: 1700 };
    run(d, 0, 1, outer);
    expect(d.mood).toBe('adventure');
    run(d, 1.25, 4, { ...GAME, ring: 1, distanceFromHome: 1450 });
    run(d, 4.25, 20, outer);
    expect(d.mood).toBe('adventure');
  });

  it('sustained fast travel away from home counts as an adventure even in the home belt', () => {
    const d = new MusicDirector(TRACKS, mulberry32(4));
    const travel = { ...GAME, ring: 1, distanceFromHome: 900, speed: 40 };
    run(d, 0, MUSIC_TIMING.travelTime - 1, travel);
    expect(d.mood).toBe('calm');
    run(d, MUSIC_TIMING.travelTime - 0.75, MUSIC_TIMING.travelTime + MUSIC_TIMING.exploreHold + 1, travel);
    expect(d.mood).toBe('adventure');
  });

  it('combat starts at once with a short fade and ends only after the threat stays gone', () => {
    const d = new MusicDirector(TRACKS, mulberry32(5));
    run(d, 0, 2, GAME);
    const fight = run(d, 2.25, 2.25, { ...GAME, combatThreat: 0.5 });
    expect(d.mood).toBe('combat');
    expect(plays(fight)).toEqual([{ t: 2.25, type: 'play', trackId: 'combat', fade: MUSIC_TIMING.combatFadeIn }]);
    // the first intensity jumps straight to the threat, before the play
    expect(fight[0]!.cmd).toEqual({ type: 'intensity', value: 0.5 });
    // threat gone: combat holds…
    run(d, 2.5, 2.25 + MUSIC_TIMING.combatHold - 0.5, GAME);
    expect(d.mood).toBe('combat');
    // …and then returns to calm with the long fade
    const after = run(d, 2.25 + MUSIC_TIMING.combatHold, 2.25 + MUSIC_TIMING.combatHold + 1, GAME);
    expect(d.mood).toBe('calm');
    expect(plays(after)[0]).toMatchObject({ fade: MUSIC_TIMING.combatFadeOut });
  });

  it('mystery near a heard Echo after a moment, and it lingers a little after leaving', () => {
    const d = new MusicDirector(TRACKS, mulberry32(6));
    run(d, 0, 2, GAME);
    const near = { ...GAME, nearMystery: true };
    run(d, 2.25, 2.25 + MUSIC_TIMING.mysteryEnter - 0.5, near);
    expect(d.mood).toBe('calm');
    run(d, 2.25 + MUSIC_TIMING.mysteryEnter, 10, near);
    expect(d.mood).toBe('mystery');
    expect(d.trackId).toBe('myst');
    run(d, 10.25, 10 + MUSIC_TIMING.mysteryHold - 1, GAME);
    expect(d.mood).toBe('mystery');
    run(d, 10 + MUSIC_TIMING.mysteryHold, 10 + MUSIC_TIMING.mysteryHold + 1, GAME);
    expect(d.mood).toBe('calm');
  });

  it('combat wins over mystery; docking settles to calm', () => {
    const d = new MusicDirector(TRACKS, mulberry32(7));
    run(d, 0, 5, { ...GAME, nearMystery: true });
    expect(d.mood).toBe('mystery');
    run(d, 5.25, 6, { ...GAME, nearMystery: true, combatThreat: 0.3 });
    expect(d.mood).toBe('combat');
    run(d, 6.25, 7, { ...GAME, docked: true, ring: 2 });
    expect(d.mood).toBe('calm');
  });
});

describe('MusicDirector tracks', () => {
  it('play-once moods fade out at the end of the track, wait in a quiet gap, then play a different track', () => {
    const d = new MusicDirector(TRACKS, mulberry32(8));
    const log = run(d, 0, 600, GAME, 0.5);
    const p = plays(log);
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.trackId).not.toBe(p[i - 1]!.trackId);
      expect(p[i]!.trackId).toMatch(/^calm-/);
    }
    // the first track stops (fade over its end) and the next one starts after a gap of 20–60 s
    const first = TRACKS.find((t) => t.id === p[0]!.trackId)!;
    const stop = log.find((e) => e.cmd.type === 'stop')!;
    expect(stop.t).toBeCloseTo(p[0]!.t + first.duration - MUSIC_TIMING.endFade, 0);
    expect(stop.cmd).toEqual({ type: 'stop', fade: MUSIC_TIMING.endFade });
    const gap = p[1]!.t - stop.t;
    expect(gap).toBeGreaterThanOrEqual(MUSIC_TIMING.endFade + MUSIC_TIMING.gapMin - 0.5);
    expect(gap).toBeLessThanOrEqual(MUSIC_TIMING.endFade + MUSIC_TIMING.gapMax + 0.5);
  });

  it('reports the gap', () => {
    const d = new MusicDirector([{ id: 'only', mood: 'calm', duration: 30 }], () => 0);
    run(d, 0, 30, GAME);
    expect(d.phase).toBe('gap');
    expect(d.gapRemaining(30)).toBeGreaterThan(0);
  });

  it('a mood change during the gap starts the new mood at once', () => {
    const d = new MusicDirector(TRACKS, mulberry32(9));
    run(d, 0, 160, GAME);
    expect(d.phase).toBe('gap');
    const log = run(d, 160.25, 160.5, { ...GAME, combatThreat: 0.4 });
    expect(plays(log).map((x) => x.trackId)).toEqual(['combat']);
  });

  it('combat and menu loop: no stop while the mood lasts', () => {
    const d = new MusicDirector(TRACKS, mulberry32(10));
    const log = run(d, 0, 400, { ...GAME, combatThreat: 0.6 }, 0.5);
    expect(plays(log)).toHaveLength(1);
    expect(log.some((e) => e.cmd.type === 'stop')).toBe(false);
  });

  it('never repeats a track back to back, also across mood changes', () => {
    const d = new MusicDirector(TRACKS, mulberry32(11));
    const sequence: string[] = [];
    let t = 0;
    for (let round = 0; round < 12; round++) {
      for (const cmd of d.update(GAME, t)) if (cmd.type === 'play') sequence.push(cmd.trackId);
      t += 1;
      for (const s of [{ ...GAME, combatThreat: 0.5 }, GAME]) {
        for (let k = 0; k < 15; k++, t += 1) for (const cmd of d.update(s, t)) if (cmd.type === 'play') sequence.push(cmd.trackId);
      }
    }
    const calm = sequence.filter((id) => id.startsWith('calm'));
    expect(calm.length).toBeGreaterThan(5);
    for (let i = 1; i < calm.length; i++) expect(calm[i]).not.toBe(calm[i - 1]);
    for (let i = 1; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 1]);
  });

  it('is deterministic for the same random source', () => {
    const a = run(new MusicDirector(TRACKS, mulberry32(42)), 0, 500, GAME, 1);
    const b = run(new MusicDirector(TRACKS, mulberry32(42)), 0, 500, GAME, 1);
    expect(a).toEqual(b);
  });

  it('falls back to another mood when one has no tracks, and waits for a catalogue', () => {
    const d = new MusicDirector([], mulberry32(12));
    expect(plays(run(d, 0, 3, MENU_SITUATION))).toEqual([]);
    d.setTracks(TRACKS.filter((t) => t.mood === 'calm'));
    const log = run(d, 3.25, 4, MENU_SITUATION);
    expect(plays(log)[0]!.trackId).toMatch(/^calm-/);
  });

  it('pause and the death card freeze the mood (no switch to combat while paused)', () => {
    const d = new MusicDirector(TRACKS, mulberry32(13));
    run(d, 0, 2, GAME);
    run(d, 2.25, 5, { ...GAME, screen: 'paused', combatThreat: 1 });
    expect(d.mood).toBe('calm');
  });
});

describe('MusicDirector intensity and level', () => {
  it('intensity rises fast and falls slowly, with a floor while combat plays', () => {
    const d = new MusicDirector(TRACKS, mulberry32(14));
    run(d, 0, 1, GAME);
    run(d, 1.25, 1.25, { ...GAME, combatThreat: 0.2 });
    expect(d.intensity).toBeCloseTo(0.2);
    run(d, 1.5, 3, { ...GAME, combatThreat: 1 });
    expect(d.intensity).toBeGreaterThan(0.9);
    run(d, 3.25, 5, { ...GAME, combatThreat: 0.05 });
    const after2s = d.intensity;
    expect(after2s).toBeGreaterThan(0.5);
    run(d, 5.25, 7, { ...GAME, combatThreat: 0.05 });
    expect(d.intensity).toBeLessThan(after2s);
    expect(d.intensity).toBeGreaterThanOrEqual(MUSIC_TIMING.combatFloor - 1e-9);
  });

  it('sends intensity only when it changes noticeably', () => {
    const d = new MusicDirector(TRACKS, mulberry32(15));
    const log = run(d, 0, 30, { ...GAME, combatThreat: 0.5 }, 0.1);
    const sent = log.filter((e) => e.cmd.type === 'intensity');
    expect(sent.length).toBeLessThan(5);
  });

  it('docked is softer and muffled, pause dips more, the death card silences, the menu is open', () => {
    const d = new MusicDirector(TRACKS, mulberry32(16));
    const levels = (s: MusicSituation, t: number) => d.update(s, t).filter((c) => c.type === 'level');
    expect(levels(MENU_SITUATION, 0)).toEqual([{ type: 'level', ...MUSIC_LEVELS.open, seconds: 0 }]);
    expect(levels({ ...GAME, docked: true }, 1)).toEqual([{ type: 'level', ...MUSIC_LEVELS.docked, seconds: 2 }]);
    expect(levels({ ...GAME, docked: true }, 2)).toEqual([]);
    expect(levels({ ...GAME, screen: 'paused' }, 3)).toEqual([{ type: 'level', ...MUSIC_LEVELS.paused, seconds: 0.6 }]);
    expect(levels({ ...GAME, screen: 'overlay' }, 4)).toEqual([{ type: 'level', ...MUSIC_LEVELS.overlay, seconds: 0.6 }]);
    expect(levels(GAME, 5)).toEqual([{ type: 'level', ...MUSIC_LEVELS.open, seconds: 2 }]);
    expect(MUSIC_LEVELS.docked.gain).toBeLessThan(1);
    expect(MUSIC_LEVELS.paused.gain).toBeLessThan(MUSIC_LEVELS.docked.gain);
  });
});

describe('MusicDirector reset', () => {
  it('starts afresh after a reset (level and track sent again)', () => {
    const d = new MusicDirector(TRACKS, mulberry32(17));
    run(d, 0, 2, GAME);
    d.reset();
    expect(d.mood).toBeNull();
    const log = run(d, 2.25, 2.25, GAME);
    expect(log.map((e) => e.cmd.type)).toEqual(['level', 'intensity', 'play']);
  });
});

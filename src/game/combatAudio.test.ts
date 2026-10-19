import { describe, expect, it } from 'vitest';
import { combatCue, HEARING_RANGE, spatial } from './combatAudio';

const me = { x: 100, y: 50 };

describe('spatial', () => {
  it('is full volume and centred at the ship, silent at the hearing range', () => {
    expect(spatial(me, me)).toEqual({ gain: 1, pan: 0 });
    expect(spatial({ x: me.x + HEARING_RANGE, y: me.y }, me).gain).toBe(0);
    expect(spatial({ x: me.x + 20, y: me.y }, me).pan).toBeGreaterThan(0);
    expect(spatial({ x: me.x - 400, y: me.y }, me).pan).toBeCloseTo(-0.8);
  });
});

describe('combatCue', () => {
  it('maps combat events to sounds', () => {
    expect(combatCue({ type: 'shotFired', owner: 'player', pos: me, dir: { x: 1, y: 0 }, tier: 1 }, me)).toMatchObject({ kind: 'shot', gain: 1 });
    expect(combatCue({ type: 'shotFired', owner: 'pr:1', pos: me, dir: { x: 1, y: 0 }, tier: 1 }, me)?.kind).toBe('pirateShot');
    const hit = { type: 'projectileHit', owner: 'pr:1', ref: 'player', pos: me, damage: 6, from: me } as const;
    expect(combatCue({ ...hit, target: 'shield' }, me)?.kind).toBe('shieldHit');
    expect(combatCue({ ...hit, target: 'ship' }, me)).toMatchObject({ kind: 'hit', intensity: 1 });
    expect(combatCue({ type: 'shipDestroyed', ref: 'pr:1', kind: 'jackal', pos: me, vel: me, radius: 2 }, me)?.kind).toBe('explosionLarge');
    expect(combatCue({ type: 'partDestroyed', ref: 'pr:1', partId: 3, key: 'armor:1', pos: me }, me)?.kind).toBe('explosionSmall');
    expect(combatCue({ type: 'asteroidDepleted', id: 'a' }, me, () => 'ice')).toMatchObject({ kind: 'breakup', resource: 'ice' });
    // the ice cracking (M2d) sounds like a disintegrating ice rock
    const crack = { type: 'asteroidCracked' as const, id: 'b', pos: { x: 0, y: 0 }, radius: 1, fragments: [] };
    expect(combatCue(crack, me)).toMatchObject({ kind: 'breakup', resource: 'ice' });
    expect(combatCue({ type: 'enemyAlert', ref: 'pr:1', pos: me }, me)?.kind).toBe('alert');
    expect(combatCue({ type: 'cargoFull' }, me)).toBeNull();
  });
});

describe('M3.6 cues', () => {
  it('cuts, fortress parts and pirate alarms have sounds', () => {
    const me = { x: 0, y: 0 };
    expect(combatCue({ type: 'wreckCut', wreckId: 1, partId: 2, pos: me, pieces: [3], blast: 30 }, me)?.kind).toBe('explosionLarge');
    expect(combatCue({ type: 'wreckCut', wreckId: 1, partId: 2, pos: me, pieces: [3], blast: 0 }, me)?.kind).toBe('explosionSmall');
    expect(combatCue({ type: 'fortressDestroyed', fortress: 'fort:0', pos: me, credits: 1, first: true }, me)?.kind).toBe('explosionLarge');
    expect(combatCue({ type: 'tollDemanded', group: 'pr:1,1', amount: 100, until: 9, pos: me }, me)?.kind).toBe('alert');
  });
});

describe('M3.8 cues', () => {
  it('a lost part has its own sound, centred (it is our ship)', () => {
    const cue = combatCue({ type: 'partsLost', cause: 'impact', parts: [{ partId: 3, key: 'armor:1', detached: false }] }, { x: 50, y: 0 });
    expect(cue).toEqual({ kind: 'partLost', gain: 1, pan: 0 });
  });
});

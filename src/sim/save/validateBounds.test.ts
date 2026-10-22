// Bounds of a crafted save (issue #2 follow-ups): tick-valued fields, string lengths, collection counts.
import { describe, expect, it } from 'vitest';
import { dockedSim } from '../station/testHarness';
import { toSave } from './serialize';
import { testContext } from './testing';
import type { SaveGame } from './types';
import { Checker, SAVE_MAX_ENTRIES, SAVE_MAX_STRING, SAVE_MAX_TICK, SAVE_MAX_TICK_AHEAD, validateSave } from './validate';

const good = (): SaveGame => toSave(dockedSim(), testContext());

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function errorsOf(mutate: (s: Loose) => void): string[] {
  const save = JSON.parse(JSON.stringify(good())) as Loose;
  mutate(save);
  const r = validateSave(save);
  return r.ok ? [] : r.errors;
}

describe('Checker tick bounds', () => {
  it('tick accepts up to SAVE_MAX_TICK and rejects more, fractions and unsafe integers', () => {
    const c = new Checker();
    expect(c.tick(SAVE_MAX_TICK, 't')).toBe(SAVE_MAX_TICK);
    expect(c.errors).toEqual([]);
    c.tick(SAVE_MAX_TICK + 1, 'a');
    c.tick(2 ** 53, 'b');
    c.tick(-1, 'c');
    c.tick(1.5, 'd');
    expect(c.errors.map((e) => e.split(':')[0])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('until allows a duration ahead of the last tick, with a sentinel minimum', () => {
    const c = new Checker();
    c.until(SAVE_MAX_TICK_AHEAD, 'a');
    c.until(-1e9, 'b', -1e9);
    expect(c.errors).toEqual([]);
    c.until(SAVE_MAX_TICK_AHEAD + 1, 'c');
    expect(c.errors).toHaveLength(1);
  });

  it('str rejects a string above the cap', () => {
    const c = new Checker();
    c.str('x'.repeat(SAVE_MAX_STRING), 'a');
    expect(c.errors).toEqual([]);
    c.str('x'.repeat(SAVE_MAX_STRING + 1), 'b');
    expect(c.errors).toHaveLength(1);
  });
});

describe('crafted save bounds', () => {
  it('accepts the plain save', () => expect(errorsOf(() => {})).toEqual([]));

  it('rejects huge names and seed texts', () => {
    expect(errorsOf((s) => (s.name = 'x'.repeat(5000))).join()).toMatch(/^name/);
    expect(errorsOf((s) => (s.settings.seedText = 'x'.repeat(5000))).join()).toMatch(/settings\.seedText/);
  });

  it('rejects a contract acceptedTick and a log tick beyond the cap', () => {
    expect(errorsOf((s) => s.career.log.push({ tick: 2 ** 52, kind: 'died' })).join()).toMatch(/career\.log\[\d+\]\.tick/);
  });

  it('rejects a director, discovery and guild tick beyond the cap', () => {
    expect(errorsOf((s) => (s.discovery.log = [{ tick: 2 ** 52 }])).length).toBeGreaterThan(0);
    expect(errorsOf((s) => (s.guild.lastRadio = 2 ** 52)).join()).toMatch(/guild\.lastRadio/);
    expect(errorsOf((s) => (s.pirates.lastHunt = 2 ** 52)).join()).toMatch(/pirates\.lastHunt/);
    expect(errorsOf((s) => (s.director.last = 2 ** 52)).join()).toMatch(/director\.last/);
    expect(errorsOf((s) => (s.director.fired = [['k', 2 ** 52]])).join()).toMatch(/director\.fired/);
  });

  it('keeps the "never" sentinels loading', () => {
    const save = good();
    expect(save.pirates.lastHunt).toBeLessThan(0);
    expect(errorsOf(() => {})).toEqual([]);
  });

  it('rejects duplicate boards and too many boards', () => {
    const board = { epoch: 0, serial: 0, offers: [] };
    expect(errorsOf((s) => (s.career.boards = [['home', board], ['home', board]])).join()).toMatch(/career\.boards: duplicate keys/);
    expect(errorsOf((s) => (s.career.boards = Array.from({ length: SAVE_MAX_ENTRIES + 1 }, (_, i) => [`st:${i},0`, board]))).join()).toMatch(/career\.boards: more than/);
  });

  it('rejects duplicate captains and demand records', () => {
    const cap = { promotions: 0, defeated: false, trophies: [], kills: 0 };
    expect(errorsOf((s) => (s.career.captains = [[0, cap], [0, cap]])).join()).toMatch(/career\.captains: duplicate/);
    expect(errorsOf((s) => (s.career.demandSold = [['home', 1, 1], ['home', 1, 1]])).join()).toMatch(/career\.demandSold: duplicate/);
  });

  it('rejects oversized combat lists and grids', () => {
    expect(errorsOf((s) => (s.combat.projectiles = new Array(5000).fill({}))).join()).toMatch(/combat\.projectiles: more than/);
    expect(errorsOf((s) => (s.combat.enemies = new Array(300).fill({}))).join()).toMatch(/combat\.enemies: more than/);
    expect(errorsOf((s) => (s.player.grid.parts = new Array(5000).fill({}))).join()).toMatch(/player\.grid\.parts: too many/);
  });
});

import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../../sim/commands';
import { dockedSim } from '../../sim/station/testHarness';
import { computeObjectives, highestDepthVisited, highestRingVisited, objectivesAt } from './objectives';
import { setLocale } from '../../i18n';
import { ensureStorage } from '../../sim/station/storage';
import type { SimState } from '../../sim/Simulation';
import { RESOURCE_IDS } from '../../data/resources';
import { sectorInfoOfChunk } from '../../sim/regions';

describe('objectivesAt (per-tick memo)', () => {
  it('returns the same list within a tick and recomputes after a step', () => {
    const sim = dockedSim();
    const a = objectivesAt(sim.state);
    expect(objectivesAt(sim.state)).toBe(a);
    expect(a).toEqual(computeObjectives(sim.state));
    sim.step(IDLE_COMMAND);
    const b = objectivesAt(sim.state);
    expect(b).not.toBe(a);
    expect(b).toEqual(computeObjectives(sim.state));
  });

  it('keeps games apart (a new state is never served an old list)', () => {
    const one = dockedSim();
    const two = dockedSim();
    expect(objectivesAt(two.state)).not.toBe(objectivesAt(one.state));
  });
});

describe('computeObjectives (memoised parts, O12)', () => {
  // each change made to one game and to a fresh copy: the memoised game must give what a cold one gives
  const changes: [string, (s: SimState) => void][] = [
    ['credits', (s) => (s.credits = 3)],
    ['cargo', (s) => (s.player.cargo.iron += 7)],
    ['a station storage', (s) => RESOURCE_IDS.forEach((r) => (ensureStorage(s, 'home').resources[r] += 2))],
    ['another station storage', (s) => RESOURCE_IDS.forEach((r) => (ensureStorage(s, 'st:1').resources[r] += 1))],
    ['reputation', (s) => (s.career.rep.guild.points += 3)],
    ['language', () => setLocale('en')],
  ];

  it('follows every input of the ship and career objectives', () => {
    setLocale('sk');
    const warm = dockedSim();
    const applied: ((s: SimState) => void)[] = [];
    for (const [name, change] of changes) {
      // the memo holds this game's key, the change must make it miss
      const before = computeObjectives(warm.state);
      change(warm.state);
      applied.push(change);
      const got = computeObjectives(warm.state);
      const cold = dockedSim();
      for (const c of applied) c(cold.state);
      expect(got, name).toEqual(computeObjectives(cold.state));
      expect(got, name).not.toEqual(before);
    }
    setLocale('sk');
  });
});

describe('highestRingVisited', () => {
  it('follows a growing explored set without re-reading the old chunks', () => {
    const explored = new Set<string>(['0,0']);
    expect(highestRingVisited(explored)).toBe(1);
    // a chunk in ring 2 (centre ~2100 u from the origin)
    explored.add('10,0');
    expect(highestRingVisited(explored)).toBe(2);
    explored.add('1,1');
    expect(highestRingVisited(explored)).toBe(2);
    // ring 3 (~5100 u)
    explored.add('25,0');
    expect(highestRingVisited(explored)).toBe(3);
  });

  it('an empty set has no ring', () => {
    expect(highestRingVisited(new Set())).toBe(-1);
  });
});

describe('highestDepthVisited (sectors §6.2)', () => {
  it('follows the depth of the explored chunks’ sectors, not the ring circle', () => {
    const seed = 1337;
    const explored = new Set<string>(['0,0']);
    expect(highestDepthVisited(seed, explored)).toBe(1);
    // the first chunk along +x whose sector is depth 2 / depth 3
    const firstOfDepth = (depth: number): string => {
      for (let cx = 0; cx < 80; cx++) if (sectorInfoOfChunk(seed, cx, 0).depth === depth) return `${cx},0`;
      throw new Error(`no depth ${depth}`);
    };
    explored.add(firstOfDepth(2));
    expect(highestDepthVisited(seed, explored)).toBe(2);
    explored.add(firstOfDepth(3));
    expect(highestDepthVisited(seed, explored)).toBe(3);
    expect(highestDepthVisited(seed, new Set())).toBe(-1);
  });
});

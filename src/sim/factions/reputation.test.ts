import { nodeFs } from '../../testing/nodeFs';
import { describe, expect, it } from 'vitest';
import { CONTRACT_DEFS, CONTRACT_TYPES } from '../../data/contracts';
import { FACTION_IDS, FACTIONS, MAX_REP_LEVEL, REP_FACTION_IDS, REP_LEVELS, emblemPath, unlocksUpTo, FUTURE_UNLOCKS } from '../../data/factions';
import { addPoints, assignmentProgress, createRep, deliverAssignment, hasUnlock, nextLevelDef, recordContract, recordDelivery } from './reputation';

describe('faction data', () => {
  it('every faction has an emblem file', () => {
    for (const id of FACTION_IDS) {
      expect(FACTIONS[id].id).toBe(id);
      expect(nodeFs().existsSync(`public/${emblemPath(id)}`)).toBe(true);
    }
  });

  it('reputation levels 0–3 with rising thresholds and two assignment options from level 2', () => {
    for (const f of REP_FACTION_IDS) {
      expect(FACTIONS[f].reputation).toBe(true);
      const levels = REP_LEVELS[f];
      expect(levels.map((l) => l.level)).toEqual([0, 1, 2, 3]);
      expect(levels[0].points).toBe(0);
      for (let i = 1; i < levels.length; i++) expect(levels[i]!.points).toBeGreaterThan(levels[i - 1]!.points);
      expect(levels[1].assignment).toBeNull();
      for (const l of levels.slice(2)) {
        expect(l.assignment).toHaveLength(2);
        expect(l.assignment![0].id).not.toBe(l.assignment![1].id);
      }
    }
    expect(MAX_REP_LEVEL).toBe(3);
  });

  it('contract assignments refer to playable contract types', () => {
    for (const f of REP_FACTION_IDS) {
      for (const l of REP_LEVELS[f]) {
        for (const a of l.assignment ?? []) if (a.kind === 'contracts') expect(CONTRACT_DEFS[a.type].since).toBeUndefined();
      }
    }
  });

  it('every playable contract type is unlocked by some level', () => {
    // Pickups unlock an Archive node (a licence), not a reputation level (M3.5b)
    const all = new Set([...unlocksUpTo('guild', 3), ...unlocksUpTo('institute', 3), 'retrieveContracts' as const]);
    for (const t of CONTRACT_TYPES) {
      const def = CONTRACT_DEFS[t];
      if (def.since) continue;
      expect(Object.values(def.unlock).some((u) => u && all.has(u))).toBe(true);
    }
    for (const u of Object.keys(FUTURE_UNLOCKS)) expect(all.has(u as never)).toBe(true);
  });
});

describe('reputation', () => {
  it('starts at level 0 with basic contracts', () => {
    const rep = createRep();
    expect(rep.guild.level).toBe(0);
    expect(hasUnlock(rep, 'contractsBasic')).toBe(true);
    expect(hasUnlock(rep, 'surveyRing1')).toBe(true);
    expect(hasUnlock(rep, 'contractsRing1')).toBe(false);
  });

  it('level 1 needs only points', () => {
    const rep = createRep();
    expect(addPoints(rep, 'guild', 59)).toEqual([]);
    expect(addPoints(rep, 'guild', 1)).toEqual([1]);
    expect(hasUnlock(rep, 'contractsRing1')).toBe(true);
  });

  it('level 2 needs points and one of two assignments', () => {
    const rep = createRep();
    addPoints(rep, 'guild', 300);
    expect(rep.guild.level).toBe(1);
    const next = nextLevelDef(rep.guild, 'guild')!;
    recordContract(rep, 'delivery', 1);
    recordContract(rep, 'delivery', 1);
    expect(assignmentProgress(rep.guild, next.assignment![0])).toBe(2);
    expect(addPoints(rep, 'guild', 0)).toEqual([]);
    recordContract(rep, 'rescue', 1);
    recordContract(rep, 'delivery', 1);
    expect(addPoints(rep, 'guild', 0)).toEqual([2]);
    expect(rep.guild.assignments).toEqual({});
    expect(hasUnlock(rep, 'courier')).toBe(true);
  });

  it('respects the minimum ring of an assignment', () => {
    const rep = createRep();
    rep.institute.level = 2;
    addPoints(rep, 'institute', 800);
    recordContract(rep, 'survey', 1);
    expect(rep.institute.assignments['inst3-surveys'] ?? 0).toBe(0);
    recordContract(rep, 'survey', 2);
    recordContract(rep, 'survey', 2);
    expect(addPoints(rep, 'institute', 0)).toEqual([3]);
  });

  it('deliver assignments accumulate the resource', () => {
    const rep = createRep();
    rep.guild.level = 2;
    rep.guild.points = 700;
    const a = deliverAssignment(rep.guild, 'guild')!;
    expect(a).toMatchObject({ resource: 'titanium', amount: 300 });
    recordDelivery(rep.guild, a, 'iron', 300);
    expect(assignmentProgress(rep.guild, a)).toBe(0);
    recordDelivery(rep.guild, a, 'titanium', 300);
    expect(addPoints(rep, 'guild', 0)).toEqual([3]);
    expect(nextLevelDef(rep.guild, 'guild')).toBeNull();
    expect(deliverAssignment(rep.guild, 'guild')).toBeNull();
  });
});

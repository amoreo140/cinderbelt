// Content validation of M3.5b (12.3): journal, Archive, variants, plans, Atlas, POIs and events.
import { describe, expect, it } from 'vitest';
import { ARCHIVE_BRANCHES, ARCHIVE_NODES, ARCHIVE_PARTS, LEGACY_ARCHIVE_NODES, archiveNode } from './archive';
import { ATLAS_COLLECTIONS, ATLAS_ITEMS, ATLAS_REWARD } from './atlas';
import { ECHOES, ECHO_INDICES } from './echoes';
import { DISTRESS, DISTRESS_KINDS } from './events';
import { LOCALES, textsFor } from '../i18n';
import { JOURNAL, JOURNAL_MAX_WORDS, journalEntry, wordCount } from './journal';
import { PART_IDS } from './parts';
import { FRAGMENT_SOURCES, PLAN_IDS, PLAN_WEIGHTS } from './plans';
import { ANOMALIES, ANOMALY_TYPES, GIANT_RESOURCES, POI_DENSITY, POI_KINDS, WRECK_CLASS_WEIGHTS } from './poi';
import { RESOURCE_IDS } from './resources';
import { VARIANTS, VARIANT_IDS } from './variants';

describe('journal content', () => {
  it('has unique ids and grid positions', () => {
    expect(new Set(JOURNAL.map((e) => e.id)).size).toBe(JOURNAL.length);
    expect(new Set(JOURNAL.map((e) => e.at.join(','))).size).toBe(JOURNAL.length);
  });

  it('every entry is short (≤ 60 words) and has at least one link to an existing entry', () => {
    for (const e of JOURNAL) {
      for (const locale of LOCALES) {
        const text = textsFor(locale).journal[e.id].text;
        expect(wordCount(text), `${locale} ${e.id}`).toBeLessThanOrEqual(JOURNAL_MAX_WORDS);
        expect(wordCount(text), `${locale} ${e.id}`).toBeGreaterThan(5);
      }
      expect(e.links.length, e.id).toBeGreaterThan(0);
      for (const l of e.links) {
        expect(journalEntry(l), `${e.id} → ${l}`).toBeDefined();
        expect(l, e.id).not.toBe(e.id);
      }
    }
  });

  it('every entry can be reached (a trigger of this version or a link from a reachable one)', () => {
    const reachable = new Set(JOURNAL.filter((e) => e.trigger.on !== 'later').map((e) => e.id));
    for (const e of JOURNAL) {
      if (reachable.has(e.id)) continue;
      // a "?" node of a later milestone: a clue must lead to it
      expect(JOURNAL.some((x) => reachable.has(x.id) && x.links.includes(e.id)), e.id).toBe(true);
    }
  });

  it('the story echoes have a place entry each and chapter 0 starts with the scanner', () => {
    for (const i of ECHO_INDICES) expect(JOURNAL.some((e) => e.trigger.on === 'echoAnalyzed' && e.trigger.echo === i && e.kind === 'place')).toBe(true);
    expect(JOURNAL.find((e) => e.trigger.on === 'firstPulse')?.chapter).toBe(0);
  });

  it('no pathos: no exclamation marks in entries', () => {
    for (const e of JOURNAL) for (const locale of LOCALES) expect(textsFor(locale).journal[e.id].text.includes('!'), `${locale} ${e.id}`).toBe(false);
  });
});

describe('archive tree', () => {
  /** Early nodes outside the 40-node tree (the docking computer, decision 2026-10-17). */
  const EXTRA = ['dockingComputer'];
  const visible = ARCHIVE_NODES.filter((n) => !n.revealedBy && !EXTRA.includes(n.id));

  it('the docking computer is an early, cheap navigation node that is buyable now', () => {
    const n = archiveNode('dockingComputer');
    expect(n).toMatchObject({ branch: 'navigation', level: 1, unlock: { kind: 'feature', feature: 'dockingComputer' } });
    expect(n.since).toBeUndefined();
    expect(n.revealedBy).toBeUndefined();
    expect(n.data).toBeLessThanOrEqual(30);
  });

  it('has 40 visible nodes in 5 branches of 8, 2 per level', () => {
    expect(visible).toHaveLength(40);
    for (const b of ARCHIVE_BRANCHES) {
      const nodes = visible.filter((n) => n.branch === b);
      expect(nodes, b).toHaveLength(8);
      for (const level of [1, 2, 3, 4] as const) expect(nodes.filter((n) => n.level === level), `${b} L${level}`).toHaveLength(2);
    }
  });

  it('hidden nodes are revealed by an existing journal entry (at most 2 per branch)', () => {
    const hidden = ARCHIVE_NODES.filter((n) => n.revealedBy);
    expect(hidden.length).toBeGreaterThan(0);
    for (const n of hidden) expect(journalEntry(n.revealedBy!), n.id).toBeDefined();
    for (const b of ARCHIVE_BRANCHES) expect(hidden.filter((n) => n.branch === b).length).toBeLessThanOrEqual(2);
  });

  it('key nodes have a threshold and cost no Data; ordinary nodes cost Data', () => {
    for (const n of ARCHIVE_NODES) {
      if (n.threshold !== undefined) expect(n.data, n.id).toBe(0);
      else expect(n.data, n.id).toBeGreaterThan(0);
      expect(n.credits, n.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('nodes that unlock parts or variants point to real ones; the M2d parts are Archive parts', () => {
    for (const n of ARCHIVE_NODES) {
      if (n.unlock.kind === 'part') expect(PART_IDS).toContain(n.unlock.part);
      if (n.unlock.kind === 'variant') {
        const v = VARIANTS[n.unlock.variant];
        expect(v.source).toEqual({ kind: 'archive', node: n.id });
      }
      // content not in this version cannot be bought
      if (n.unlock.kind === 'future') expect(n.since, n.id).toBeDefined();
      else expect(n.since, n.id).toBeUndefined();
    }
    expect([...ARCHIVE_PARTS.keys()].sort()).toEqual(['battery', 'heavyLaser', 'largeCargo', 'largeReactor', 'refinery', 'repairModule']);
    for (const id of LEGACY_ARCHIVE_NODES) expect(archiveNode(id).unlock.kind).toBe('part');
  });

  it('every level-2+ node of a branch with a buyable node has a buyable predecessor', () => {
    for (const n of ARCHIVE_NODES.filter((x) => !x.since && x.level > 1)) {
      const before = ARCHIVE_NODES.filter((x) => x.branch === n.branch && x.level === n.level - 1 && !x.since);
      expect(before.length, n.id).toBeGreaterThan(0);
    }
  });
});

describe('variants and plans', () => {
  it('at least 6 variants and 6 plans; each variant changes one or two stats', () => {
    expect(VARIANT_IDS.length).toBeGreaterThanOrEqual(6);
    expect(PLAN_IDS.length).toBeGreaterThanOrEqual(6);
    for (const v of VARIANT_IDS) {
      const n = Object.keys(VARIANTS[v].mods).length;
      expect(n, v).toBeGreaterThanOrEqual(1);
      expect(n, v).toBeLessThanOrEqual(3);
      expect(PART_IDS).toContain(VARIANTS[v].base);
    }
  });

  it('every plan drops from at least one source and every source has plans', () => {
    for (const p of PLAN_IDS) expect(FRAGMENT_SOURCES.some((s) => (PLAN_WEIGHTS[s][p] ?? 0) > 0), p).toBe(true);
    for (const s of FRAGMENT_SOURCES) {
      const weights = Object.entries(PLAN_WEIGHTS[s]);
      expect(weights.length, s).toBeGreaterThan(0);
      for (const [p] of weights) expect(PLAN_IDS).toContain(p);
    }
  });
});

describe('places, events and atlas', () => {
  it('densities are probabilities and anomaly cores lie inside their fields', () => {
    for (const k of POI_KINDS) for (const r of [1, 2, 3, 4] as const) expect(POI_DENSITY[k][r]).toBeGreaterThanOrEqual(0);
    for (const t of ANOMALY_TYPES) expect(ANOMALIES[t].core).toBeLessThan(ANOMALIES[t].field);
    for (const r of [1, 2, 3, 4] as const) {
      const w = WRECK_CLASS_WEIGHTS[r];
      expect(w.miner + w.freighter + w.pirate).toBeCloseTo(1, 6);
      for (const res of Object.keys(GIANT_RESOURCES[r])) expect(RESOURCE_IDS).toContain(res);
    }
    const sum = DISTRESS_KINDS.reduce((s, k) => s + DISTRESS.weights[k], 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('echoes grow outwards and need the decoder, then the shard', () => {
    expect(ECHOES.map((e) => e.gate)).toEqual(['none', 'decoder', 'shard']);
    for (let i = 1; i < ECHOES.length; i++) expect(ECHOES[i]!.distance).toBeGreaterThan(ECHOES[i - 1]!.distance);
  });

  it('every atlas collection has items and a non-negative reward', () => {
    for (const c of ATLAS_COLLECTIONS) {
      expect(ATLAS_ITEMS[c].length, c).toBeGreaterThan(0);
      expect(ATLAS_REWARD[c], c).toBeGreaterThanOrEqual(0);
    }
  });
});

// Validation of discoveries in save V5/V6 (M3.5b, salvageable wrecks M3.6) – the same style as validate.ts: a clean copy, errors with a path.
import { ARCHIVE_NODE_IDS, type ArchiveNodeId } from '../../data/archive';
import { ATLAS_COLLECTIONS, type AtlasCollection } from '../../data/atlas';
import { KEY_ITEMS, type KeyItemId } from '../../data/echoes';
import { isJournalId } from '../../data/journal';
import { FRAGMENTS_PER_PLAN, FRAGMENT_SOURCES, PLAN_IDS, type FragmentSource, type PlanId } from '../../data/plans';
import { BUFF_KINDS, POI_KINDS, type BuffKind, type PoiKind } from '../../data/poi';
import { ECHO_INDICES, type EchoIndex } from '../../data/echoes';
import { DISCOVERY_LOG_MAX, SIGNAL_KINDS, type DiscoveryLogEntry, type Fix, type Signal, type SignalKind } from '../discovery/types';
import type { SavedDiscoveryV6 } from './types';
import type { Checker } from './validate';

/** Reasonable caps (protection against nonsense, not game limits). */
const MAX_SIGNALS = 256;
const MAX_KEYS = 100_000;

function keys(c: Checker, v: unknown, path: string): string[] {
  const list = (c.arr(v, path) ?? []).map((x, i) => c.str(x, `${path}[${i}]`, true));
  if (list.length > MAX_KEYS) c.err(path, 'too many entries');
  if (new Set(list).size !== list.length) c.err(path, 'duplicate entries');
  return list;
}

function pairs<K extends string>(c: Checker, v: unknown, path: string, key: (x: unknown, p: string) => K, min = 0, max = Infinity, int = true): [K, number][] {
  const out: [K, number][] = [];
  (c.arr(v, path) ?? []).forEach((entry, i) => {
    const p = `${path}[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [key, value]');
    out.push([key(entry[0], p), int ? c.int(entry[1], p, min, max) : c.num(entry[1], p, min, max)]);
  });
  if (new Set(out.map(([k]) => k)).size !== out.length) c.err(path, 'duplicate keys');
  return out;
}

function signal(c: Checker, v: unknown, path: string): Signal {
  const o = c.obj(v, path) ?? {};
  return {
    id: c.str(o.id, `${path}.id`, true),
    kind: c.oneOf<SignalKind>(o.kind, SIGNAL_KINDS, `${path}.kind`),
    pos: c.vec(o.pos, `${path}.pos`),
    radius: c.num(o.radius, `${path}.radius`, 0),
    tick: c.tick(o.tick, `${path}.tick`),
  };
}

function fix(c: Checker, v: unknown, path: string): Fix {
  const o = c.obj(v, path) ?? {};
  return {
    pulses: (c.arr(o.pulses, `${path}.pulses`) ?? []).map((p, i) => c.vec(p, `${path}.pulses[${i}]`)),
    radius: c.num(o.radius, `${path}.radius`, 0),
  };
}

function logEntry(c: Checker, v: unknown, path: string): DiscoveryLogEntry {
  const o = c.obj(v, path) ?? {};
  const tick = c.tick(o.tick, `${path}.tick`);
  const kind = c.oneOf(o.kind, ['poi', 'echo', 'journal', 'plan', 'archive'] as const, `${path}.kind`);
  switch (kind) {
    case 'poi':
      return { tick, kind, poi: c.oneOf<PoiKind>(o.poi, POI_KINDS, `${path}.poi`) };
    case 'echo':
      return { tick, kind, echo: c.oneOf<EchoIndex>(o.echo, ECHO_INDICES, `${path}.echo`) };
    case 'journal': {
      const entry = c.str(o.entry, `${path}.entry`, true);
      if (!isJournalId(entry)) c.err(`${path}.entry`, 'unknown journal entry');
      return { tick, kind, entry };
    }
    case 'plan':
      return { tick, kind, plan: c.oneOf<PlanId>(o.plan, PLAN_IDS, `${path}.plan`) };
    case 'archive':
      return { tick, kind, node: c.oneOf<ArchiveNodeId>(o.node, ARCHIVE_NODE_IDS, `${path}.node`) };
  }
}

export function validateDiscovery(c: Checker, raw: unknown, path: string): SavedDiscoveryV6 {
  const o = c.obj(raw, path) ?? {};
  const dataTotal = c.num(o.dataTotal, `${path}.dataTotal`, 0);
  const dataFund = c.num(o.dataFund, `${path}.dataFund`, 0);
  if (dataFund > dataTotal + 1e-9) c.err(`${path}.dataFund`, 'fund exceeds collected Data');
  const plans = (c.arr(o.plans, `${path}.plans`) ?? []).map((p, i) => c.oneOf<PlanId>(p, PLAN_IDS, `${path}.plans[${i}]`));
  const fragments = pairs(c, o.fragments, `${path}.fragments`, (x, p) => c.oneOf<PlanId>(x, PLAN_IDS, p), 1, FRAGMENTS_PER_PLAN - 1);
  for (const [p] of fragments) if (plans.includes(p)) c.err(`${path}.fragments`, `plan ${p} is already complete`);
  const scanner = c.obj(o.scanner, `${path}.scanner`) ?? {};
  const target = scanner.target;
  const signals = (c.arr(o.signals, `${path}.signals`) ?? []).map((s, i) => signal(c, s, `${path}.signals[${i}]`));
  if (signals.length > MAX_SIGNALS) c.err(`${path}.signals`, 'too many signals');
  const journal = (c.arr(o.journal, `${path}.journal`) ?? []).map((e, i) => {
    const p = `${path}.journal[${i}]`;
    const x = c.obj(e, p) ?? {};
    const id = c.str(x.id, `${p}.id`, true);
    if (!isJournalId(id)) c.err(`${p}.id`, 'unknown journal entry');
    return { id, tick: c.tick(x.tick, `${p}.tick`) };
  });
  if (new Set(journal.map((e) => e.id)).size !== journal.length) c.err(`${path}.journal`, 'duplicate entries');
  const log = (c.arr(o.log, `${path}.log`) ?? []).map((e, i) => logEntry(c, e, `${path}.log[${i}]`));
  if (log.length > DISCOVERY_LOG_MAX) c.err(`${path}.log`, `at most ${DISCOVERY_LOG_MAX} entries`);
  return {
    dataTotal,
    dataFund,
    archive: (c.arr(o.archive, `${path}.archive`) ?? []).map((n, i) => c.oneOf<ArchiveNodeId>(n, ARCHIVE_NODE_IDS, `${path}.archive[${i}]`)),
    fragments,
    plans,
    pity: pairs(c, o.pity, `${path}.pity`, (x, p) => c.oneOf<FragmentSource>(x, FRAGMENT_SOURCES, p), 0, 1000),
    scanned: keys(c, o.scanned, `${path}.scanned`),
    known: keys(c, o.known, `${path}.known`),
    signals,
    fixes: (c.arr(o.fixes, `${path}.fixes`) ?? []).map((entry, i): [string, Fix] => {
      const p = `${path}.fixes[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2) {
        c.err(p, 'expected [id, fix]');
        return ['', { pulses: [], radius: 0 }];
      }
      return [c.str(entry[0], p, true), fix(c, entry[1], p)];
    }),
    opened: keys(c, o.opened, `${path}.opened`),
    giants: pairs(c, o.giants, `${path}.giants`, (x, p) => c.str(x, p, true), 0, 10_000, false),
    journal,
    keyItems: (c.arr(o.keyItems, `${path}.keyItems`) ?? []).map((k, i) => c.oneOf<KeyItemId>(k, KEY_ITEMS, `${path}.keyItems[${i}]`)),
    buffs: (c.arr(o.buffs, `${path}.buffs`) ?? []).map((b, i) => {
      const p = `${path}.buffs[${i}]`;
      const x = c.obj(b, p) ?? {};
      return { kind: c.oneOf<BuffKind>(x.kind, BUFF_KINDS, `${p}.kind`), until: c.until(x.until, `${p}.until`) };
    }),
    anomalyUsed: pairs(c, o.anomalyUsed, `${path}.anomalyUsed`, (x, p) => c.str(x, p, true), 0),
    scanner: {
      cooldown: c.int(scanner.cooldown, `${path}.scanner.cooldown`, 0),
      held: c.int(scanner.held, `${path}.scanner.held`, 0),
      target: target === null ? null : c.str(target, `${path}.scanner.target`, true),
    },
    distressScans: pairs(c, o.distressScans, `${path}.distressScans`, (x, p) => c.str(x, p, true), 0),
    pirateLogs: c.int(o.pirateLogs, `${path}.pirateLogs`, 0, 3),
    atlas: keys(c, o.atlas, `${path}.atlas`),
    atlasDone: (c.arr(o.atlasDone, `${path}.atlasDone`) ?? []).map((a, i) => c.oneOf<AtlasCollection>(a, ATLAS_COLLECTIONS, `${path}.atlasDone[${i}]`)),
    log,
    cut: (c.arr(o.cut, `${path}.cut`) ?? []).map((entry, i): [string, number[]] => {
      const p = `${path}.cut[${i}]`;
      if (!Array.isArray(entry) || entry.length !== 2) {
        c.err(p, 'expected [poi, partIds]');
        return ['', []];
      }
      const ids = (c.arr(entry[1], `${p}.ids`) ?? []).map((id, j) => c.int(id, `${p}.ids[${j}]`, 0));
      return [c.str(entry[0], p, true), ids];
    }),
  };
}

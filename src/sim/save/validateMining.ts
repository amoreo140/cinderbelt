// Validation of the Mining 2.0 state in save V12 – same style as validate.ts: a clean copy, errors with paths.
import { GRADE_TABLES } from '../../data/ore';
import { RESOURCE_IDS } from '../../data/resources';
import type { SavedMiningV12, SavedNuggetV12 } from './types';
import type { Checker } from './validate';

const CHUNK_KEY = /^-?\d+,-?\d+$/;
const MIN_GRADE = Math.min(...Object.values(GRADE_TABLES).flat().map((g) => g.grade));
const MAX_GRADE = Math.max(...Object.values(GRADE_TABLES).flat().map((g) => g.grade));

export function validateMining(c: Checker, v: unknown, path: string): SavedMiningV12 {
  const o = c.obj(v, path) ?? {};
  const nextId = c.int(o.nextId, `${path}.nextId`, 1);
  const nuggets = (c.arr(o.nuggets, `${path}.nuggets`) ?? []).map((raw, i): SavedNuggetV12 => {
    const p = `${path}.nuggets[${i}]`;
    const n = c.obj(raw, p) ?? {};
    const id = c.int(n.id, `${p}.id`, 1);
    if (id >= nextId) c.err(`${p}.id`, 'not below nextId');
    return {
      id,
      resource: c.oneOf(n.resource, RESOURCE_IDS, `${p}.resource`),
      amount: c.num(n.amount, `${p}.amount`, 0),
      // grade tables are tunable – a grade outside them is clamped, not a broken save
      grade: Math.min(MAX_GRADE, Math.max(MIN_GRADE, c.num(n.grade, `${p}.grade`, 0))),
      source: c.str(n.source, `${p}.source`, true),
      body: c.body(n.body, `${p}.body`),
      ttl: c.int(n.ttl, `${p}.ttl`, 0),
    };
  });
  if (new Set(nuggets.map((n) => n.id)).size !== nuggets.length) c.err(`${path}.nuggets`, 'duplicate ids');
  const assayed = (c.arr(o.assayed, `${path}.assayed`) ?? []).map((k, i) => {
    const s = c.str(k, `${path}.assayed[${i}]`);
    if (!CHUNK_KEY.test(s)) c.err(`${path}.assayed[${i}]`, 'expected a chunk key "cx,cy"');
    return s;
  });
  return { nextId, nuggets, assayed: [...new Set(assayed)].sort() };
}

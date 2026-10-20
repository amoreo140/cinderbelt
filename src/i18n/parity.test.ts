// Every language has every key: the English and German modules mirror the Slovak ones key by key (the types already
// require it; this also catches empty strings, empty variant lists and functions with the wrong arity).
// Modules still waiting for a translation fall back to Slovak (see the en*.ts TODOs) and pass trivially.
import { describe, expect, it } from 'vitest';
import { textsFor, type Texts } from './index';
import { skComms } from './skComms';
import { enComms } from './enComms';
import { deComms } from './deComms';
import { skTraining } from './skTraining';

type Shape = string | number | boolean | null | undefined | ((...args: never[]) => unknown) | readonly Shape[] | { [k: string]: Shape };

/** Every difference in structure between two text trees (path: what differs). */
export function shapeDiff(a: Shape, b: Shape, path = ''): string[] {
  if (typeof a === 'function' || typeof b === 'function') {
    if (typeof a !== typeof b) return [`${path}: function vs ${typeof b}`];
    return (a as (...x: never[]) => unknown).length === (b as (...x: never[]) => unknown).length ? [] : [`${path}: arity`];
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${path}: array vs ${typeof b}`];
    if (a.length === 0 || b.length === 0) return a.length === b.length ? [] : [`${path}: empty list`];
    // variant lists may differ in length; their items must have one shape
    return [...shapeDiff(a[0] as Shape, b[0] as Shape, `${path}[0]`)];
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const out: string[] = [];
    for (const k of ka) if (!kb.includes(k)) out.push(`${path}.${k}: missing in the second`);
    for (const k of kb) if (!ka.includes(k)) out.push(`${path}.${k}: missing in the first`);
    for (const k of ka) if (kb.includes(k)) out.push(...shapeDiff((a as Record<string, Shape>)[k], (b as Record<string, Shape>)[k], `${path}.${k}`));
    return out;
  }
  if (typeof a !== typeof b) return [`${path}: ${typeof a} vs ${typeof b}`];
  if (typeof a === 'string' && (a.trim() === '' || (b as string).trim() === '')) return a === b ? [] : [`${path}: empty text`];
  return [];
}

/** Every string and every function result (called with sample args) is non-empty. */
function emptyTexts(node: Shape, path = ''): string[] {
  if (typeof node === 'string') return node.trim() === '' ? [path] : [];
  if (typeof node === 'function') {
    // sample arguments; a text that needs a richer argument (an object, a list) is skipped
    const args = Array.from({ length: node.length }, () => 3) as never[];
    let r: unknown;
    try {
      r = (node as (...x: never[]) => unknown)(...args);
    } catch {
      return [];
    }
    return typeof r === 'string' && r.trim() === '' ? [path] : [];
  }
  if (Array.isArray(node)) return node.flatMap((n, i) => emptyTexts(n as Shape, `${path}[${i}]`));
  if (typeof node === 'object' && node !== null) return Object.entries(node).flatMap(([k, v]) => emptyTexts(v as Shape, `${path}.${k}`));
  return [];
}

const SK = textsFor('sk') as unknown as Shape;
const EN = textsFor('en') as unknown as Shape;
const DE = textsFor('de') as unknown as Shape;
const MODULES = Object.keys(textsFor('sk')) as (keyof Texts)[];

describe('i18n parity (Slovak ↔ English ↔ German)', () => {
  it('every language has the same modules', () => {
    expect(Object.keys(textsFor('en')).sort()).toEqual([...MODULES].sort());
    expect(Object.keys(textsFor('de')).sort()).toEqual([...MODULES].sort());
  });

  for (const name of MODULES) {
    it(`${name}: the same keys, list shapes and function arities in every language`, () => {
      expect(shapeDiff((SK as Record<string, Shape>)[name], (EN as Record<string, Shape>)[name], name)).toEqual([]);
      expect(shapeDiff((SK as Record<string, Shape>)[name], (DE as Record<string, Shape>)[name], name)).toEqual([]);
    });
  }

  it('no empty text in any language', () => {
    expect(emptyTexts(SK)).toEqual([]);
    expect(emptyTexts(EN)).toEqual([]);
    expect(emptyTexts(DE)).toEqual([]);
  });

  it('comms: no empty text in either language, every variant list has a line', () => {
    expect(emptyTexts(skComms as unknown as Shape)).toEqual([]);
    expect(emptyTexts(enComms as unknown as Shape)).toEqual([]);
    const lists = (t: typeof skComms): (readonly unknown[])[] => Object.values(t.lines).flatMap((group) => Object.values(group) as unknown as (readonly unknown[])[]);
    for (const list of [...lists(skComms), ...lists(enComms), ...lists(deComms)]) expect(list.length).toBeGreaterThan(0);
  });

  it('comms: the instructor has an intro and a nudge for every training step, every first contact has a line', () => {
    const lists = (t: typeof skComms): (readonly unknown[])[] => [
      ...Object.values(t.instructor.intro),
      ...Object.values(t.instructor.nudge),
      t.instructor.praise,
      t.instructor.done,
      t.instructor.nudgeUndock,
      t.instructor.nudgeDock,
      ...Object.values(t.firstContact),
    ];
    for (const t of [skComms, enComms, deComms]) {
      expect(Object.keys(t.instructor.intro).sort()).toEqual(Object.keys(skTraining.steps).sort());
      expect(Object.keys(t.instructor.nudge).sort()).toEqual(Object.keys(skTraining.steps).sort());
      for (const list of lists(t)) expect(list.length).toBeGreaterThan(0);
    }
  });

  it('the diff finds a missing key and a wrong arity', () => {
    expect(shapeDiff({ a: 'x', b: { c: 'y' } }, { a: 'x', b: {} })).toEqual(['.b.c: missing in the second']);
    expect(shapeDiff({ f: (x: number) => String(x) }, { f: () => 'x' })).toEqual(['.f: arity']);
  });
});

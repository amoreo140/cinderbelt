// Template actions (M4a): save, rename, delete – anywhere, capped by the Archive.
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SLOTS } from '../../data/fleet';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { createStarterShip } from '../ship/presets';
import { Simulation, type SimEvent } from '../Simulation';
import { isTemplateAction, validTemplateParts } from './actions';
import { normalizeTemplate } from './normalize';
import { SPEC_SHIPS_E2 } from './testShips';
import type { TemplatePart } from './types';

let req = 0;
const act = (sim: Simulation, a: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });
const result = (events: readonly SimEvent[]) => events.find((e) => e.type === 'actionResult');

const STARTER = normalizeTemplate(createStarterShip())!;
const save = (name: string, parts: unknown = STARTER): GameActionInput => ({ type: 'templateSave', name, parts: parts as TemplatePart[] });

function sim(nodes: ('templates' | 'templates20')[] = ['templates'], docked = true): Simulation {
  const s = new Simulation({ seed: 7, startDocked: docked });
  for (const n of nodes) s.state.discovery.archive.add(n);
  return s;
}

describe('template action routing', () => {
  it('recognises exactly the template actions', () => {
    for (const a of [save('A'), { type: 'templateRename', index: 0, name: 'B' }, { type: 'templateDelete', index: 0 }] as GameActionInput[]) {
      expect(isTemplateAction({ ...a, reqId: 1 } as GameAction), a.type).toBe(true);
    }
    expect(isTemplateAction({ type: 'hangarBuySlot', reqId: 1 })).toBe(false);
  });
});

describe('templateSave', () => {
  it('saves normalised parts under the sanitised name, docked and in flight', () => {
    for (const docked of [true, false]) {
      const s = sim(['templates'], docked);
      // the same ship, shifted and unsorted – stored normalised
      const raw = STARTER.map(([k, x, y, r]): TemplatePart => [k, x + 3, y - 2, r]).reverse();
      const events = act(s, save('  Ťažiar\u0007 ', raw));
      expect(result(events)).toMatchObject({ ok: true });
      expect(events).toContainEqual({ type: 'templateSaved', index: 0, name: 'Ťažiar' });
      expect(s.state.templates).toEqual([{ name: 'Ťažiar', parts: STARTER }]);
    }
  });

  it('caps: 0 before the Archive node, 5 with "templates", 20 with "templates20"', () => {
    for (const [nodes, cap] of [[[], 0], [['templates'], 5], [['templates', 'templates20'], 20]] as const) {
      const s = sim([...nodes]);
      for (let i = 0; i < cap; i++) expect(result(act(s, save(`T${i}`))), `${cap}/${i}`).toMatchObject({ ok: true });
      expect(result(act(s, save('over')))).toMatchObject({ ok: false, reason: 'templateCap' });
      expect(s.state.templates).toHaveLength(cap);
    }
    expect([TEMPLATE_SLOTS.none, TEMPLATE_SLOTS.base, TEMPLATE_SLOTS.plus]).toEqual([0, 5, 20]);
  });

  it('a deleted template frees its slot', () => {
    const s = sim();
    for (let i = 0; i < 5; i++) act(s, save(`T${i}`));
    act(s, { type: 'templateDelete', index: 2 });
    expect(result(act(s, save('again')))).toMatchObject({ ok: true });
  });

  it('rejects bad names: invalidName', () => {
    const s = sim();
    for (const name of ['', '   ', 'x'.repeat(25), '\u0000‮', 42, null]) {
      expect(result(act(s, save(name as string))), String(name)).toMatchObject({ ok: false, reason: 'invalidName' });
    }
    expect(s.state.templates).toEqual([]);
  });

  it('rejects parts that are not a valid design: invalidTemplate', () => {
    const s = sim();
    const bad: unknown[] = [
      null,
      'parts',
      [],
      [['engine:1', 0, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['cockpit:1', 1, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['armor:1', 0, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['armor:1', 2, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['nope:1', 1, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['armor:1', 1.5, 0, 0]],
      [['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 7]],
      [['cockpit:1', 0, 0, 0, 'extra']],
      [['cockpit:1', 0, 0, 0], ...Array.from({ length: 15 }, (_, i) => ['armor:1', i + 1, 0, 0])],
      Array.from({ length: 1000 }, () => ['armor:1', 0, 0, 0]),
    ];
    for (const parts of bad) expect(result(act(s, save('X', parts))), JSON.stringify(parts)?.slice(0, 60)).toMatchObject({ ok: false, reason: 'invalidTemplate' });
    expect(s.state.templates).toEqual([]);
  });

  it('copies the parts (later changes to the action do not reach the state)', () => {
    const s = sim();
    const parts = STARTER.map((p): TemplatePart => [...p]);
    act(s, save('A', parts));
    parts[0]![1] = 99;
    expect(s.state.templates[0]!.parts).toEqual(STARTER);
  });
});

describe('templateRename / templateDelete', () => {
  it('renames by index (anywhere), sanitised; bad index or name changes nothing', () => {
    const s = sim(['templates'], false);
    act(s, save('A'));
    act(s, save('B'));
    const events = act(s, { type: 'templateRename', index: 1, name: ' Nová ' });
    expect(result(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'templateRenamed', index: 1, name: 'Nová' });
    expect(s.state.templates.map((t) => t.name)).toEqual(['A', 'Nová']);
    for (const index of [-1, 2, 0.5, NaN, '0']) {
      expect(result(act(s, { type: 'templateRename', index: index as number, name: 'X' })), String(index)).toMatchObject({ ok: false, reason: 'invalidTemplate' });
    }
    expect(result(act(s, { type: 'templateRename', index: 0, name: ' ' }))).toMatchObject({ ok: false, reason: 'invalidName' });
    expect(s.state.templates.map((t) => t.name)).toEqual(['A', 'Nová']);
  });

  it('deletes by index; the later templates move up', () => {
    const s = sim(['templates'], false);
    for (const n of ['A', 'B', 'C']) act(s, save(n));
    const events = act(s, { type: 'templateDelete', index: 1 });
    expect(result(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'templateDeleted', index: 1 });
    expect(s.state.templates.map((t) => t.name)).toEqual(['A', 'C']);
    expect(result(act(s, { type: 'templateDelete', index: 2 }))).toMatchObject({ ok: false, reason: 'invalidTemplate' });
    expect(s.state.templates).toHaveLength(2);
  });

  it('rename and delete work without the Archive node too (only saving is capped)', () => {
    const s = sim();
    act(s, save('A'));
    s.state.discovery.archive.delete('templates');
    expect(result(act(s, { type: 'templateRename', index: 0, name: 'B' }))).toMatchObject({ ok: true });
    expect(result(act(s, { type: 'templateDelete', index: 0 }))).toMatchObject({ ok: true });
  });
});

describe('validTemplateParts', () => {
  it('normalises valid parts and answers null otherwise', () => {
    expect(validTemplateParts(STARTER)).toEqual(STARTER);
    expect(validTemplateParts([['engine:1', 0, 0, 0]])).toBeNull();
    expect(validTemplateParts({ length: 1, 0: ['cockpit:1', 0, 0, 0] })).toBeNull();
  });

  it('keeps shapes (index 4) and copies the tuples; rejects shapes that are unknown or not allowed', () => {
    const raw: TemplatePart[] = [['armor:1', 3, 2, 1, 'wedge'], ['cockpit:1', 2, 2, 0], ['armor:2', 0, 2, 0, 'wingR']];
    const parts = validTemplateParts(raw)!;
    expect(parts).toEqual([['armor:1', 1, 0, 1, 'wedge'], ['armor:2', -2, 0, 0, 'wingR'], ['cockpit:1', 0, 0, 0]]);
    expect(parts.every((p) => !raw.includes(p))).toBe(true);
    expect(validTemplateParts([['cockpit:1', 0, 0, 0], ['cannon:1', 1, 0, 0, 'wedge']])).toBeNull();
    expect(validTemplateParts([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 0, 'blob']])).toBeNull();
    expect(validTemplateParts([['cockpit:1', 0, 0, 0], ['armor:1', 1, 0, 0, 'wedge', 0]])).toBeNull();
    // the wing's second cell lands on the cockpit
    expect(validTemplateParts([['cockpit:1', 0, 0, 0], ['armor:1', -1, 0, 0, 'wingL']])).toBeNull();
  });

  it('templateSave stores a shaped template normalised, shapes kept', () => {
    const s = sim();
    const parts = normalizeTemplate(SPEC_SHIPS_E2.B())!;
    expect(parts.some((p) => p.length === 5)).toBe(true);
    expect(result(act(s, save('Mula', [...parts].reverse())))).toMatchObject({ ok: true });
    expect(s.state.templates).toEqual([{ name: 'Mula', parts }]);
  });
});

describe('determinism', () => {
  it('the same template actions give the same templates', () => {
    const run = () => {
      const s = sim(['templates', 'templates20']);
      act(s, save('A'));
      act(s, save('B', [['cockpit:1', 4, 4, 1]]));
      act(s, { type: 'templateRename', index: 0, name: 'C' });
      act(s, { type: 'templateDelete', index: 1 });
      act(s, save('D'));
      return JSON.stringify(s.state.templates);
    };
    expect(run()).toBe(run());
  });
});

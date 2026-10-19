// M4d T8: map notes in the simulation (plan §2.8) – commands, validation, the Archive gate, ids.
import { describe, expect, it } from 'vitest';
import { NOTES } from '../../data/navigation';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { Simulation, type SimEvent } from '../Simulation';
import { cleanNoteText } from './notes';

let reqId = 0;

function run(sim: Simulation, action: GameActionInput): SimEvent | undefined {
  const events = sim.step({ ...IDLE_COMMAND, actions: [{ ...action, reqId: ++reqId } as GameAction] });
  return events.find((e) => e.type === 'actionResult');
}

function withNotes(startDocked = false): Simulation {
  const sim = new Simulation({ seed: 3, startDocked });
  sim.state.discovery.archive.add('mapNotes');
  return sim;
}

const ok = { type: 'actionResult', ok: true };
const fail = (reason: string) => ({ type: 'actionResult', ok: false, reason });

describe('map notes (T8)', () => {
  it('adds, edits and deletes a note, docked and in flight', () => {
    for (const startDocked of [true, false]) {
      const sim = withNotes(startDocked);
      expect(run(sim, { type: 'mapNoteSet', pos: { x: 10, y: -20 }, icon: 'ore', text: '  bohaté Ti  ' })).toMatchObject(ok);
      expect(sim.state.navigation.notes).toEqual([{ id: 1, pos: { x: 10, y: -20 }, icon: 'ore', text: 'bohaté Ti' }]);
      expect(sim.state.navigation.nextNote).toBe(2);

      expect(run(sim, { type: 'mapNoteSet', id: 1, pos: { x: 15, y: 5 }, icon: 'pirate', text: 'Klan Hyena' })).toMatchObject(ok);
      expect(sim.state.navigation.notes).toEqual([{ id: 1, pos: { x: 15, y: 5 }, icon: 'pirate', text: 'Klan Hyena' }]);
      expect(sim.state.navigation.nextNote).toBe(2);

      expect(run(sim, { type: 'mapNoteDelete', id: 1 })).toMatchObject(ok);
      expect(sim.state.navigation.notes).toEqual([]);
    }
  });

  it('the stored position is a copy of the command position', () => {
    const sim = withNotes();
    const pos = { x: 1, y: 2 };
    run(sim, { type: 'mapNoteSet', pos, icon: 'star', text: 'a' });
    pos.x = 99;
    expect(sim.state.navigation.notes[0].pos).toEqual({ x: 1, y: 2 });
  });

  it('is locked without the Archive node', () => {
    const sim = new Simulation({ seed: 3 });
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'x' })).toMatchObject(fail('noMapNotes'));
    expect(run(sim, { type: 'mapNoteDelete', id: 1 })).toMatchObject(fail('noMapNotes'));
    expect(sim.state.navigation).toEqual({ notes: [], nextNote: 1 });
  });

  it(`refuses note ${NOTES.max + 1}; deleting one frees a slot`, () => {
    const sim = withNotes();
    for (let i = 0; i < NOTES.max; i++) {
      expect(run(sim, { type: 'mapNoteSet', pos: { x: i, y: 0 }, icon: 'flag', text: `#${i}` })).toMatchObject(ok);
    }
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 1 }, icon: 'flag', text: 'one more' })).toMatchObject(fail('notesFull'));
    expect(sim.state.navigation.notes).toHaveLength(NOTES.max);
    // Editing a note is still allowed when full.
    expect(run(sim, { type: 'mapNoteSet', id: 5, pos: { x: 0, y: 1 }, icon: 'star', text: 'edited' })).toMatchObject(ok);
    expect(run(sim, { type: 'mapNoteDelete', id: 3 })).toMatchObject(ok);
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 1 }, icon: 'flag', text: 'one more' })).toMatchObject(ok);
    expect(sim.state.navigation.notes).toHaveLength(NOTES.max);
  });

  it('refuses invalid text, icon and position', () => {
    const sim = withNotes();
    const bad: GameActionInput[] = [
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: '' },
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: '   \t\n ' },
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: '\u0000\u0007\u001b' },
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'x'.repeat(NOTES.textMax + 1) },
      { type: 'mapNoteSet', pos: { x: Number.NaN, y: 0 }, icon: 'star', text: 'ok' },
      { type: 'mapNoteSet', pos: { x: 0, y: Number.POSITIVE_INFINITY }, icon: 'star', text: 'ok' },
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'skull' as 'star', text: 'ok' },
      { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 42 as unknown as string },
      { type: 'mapNoteSet', pos: null as unknown as { x: number; y: number }, icon: 'star', text: 'ok' },
    ];
    for (const cmd of bad) expect(run(sim, cmd), JSON.stringify(cmd)).toMatchObject(fail('invalidNote'));
    expect(sim.state.navigation).toEqual({ notes: [], nextNote: 1 });
  });

  it('accepts exactly the maximum length, counted in characters (not UTF-16 units)', () => {
    const sim = withNotes();
    const max = 'ž'.repeat(NOTES.textMax - 1) + '🚀';
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'warning', text: max })).toMatchObject(ok);
    expect(sim.state.navigation.notes[0].text).toBe(max);
  });

  it('strips control characters and trims the text', () => {
    expect(cleanNoteText(' a\u0000b\u0007c ')).toBe('abc');
    expect(cleanNoteText('riadok\njeden\r\ndva\ttri')).toBe('riadok jeden dva tri');
    expect(cleanNoteText('\u202Eevil\u202C')).toBe('evil');
    expect(cleanNoteText('<b>Ti</b> & Cu')).toBe('<b>Ti</b> & Cu');
    const sim = withNotes();
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: '\u0001 Ti \u0002' })).toMatchObject(ok);
    expect(sim.state.navigation.notes[0].text).toBe('Ti');
    // Control characters do not count towards the length.
    const long = 'x'.repeat(NOTES.textMax) + '\u0000'.repeat(10);
    expect(run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: long })).toMatchObject(ok);
  });

  it('refuses an unknown id for edit and delete', () => {
    const sim = withNotes();
    expect(run(sim, { type: 'mapNoteSet', id: 1, pos: { x: 0, y: 0 }, icon: 'star', text: 'x' })).toMatchObject(fail('unknownNote'));
    expect(run(sim, { type: 'mapNoteDelete', id: 1 })).toMatchObject(fail('unknownNote'));
    run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'x' });
    expect(run(sim, { type: 'mapNoteDelete', id: 2 })).toMatchObject(fail('unknownNote'));
    expect(run(sim, { type: 'mapNoteDelete', id: Number.NaN })).toMatchObject(fail('unknownNote'));
    expect(sim.state.navigation.notes).toHaveLength(1);
  });

  it('never reuses ids', () => {
    const sim = withNotes();
    run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'a' });
    run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'b' });
    run(sim, { type: 'mapNoteDelete', id: 2 });
    run(sim, { type: 'mapNoteDelete', id: 1 });
    run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: 'c' });
    expect(sim.state.navigation.notes.map((n) => n.id)).toEqual([3]);
    expect(sim.state.navigation.nextNote).toBe(4);
    // A refused command does not consume an id.
    run(sim, { type: 'mapNoteSet', pos: { x: 0, y: 0 }, icon: 'star', text: '' });
    expect(sim.state.navigation.nextNote).toBe(4);
  });

  it('is deterministic', () => {
    const script: GameActionInput[] = [
      { type: 'mapNoteSet', pos: { x: 100, y: 200 }, icon: 'star', text: 'A' },
      { type: 'mapNoteSet', pos: { x: -5, y: 7 }, icon: 'warning', text: 'B' },
      { type: 'mapNoteSet', id: 1, pos: { x: 1, y: 1 }, icon: 'flag', text: 'A2' },
      { type: 'mapNoteDelete', id: 2 },
      { type: 'mapNoteSet', pos: { x: 3, y: 3 }, icon: 'ore', text: 'C' },
    ];
    const play = () => {
      const sim = withNotes();
      const results = script.map((a) => run(sim, a));
      return { results: results.map((r) => r && r.type === 'actionResult' && r.ok), navigation: sim.state.navigation };
    };
    expect(play()).toEqual(play());
  });
});

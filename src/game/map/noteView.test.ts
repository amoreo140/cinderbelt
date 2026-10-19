import { describe, expect, it } from 'vitest';
import { NOTES } from '../../data/navigation';
import { Simulation } from '../../sim/Simulation';
import { clampNoteInput, notesLocked, notesNear, noteTextCheck, noteViews } from './noteView';

describe('note views', () => {
  it('copies the sim notes sorted by id', () => {
    const sim = new Simulation({ seed: 3 });
    sim.state.navigation.notes.push({ id: 4, pos: { x: 1, y: 2 }, icon: 'ore', text: 'Ti' }, { id: 2, pos: { x: 0, y: 0 }, icon: 'flag', text: 'Base' });
    const views = noteViews(sim.state);
    expect(views.map((v) => v.id)).toEqual([2, 4]);
    views[1]!.pos.x = 99;
    expect(sim.state.navigation.notes[0]!.pos.x).toBe(1);
  });

  it('is locked until the Archive node is bought', () => {
    const sim = new Simulation({ seed: 3 });
    expect(notesLocked(sim.state)).toBe(true);
    sim.state.discovery.archive.add('mapNotes');
    expect(notesLocked(sim.state)).toBe(false);
  });

  it('picks the notes near the ship, nearest first', () => {
    const notes = [
      { id: 1, pos: { x: 2900, y: 0 }, icon: 'star' as const, text: 'a' },
      { id: 2, pos: { x: 100, y: 0 }, icon: 'star' as const, text: 'b' },
      { id: 3, pos: { x: 3100, y: 0 }, icon: 'star' as const, text: 'c' },
    ];
    expect(notesNear(notes, { x: 0, y: 0 }).map((n) => n.id)).toEqual([2, 1]);
    expect(notesNear(notes, { x: 0, y: 0 }, 500).map((n) => n.id)).toEqual([2]);
  });

  it('checks the text like the sim (trimmed, control characters out, 1–40 characters)', () => {
    expect(noteTextCheck('  Ti žila \n tu ')).toEqual({ clean: 'Ti žila   tu', length: 12, ok: true });
    expect(noteTextCheck('   ').ok).toBe(false);
    expect(noteTextCheck('x'.repeat(NOTES.textMax)).ok).toBe(true);
    expect(noteTextCheck('x'.repeat(NOTES.textMax + 1)).ok).toBe(false);
    expect([...clampNoteInput('🚀'.repeat(50))]).toHaveLength(NOTES.textMax);
    expect(clampNoteInput('krátke')).toBe('krátke');
  });
});

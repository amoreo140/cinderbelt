// Mirror mode of the shipyard editor (SL2 E1, §2.11): M mirrors place / remove / paint in one
// undo step, the copy's ghost shows its own validity, Shift+M mirrors the selection.
import { describe, expect, it } from 'vitest';
import type { PartInventory } from '../data/parts';
import { emptyCargo } from '../data/resources';
import { setLocale } from '../i18n/locale';
import { createStarterShip } from '../sim/ship/presets';
import type { HpMap, ShipGrid } from '../sim/ship/types';
import { partAt } from '../sim/shipyard/editor';
import { ShipyardEditor, type ShipyardSource } from './shipyardEditor';

// the starter ship: cockpit (1, 0), so the mirror axis is the row y = 0 (or the seam y = ½)
function setup(inventory: PartInventory = { 'armor:1': 4 }) {
  setLocale('sk');
  const state = { grid: createStarterShip() as ShipGrid, hp: new Map() as HpMap, inventory: { ...inventory } };
  const source: ShipyardSource = {
    stationId: 'home',
    ship: () => ({ grid: state.grid, hp: state.hp }),
    inventory: () => state.inventory,
    context: () => ({
      ring: 1,
      services: { crafting: true, partsMarket: true },
      credits: 5000,
      storage: emptyCargo(),
      cargo: emptyCargo(),
      fuel: 0,
    }),
  };
  const editor = new ShipyardEditor(source);
  return { state, editor };
}

const count = (e: ShipyardEditor) => e.draft.grid.parts.length;
const at = (e: ShipyardEditor, x: number, y: number) => partAt(e.draft.grid, x, y);
const click = (e: ShipyardEditor, x: number, y: number, button: 'left' | 'right' = 'left') => {
  const error = e.pointerDown({ x, y }, button);
  e.pointerUp();
  return error;
};

describe('ShipyardEditor – mirror mode', () => {
  it('M toggles the mode with a toast; the scene carries the axis only while it is on', () => {
    const { editor } = setup();
    expect(editor.scene().mirror).toBeNull();
    expect(editor.toggleMirror()).toEqual({ text: 'Zrkadlo zapnuté', kind: 'info' });
    expect(editor.scene().mirror).toEqual({ axis2: 0, ghost: null, label: 'OS' });
    editor.toggleMirrorAxis();
    expect(editor.scene().mirror?.axis2).toBe(1);
    expect(editor.toggleMirror().text).toBe('Zrkadlo vypnuté');
    expect(editor.scene().mirror).toBeNull();
  });

  it('places the mirror copy with a mirrored rotation, both in one undo step', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('engine:1');
    editor.rot = 1;
    expect(click(editor, 4, 2)).toBeNull();
    expect(at(editor, 4, 2)).toMatchObject({ partId: 'engine', rot: 1 });
    expect(at(editor, 4, -2)).toMatchObject({ partId: 'engine', rot: 3 });
    expect(editor.draft.undo).toHaveLength(1);
    editor.undo();
    expect(count(editor)).toBe(14);
    editor.redo();
    expect(count(editor)).toBe(16);
  });

  it('mirrors a 2×2 part across the seam axis', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.toggleMirrorAxis();
    editor.select('largeCargo:1');
    click(editor, 4, 2);
    expect(at(editor, 4, 2)).toMatchObject({ partId: 'largeCargo', x: 4, y: 2 });
    // rows 2–3 across the seam y = ½ → rows −2…−1
    expect(at(editor, 4, -2)).toMatchObject({ partId: 'largeCargo', x: 4, y: -2 });
  });

  it('places a part lying on the axis once', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('armor:1');
    editor.setHover({ x: 3, y: 0 });
    expect(editor.scene().mirror?.ghost).toBeNull();
    click(editor, 3, 0);
    expect(count(editor)).toBe(15);
  });

  it('shows the copy ghost with its own validity and places only the original when the copy is blocked', () => {
    const { editor } = setup();
    editor.select('armor:1');
    click(editor, 3, -2);
    editor.toggleMirror();
    editor.setHover({ x: 3, y: 2 });
    const mirror = editor.scene().mirror!;
    expect(editor.ghost()?.error).toBeNull();
    expect(mirror.ghost).toMatchObject({ key: 'armor:1', x: 3, y: -2, error: 'occupied' });
    expect(editor.mirrorGhostMessage()).toBe('Zrkadlová kópia sa nepoloží: Bunka je obsadená. Položí sa len originál.');
    click(editor, 3, 2);
    expect(count(editor)).toBe(16);
    // a free copy is green and has no message
    editor.setHover({ x: 4, y: 3 });
    expect(editor.scene().mirror?.ghost).toMatchObject({ x: 4, y: -3, error: null });
    expect(editor.mirrorGhostMessage()).toBeNull();
  });

  it('places neither part when the original is blocked (the copy ghost is red too)', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('armor:1');
    editor.setHover({ x: 0, y: 1 });
    expect(editor.ghost()?.error).toBe('occupied');
    expect(editor.scene().mirror?.ghost?.error).toBe('occupied');
    expect(editor.mirrorGhostMessage()).toBeNull();
    expect(click(editor, 0, 1)).toBe('occupied');
    expect(count(editor)).toBe(14);
  });

  it('a copy out of the hangar is blocked', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.toggleMirrorAxis();
    editor.select('armor:1');
    // seam y = ½: row −7 mirrors to row 8 – outside the hangar
    editor.setHover({ x: 3, y: -7 });
    expect(editor.scene().mirror?.ghost?.error).toBe('outOfBounds');
    click(editor, 3, -7);
    expect(count(editor)).toBe(15);
  });

  it('the cockpit is never mirrored: its copy hits the cockpit limit', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('cockpit:1');
    editor.setHover({ x: 4, y: 3 });
    // the original itself is a second cockpit
    expect(editor.ghost()?.error).toBe('cockpitLimit');
    expect(editor.scene().mirror?.ghost?.error).toBe('cockpitLimit');
  });

  it('paints a mirrored stroke as one undo step', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('armor:1');
    editor.pointerDown({ x: 4, y: 1 }, 'left');
    editor.setHover({ x: 4, y: 3 });
    editor.pointerUp();
    expect([1, 2, 3, -1, -2, -3].map((y) => at(editor, 4, y)?.partId ?? null)).toEqual(Array(6).fill("armor"));
    expect(count(editor)).toBe(20);
    expect(editor.draft.undo).toHaveLength(1);
    editor.undo();
    expect(count(editor)).toBe(14);
  });

  it('removes the mirrored part with the right button and with Delete, in one step', () => {
    const { editor } = setup();
    editor.toggleMirror();
    click(editor, 2, 1, 'right');
    expect(at(editor, 2, 1)).toBeNull();
    expect(at(editor, 2, -1)).toBeNull();
    expect(editor.draft.undo).toHaveLength(1);
    editor.setHover({ x: -1, y: 1 });
    editor.removeHovered();
    expect(at(editor, -1, -1)).toBeNull();
    expect(count(editor)).toBe(10);
    editor.undo();
    editor.undo();
    expect(count(editor)).toBe(14);
  });

  it('never removes the cockpit through the mirror', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.toggleMirrorAxis();
    // seam y = ½: the fuel tank (1, 1) mirrors onto the cockpit (1, 0)
    click(editor, 1, 1, 'right');
    expect(at(editor, 1, 1)).toBeNull();
    expect(at(editor, 1, 0)?.partId).toBe('cockpit');
  });

  it('does not mirror moves', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.pointerDown({ x: 1, y: 1 }, 'left');
    editor.setHover({ x: 4, y: 3 });
    expect(editor.scene().mirror?.ghost).toBeNull();
    editor.pointerUp();
    expect(at(editor, 4, 3)?.partId).toBe('fuelTank');
    expect(at(editor, 4, -3)).toBeNull();
    expect(at(editor, 1, -1)?.partId).toBe('radar');
  });

  it('the price of changes counts both parts', () => {
    const { editor } = setup({});
    editor.toggleMirror();
    editor.select('armor:1');
    click(editor, 4, 2);
    const parts = editor.view().cost.lines.reduce((n, l) => n + (l.parts['armor:1'] ?? 0), 0);
    expect(parts).toBe(2);
  });
});

describe('ShipyardEditor – Shift+M mirrors the selection', () => {
  it('asks for a selection first', () => {
    const { editor } = setup();
    expect(editor.mirrorSelection()).toEqual({ text: 'Najprv vyber diely (Shift+ťah alebo dvojklik)', kind: 'info' });
  });

  it('mirrors the selection across its own long axis in one undo step', () => {
    const { editor } = setup();
    // fuel tank (1, 1) and radar (1, −1): rows −1…1, so they swap sides
    editor.pointerDown({ x: 1, y: 1 }, 'left', false, true);
    editor.pointerUp();
    editor.pointerDown({ x: 1, y: -1 }, 'left', false, true);
    editor.pointerUp();
    expect(editor.selection).toHaveLength(2);
    expect(editor.mirrorSelection()).toEqual({ text: 'Výber zrkadlený', kind: 'ok' });
    expect(at(editor, 1, 1)?.partId).toBe('radar');
    expect(at(editor, 1, -1)?.partId).toBe('fuelTank');
    expect(editor.draft.undo).toHaveLength(1);
    editor.undo();
    expect(at(editor, 1, 1)?.partId).toBe('fuelTank');
  });

  it('flips a single part in place (engine rot 3 → rot 1)', () => {
    const { editor } = setup();
    editor.pointerDown({ x: 0, y: 2 }, 'left', false, true);
    editor.pointerUp();
    editor.mirrorSelection();
    expect(at(editor, 0, 2)).toMatchObject({ partId: 'engine', rot: 1 });
  });

  it('keeps the cockpit where it is when the whole ship is mirrored', () => {
    const { editor } = setup();
    editor.selectAll();
    editor.mirrorSelection();
    expect(at(editor, 1, 0)?.partId).toBe('cockpit');
    expect(at(editor, 1, 1)?.partId).toBe('radar');
    expect(count(editor)).toBe(14);
  });

  it('refuses a mirrored selection that does not fit', () => {
    const { editor } = setup();
    // fuel tank (1, 1) + engine (0, 2): rows 1…2 → the engine would land on the cargo (0, 1)
    editor.pointerDown({ x: 1, y: 1 }, 'left', false, true);
    editor.pointerUp();
    editor.pointerDown({ x: 0, y: 2 }, 'left', false, true);
    editor.pointerUp();
    expect(editor.mirrorSelection()).toEqual({ text: 'Zrkadlený výber sa nezmestí: Bunka je obsadená', kind: 'error' });
    expect(editor.draft.undo).toHaveLength(0);
  });
});

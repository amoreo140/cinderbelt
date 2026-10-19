// Shaped armour in the shipyard editor (SL2 E2 U1, §2.3, §2.7):
// the shape in hand, Tab / Shift+Tab, the reshape stroke (remove + place for a damaged plate), mirrored
// shapes and the eyedropper.
import { describe, expect, it } from 'vitest';
import type { PartId, PartInventory } from '../data/parts';
import type { ShapeId } from '../data/shapes';
import { emptyCargo, type Cargo } from '../data/resources';
import { tx } from '../i18n';
import { setLocale } from '../i18n/locale';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { HpMap, Rotation, ShipGrid } from '../sim/ship/types';
import { partAt } from '../sim/shipyard/editor';
import type { ShipyardContext } from '../sim/shipyard/design';
import { ShipyardEditor, type ShipyardSource } from './shipyardEditor';

type Extra = [PartId, number, number, Rotation?, 1?, ShapeId?];

/** The starter ship (cockpit (1, 0), mirror axis y = 0) plus `extra` parts (ids 15…). */
function setup(extra: Extra[] = [], hp: [number, number][] = [], inventory: PartInventory = { 'armor:1': 6 }, ctx: Partial<ShipyardContext> = {}) {
  setLocale('sk');
  const starter = createStarterShip().parts.map((p) => [p.partId, p.x, p.y, p.rot] as Extra);
  const state = { grid: createGrid([...starter, ...extra]) as ShipGrid, hp: new Map(hp) as HpMap, inventory: { ...inventory } };
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
      ...ctx,
    }),
  };
  return { state, editor: new ShipyardEditor(source) };
}

const at = (e: ShipyardEditor, x: number, y: number) => partAt(e.draft.grid, x, y);
const click = (e: ShipyardEditor, x: number, y: number) => {
  const error = e.pointerDown({ x, y }, 'left');
  e.pointerUp();
  return error;
};
/** A station storage with plenty of every resource (repairs are affordable). */
const STOCKED: Cargo = { iron: 1000, copper: 1000, ice: 1000, titanium: 1000 };
const ORDER: (ShapeId | null)[] = [null, 'wedge', 'chamfer', 'round', 'arc', 'half', 'nose', 'wingL', 'wingR', 'nose2x1'];

describe('ShipyardEditor – shape in hand', () => {
  it('Tab / Shift+Tab cycle the hand full → wedge → … → nose 2×1 → full, both ways', () => {
    const { editor } = setup();
    editor.select('armor:1');
    expect(editor.shape).toBeNull();
    const seen: (ShapeId | null)[] = [];
    for (let i = 0; i < ORDER.length; i++) {
      seen.push(editor.shape);
      expect(editor.cycleShape(1)).toBeNull();
    }
    expect(seen).toEqual(ORDER);
    expect(editor.shape).toBeNull();
    const back: (ShapeId | null)[] = [];
    for (let i = 0; i < ORDER.length; i++) {
      editor.cycleShape(-1);
      back.push(editor.shape);
    }
    expect(back).toEqual([...ORDER.slice(1).reverse(), null]);
  });

  it('the ghost carries the shape and changes with Tab (the cache key includes the shape)', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.setHover({ x: 4, y: 2 });
    const full = editor.ghost()!;
    expect(full.shape).toBeUndefined();
    editor.cycleShape(1);
    expect(editor.ghost()).toMatchObject({ key: 'armor:1', x: 4, y: 2, rot: 0, shape: 'wedge', error: null });
    expect(editor.scene().ghost?.shape).toBe('wedge');
    // a 2×1 wing anchored at the cursor, blocked by the engine at (0, 2) when it would reach it
    editor.setShape('wingL');
    expect(editor.ghost()).toMatchObject({ shape: 'wingL', x: 4, y: 2, error: null });
    editor.setHover({ x: 1, y: 2 });
    expect(editor.ghost()).toMatchObject({ shape: 'wingL', x: 1, y: 2, error: null });
    editor.setHover({ x: -1, y: 2 });
    expect(editor.ghost()?.error).toBe('occupied');
  });

  it('places the part in the hand shape', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.setShape('wingR');
    expect(click(editor, 4, 2)).toBeNull();
    expect(at(editor, 5, 2)).toMatchObject({ partId: 'armor', x: 4, y: 2, shape: 'wingR' });
    editor.setShape(null);
    click(editor, 4, 3);
    expect(at(editor, 4, 3)).not.toHaveProperty('shape');
  });

  it('a non-armour part resets the hand; a tier change keeps it; setShape ignores non-armour', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.setShape('chamfer');
    editor.setTier(2);
    expect(editor.selected).toBe('armor:2');
    expect(editor.shape).toBe('chamfer');
    editor.select('cannon:1');
    expect(editor.shape).toBeNull();
    editor.setShape('wedge');
    expect(editor.shape).toBeNull();
    editor.select('armor:1');
    expect(editor.shape).toBeNull();
  });

  it('Tab with a non-armour part in hand or over a non-armour part: "Only armor has shapes."', () => {
    const { editor } = setup();
    editor.select('cannon:1');
    expect(editor.cycleShape(1)).toEqual({ text: 'Tvary má len pancier.', kind: 'info' });
    editor.select(null);
    editor.setHover({ x: 1, y: 0 });
    expect(editor.cycleShape(1)).toEqual({ text: 'Tvary má len pancier.', kind: 'info' });
    editor.setHover({ x: 5, y: 5 });
    expect(editor.cycleShape(1)).toBeNull();
    expect(editor.draft.undo).toHaveLength(0);
  });

  it('the eyedropper picks the key and the shape', () => {
    const { editor } = setup([['armor', 3, 1, 1, 1, 'wedge']]);
    editor.eyedrop({ x: 3, y: 1 });
    expect(editor.selected).toBe('armor:1');
    expect(editor.rot).toBe(1);
    expect(editor.shape).toBe('wedge');
    editor.eyedrop({ x: 1, y: 0 });
    expect(editor.selected).toBe('cockpit:1');
    expect(editor.shape).toBeNull();
  });
});

describe('ShipyardEditor – Tab over a placed armour (reshape)', () => {
  it('a full-HP plate is reshaped in place: the id stays, each Tab is one undo step', () => {
    const { editor } = setup([['armor', 3, 1]]);
    const id = at(editor, 3, 1)!.id;
    editor.setHover({ x: 3, y: 1 });
    expect(editor.cycleShape(1)).toBeNull();
    expect(at(editor, 3, 1)).toMatchObject({ id, shape: 'wedge' });
    expect(editor.draft.undo).toHaveLength(1);
    expect(editor.draft.undo[0]).toEqual({ kind: 'ops', ops: [{ op: 'reshape', id, shape: 'wedge' }] });
    editor.cycleShape(1);
    expect(at(editor, 3, 1)).toMatchObject({ id, shape: 'chamfer' });
    expect(editor.draft.undo).toHaveLength(2);
    editor.undo();
    expect(at(editor, 3, 1)?.shape).toBe('wedge');
    editor.cycleShape(-1);
    expect(at(editor, 3, 1)).not.toHaveProperty('shape');
  });

  it('skips shapes whose footprint does not fit (wings and the 2×1 nose next to a part)', () => {
    const { editor } = setup([['armor', 3, 1, 0, 1, 'nose'], ['armor', 4, 1]]);
    const id = at(editor, 3, 1)!.id;
    editor.setHover({ x: 3, y: 1 });
    editor.cycleShape(1);
    expect(at(editor, 3, 1)).toMatchObject({ id });
    expect(at(editor, 3, 1)).not.toHaveProperty('shape');
    editor.cycleShape(-1);
    expect(at(editor, 3, 1)).toMatchObject({ id, shape: 'nose' });
    expect(editor.draft.undo).toHaveLength(2);
  });

  it('a damaged plate goes remove + place in one stroke (new id, repair note), no reshapeDamaged', () => {
    const { editor, state } = setup([['armor', 3, 1]], [], { 'armor:1': 6 }, { storage: STOCKED });
    const id = state.grid.parts.find((p) => p.x === 3 && p.y === 1)!.id;
    state.hp.set(id, 10);
    editor.discard();
    editor.setHover({ x: 3, y: 1 });
    expect(editor.cycleShape(1)).toEqual({ text: 'Poškodený diel sa pri pretvarovaní opraví', kind: 'info' });
    const placed = at(editor, 3, 1)!;
    expect(placed).toMatchObject({ partId: 'armor', shape: 'wedge', x: 3, y: 1, rot: 0 });
    expect(placed.id).not.toBe(id);
    expect(editor.draft.undo).toEqual([
      { kind: 'ops', ops: [{ op: 'remove', id }, { op: 'place', key: 'armor:1', x: 3, y: 1, rot: 0, shape: 'wedge' }] },
    ]);
    expect(editor.view().report.errors.map((e) => e.code)).not.toContain('reshapeDamaged');
    // the new part is at full HP: the next Tab is a plain reshape
    editor.cycleShape(1);
    expect(at(editor, 3, 1)).toMatchObject({ id: placed.id, shape: 'chamfer' });
    editor.undo();
    editor.undo();
    expect(at(editor, 3, 1)).toMatchObject({ id });
  });

  it('without repair material the notice says the plate is scrapped and a fresh one is laid (damagedScrapped)', () => {
    const { editor, state } = setup([['armor', 3, 1]]);
    const id = state.grid.parts.find((p) => p.x === 3 && p.y === 1)!.id;
    state.hp.set(id, 10);
    editor.discard();
    editor.setHover({ x: 3, y: 1 });
    expect(editor.cycleShape(1)).toEqual({ text: tx().shipyardV2.shapes.reshapeScrap(false), kind: 'info' });
    expect(tx().shipyardV2.shapes.reshapeScrap(false)).toMatch(/šrot/);
    const report = editor.view().report;
    expect(report.warnings.map((w) => w.code)).toContain('damagedScrapped');
    expect(report.cost.repairs).toEqual([]);
    expect(report.canCommit).toBe(true);
  });

  it('a station without repairs: the scrap notice names it', () => {
    const { editor, state } = setup([['armor', 3, 1]], [], { 'armor:1': 6 }, { storage: STOCKED, services: { crafting: true, partsMarket: true, repair: false } });
    const id = state.grid.parts.find((p) => p.x === 3 && p.y === 1)!.id;
    state.hp.set(id, 10);
    editor.discard();
    editor.setHover({ x: 3, y: 1 });
    expect(editor.cycleShape(1)).toEqual({ text: tx().shipyardV2.shapes.reshapeScrap(true), kind: 'info' });
  });

  it('neither repair material nor a fresh plate: the notice is an error (the design cannot be confirmed)', () => {
    const { editor, state } = setup([['armor', 3, 1]], [], {}, { services: { crafting: false, partsMarket: false } });
    const id = state.grid.parts.find((p) => p.x === 3 && p.y === 1)!.id;
    state.hp.set(id, 10);
    editor.discard();
    editor.setHover({ x: 3, y: 1 });
    expect(editor.cycleShape(1)).toEqual({ text: tx().shipyardV2.shapes.reshapeStuck, kind: 'error' });
    expect(editor.view().report.canCommit).toBe(false);
  });

  it('a damaged wing keeps its id when the max HP does not change (wing L → wing R)', () => {
    const { editor, state } = setup([['armor', 3, 1, 0, 1, 'wingL']]);
    const id = state.grid.parts.find((p) => p.x === 3 && p.y === 1)!.id;
    state.hp.set(id, 10);
    editor.discard();
    editor.setHover({ x: 4, y: 1 });
    expect(editor.cycleShape(1)).toBeNull();
    expect(at(editor, 3, 1)).toMatchObject({ id, shape: 'wingR' });
    expect(editor.view().report.errors.map((e) => e.code)).not.toContain('reshapeDamaged');
  });
});

describe('ShipyardEditor – shapes in mirror mode', () => {
  it('places the mirrored shape with the hand (wedge rot 0 ↔ rot 3), the mirror ghost shows it', () => {
    const { editor } = setup();
    editor.toggleMirror();
    editor.select('armor:1');
    editor.setShape('wedge');
    editor.setHover({ x: 4, y: 2 });
    expect(editor.mirrorScene()?.ghost).toMatchObject({ x: 4, y: -2, rot: 3, shape: 'wedge', error: null });
    click(editor, 4, 2);
    expect(at(editor, 4, 2)).toMatchObject({ shape: 'wedge', rot: 0 });
    expect(at(editor, 4, -2)).toMatchObject({ shape: 'wedge', rot: 3 });
    expect(editor.draft.undo).toHaveLength(1);
    editor.setShape('wingL');
    editor.setHover({ x: 4, y: 3 });
    expect(editor.mirrorScene()?.ghost).toMatchObject({ x: 4, y: -3, rot: 0, shape: 'wingR' });
  });

  it('Tab reshapes the mirror counterpart with the mirrored shape in the same stroke', () => {
    const { editor } = setup([['armor', 3, 2], ['armor', 3, -2]]);
    editor.toggleMirror();
    const a = at(editor, 3, 2)!.id;
    const b = at(editor, 3, -2)!.id;
    editor.setHover({ x: 3, y: 2 });
    editor.cycleShape(1);
    expect(at(editor, 3, 2)).toMatchObject({ id: a, shape: 'wedge', rot: 0 });
    expect(at(editor, 3, -2)).toMatchObject({ id: b, shape: 'wedge', rot: 3 });
    expect(editor.draft.undo).toHaveLength(1);
    // Shift+Tab from full: nose 2×1, then wing R ↔ wing L on the other side
    editor.undo();
    editor.cycleShape(-1);
    editor.cycleShape(-1);
    expect(at(editor, 3, 2)).toMatchObject({ id: a, shape: 'wingR', rot: 0 });
    expect(at(editor, 3, -2)).toMatchObject({ id: b, shape: 'wingL', rot: 0 });
    expect(editor.draft.undo).toHaveLength(2);
    editor.undo();
    expect(at(editor, 3, 2)).toMatchObject({ shape: 'nose2x1' });
    expect(at(editor, 3, -2)).toMatchObject({ shape: 'nose2x1' });
  });

  it('a counterpart that cannot take the shape stays, only the original changes (notice)', () => {
    const { editor } = setup([['armor', 3, 2, 0, 1, 'nose'], ['armor', 3, -2, 0, 1, 'nose'], ['armor', 4, -2]]);
    editor.toggleMirror();
    editor.setHover({ x: 3, y: 2 });
    const notice = editor.cycleShape(1);
    expect(at(editor, 3, 2)).toMatchObject({ shape: 'wingL' });
    expect(at(editor, 3, -2)).toMatchObject({ shape: 'nose' });
    expect(notice).toEqual({ text: 'Zrkadlový diel sa nepretvaruje: Bunka je obsadená. Pretvaruje sa len originál.', kind: 'info' });
    expect(editor.draft.undo).toHaveLength(1);
  });

  it('a damaged counterpart goes remove + place too, all in one stroke', () => {
    const { editor, state } = setup([['armor', 3, 2], ['armor', 3, -2]]);
    const b = state.grid.parts.find((p) => p.y === -2 && p.x === 3)!.id;
    state.hp.set(b, 5);
    editor.discard();
    editor.toggleMirror();
    editor.setHover({ x: 3, y: 2 });
    editor.cycleShape(1);
    expect(at(editor, 3, -2)).toMatchObject({ shape: 'wedge', rot: 3 });
    expect(at(editor, 3, -2)!.id).not.toBe(b);
    expect(editor.draft.undo).toHaveLength(1);
    expect(editor.view().report.errors.map((e) => e.code)).not.toContain('reshapeDamaged');
  });
});

describe('ShipyardEditor – moving shaped parts', () => {
  it('a dragged shaped part keeps its shape in the ghost and after the drop', () => {
    const { editor } = setup([['armor', 3, 2, 0, 1, 'wingL']]);
    const id = at(editor, 3, 2)!.id;
    editor.pointerDown({ x: 4, y: 2 }, 'left');
    editor.setHover({ x: 5, y: 3 });
    expect(editor.ghost()).toMatchObject({ x: 4, y: 3, shape: 'wingL', movingId: id, error: null });
    expect(editor.scene().origin).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    editor.pointerUp();
    expect(at(editor, 5, 3)).toMatchObject({ id, x: 4, y: 3, shape: 'wingL' });
  });

  it('rotating a placed wing uses its 2×1 footprint', () => {
    const { editor } = setup([['armor', 3, 2, 0, 1, 'wingL']]);
    editor.setHover({ x: 3, y: 2 });
    editor.rotate(1);
    expect(at(editor, 3, 2)).toMatchObject({ rot: 1, shape: 'wingL' });
    expect(at(editor, 3, 3)).toMatchObject({ rot: 1, shape: 'wingL' });
  });
});

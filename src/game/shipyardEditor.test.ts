import { describe, expect, it } from 'vitest';
import type { PartInventory } from '../data/parts';
import { emptyCargo } from '../data/resources';
import { createStarterShip } from '../sim/ship/presets';
import type { HpMap, ShipGrid } from '../sim/ship/types';
import { partAt } from '../sim/shipyard/editor';
import { hotkeyNumber } from './paletteHotkeys';
import { cellsBetween, ShipyardEditor, type ShipyardSource } from './shipyardEditor';

function setup(inventory: PartInventory = { 'armor:1': 2 }) {
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
  return { state, editor: new ShipyardEditor(source) };
}

const count = (e: ShipyardEditor) => e.draft.grid.parts.length;

describe('cellsBetween', () => {
  it('walks every cell of a fast mouse stroke', () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(cellsBetween({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });
});

describe('ShipyardEditor', () => {
  it('places the selected part with a click and shows the ghost', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.setHover({ x: -2, y: 0 });
    expect(editor.ghost()).toMatchObject({ key: 'armor:1', x: -2, y: 0, error: null });
    editor.setHover({ x: 0, y: 0 });
    expect(editor.ghost()?.error).toBe('occupied');
    expect(editor.ghostMessage()).toBe('Bunka je obsadená');
    editor.setHover({ x: -5, y: 0 });
    // free placement: a cell away from the ship is valid (the loose part is marked, not refused)
    expect(editor.ghost()?.error).toBeNull();

    expect(editor.pointerDown({ x: -2, y: 0 }, 'left')).toBeNull();
    editor.pointerUp();
    expect(count(editor)).toBe(15);
    expect(editor.dirty).toBe(true);
    expect(editor.pointerDown({ x: 0, y: 0 }, 'left')).toBe('occupied');
    editor.pointerUp();
    expect(count(editor)).toBe(15);
  });

  it('paints a row in one undo step, skipping invalid cells', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.pointerDown({ x: 3, y: 0 }, 'left');
    editor.setHover({ x: 3, y: 3 }); // fast drag – the cells in between are filled in
    editor.pointerUp();
    expect(count(editor)).toBe(14 + 4);
    expect(editor.draft.undo).toHaveLength(1);
    editor.undo();
    expect(count(editor)).toBe(14);
    editor.redo();
    expect(count(editor)).toBe(18);
  });

  it('erases parts with the right button drag as one step', () => {
    const { editor } = setup();
    editor.pointerDown({ x: 0, y: 2 }, 'right');
    editor.setHover({ x: 0, y: 1 });
    editor.pointerUp();
    expect(count(editor)).toBe(12);
    expect(editor.draft.undo).toHaveLength(1);
    expect(editor.view().cost.lines.find((l) => l.id === 'toStorage')?.text).toContain('Motor T1');
  });

  it('moves a part by dragging and returns it on an invalid drop', () => {
    const { editor } = setup();
    const engine = partAt(editor.draft.grid, 0, 2)!;
    editor.pointerDown({ x: 0, y: 2 }, 'left');
    editor.setHover({ x: 1, y: 2 });
    expect(editor.ghost()).toMatchObject({ key: 'engine:1', x: 1, y: 2, error: null, movingId: engine.id });
    expect(editor.scene().grid.parts.some((p) => p.id === engine.id)).toBe(false);
    expect(editor.scene().origin).toEqual([{ x: 0, y: 2 }]);
    editor.rotate(1);
    editor.pointerUp();
    expect(partAt(editor.draft.grid, 1, 2)).toMatchObject({ id: engine.id, rot: 0 });

    // dropping onto an occupied cell – the part stays in place, no extra undo step
    editor.pointerDown({ x: 1, y: 2 }, 'left');
    editor.setHover({ x: 0, y: 0 });
    expect(editor.ghost()?.error).toBe('occupied');
    expect(editor.pointerUp()).toBe('occupied');
    expect(partAt(editor.draft.grid, 1, 2)?.id).toBe(engine.id);
    expect(editor.draft.undo).toHaveLength(1);
  });

  it('rotates the ghost, or the hovered part in place without a selection', () => {
    const { editor } = setup();
    editor.select('engine:1');
    editor.rotate(1);
    editor.rotate(1);
    expect(editor.rot).toBe(2);
    editor.rotate(-1);
    expect(editor.rot).toBe(1);

    editor.select(null);
    editor.setHover({ x: -1, y: 1 });
    editor.rotate(1);
    expect(partAt(editor.draft.grid, -1, 1)?.rot).toBe(1);
  });

  it('multi-cell parts: ghost footprint, rotation around the grabbed cell, overlap on rotation', () => {
    const { editor } = setup({ 'heavyLaser:1': 1, 'largeCargo:1': 1 });
    editor.select('heavyLaser:1');
    editor.setHover({ x: 3, y: 0 });
    expect(editor.ghost()).toMatchObject({ key: 'heavyLaser:1', x: 3, y: 0, rot: 0, error: null });
    editor.rotate(1);
    // rotated by 90°: occupies (3, 0) and (3, 1) – adjoins the laser (2, 0)
    expect(editor.ghost()).toMatchObject({ x: 3, y: 0, rot: 1, error: null });
    editor.rotate(-1);
    expect(editor.pointerDown({ x: 3, y: 0 }, 'left')).toBeNull();
    editor.pointerUp();
    const laser = partAt(editor.draft.grid, 4, 0)!;
    expect(laser.partId).toBe('heavyLaser');
    expect(partAt(editor.draft.grid, 3, 0)?.id).toBe(laser.id);

    // rotation without a selection around the cell under the cursor (3, 0): it stays covered
    editor.select(null);
    editor.setHover({ x: 3, y: 0 });
    editor.rotate(1);
    expect(partAt(editor.draft.grid, 3, 0)).toMatchObject({ id: laser.id, rot: 1 });
    expect(partAt(editor.draft.grid, 3, 1)?.id).toBe(laser.id);
    expect(partAt(editor.draft.grid, 4, 0)).toBeNull();
    // a further rotation would take the cell (2, 0) with the mining laser – it is not done
    const steps = editor.draft.undo.length;
    editor.rotate(1);
    expect(partAt(editor.draft.grid, 3, 0)).toMatchObject({ id: laser.id, rot: 1 });
    expect(editor.draft.undo.length).toBe(steps);
  });

  it('dragging a multi-cell part keeps the grabbed cell under the cursor, also after rotating', () => {
    const { editor } = setup({ 'largeCargo:1': 1 });
    editor.select('largeCargo:1');
    editor.pointerDown({ x: -1, y: 3 }, 'left');
    editor.pointerUp();
    const cargo = partAt(editor.draft.grid, -1, 3)!;
    expect(cargo.partId).toBe('largeCargo');
    editor.select(null);
    // grabs the top right cell (0, 4) and moves
    editor.pointerDown({ x: 0, y: 4 }, 'left');
    editor.setHover({ x: 1, y: 4 });
    expect(editor.ghost()).toMatchObject({ x: 0, y: 3, movingId: cargo.id });
    editor.rotate(1);
    const g = editor.ghost()!;
    expect(g.rot).toBe(1);
    // the cell under the cursor (1, 4) is still within the ghost's rectangle
    expect(g.x <= 1 && 1 <= g.x + 1 && g.y <= 4 && 4 <= g.y + 1).toBe(true);
  });

  it('removes the hovered part with Delete and picks a part with the eyedropper', () => {
    const { editor } = setup();
    editor.setHover({ x: 0, y: -2 });
    expect(editor.hoveredPart()).not.toBeNull();
    editor.eyedrop({ x: 0, y: -2 });
    expect(editor.selected).toBe('engine:1');
    expect(editor.rot).toBe(1);
    editor.select(null);
    editor.removeHovered();
    expect(partAt(editor.draft.grid, 0, -2)).toBeNull();
  });

  it('selects palette hotkeys and switches tiers', () => {
    const { editor } = setup();
    editor.selectHotkey(2);
    expect(editor.selected).toBe('armor:1');
    editor.toggleTier();
    expect(editor.selected).toBe('armor:2');
    editor.selectHotkey(2);
    expect(editor.selected).toBeNull();
  });

  it('reaches the cannon and the shield generator on the second hotkey row (Shift + 1, 2)', () => {
    const { editor } = setup();
    editor.selectHotkey(hotkeyNumber(1, true));
    expect(editor.selected).toBe('cannon:1');
    editor.selectHotkey(hotkeyNumber(2, true));
    expect(editor.selected).toBe('shield:1');
  });

  it('flags disconnected parts in the hangar scene', () => {
    const { editor } = setup();
    editor.pointerDown({ x: 1, y: 0 }, 'right'); // cockpit gone
    editor.pointerUp();
    editor.pointerDown({ x: 1, y: 1 }, 'right');
    editor.pointerUp();
    const msgs = editor.view().messages.map((m) => m.code);
    expect(msgs).toContain('noCockpit');
    expect(editor.view().canCommit).toBe(false);
  });

  it('highlights the parts of a clicked check message and toggles it off', () => {
    const { editor } = setup();
    editor.pointerDown({ x: 1, y: 1 }, 'right'); // tank gone – the engine (2, 1) hangs loose
    editor.pointerUp();
    editor.pointerDown({ x: 2, y: 0 }, 'right'); // laser gone
    editor.pointerUp();
    const msg = editor.view().messages.find((m) => m.code === 'disconnected')!;
    expect(msg.partIds.length).toBeGreaterThan(0);
    editor.toggleFocus(msg);
    expect(editor.scene().focus).toMatchObject({ tone: 'error', code: 'disconnected', ids: msg.partIds });
    expect(editor.scene().disconnected).toEqual(msg.partIds);
    editor.toggleFocus(msg);
    expect(editor.scene().focus).toBeNull();
  });

  it('refreshes a clean draft and offers a rebase for an edited one when the ship changes', () => {
    const { state, editor } = setup();
    state.inventory = { 'armor:1': 3 };
    editor.sync();
    expect(editor.prompt).toBeNull();
    expect(editor.draft.base.inventory['armor:1']).toBe(3);

    editor.select('armor:1');
    editor.pointerDown({ x: -2, y: 0 }, 'left');
    editor.pointerUp();
    state.inventory = { 'armor:1': 1 };
    editor.sync();
    expect(editor.prompt).toBe('stale');
    expect(editor.rebase()).toBe(0);
    expect(editor.prompt).toBeNull();
    expect(editor.draft.base.inventory['armor:1']).toBe(1);
    expect(count(editor)).toBe(15);
    expect(editor.isStale()).toBe(false);
  });

  it('restores the original ship as one undoable step', () => {
    const { editor } = setup();
    editor.pointerDown({ x: 0, y: 2 }, 'right');
    editor.pointerUp();
    editor.restore();
    expect(editor.dirty).toBe(false);
    editor.undo();
    expect(editor.dirty).toBe(true);
  });

  it('keeps the view and scene objects stable while nothing changes', () => {
    const { editor } = setup();
    const v = editor.view();
    const s = editor.scene();
    expect(editor.view()).toBe(v);
    expect(editor.scene()).toBe(s);
    editor.setHover({ x: 5, y: 5 });
    editor.select('armor:1');
    expect(editor.scene()).not.toBe(s);
  });
});

describe('ShipyardEditor – restore to design (M3.8)', () => {
  function withBlueprint() {
    const blueprint = createStarterShip();
    const lost = blueprint.parts.filter((p) => p.partId === 'radar' || (p.partId === 'engine' && p.x === 0 && p.y === 2)).map((p) => p.id);
    const state = { grid: { nextId: blueprint.nextId, parts: blueprint.parts.filter((p) => !lost.includes(p.id)) } as ShipGrid, hp: new Map() as HpMap };
    const source: ShipyardSource = {
      stationId: 'home',
      ship: () => ({ grid: state.grid, hp: state.hp }),
      inventory: () => ({ 'radar:1': 1 }),
      context: () => ({ ring: 1, services: { crafting: true, partsMarket: true }, credits: 5000, storage: emptyCargo(), cargo: emptyCargo(), fuel: 0 }),
      blueprint: () => blueprint,
    };
    return { blueprint, state, editor: new ShipyardEditor(source) };
  }

  it('reports what the ship lost and shows the sockets in the hangar', () => {
    const { editor } = withBlueprint();
    expect(editor.restoreInfo()).toEqual({ missing: { 'radar:1': 1, 'engine:1': 1 }, missingCount: 2, damaged: 0, available: true, applied: false });
    expect(editor.scene().blueprint).toEqual([{ x: 1, y: -1 }, { x: 0, y: 2 }]);
  });

  it('rebuilds the draft from the blueprint in one undo step – radar from storage, engine bought', () => {
    const { blueprint, editor } = withBlueprint();
    const plan = editor.restoreDesign();
    expect(plan).toMatchObject({ missing: 2, repaired: 0, unplaced: 0 });
    expect(editor.draft.grid.parts).toHaveLength(blueprint.parts.length);
    expect(editor.restoreInfo().applied).toBe(true);
    expect(editor.scene().blueprint).toBeNull();
    const cost = editor.view().report.cost;
    expect(cost.fromStorage).toEqual({ 'radar:1': 1 });
    // no materials in storage or cargo – the engine is bought by the usual draft rules
    expect(cost.buy).toEqual({ 'engine:1': 1 });
    expect(editor.view().canCommit).toBe(true);
    editor.undo();
    expect(editor.draft.grid.parts).toHaveLength(blueprint.parts.length - 2);
  });

  it('swaps damaged parts (repair line in the cost) even when nothing is missing', () => {
    const { state, editor } = withBlueprint();
    state.grid = createStarterShip();
    state.hp.set(2, 1);
    editor.discard();
    // the ship no longer comes from that blueprint (a full starter ship has the lost ids back) – only repair
    const plan = editor.restoreDesign();
    expect(plan).toMatchObject({ repaired: 1 });
    // no iron for the repair here, so the worn part is scrapped and a new one bought (existing rules)
    const cost = editor.view().report.cost;
    expect(cost.repairs.length + Object.keys(cost.scrapped).length).toBe(1);
  });

  it('does nothing for an intact ship', () => {
    const { state, editor, blueprint } = withBlueprint();
    state.grid = blueprint;
    editor.discard();
    expect(editor.restoreInfo().available).toBe(false);
    expect(editor.restoreDesign()).toBeNull();
  });
});

describe('ShipyardEditor – restore when the swaps are too expensive (M3.8)', () => {
  it('puts the lost parts back and leaves the damaged ones', () => {
    const blueprint = createStarterShip();
    const radar = blueprint.parts.find((p) => p.partId === 'radar')!.id;
    const grid = { nextId: blueprint.nextId, parts: blueprint.parts.filter((p) => p.id !== radar) };
    const hp: HpMap = new Map([[2, 1]]);
    const editor = new ShipyardEditor({
      stationId: 'home',
      ship: () => ({ grid, hp }),
      inventory: () => ({ 'radar:1': 1 }),
      // 15 kr: the radar's install fee, not a new gyro
      context: () => ({ ring: 1, services: { crafting: true, partsMarket: true }, credits: 15, storage: emptyCargo(), cargo: emptyCargo(), fuel: 0 }),
      blueprint: () => blueprint,
    });
    const plan = editor.restoreDesign();
    expect(plan).toMatchObject({ missing: 1, repaired: 0, skippedRepairs: 1 });
    expect(editor.view().canCommit).toBe(true);
    expect(editor.view().report.cost.fromStorage).toEqual({ 'radar:1': 1 });
  });
});

describe('ShipyardEditor – free placement (Shipyard 2.0)', () => {
  it('places a part loose, marks it and tags its piece; connecting it clears the mark', () => {
    const { editor } = setup();
    editor.select('armor:1');
    expect(editor.pointerDown({ x: 5, y: 5 }, 'left')).toBeNull();
    editor.pointerUp();
    editor.select(null);
    expect(count(editor)).toBe(15);
    const view = editor.view();
    expect(view.disconnected).toEqual([15]);
    expect(view.canCommit).toBe(false);
    expect(view.messages[0]).toMatchObject({ severity: 'error', code: 'disconnected' });
    expect(editor.scene().loose).toEqual({ cells: [{ x: 5, y: 5 }], label: 'NEPRIPOJENÉ' });
    // drag it next to the hull
    editor.pointerDown({ x: 5, y: 5 }, 'left');
    editor.setHover({ x: 3, y: 0 });
    expect(editor.pointerUp()).toBeNull();
    expect(editor.view().disconnected).toEqual([]);
    expect(editor.view().canCommit).toBe(true);
    expect(editor.scene().loose).toBeNull();
  });
});

describe('ShipyardEditor – group selection', () => {
  const shiftClick = (editor: ShipyardEditor, cell: { x: number; y: number }) => {
    editor.pointerDown(cell, 'left', false, true);
    editor.pointerUp();
  };

  it('Shift + click toggles parts, a click outside the selection clears it', () => {
    const { editor } = setup();
    shiftClick(editor, { x: -1, y: 1 });
    shiftClick(editor, { x: -1, y: -1 });
    expect(editor.selection).toEqual([9, 10]);
    shiftClick(editor, { x: -1, y: 1 });
    expect(editor.selection).toEqual([10]);
    shiftClick(editor, { x: 6, y: 6 }); // empty cell – nothing changes
    expect(editor.selection).toEqual([10]);
    editor.pointerDown({ x: 1, y: 0 }, 'left');
    editor.pointerUp();
    expect(editor.selection).toEqual([]);
  });

  it('Shift + drag selects every part with a cell in the box (shown while dragging)', () => {
    const { editor } = setup();
    editor.pointerDown({ x: -1, y: -1 }, 'left', false, true);
    editor.setHover({ x: -1, y: 1 });
    expect(editor.scene().box).toEqual({ min: { x: -1, y: -1 }, max: { x: -1, y: 1 } });
    expect(editor.ghost()).toBeNull();
    editor.pointerUp();
    expect(editor.selection).toEqual([4, 9, 10]);
    expect(editor.scene().box).toBeNull();
    expect(editor.scene().selection).toEqual([4, 9, 10]);
  });

  it('double click selects the connected piece, Ctrl+A everything, Esc clears', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.pointerDown({ x: 5, y: 5 }, 'left');
    editor.pointerUp();
    editor.select(null);
    editor.selectPiece({ x: 5, y: 5 });
    expect(editor.selection).toEqual([15]);
    editor.selectPiece({ x: 0, y: 0 });
    expect(editor.selection).toHaveLength(14);
    editor.selectPiece({ x: 6, y: -6 });
    expect(editor.selection).toEqual([]);
    editor.selectAll();
    expect(editor.selection).toHaveLength(15);
    expect(editor.clearSelection()).toBe(true);
    expect(editor.clearSelection()).toBe(false);
  });

  it('drags the selection as one: ghost with per-cell validity, one undo step, mount fee per part', () => {
    const { editor } = setup();
    shiftClick(editor, { x: -1, y: 1 });
    shiftClick(editor, { x: -1, y: -1 });
    editor.pointerDown({ x: -1, y: 1 }, 'left');
    expect(editor.dragging).toBe(true);
    // over the ship: engine 9 would land on the cargo hold (0, 1) – red cell, the rest green
    editor.setHover({ x: 0, y: 1 });
    const bad = editor.groupGhost()!;
    expect(bad.error).toBe('occupied');
    expect(bad.cells).toEqual([{ x: 0, y: 1, ok: false }, { x: 0, y: -1, ok: false }]);
    // the scene shows the ship without the group and the old cells dashed
    const scene = editor.scene();
    expect(scene.grid.parts.map((p) => p.id)).not.toContain(9);
    expect(scene.origin).toHaveLength(2);
    expect(scene.group).toBe(bad);
    editor.setHover({ x: -1, y: 4 });
    expect(editor.groupGhost()).toMatchObject({ error: null });
    const undoBefore = editor.draft.undo.length;
    expect(editor.pointerUp()).toBeNull();
    expect(editor.draft.undo.length).toBe(undoBefore + 1);
    const at = (id: number) => editor.draft.grid.parts.find((p) => p.id === id);
    expect(at(9)).toMatchObject({ x: -1, y: 4 });
    expect(at(10)).toMatchObject({ x: -1, y: 2 });
    expect(editor.selection).toEqual([9, 10]);
    expect(editor.view().disconnected).toEqual([9]);
    expect(editor.view().cost.total).toBe(20);
    editor.undo();
    expect(at(9)).toMatchObject({ x: -1, y: 1 });
    expect(at(10)).toMatchObject({ x: -1, y: -1 });
    editor.redo();
    expect(at(9)).toMatchObject({ x: -1, y: 4 });
  });

  it('a drop on an invalid spot keeps the group where it was', () => {
    const { editor } = setup();
    shiftClick(editor, { x: -1, y: 1 });
    shiftClick(editor, { x: -1, y: -1 });
    const before = editor.draft;
    editor.pointerDown({ x: -1, y: 1 }, 'left');
    editor.setHover({ x: 0, y: 1 });
    expect(editor.pointerUp()).toBe('occupied');
    expect(editor.draft).toBe(before);
  });

  it('R turns the dragged group around the grabbed cell', () => {
    const { editor } = setup();
    shiftClick(editor, { x: -1, y: 1 });
    shiftClick(editor, { x: -1, y: -1 });
    editor.pointerDown({ x: -1, y: 1 }, 'left');
    editor.setHover({ x: -4, y: 4 });
    editor.rotate(1);
    const ghost = editor.groupGhost()!;
    // engine 9 is grabbed (stays at the cursor), engine 10 was 2 cells below it – now 2 cells right of it
    expect(ghost.parts).toEqual([
      { id: 9, key: 'engine:1', x: -4, y: 4, rot: 1, ok: true },
      { id: 10, key: 'engine:1', x: -2, y: 4, rot: 1, ok: true },
    ]);
    editor.pointerUp();
    expect(editor.draft.grid.parts.find((p) => p.id === 10)).toMatchObject({ x: -2, y: 4, rot: 1 });
  });

  it('R on a selected part turns the whole selection in place (one step); Delete sends it to storage', () => {
    const { editor } = setup();
    shiftClick(editor, { x: -1, y: 1 });
    shiftClick(editor, { x: -1, y: -1 });
    editor.setHover({ x: -1, y: -1 });
    editor.rotate(1);
    const at = (id: number) => editor.draft.grid.parts.find((p) => p.id === id);
    expect(at(10)).toMatchObject({ x: -1, y: -1, rot: 1 });
    expect(at(9)).toMatchObject({ x: -3, y: -1, rot: 1 });
    expect(editor.draft.undo).toHaveLength(1);
    editor.removeHovered();
    expect(count(editor)).toBe(12);
    expect(editor.draft.undo).toHaveLength(2);
    expect(editor.selection).toEqual([]);
    expect(editor.view().report.cost.toStorage).toEqual({ 'engine:1': 2 });
    editor.undo();
    expect(count(editor)).toBe(14);
  });
});

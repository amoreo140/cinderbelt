// "Build from a template" in the shipyard editor (M4a T4): the template becomes the draft in one undo step,
// and the price of changes is what building the same ship by hand costs.
import { describe, expect, it } from 'vitest';
import { placedKey, type PartInventory } from '../data/parts';
import { emptyCargo } from '../data/resources';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { HpMap, ShipGrid } from '../sim/ship/types';
import type { ShipyardContext } from '../sim/shipyard/design';
import { applyStroke, createDraft } from '../sim/shipyard/draft';
import type { EditorOp } from '../sim/shipyard/editor';
import { normalizeTemplate } from '../sim/templates/normalize';
import type { ShipTemplate } from '../sim/templates/types';
import { ShipyardEditor, type ShipyardSource } from './shipyardEditor';
import { buildShipyardView } from './shipyardView';

const ctx = (): ShipyardContext => ({
  ring: 1,
  services: { crafting: true, partsMarket: true },
  credits: 50_000,
  storage: emptyCargo(),
  cargo: emptyCargo(),
  fuel: 0,
});

function setup(inventory: PartInventory = {}, grid: ShipGrid = createStarterShip()) {
  const hp: HpMap = new Map();
  const source: ShipyardSource = { stationId: 'home', ship: () => ({ grid, hp }), inventory: () => inventory, context: ctx, blueprint: () => grid };
  return { grid, hp, inventory, editor: new ShipyardEditor(source) };
}

/** A miner: the starter's cockpit, a gyro, two lasers, a cargo hold and an engine. */
const MINER = createGrid([
  ['cockpit', 0, 0],
  ['gyro', -1, 0],
  ['miningLaser', 1, 0, 0],
  ['miningLaser', 0, 1, 0],
  ['cargo', 0, -1],
  ['engine', -2, 0, 0],
]);
const template = (grid: ShipGrid, name = 'Ťažiar'): ShipTemplate => ({ name, parts: normalizeTemplate(grid)! });

const sortedKeys = (grid: ShipGrid) => normalizeTemplate(grid);

describe('ShipyardEditor.applyTemplate', () => {
  it('loads the template as a dirty draft in one undo step', () => {
    const { editor } = setup();
    expect(editor.dirty).toBe(false);
    const plan = editor.applyTemplate(template(MINER));
    expect(plan.ops.length).toBeGreaterThan(0);
    expect(editor.dirty).toBe(true);
    expect(sortedKeys(editor.draft.grid)).toEqual(normalizeTemplate(MINER));
    expect(editor.appliedTemplate).toBe('Ťažiar');
    // a template load is not "restore to design"
    expect(editor.restoreInfo().applied).toBe(false);
    editor.undo();
    expect(editor.dirty).toBe(false);
    expect(editor.appliedTemplate).toBeNull();
  });

  it('replaces earlier edits (undo brings them back)', () => {
    const { editor } = setup({ 'armor:1': 1 });
    editor.select('armor:1');
    editor.pointerDown({ x: -3, y: 3 }, 'left');
    editor.pointerUp();
    const edited = editor.draft.grid;
    editor.applyTemplate(template(MINER));
    expect(sortedKeys(editor.draft.grid)).toEqual(normalizeTemplate(MINER));
    editor.undo();
    expect(editor.draft.grid).toEqual(edited);
  });

  it('the price of changes equals building the same ship by hand', () => {
    const { editor, grid, hp, inventory } = setup({ 'miningLaser:1': 1 });
    const plan = editor.applyTemplate(template(MINER));
    const viaTemplate = editor.view().report.cost;

    // the same edits made by hand (remove, drag the reused parts, place the new ones): the same price
    const byHand = applyStroke(createDraft('home', grid, hp, inventory), plan.ops);
    expect(byHand.errors).toEqual([]);
    expect(viaTemplate).toEqual(buildShipyardView(byHand.draft, ctx(), 1).report.cost);

    // a naive rebuild (everything off but the cockpit, every part placed new) never costs less
    const cockpit = grid.parts.find((p) => p.partId === 'cockpit')!;
    const ops: EditorOp[] = grid.parts.filter((p) => p !== cockpit).map((p) => ({ op: 'remove', id: p.id }));
    const at = editor.draft.grid.parts.find((p) => p.partId === 'cockpit')!;
    // the template's cockpit stands where the ship's did (same key)
    expect([at.x, at.y]).toEqual([cockpit.x, cockpit.y]);
    for (const p of MINER.parts) {
      if (p.partId === 'cockpit') continue;
      ops.push({ op: 'place', key: placedKey(p), x: p.x + cockpit.x, y: p.y + cockpit.y, rot: p.rot });
    }
    const manual = applyStroke(createDraft('home', grid, hp, inventory), ops);
    expect(manual.errors).toEqual([]);
    expect(sortedKeys(manual.draft.grid)).toEqual(normalizeTemplate(MINER));
    const naive = buildShipyardView(manual.draft, ctx(), 1).report.cost;
    expect(viaTemplate.fromStorage).toEqual(naive.fromStorage);
    expect(viaTemplate.buyCredits + viaTemplate.craftCredits).toBe(naive.buyCredits + naive.craftCredits);
    expect(viaTemplate.credits).toBeLessThanOrEqual(naive.credits);
  });

  it('a template equal to the ship gives back the ship', () => {
    const { editor, grid } = setup({ 'armor:1': 1 });
    editor.select('armor:1');
    editor.pointerDown({ x: -3, y: 3 }, 'left');
    editor.pointerUp();
    expect(editor.dirty).toBe(true);
    const plan = editor.applyTemplate(template(grid));
    expect(plan.ops).toEqual([]);
    expect(editor.dirty).toBe(false);
  });
});

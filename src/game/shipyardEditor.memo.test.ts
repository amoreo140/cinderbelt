// M28 from the M2a–M3b code review: the shipyard editor is drawn every frame – with unchanged inputs it must not
// re-check placement or re-serialise the station context again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyCargo } from '../data/resources';
import { createStarterShip } from '../sim/ship/presets';
import type { HpMap, ShipGrid } from '../sim/ship/types';
import * as editorRules from '../sim/shipyard/editor';
import { ShipyardEditor, type ShipyardSource } from './shipyardEditor';

vi.mock('../sim/shipyard/editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../sim/shipyard/editor')>();
  return { ...mod, checkPlacement: vi.fn(mod.checkPlacement) };
});

function setup() {
  const grid = createStarterShip() as ShipGrid;
  const ctx = { credits: 5000 };
  const source: ShipyardSource = {
    stationId: 'home',
    ship: () => ({ grid, hp: new Map() as HpMap }),
    inventory: () => ({ 'armor:1': 2 }),
    // every call a new object (like shipyardContext from the simulation state)
    context: () => ({
      ring: 1,
      services: { crafting: true, partsMarket: true },
      credits: ctx.credits,
      storage: emptyCargo(),
      cargo: emptyCargo(),
      fuel: 0,
    }),
  };
  return { ctx, editor: new ShipyardEditor(source) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShipyardEditor per-frame work (M28)', () => {
  it('reuses the ghost, the view and the scene while nothing changes', () => {
    const { editor } = setup();
    editor.select('armor:1');
    editor.setHover({ x: -2, y: 0 });
    const first = editor.scene();
    const check = vi.mocked(editorRules.checkPlacement);
    check.mockClear();
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let frame = 0; frame < 120; frame++) expect(editor.scene()).toBe(first);
    expect(check).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
  });

  it('recomputes when an input changes (hover, rotation, station context)', () => {
    const { ctx, editor } = setup();
    editor.select('armor:1');
    editor.setHover({ x: -2, y: 0 });
    const a = editor.scene();
    const view = editor.view();
    editor.setHover({ x: -3, y: 0 });
    const b = editor.scene();
    expect(b).not.toBe(a);
    expect(b.ghost).toMatchObject({ x: -3, y: 0 });
    editor.rotate(1);
    expect(editor.scene().ghost?.rot).toBe(1);
    expect(editor.view()).toBe(view);
    ctx.credits = 10;
    expect(editor.view()).not.toBe(view);
  });
});

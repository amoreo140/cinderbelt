import { describe, expect, it } from 'vitest';
import { blueprintMatches, blueprintStatus, missingParts, samePlacement } from './blueprint';
import { createGrid } from './grid';
import { createStarterShip } from './presets';
import { shaped } from './testing';
import type { ShipGrid } from './types';

const without = (grid: ShipGrid, ...ids: number[]): ShipGrid => ({ nextId: grid.nextId, parts: grid.parts.filter((p) => !ids.includes(p.id)) });
const idAt = (grid: ShipGrid, x: number, y: number) => grid.parts.find((p) => p.x === x && p.y === y)!.id;

describe('ship blueprint', () => {
  it('reports nothing missing when the ship is the blueprint', () => {
    const grid = createStarterShip();
    expect(blueprintMatches(grid, grid)).toBe(true);
    expect(missingParts(grid, grid)).toEqual([]);
  });

  it('lists parts the ship lost compared to the blueprint', () => {
    const blueprint = createStarterShip();
    const armorless = without(blueprint, idAt(blueprint, 0, 2), idAt(blueprint, 1, -1));
    expect(missingParts(blueprint, armorless).map((p) => [p.partId, p.x, p.y])).toEqual([
      ['radar', 1, -1],
      ['engine', 0, 2],
    ]);
  });

  it('ignores a blueprint the ship does not come from (a part not in the blueprint, or moved)', () => {
    const blueprint = createStarterShip();
    const extra: ShipGrid = { nextId: blueprint.nextId + 1, parts: [...blueprint.parts, { id: blueprint.nextId, partId: 'armor', tier: 1, x: 3, y: 0, rot: 0 }] };
    expect(blueprintMatches(blueprint, extra)).toBe(false);
    expect(missingParts(blueprint, without(extra, idAt(blueprint, 0, 2)))).toEqual([]);
    const moved: ShipGrid = { ...blueprint, parts: blueprint.parts.map((p) => (p.partId === 'radar' ? { ...p, rot: 1 as const } : p)) };
    expect(blueprintMatches(blueprint, moved)).toBe(false);
  });

  it('counts missing and damaged parts', () => {
    const blueprint = createStarterShip();
    const ship = without(blueprint, idAt(blueprint, 0, 2));
    const hp = new Map([[idAt(blueprint, 1, 1), 3], [idAt(blueprint, 0, 0), 1]]);
    const status = blueprintStatus(blueprint, ship, hp);
    expect(status.missing.map((p) => p.partId)).toEqual(['engine']);
    expect(status.damaged).toBe(2);
    expect(blueprintStatus(blueprint, blueprint, new Map())).toEqual({ missing: [], damaged: 0 });
  });
});

describe('ship blueprint – shapes (SL2 E2)', () => {
  it('a part laid in another shape is not the same placement', () => {
    const blueprint = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wedge']]);
    const wedge = blueprint.parts[1]!;
    expect(samePlacement(wedge, { ...wedge })).toBe(true);
    expect(samePlacement(wedge, { ...wedge, shape: 'chamfer' })).toBe(false);
    const { shape: _s, ...full } = wedge;
    expect(samePlacement(wedge, full)).toBe(false);
    expect(blueprintMatches(blueprint, shaped(blueprint, 2, null))).toBe(false);
    expect(missingParts(blueprint, without(blueprint, 2))).toEqual([wedge]);
  });
});

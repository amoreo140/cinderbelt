import { describe, expect, it } from 'vitest';
import { createGrid, partCells } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { Rotation, ShipGrid } from '../sim/ship/types';
import { connectorPlacements, type ConnectorPlacement } from './connectors';

const sortKey = (c: { kind: string; x: number; y: number; rot: number }) => `${c.kind}:${c.x}:${c.y}:${c.rot}`;
const sorted = <T extends { kind: string; x: number; y: number; rot: number }>(list: T[]) =>
  [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

describe('connectorPlacements', () => {
  it('places nothing for a single cell', () => {
    expect(connectorPlacements(createGrid([['cockpit', 0, 0]]))).toEqual([]);
  });

  it('joins horizontal neighbours with an edge at rotation 0', () => {
    expect(connectorPlacements(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]))).toEqual([
      { kind: 'edge', x: 0.5, y: 0, rot: 0 },
    ]);
  });

  it('joins vertical neighbours with an edge at rotation 90°', () => {
    expect(connectorPlacements(createGrid([['cockpit', 3, -2], ['armor', 3, -1]]))).toEqual([
      { kind: 'edge', x: 3, y: -1.5, rot: 1 },
    ]);
  });

  it('adds four edges and one corner to a 2x2 block', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 0, 1], ['armor', 1, 1]]);
    expect(sorted(connectorPlacements(grid))).toEqual(
      sorted([
        { kind: 'edge', x: 0.5, y: 0, rot: 0 },
        { kind: 'edge', x: 0.5, y: 1, rot: 0 },
        { kind: 'edge', x: 0, y: 0.5, rot: 1 },
        { kind: 'edge', x: 1, y: 0.5, rot: 1 },
        { kind: 'corner', x: 0.5, y: 0.5, rot: 0 },
      ]),
    );
  });

  it('has no corner in an L shape', () => {
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 0, 1]]);
    const list = connectorPlacements(grid);
    expect(list.filter((c) => c.kind === 'corner')).toEqual([]);
    expect(list).toHaveLength(2);
  });

  it('skips seams inside one multi-cell part (2x2 large cargo: no internal edges, no centre corner)', () => {
    const grid = createGrid([['largeCargo', 0, 0], ['cockpit', 2, 0]]);
    expect(connectorPlacements(grid)).toEqual([{ kind: 'edge', x: 1.5, y: 0, rot: 0 }]);
  });

  it('a 2x1 heavy laser joins its neighbours on every outer edge but not across its own seam', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const grid = createGrid([['cockpit', 0, 0], ['heavyLaser', 1, 0, rot]]);
      const list = connectorPlacements(grid);
      expect(list).toEqual([{ kind: 'edge', x: 0.5, y: 0, rot: 0 }]);
    }
  });

  it('caps a T-junction where a 2x1 meets two other parts (corner unless all four cells are one part)', () => {
    // heavy laser (0,1)-(1,1) above the cockpit (0,0) and the armour (1,0)
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['heavyLaser', 0, 1, 0]]);
    expect(sorted(connectorPlacements(grid))).toEqual(
      sorted([
        { kind: 'edge', x: 0.5, y: 0, rot: 0 },
        { kind: 'edge', x: 0, y: 0.5, rot: 1 },
        { kind: 'edge', x: 1, y: 0.5, rot: 1 },
        { kind: 'corner', x: 0.5, y: 0.5, rot: 0 },
      ]),
    );
  });

  it('matches preview_m2d.connector_placements_multi for a ship with a large cargo hold and a heavy laser', () => {
    // cockpit (0,0), large cargo (1..2, 0..1), heavy laser turned by 90° (−1, 0..1), armour (0, 1)
    const grid = createGrid([['cockpit', 0, 0], ['largeCargo', 1, 0], ['heavyLaser', -1, 0, 1], ['armor', 0, 1]]);
    const list = connectorPlacements(grid);
    const edges = list.filter((c) => c.kind === 'edge').map((c) => `${c.x},${c.y},${c.rot}`).sort();
    expect(edges).toEqual(['-0.5,0,0', '-0.5,1,0', '0,0.5,1', '0.5,0,0', '0.5,1,0'].sort());
    // corners: (−0.5, 0.5) laser+laser+cockpit+armour, (0.5, 0.5) cockpit+armour+cargo; not the cargo's centre (1.5, 0.5)
    expect(list.filter((c) => c.kind === 'corner').map((c) => `${c.x},${c.y}`).sort()).toEqual(['-0.5,0.5', '0.5,0.5']);
  });

  it('connects the starter ship (19 edges, 6 corners)', () => {
    const list = connectorPlacements(createStarterShip());
    expect(list.filter((c) => c.kind === 'edge')).toHaveLength(19);
    expect(list.filter((c) => c.kind === 'corner')).toHaveLength(6);
  });
});

// SL2 E2 (shaped-parts plan §2.6): with the shell off, an edge connector only where
// the solid sides of both neighbours overlap by at least ½, a corner only where all four cell
// polygons share the corner point.
describe('connectorPlacements with shaped armour', () => {
  const edges = (list: ConnectorPlacement[]) => list.filter((c) => c.kind === 'edge').map((c) => `${c.x},${c.y},${c.rot}`).sort();
  const corners = (list: ConnectorPlacement[]) => list.filter((c) => c.kind === 'corner').map((c) => `${c.x},${c.y}`).sort();

  it('keeps the edge on the solid legs of a wedge, drops it at its tip-only sides', () => {
    // wedge at (1,0), hypotenuse front-port: solid rear (−x) and starboard (−y) sides
    const grid = createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 1, 'wedge'], ['armor', 2, 0], ['armor', 1, 1], ['armor', 1, -1]]);
    // rear (cockpit) and starboard (1,−1) kept; bow (2,0) and port (1,1) touch only a tip
    expect(edges(connectorPlacements(grid))).toEqual(['0.5,0,0', '1,-0.5,1'].sort());
  });

  it('keeps the half side of a half plate (overlap exactly ½) and drops its open side', () => {
    // starboard half (y ∈ [−½, 0]) at (0,0): bow side solid [0, ½], port side open
    const grid = createGrid([['armor', 0, 0, 0, 1, 'half'], ['cockpit', 1, 0], ['armor', 0, 1]]);
    expect(edges(connectorPlacements(grid))).toEqual(['0.5,0,0']);
  });

  it('drops the edge between two half plates whose solid halves do not overlap', () => {
    // starboard half at (0,0), port half (rot 2) at (1,0): [0, ½] against [½, 1]
    const grid = createGrid([['armor', 0, 0, 0, 1, 'half'], ['armor', 1, 0, 2, 1, 'half']]);
    expect(connectorPlacements(grid)).toEqual([]);
  });

  it('places a corner only where all four cell polygons share the corner point', () => {
    const block = (rot: Rotation): ShipGrid =>
      createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 0, 1], ['armor', 1, 1, rot, 1, 'wedge']]);
    // rot 0: the wedge's solid corner is its rear-starboard one = the block's centre (½, ½)
    expect(corners(connectorPlacements(block(0)))).toEqual(['0.5,0.5']);
    // rot 2: the hypotenuse faces rear-starboard, the corner at (½, ½) is cut away
    expect(corners(connectorPlacements(block(2)))).toEqual([]);
    // a chamfer keeps all four corners of its cell except the front-port one
    const chamfer = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 0, 1], ['armor', 1, 1, 2, 1, 'chamfer']]);
    expect(corners(connectorPlacements(chamfer))).toEqual([]);
    const chamfer0 = createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', 0, 1], ['armor', 1, 1, 0, 1, 'chamfer']]);
    expect(corners(connectorPlacements(chamfer0))).toEqual(['0.5,0.5']);
  });

  it('treats a 2×1 wing as one part: no seam inside it, a solid rear and starboard edge, nothing on the slope', () => {
    // wing L over (0,0)-(1,0) (rear cell (0,0)): long leg on the starboard edge, slope 1:2 front-port
    const wing = createGrid([['armor', 0, 0, 0, 1, 'wingL']]);
    const cells = wing.parts[0]!;
    expect(partCells(cells).map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '1,0']);
    const grid = createGrid([['armor', 0, 0, 0, 1, 'wingL'], ['cockpit', -1, 0], ['armor', 0, -1], ['armor', 1, -1], ['armor', 0, 1], ['armor', 1, 1]]);
    // the two port armours join each other (0.5, 1); neither joins the wing's slope
    expect(edges(connectorPlacements(grid))).toEqual(['-0.5,0,0', '0,-0.5,1', '1,-0.5,1', '0.5,-1,0', '0.5,1,0'].sort());
  });

  it('leaves unshaped ships unchanged (the starter ship still has 19 edges and 6 corners)', () => {
    const list = connectorPlacements(createStarterShip());
    expect(list.filter((c) => c.kind === 'edge')).toHaveLength(19);
    expect(list.filter((c) => c.kind === 'corner')).toHaveLength(6);
  });
});

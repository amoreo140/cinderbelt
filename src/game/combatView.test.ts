import { describe, expect, it } from 'vitest';
import { createEnemy } from '../sim/combat/enemies';
import { createWreck } from '../sim/combat/wrecks';
import { createGrid } from '../sim/ship/grid';
import { Simulation, type SimEvent } from '../sim/Simulation';
import { applyRam } from '../sim/combat/combat';
import { outlineSvgPath } from '../sim/ship/outline';
import { combatHudView, deathView, flightSilhouette, HIT_INDICATOR_TIME, HitTracker, silhouette } from './combatView';

const empty = (_s: number, cx: number, cy: number) => ({ cx, cy, asteroids: [] });

const grid = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['cannon', 1, 0, 0],
    ['shield', -1, 0],
    ['engine', -2, 0, 0],
    ['cargo', 0, 1],
  ]);

function flying(settings = {}): Simulation {
  return new Simulation({ seed: 4, grid: grid(), startDocked: false, generator: empty, settings });
}

describe('flightSilhouette memo (O12)', () => {
  it('is the same object while the grid and the HP stay, a new one after a hit in place', () => {
    const sim = new Simulation({ seed: 1, startDocked: false });
    const a = flightSilhouette(sim.state);
    expect(flightSilhouette(sim.state)).toBe(a);
    const part = sim.state.player.grid.parts[0]!;
    sim.state.player.hp.set(part.id, 1);
    const b = flightSilhouette(sim.state);
    expect(b).not.toBe(a);
    expect(b.damaged).toBe(1);
    expect(b).toEqual(silhouetteFresh(sim));
  });
});

/** A cold silhouette of the same ship (another game with the same HP). */
function silhouetteFresh(sim: Simulation) {
  const other = new Simulation({ seed: 1, startDocked: false });
  for (const [id, hp] of sim.state.player.hp) other.state.player.hp.set(id, hp);
  return flightSilhouette(other.state);
}

describe('flightSilhouette (M3.8)', () => {
  it('keeps parts lost against the blueprint as empty cells and counts them', () => {
    const sim = flying();
    expect(flightSilhouette(sim.state)).toMatchObject({ missing: 0, damaged: 0 });
    // the cargo hold at (0, 1) is rammed off
    applyRam(sim.state, 'player', sim.state.player, 5, 1000, []);
    const s = flightSilhouette(sim.state);
    expect(s.missing).toBe(1);
    expect(s.cells.filter((c) => c.missing)).toEqual([{ x: 0, y: 1, partId: 'cargo', tier: 1, part: 5, fraction: 0, missing: true }]);
    // the frame still spans the designed ship
    expect([s.minX, s.maxX, s.minY, s.maxY]).toEqual([-2, 1, 0, 1]);
    expect(silhouette(sim.state).cells.some((c) => c.missing)).toBe(false);
    expect(combatHudView(sim.state).silhouette.missing).toBe(1);
  });
});

/** All coordinates of an SVG path (pairs after M / L). */
const pathPoints = (d: string): [number, number][] => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
};

describe('silhouette outline (SL2 E1 T10)', () => {
  it('carries the hull outline of the grid in grid units, inside the cell bounds ± ½', () => {
    const sim = flying();
    const s = silhouette(sim.state);
    expect(s.outline).toBe(outlineSvgPath(sim.state.player.grid));
    expect(s.outline).toMatch(/^M.*Z$/);
    const pts = pathPoints(s.outline!);
    expect(Math.min(...pts.map((p) => p[0]))).toBe(s.minX - 0.5);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(s.maxX + 0.5);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(s.minY - 0.5);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(s.maxY + 0.5);
  });

  it('is empty for an empty grid', () => {
    const sim = flying();
    sim.state.player.grid = { parts: [], nextId: 1 };
    expect(silhouette(sim.state).outline).toBe('');
  });

  it('memoises the outline per grid shape and follows the grid when it changes', () => {
    const sim = flying();
    const a = silhouette(sim.state).outline;
    // same shape in a new grid object → the same string; HP changes do not matter
    sim.state.player.grid = { ...sim.state.player.grid, parts: sim.state.player.grid.parts.map((p) => ({ ...p })) };
    sim.state.player.hp.set(2, 1);
    expect(silhouette(sim.state).outline).toBe(a);
    // the cargo hold is rammed off: the flight silhouette keeps the socket, the outline shrinks
    applyRam(sim.state, 'player', sim.state.player, 5, 1000, []);
    const f = flightSilhouette(sim.state);
    expect(f.missing).toBe(1);
    expect(f.outline).toBe(outlineSvgPath(sim.state.player.grid));
    expect(f.outline).not.toBe(a);
    expect(Math.max(...pathPoints(f.outline!).map((p) => p[1]))).toBe(0.5);
  });
});

describe('combatHudView', () => {
  it('reports shield, hull and cannons', () => {
    const sim = flying();
    sim.state.player.shield = 30;
    sim.state.player.hp.set(1, 30);
    const v = combatHudView(sim.state);
    expect(v.shield).toEqual({ current: 30, max: 60, fraction: 0.5 });
    expect(v.hull.max).toBe(60 + 30 + 30 + 25 + 30);
    expect(v.hull.current).toBe(v.hull.max - 30);
    expect(v.cannons).toEqual({ total: 1, ready: 1 });
    expect(v.destroyed).toBe(false);
    sim.state.player.cooldowns.set(2, 5);
    expect(combatHudView(sim.state).cannons.ready).toBe(0);
  });

  it('has no shield meter without a shield generator', () => {
    const sim = new Simulation({ seed: 4, grid: createGrid([['cockpit', 0, 0]]), startDocked: false, generator: empty });
    expect(combatHudView(sim.state).shield).toBeNull();
  });

  it('builds a silhouette with HP per cell', () => {
    const sim = flying();
    sim.state.player.hp.set(2, 15);
    const s = silhouette(sim.state);
    expect(s.cells).toHaveLength(5);
    expect(s).toMatchObject({ minX: -2, maxX: 1, minY: 0, maxY: 1, damaged: 1 });
    expect(s.cells.find((c) => c.part === 2)).toMatchObject({ x: 1, y: 0, partId: 'cannon', tier: 1, fraction: 0.5 });
  });

  it('counts attacking pirates and points at the nearest', () => {
    const sim = flying();
    const a = createEnemy({ id: 'a', kind: 'jackal', tier: 1, pos: { x: 0, y: 50 }, angle: 0, home: { x: 0, y: 50 }, orbit: 1 });
    const b = createEnemy({ id: 'b', kind: 'jackal', tier: 1, pos: { x: 100, y: 0 }, angle: 0, home: { x: 100, y: 0 }, orbit: 1 });
    a.ai.mode = 'attack';
    sim.state.combat.enemies.push(a, b);
    const t = combatHudView(sim.state).threat;
    expect(t.nearby).toBe(2);
    expect(t.attacking).toBe(1);
    expect(t.nearest!.distance).toBeCloseTo(50);
    expect(t.nearest!.angle).toBeCloseTo(Math.PI / 2);
  });

  it('offers the nearest wreck with loot and whether F reaches it', () => {
    const sim = flying();
    const e = createEnemy({ id: 'w', kind: 'jackal', tier: 1, pos: { x: 10, y: 0 }, angle: 0, home: { x: 10, y: 0 }, orbit: 1 });
    const loot = { cargo: { iron: 5, copper: 0, ice: 0, titanium: 0 }, parts: { 'cannon:1': 1 } };
    sim.state.combat.wrecks.push(createWreck(9, e.grid.parts, e, { vel: { x: 0, y: 0 }, angVel: 0 }, loot, 'pirate'));
    const v = combatHudView(sim.state);
    expect(v.salvage).toMatchObject({ wreckId: 9, inRange: true, cargo: { iron: 5 }, parts: { 'cannon:1': 1 } });
    sim.state.player.body = { ...sim.state.player.body, pos: { x: -6, y: 0 } };
    expect(combatHudView(sim.state).salvage).toMatchObject({ wreckId: 9, inRange: false });
    sim.state.player.body = { ...sim.state.player.body, pos: { x: -200, y: 0 } };
    expect(combatHudView(sim.state).salvage).toBeNull();
  });
});

describe('HitTracker', () => {
  it('turns player hits into fading direction indicators', () => {
    const sim = flying();
    const tracker = new HitTracker();
    const hit: SimEvent = { type: 'projectileHit', target: 'shield', owner: 'a', ref: 'player', pos: { x: 0, y: 1 }, damage: 6, from: { x: 0, y: 40 } };
    const other: SimEvent = { type: 'projectileHit', target: 'ship', owner: 'player', ref: 'a', pos: { x: 9, y: 9 }, damage: 6, from: { x: 0, y: 0 } };
    tracker.push([hit, other], sim.state, 10);
    const now = tracker.indicators(10.3);
    expect(now).toHaveLength(1);
    expect(now[0]!.angle).toBeCloseTo(Math.PI / 2);
    expect(now[0]!.shield).toBe(true);
    expect(now[0]!.intensity).toBeCloseTo(1 - 0.3 / HIT_INDICATOR_TIME);
    expect(tracker.lastHitAt).toBe(10);
    expect(tracker.indicators(10 + HIT_INDICATOR_TIME + 0.01)).toEqual([]);
  });
});

describe('deathView', () => {
  it('summarises the losses by difficulty', () => {
    const mild = flying({ deathPenalty: 'mild' });
    mild.state.player.cargo.iron = 20;
    mild.state.player.salvage = { 'cannon:1': 2 };
    expect(deathView(mild)).toMatchObject({
      penalty: 'mild',
      respawnStationId: 'home',
      evacuationStationId: null,
      loses: { cargo: true, cargoAmount: 20, salvageParts: 2, installedParts: false, partHpFraction: 0.4, fuelFraction: 0.25 },
      fallsToHard: false,
    });
    const none = flying({ deathPenalty: 'none' });
    none.state.player.cargo.iron = 20;
    expect(deathView(none).loses).toMatchObject({ cargo: false, cargoAmount: 0, installedParts: false });
    const hardcore = flying({ deathPenalty: 'hardcore' });
    expect(deathView(hardcore)).toMatchObject({ loses: { installedParts: true }, fallsToHard: true, scuttle: null });
  });

  it('shows the tow fee of a voluntary scuttle, and the cargo lost when it cannot be paid', () => {
    const paid = flying({ deathPenalty: 'none' });
    paid.state.credits = 5000;
    paid.state.player.cargo.iron = 20;
    paid.state.player.scuttled = true;
    expect(deathView(paid)).toMatchObject({ scuttle: { free: false }, loses: { cargo: false } });
    expect(deathView(paid).scuttle!.fee).toBeGreaterThanOrEqual(100);
    const broke = flying({ deathPenalty: 'none' });
    broke.state.credits = 0;
    broke.state.player.cargo.iron = 20;
    broke.state.player.scuttled = true;
    expect(deathView(broke)).toMatchObject({ scuttle: { free: true }, loses: { cargo: true, cargoAmount: 20 } });
  });
});

/** Shoelace area of a cell polygon (cell units). */
const area = (poly: readonly { x: number; y: number }[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

describe('silhouette of shaped armour (SL2 E2 U3)', () => {
  // cockpit, a port wing 2×1 behind it, a wedge on the bow, a nose 2×1 on the starboard side
  const shapedGrid = () =>
    createGrid([
      ['cockpit', 0, 0],
      ['armor', 0, 1, 0, 1, 'wingL'],
      ['armor', 1, 0, 0, 1, 'wedge'],
      ['armor', 0, -1, 0, 1, 'nose2x1'],
    ]);
  const shapedSim = () => new Simulation({ seed: 4, grid: shapedGrid(), startDocked: false, generator: empty });

  it('gives each cell of a wing its own polygon in cell units (the wing is 2 cells)', () => {
    const sim = shapedSim();
    const wing = sim.state.player.grid.parts.find((p) => p.shape === 'wingL')!;
    const cells = silhouette(sim.state).cells.filter((c) => c.part === wing.id);
    expect(cells).toHaveLength(2);
    for (const c of cells) {
      expect(c.poly).toBeDefined();
      expect(c.poly!.length).toBeGreaterThanOrEqual(3);
      // cell units around the cell centre, counter-clockwise
      for (const v of c.poly!) {
        expect(Math.abs(v.x)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(v.y)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
      expect(area(c.poly!)).toBeGreaterThan(0);
    }
    // the rear cell carries ¾ of the wing, the front cell the ¼ tip; together the wing's area 1.0
    const sorted = [...cells].sort((a, b) => a.x - b.x);
    expect(area(sorted[0]!.poly!)).toBeCloseTo(0.75, 6);
    expect(area(sorted[1]!.poly!)).toBeCloseTo(0.25, 6);
  });

  it('draws a wedge as its triangle and leaves full cells without a polygon', () => {
    const s = silhouette(shapedSim().state);
    const wedge = s.cells.find((c) => c.x === 1 && c.y === 0)!;
    expect(area(wedge.poly!)).toBeCloseTo(0.5, 6);
    expect(wedge.poly).toHaveLength(3);
    // unshaped parts keep the exact E1 cell (no poly key at all)
    expect(s.cells.find((c) => c.partId === 'cockpit')).toEqual({ x: 0, y: 0, partId: 'cockpit', tier: 1, part: 1, fraction: 1 });
    // the solid rear cell of the nose 2×1 is a plain square, its ogive cell a polygon
    const nose = s.cells.filter((c) => c.part === 4);
    expect(nose).toHaveLength(2);
    expect(nose.filter((c) => c.poly !== undefined)).toHaveLength(1);
    // the ogive at render detail: a curve, so more than the 3 corners of the bounding triangle
    expect(nose.find((c) => c.poly)!.poly!.length).toBeGreaterThan(4);
  });

  it('turns the polygon with the part', () => {
    const turned = new Simulation({ seed: 4, grid: createGrid([['cockpit', 0, 0], ['armor', 1, 0, 1, 1, 'wedge']]), startDocked: false, generator: empty });
    const a = silhouette(shapedSim().state).cells.find((c) => c.x === 1 && c.y === 0)!.poly!;
    const b = silhouette(turned.state).cells.find((c) => c.x === 1 && c.y === 0)!.poly!;
    // rot 1 = 90° CCW: (x, y) → (−y, x)
    const rotated = a.map((v) => `${(-v.y).toFixed(3)},${v.x.toFixed(3)}`).sort();
    expect(b.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).sort()).toEqual(rotated.map((s) => s.replace(/-0\.000/g, '0.000')));
  });

  it('keeps the polygon on the socket of a shaped part lost against the blueprint', () => {
    const sim = shapedSim();
    sim.state.player.grid = { ...sim.state.player.grid, parts: sim.state.player.grid.parts.filter((p) => p.shape !== 'wedge') };
    const lost = flightSilhouette(sim.state).cells.filter((c) => c.missing);
    expect(lost).toHaveLength(1);
    expect(area(lost[0]!.poly!)).toBeCloseTo(0.5, 6);
  });

  it('memoises the outline with the shape: a reshape changes the hull outline', () => {
    const sim = shapedSim();
    const a = silhouette(sim.state).outline;
    sim.state.player.grid = { ...sim.state.player.grid, parts: sim.state.player.grid.parts.map((p) => (p.shape === 'wedge' ? { ...p, shape: 'chamfer' as const } : p)) };
    const b = silhouette(sim.state).outline;
    expect(b).not.toBe(a);
    expect(b).toBe(outlineSvgPath(sim.state.player.grid));
  });
});

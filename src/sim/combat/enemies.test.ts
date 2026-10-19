import { describe, expect, it } from 'vitest';
import { length } from '../math/vec2';
import { createGrid, validateGrid } from '../ship/grid';
import { CHUNK_SIZE } from '../world/chunks';
import { chunkPirates, regionWorld, STATIC_SPAWN_CONTEXT } from '../regions';
import { stationsInArea } from '../world/stations';
import { blockedExhausts } from '../ship/exhaust';
import { captainGrid } from '../captains/captains';
import { GUNNER, SENTRY } from '../../data/pirates';
import { PART_DEFS } from '../../data/parts';
import { hullBudgetOf } from '../ship/budget';
import { computeProperties } from '../ship/properties';
import { CANNON_HALF_ARC } from './arcs';
import { createEnemy, ENEMY_TEMPLATES, gunnerLeads, huntGroupSlots, SPAWN_FUEL, spawnSlots, STATION_SAFE_MARGIN } from './enemies';

describe('enemy templates', () => {
  it('are valid ships with cannons, engines in every direction and the right size', () => {
    for (const kind of ['jackal', 'hammer'] as const) {
      for (const tier of [1, 2] as const) {
        const grid = ENEMY_TEMPLATES[kind](tier);
        expect(validateGrid(grid)).toEqual([]);
        expect(grid.parts.every((p) => p.tier === tier)).toBe(true);
        const enemy = createEnemy({ id: 'x', kind, tier, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
        const { thrust } = enemy.props;
        expect(Math.min(thrust.forward, thrust.backward, thrust.left, thrust.right)).toBeGreaterThan(0);
        expect(enemy.props.weapons.length).toBeGreaterThan(0);
      }
    }
    // Jackal 5–7 parts with 1 cannon, Hammer 15–20 with 2 cannons and a shield (long-term design)
    expect(ENEMY_TEMPLATES.jackal(1).parts).toHaveLength(7);
    expect(ENEMY_TEMPLATES.hammer(1).parts).toHaveLength(17);
    const hammer = createEnemy({ id: 'h', kind: 'hammer', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
    expect(hammer.props.weapons).toHaveLength(2);
    expect(hammer.shield).toBe(60);
    expect(hammer.maxHull).toBeGreaterThan(400);
  });
});

describe('pirate layouts', () => {
  it('cover no engine nozzle (a covered nozzle halves thrust and burns the part)', () => {
    for (const kind of ['jackal', 'hammer', 'scavenger'] as const) {
      for (const tier of [1, 2] as const) expect(blockedExhausts(ENEMY_TEMPLATES[kind](tier)), `${kind} T${tier}`).toEqual([]);
    }
    for (let level = 1; level <= 5; level++) expect(blockedExhausts(captainGrid(level)), `captain ${level}`).toEqual([]);
  });
});

describe('spawnSlots', () => {
  const area = (seed: number, density: 'low' | 'normal' | 'high', r0: number, r1: number) => {
    let groups = 0;
    let chunks = 0;
    const slots = [];
    for (let cx = -r1; cx <= r1; cx++) {
      for (let cy = -r1; cy <= r1; cy++) {
        const d = length({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE });
        if (d < r0 * CHUNK_SIZE || d > r1 * CHUNK_SIZE) continue;
        chunks++;
        const s = spawnSlots(seed, cx, cy, density);
        if (s.length > 0) groups++;
        slots.push(...s);
      }
    }
    return { groups, chunks, slots };
  };

  it('is deterministic and has stable ids', () => {
    const a = spawnSlots(5, 12, -3, 'normal');
    expect(spawnSlots(5, 12, -3, 'normal')).toBe(a);
    // a new copy of the computation (different density) – same positions for the same roll
    const all = area(5, 'high', 8, 18).slots;
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.id).toMatch(/^pr:-?\d+,-?\d+:\d$/);
  });

  it('never spawns pirates within 1 000 u of home; in depth 1 only the pirate corner (T1 Jackals)', () => {
    expect(area(1, 'high', 0, 4.9).slots).toEqual([]);
    const world = regionWorld(1);
    for (const s of area(1, 'high', 0, 8).slots) {
      const sector = world.field.regionAt(s.home.x, s.home.y);
      if (sector.depth > 1) continue;
      expect(sector.id).toBe(world.corners.depth1);
      expect(s.kind).toBe('jackal');
      expect(s.tier).toBe(1);
    }
  });

  it('spawns drones in pirate-rate sectors and more groups with higher density', () => {
    const normal = area(3, 'normal', 8, 19);
    const high = area(3, 'high', 8, 19);
    const low = area(3, 'low', 8, 19);
    expect(normal.groups).toBeGreaterThan(0);
    expect(high.groups).toBeGreaterThan(normal.groups);
    expect(low.groups).toBeLessThan(normal.groups);
    for (const s of normal.slots) expect(chunkPirates(regionWorld(3), Math.floor(s.home.x / CHUNK_SIZE), Math.floor(s.home.y / CHUNK_SIZE), STATIC_SPAWN_CONTEXT).group).toBeGreaterThan(0);
    expect(normal.slots.some((s) => s.kind === 'jackal')).toBe(true);
    // group: 2–3 jackals or a hammer with 0–1 jackals
    const byGroup = new Map<string, string[]>();
    for (const s of normal.slots) {
      const g = s.id.slice(0, s.id.lastIndexOf(':'));
      byGroup.set(g, [...(byGroup.get(g) ?? []), s.kind]);
    }
    for (const kinds of byGroup.values()) {
      if (kinds[0] === 'hammer') expect(kinds.length).toBeLessThanOrEqual(2);
      else expect(kinds.length === 2 || kinds.length === 3).toBe(true);
    }
  });

  it('keeps pirates away from stations', () => {
    const seed = 3;
    const stations = stationsInArea(seed, -20, 20, -20, 20);
    const { slots } = area(seed, 'high', 7, 20);
    for (const slot of slots) {
      for (const s of stations) {
        expect(Math.hypot(s.pos.x - slot.home.x, s.pos.y - slot.home.y)).toBeGreaterThanOrEqual(s.clearRadius + STATION_SAFE_MARGIN);
      }
    }
  });
});

describe('createEnemy', () => {
  it('starts on patrol at its slot with full battery and shield', () => {
    const slot = { id: 'pr:1,1:0', kind: 'jackal' as const, tier: 1 as const, pos: { x: 5, y: 6 }, angle: 1, home: { x: 4, y: 4 }, orbit: -1 as const };
    const e = createEnemy(slot);
    expect(e).toMatchObject({ id: 'pr:1,1:0', kind: 'jackal', home: { x: 4, y: 4 }, gridVersion: 0, shield: 0 });
    expect(e.body.pos).toEqual({ x: 5, y: 6 });
    expect(e.body.angle).toBe(1);
    expect(e.energy).toBe(e.props.batteryCapacity);
    expect(e.ai).toEqual({ mode: 'patrol', waypoint: { x: 5, y: 6 }, timer: 0, orbit: -1, breakOff: 0, react: 0, seen: { x: 0, y: 0 } });
    // tanks 65–100 % full, the same for the same slot
    expect(e.fuel).toBeGreaterThanOrEqual(e.props.fuelCapacity * SPAWN_FUEL[0]);
    expect(e.fuel).toBeLessThanOrEqual(e.props.fuelCapacity);
    expect(createEnemy(slot).fuel).toBe(e.fuel);
  });
});

describe('hunt contract groups (sectors §6.1)', () => {
  it('lay out exactly the saved ids, also when the chunk has no group now', () => {
    // a chunk at home has no pirates at all, a saved contract still gets its group
    const ids = ['pr:1,1:0', 'pr:1,1:1', 'pr:1,1:2'];
    const slots = huntGroupSlots(7, 1, 1, ids);
    expect(slots.map((s) => s.id)).toEqual(ids);
    for (const s of slots) {
      expect(s.home.x).toBeGreaterThanOrEqual(CHUNK_SIZE);
      expect(s.home.x).toBeLessThan(2 * CHUNK_SIZE);
    }
  });

  it('match the live group of a chunk that has one', () => {
    for (let cx = 10; cx < 30; cx++) {
      const live = spawnSlots(5, cx, 3, 'normal');
      if (live.length === 0) continue;
      expect(huntGroupSlots(5, cx, 3, live.map((s) => s.id))).toEqual(live);
      return;
    }
    throw new Error('no group');
  });
});

// ---------------------------------------------------------------------------
// M4b T6: the Gunner and the sentry drone

/** Parts the pirate clan sets model (public/assets/models/parts_pirate/manifest.json, render/assets/clanParts.ts). */
const CLAN_PARTS = new Set(['cockpit', 'engine', 'cannon', 'armor', 'shield', 'reactor', 'gyro', 'fuelTank', 'cargo', 'tractorBeam']);

/** The starter ship fitted for combat (2 cannons, shield, armour – balance.test.ts) at a tier. */
const armedStarter = (tier: 1 | 2) =>
  createGrid([
    ['cockpit', 1, 0, 0, tier], ['gyro', 0, 0, 0, tier], ['miningLaser', 2, 0, 0, tier], ['reactor', -1, 0, 0, tier], ['cargo', 0, 1, 0, tier], ['cargo', 0, -1, 0, tier],
    ['fuelTank', 1, 1, 0, tier], ['radar', 1, -1, 0, tier], ['engine', -1, 1, 0, tier], ['engine', -1, -1, 0, tier], ['engine', 2, 1, 2, tier], ['engine', 2, -1, 2, tier],
    ['engine', 0, -2, 1, tier], ['engine', 0, 2, 3, tier], ['cannon', 1, 2, 0, tier], ['cannon', 1, -2, 0, tier], ['shield', -1, 2, 0, tier], ['armor', -1, -2, 0, tier],
  ]);

describe('Gunner template (M4b §2.6)', () => {
  it('is a valid 20–25 part ship within its hull budget, no covered nozzle, clan parts only', () => {
    for (const tier of [1, 2] as const) {
      const grid = ENEMY_TEMPLATES.gunner(tier);
      expect(validateGrid(grid)).toEqual([]);
      expect(blockedExhausts(grid)).toEqual([]);
      expect(hullBudgetOf(grid).over).toBe(false);
      expect(grid.parts.length).toBeGreaterThanOrEqual(GUNNER.parts[0]);
      expect(grid.parts.length).toBeLessThanOrEqual(GUNNER.parts[1]);
      for (const p of grid.parts) expect(CLAN_PARTS.has(p.partId), p.partId).toBe(true);
      const count = (id: string) => grid.parts.filter((p) => p.partId === id).length;
      expect(count('cannon')).toBe(GUNNER.cannons);
      expect(count('reactor')).toBe(2);
      expect(count('shield')).toBe(1);
      expect(count('gyro')).toBe(1);
      expect(count('fuelTank')).toBeGreaterThanOrEqual(1);
      expect(count('armor')).toBeGreaterThanOrEqual(1);
      expect(count('engine')).toBeGreaterThanOrEqual(6);
      expect(count('engine')).toBeLessThanOrEqual(7);
      // T2 cannons always (range 100), the rest by tier
      for (const p of grid.parts) expect(p.tier).toBe(p.partId === 'cannon' ? GUNNER.cannonTier : tier);
    }
  });

  it('fires three cannons forward (each covers straight ahead) and has engines in every direction', () => {
    const e = createEnemy({ id: 'g', kind: 'gunner', tier: 1, pos: { x: 0, y: 0 }, angle: 0, home: { x: 0, y: 0 }, orbit: 1 });
    expect(e.props.weapons).toHaveLength(3);
    for (const w of e.props.weapons) {
      expect(w.facing).toEqual({ x: 1, y: 0 });
      expect(w.range).toBe(100);
      expect(w.arcs.some(([a, b]) => a <= 0 && b >= 0)).toBe(true);
      expect(w.arcs.reduce((s, [a, b]) => s + b - a, 0)).toBeGreaterThan(CANNON_HALF_ARC * 1.4);
    }
    const { thrust } = e.props;
    expect(Math.min(thrust.forward, thrust.backward, thrust.left, thrust.right)).toBeGreaterThan(0);
    expect(e.shield).toBeGreaterThan(0);
    expect(e.props.fuelCapacity).toBeGreaterThan(PART_DEFS.cockpit[1].fuel!);
  });

  it('is slower than a combat-fit ship of its tier (forward and backward) – it cannot outrun a chase', () => {
    for (const tier of [1, 2] as const) {
      const g = computeProperties(ENEMY_TEMPLATES.gunner(tier));
      const s = computeProperties(armedStarter(tier));
      const accel = (p: typeof g, dir: 'forward' | 'backward') => p.thrust[dir] / p.mass;
      expect(accel(g, 'forward')).toBeLessThan(accel(s, 'forward') * 0.9);
      expect(accel(g, 'backward')).toBeLessThan(accel(s, 'forward') * 0.9);
      // and slower than the Hammer it may replace as a group leader
      expect(accel(g, 'forward')).toBeLessThan(accel(computeProperties(ENEMY_TEMPLATES.hammer(tier)), 'forward'));
    }
  });
});

describe('sentry template (M4b §2.4)', () => {
  it('is a valid 5-part drone: cockpit, cannon, 2 engines, armour', () => {
    for (const tier of [1, 2] as const) {
      const grid = ENEMY_TEMPLATES.sentry(tier);
      expect(validateGrid(grid)).toEqual([]);
      expect(blockedExhausts(grid)).toEqual([]);
      expect(grid.parts).toHaveLength(SENTRY.parts);
      expect(grid.parts.map((p) => p.partId).sort()).toEqual(['armor', 'cannon', 'cockpit', 'engine', 'engine']);
      expect(grid.parts.every((p) => p.tier === tier)).toBe(true);
      for (const p of grid.parts) expect(CLAN_PARTS.has(p.partId)).toBe(true);
      const props = computeProperties(grid);
      expect(props.weapons).toHaveLength(1);
      expect(props.thrust.forward).toBeGreaterThan(0);
      expect(props.thrust.backward).toBeGreaterThan(0);
    }
  });
});

describe('Gunner leader roll of regular groups (M4b §2.6 a)', () => {
  it('leads its share of groups by depth (separate hash stream, within ±10 %)', () => {
    for (const depth of [1, 2, 3, 4] as const) {
      let n = 0;
      let hits = 0;
      for (const seed of [1, 2, 3]) {
        for (let i = 0; i < 4000; i++) {
          n++;
          if (gunnerLeads(seed, (i % 80) - 40, Math.floor(i / 80) - 25, depth)) hits++;
        }
      }
      const share = GUNNER.groupShare[depth];
      if (share === 0) expect(hits).toBe(0);
      else expect(Math.abs(hits / n - share)).toBeLessThan(share * 0.1);
    }
  });

  it('only swaps the leader’s kind: ids, positions, tier and group size stay (baseKind keeps the old kind)', () => {
    let gunners = 0;
    let groups = 0;
    for (const seed of [1, 2, 3, 42]) {
      const world = regionWorld(seed);
      for (let cx = -30; cx <= 30; cx++) {
        for (let cy = -30; cy <= 30; cy++) {
          const slots = spawnSlots(seed, cx, cy, 'high');
          if (slots.length === 0) continue;
          groups++;
          const depth = chunkPirates(world, cx, cy, STATIC_SPAWN_CONTEXT).depth;
          const lead = gunnerLeads(seed, cx, cy, depth);
          expect(slots[0]!.kind === 'gunner').toBe(lead);
          if (lead) {
            gunners++;
            expect(depth).toBeGreaterThanOrEqual(3);
            expect(['hammer', 'jackal']).toContain(slots[0]!.baseKind);
          } else {
            expect(slots[0]!.baseKind).toBeUndefined();
          }
          // only the leader ever changes
          for (const s of slots.slice(1)) {
            expect(s.baseKind).toBeUndefined();
            expect(s.kind).not.toBe('gunner');
          }
          // the Hammer share and the group size come from the old layout
          const base = slots.map((s) => s.baseKind ?? s.kind);
          if (base[0] === 'hammer') expect(slots.length).toBeLessThanOrEqual(2);
          else expect(slots.length === 2 || slots.length === 3).toBe(true);
        }
      }
    }
    expect(groups).toBeGreaterThan(100);
    expect(gunners).toBeGreaterThan(0);
  });

  it('a saved hunt contract of a Gunner-led group resolves to the same ids and the same live group', () => {
    for (const seed of [1, 2, 3, 42]) {
      for (let cx = -30; cx <= 30; cx++) {
        for (let cy = -30; cy <= 30; cy++) {
          const live = spawnSlots(seed, cx, cy, 'normal');
          if (live[0]?.kind !== 'gunner') continue;
          const ids = live.map((s) => s.id);
          expect(huntGroupSlots(seed, cx, cy, ids)).toEqual(live);
          // a bigger saved group (an id beyond the layout) still resolves every id
          const more = [...ids, `pr:${cx},${cy}:${ids.length}`];
          expect(huntGroupSlots(seed, cx, cy, more).map((s) => s.id)).toEqual(more);
          return;
        }
      }
    }
    throw new Error('no gunner-led group');
  });
});

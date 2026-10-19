import { describe, expect, it } from 'vitest';
import { regionField } from '../sim/regions/field';
import { sectorInfo, sectorSecurity } from '../sim/regions/sectors';
import type { RegionSeed } from '../sim/regions/seeds';
import { pastBorder, SectorZoneTracker, ZONE_HYSTERESIS, zoneKey } from './sectorZone';
import { flyingAt } from '../sim/discovery/testing';
import { regionWorld } from '../sim/regions/world';
import { musicZoneAt } from './musicSituation';
import { fortressStatus } from '../sim/pirates/fortress';
import { securityHere } from '../sim/pirates/sectors';

const SEED = 42;

/** A fake field with one straight border at x = 0: west is sector W, east is sector E. */
const halfPlanes = {
  regionAt: (x: number): RegionSeed => ({ id: x < 0 ? 'W' : 'E', key: x < 0 ? 0 : 1, x: 0, y: 0, depth: x < 0 ? 1 : 2, weight: 0, spacing: 1, origin: false }),
};

/** First point along the ray from home at `angle` where the sector depth changes from 1 to 2. */
function depthBorder(angle: number): { x: number; y: number } {
  const f = regionField(SEED);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let r = 0;
  while (f.regionAt(dx * r, dy * r).depth === 1) r += 1;
  return { x: dx * r, y: dy * r };
}

describe('pastBorder', () => {
  it('counts a border only once the point is the margin past it', () => {
    expect(pastBorder(halfPlanes, 'W', { x: -5, y: 0 })).toBe(false);
    expect(pastBorder(halfPlanes, 'W', { x: 5, y: 0 })).toBe(false);
    expect(pastBorder(halfPlanes, 'W', { x: ZONE_HYSTERESIS - 1, y: 0 })).toBe(false);
    expect(pastBorder(halfPlanes, 'W', { x: ZONE_HYSTERESIS + 1, y: 0 })).toBe(true);
    expect(pastBorder(halfPlanes, 'E', { x: -(ZONE_HYSTERESIS + 1), y: 3 })).toBe(true);
  });
});

describe('SectorZoneTracker', () => {
  it('sets the zone silently from the position on the first update', () => {
    const t = new SectorZoneTracker();
    const f = regionField(SEED);
    const z = t.update(SEED, { x: 0, y: 0 });
    expect(z.id).toBe(f.origin.id);
    expect(z.depth).toBe(1);
    expect(z.environment).toBe('asteroidField');
    expect(zoneKey(z)).toBe('1:asteroidField');
  });

  it.each([0.3, 1.9, 3.4, 5.1])('crossing a depth 1 → 2 border at bearing %s rad switches only past the hysteresis', (angle) => {
    const border = depthBorder(angle);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const at = (d: number) => ({ x: border.x + ux * d, y: border.y + uy * d });
    const t = new SectorZoneTracker();
    const inner = t.update(SEED, at(-80));
    expect(inner.depth).toBe(1);
    // wiggling around the border: never flips
    for (const d of [-10, 2, 12, -4, 20, 5, -1, 15]) expect(t.update(SEED, at(d)).id).toBe(inner.id);
    // well past it: the depth-2 sector
    const outer = t.update(SEED, at(ZONE_HYSTERESIS + 40));
    expect(outer.depth).toBe(2);
    // and back only once well inside again
    for (const d of [10, -5, 3, -12]) expect(t.update(SEED, at(d)).id).toBe(outer.id);
    expect(t.update(SEED, at(-(ZONE_HYSTERESIS + 40))).id).toBe(inner.id);
  });

  it('a jump (respawn, teleport) switches at once; a seed change or reset starts over', () => {
    const t = new SectorZoneTracker();
    t.update(SEED, { x: 0, y: 0 });
    expect(t.update(SEED, { x: 6000, y: 0 }).depth).toBe(3);
    expect(t.update(SEED, { x: 0, y: 0 }).depth).toBe(1);
    t.update(SEED, { x: 6000, y: 0 });
    t.reset();
    expect(t.current).toBeNull();
    expect(t.update(7, { x: 0, y: 0 }).id).toBe(regionField(7).origin.id);
  });

  it('the frontier music: depth 1 never, depth ≥ 2 unless Guarded', () => {
    const t = new SectorZoneTracker();
    t.update(SEED, { x: 0, y: 0 });
    expect(t.frontier()).toBe(false);
    const z = t.update(SEED, { x: 6000, y: 0 });
    expect(t.frontier()).toBe(sectorSecurity(SEED, z.id) !== 'guarded');
    expect(z.environment).toBe(sectorInfo(SEED, z.id)!.biome);
  });

  it('preloads the depths of the sectors around the ship', () => {
    const t = new SectorZoneTracker();
    const border = depthBorder(1.9);
    t.update(SEED, border);
    expect(t.depthsNear(border)).toEqual([1, 2]);
    t.update(SEED, { x: 0, y: 0 });
    expect(t.depthsNear({ x: 0, y: 0 })).toEqual([1]);
  });
});

describe('the frontier music follows the current security (M4d §2.1)', () => {
  const world = regionWorld(SEED);
  /** The seed point of the first sector matching `pred` that lies in its own sector, ≥ 1 500 u out. */
  const pointOf = (pred: (r: (typeof world.regions)[number]) => boolean) => {
    const r = world.regions.find((x) => pred(x) && Math.hypot(x.seed.x, x.seed.y) > 1500 && world.field.regionAt(x.seed.x, x.seed.y).id === x.seed.id)!;
    return { id: r.seed.id, pos: { x: r.seed.x, y: r.seed.y } };
  };

  it('a Guild-secured Contested sector is no frontier; a fortress sector with its fortress down still is', () => {
    const c = pointOf((r) => r.seed.depth >= 2 && r.security === 'contested' && r.fixed === null);
    const t = new SectorZoneTracker();
    expect(t.update(SEED, c.pos).id).toBe(c.id);
    expect(t.frontier()).toBe(true);
    expect(t.frontier(new Set([c.id]))).toBe(false);
    expect(t.frontier(new Set())).toBe(true);

    const sim = flyingAt(SEED, c.pos);
    expect(musicZoneAt(sim.state).frontier).toBe(true);
    sim.state.guild.relays.set('A', { stage: 'secured', sector: c.id, tick: 0 });
    expect(musicZoneAt(sim.state).frontier).toBe(false);

    const [, rid] = [...world.fortressRegions][0]!;
    const f = pointOf((r) => r.seed.id === rid);
    const fort = flyingAt(SEED, f.pos);
    for (const [other, r] of world.fortressRegions) {
      if (r === rid) fort.state.pirates.fortresses.set(other, { ...fortressStatus(fort.state, other), destroyed: 1, kills: 1 });
    }
    expect(securityHere(fort.state, f.pos)).toBe('contested');
    expect(musicZoneAt(fort.state).frontier).toBe(true);
  });
});

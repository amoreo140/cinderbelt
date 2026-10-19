// Survey points (sectors §4.1, stage 2): 3 / 4 / 5 by depth, inside the sector, apart, never at a cache.
import { describe, expect, it } from 'vitest';
import { poisInChunk } from '../discovery/poi';
import { REGION_GEN } from './constants';
import { sectorInfo } from './sectors';
import { surveyMask, surveyPoints, surveyPointsNear } from './survey';
import { regionWorld } from './world';
import { CHUNK_SIZE } from '../world/chunks';

const SEEDS = [1, 2, 3, 1337];

describe('survey points', () => {
  it('every finite sector not Charted at the start has 3 / 4 / 5 points by depth, inside it and apart', () => {
    let strict = 0;
    let all = 0;
    for (const seed of SEEDS) {
      const world = regionWorld(seed);
      for (const r of world.regions) {
        const id = r.seed.id;
        const info = sectorInfo(seed, id)!;
        const points = surveyPoints(seed, id);
        const want = info.startKnowledge === 'charted' ? 0 : REGION_GEN.survey.points[info.depth];
        expect(points.length, `${seed} ${id}`).toBe(want);
        expect(surveyMask(seed, id)).toBe((1 << want) - 1);
        points.forEach((p, i) => {
          expect(p.index).toBe(i);
          expect(p.sector).toBe(id);
          expect(world.field.regionAt(p.pos.x, p.pos.y).id).toBe(id);
        });
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const d = Math.hypot(points[i]!.pos.x - points[j]!.pos.x, points[i]!.pos.y - points[j]!.pos.y);
            expect(d).toBeGreaterThanOrEqual(REGION_GEN.survey.relax.at(-1)![1] - 1e-9);
            all++;
            if (d >= REGION_GEN.survey.spacing) strict++;
          }
        }
      }
    }
    // the relaxed rule is the exception (small depth-1 sectors)
    expect(strict / all).toBeGreaterThan(0.9);
  });

  it('a point never sits on a cache (the map must not reveal one)', () => {
    for (const seed of SEEDS) {
      for (const r of regionWorld(seed).regions) {
        for (const p of surveyPoints(seed, r.seed.id)) {
          const cx = Math.floor(p.pos.x / CHUNK_SIZE);
          const cy = Math.floor(p.pos.y / CHUNK_SIZE);
          const caches = poisInChunk(seed, cx, cy).filter((x) => x.kind === 'cache');
          for (const c of caches) expect(Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y)).toBeGreaterThan(1e-6);
        }
      }
    }
  });

  it('prefers landmarks, POIs and asteroid clusters over open space', () => {
    let anchored = 0;
    let total = 0;
    for (const seed of SEEDS) {
      for (const r of regionWorld(seed).regions) {
        for (const p of surveyPoints(seed, r.seed.id)) {
          total++;
          if (p.anchor !== 'open') anchored++;
        }
      }
    }
    expect(anchored / total).toBeGreaterThan(0.8);
  });

  it('is a pure function of the seed and the sector (no depth-4 points, unknown ids empty)', () => {
    const id = regionWorld(7).regions.find((r) => r.seed.depth === 2)!.seed.id;
    expect(JSON.stringify(surveyPoints(7, id))).toBe(JSON.stringify(surveyPoints(7, id)));
    expect(surveyPoints(7, 'rg:B:nope')).toEqual([]);
    const far = regionWorld(7).field.regionAt(12_000, 0);
    expect(far.depth).toBe(4);
    expect(surveyPoints(7, far.id)).toEqual([]);
  });

  it('surveyPointsNear finds the points within the range around a position', () => {
    const seed = 1337;
    const r = regionWorld(seed).regions.find((x) => x.seed.depth === 2 && surveyPoints(seed, x.seed.id).length > 0)!;
    const p = surveyPoints(seed, r.seed.id)[1]!;
    const near = surveyPointsNear(seed, { x: p.pos.x + 100, y: p.pos.y }, 150);
    expect(near).toContainEqual(p);
    expect(surveyPointsNear(seed, { x: p.pos.x + 200, y: p.pos.y }, 150).some((q) => q.sector === p.sector && q.index === p.index)).toBe(false);
  });
});

// M4b T3: placement of derelict stations and ship graveyards (plan §2.1, §2.4, §2.5).
import { describe, expect, it } from 'vitest';
import { guildRelaySites } from '../guild/relaySites';
import { ECHO_RADIUS } from '../../data/echoes';
import { DERELICT_LAYOUTS, GRAVEYARD, MINE, RELAY, RELAY_LAYOUT, SITES } from '../../data/sites';
import { echoSites, poiRadius, poisInChunk } from '../discovery/poi';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import { sectorInfoOfChunk, surveyPointsNear, type Depth } from '../regions';
import { CHUNK_SIZE, generateChunk } from '../world/generate';
import { landmarkSites } from '../world/landmarks';
import { stationsInArea } from '../world/stations';
import { WORLD_GENS } from '../world/worldGen';
import { GRAVEYARD_CORE, relayById, siteById, sitesInChunk, sitesNear } from './placement';
import type { DerelictSite, GraveyardSite, Site } from './types';

const R = 45;
const DEPTHS: readonly Depth[] = [1, 2, 3, 4];

/** Every site of a seed in the square of chunks ±R around home. */
function allSites(seed: number, r = R): Site[] {
  const out: Site[] = [];
  for (let cx = -r; cx <= r; cx++) for (let cy = -r; cy <= r; cy++) out.push(...sitesInChunk(seed, cx, cy));
  return out;
}

/** Circles a site keeps clear (centre + relays for a derelict; the field for a graveyard). */
function derelictCircles(s: DerelictSite): { pos: { x: number; y: number }; r: number }[] {
  return [{ pos: s.pos, r: DERELICT_LAYOUTS[s.model].clearRadius }, ...s.relays.map((r) => ({ pos: r.pos, r: RELAY_LAYOUT.clearRadius }))];
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

interface DensityStats {
  exp: Record<Site['kind'], Record<Depth, number>>;
  got: Record<Site['kind'], Record<Depth, number>>;
  chunks: Record<Depth, number>;
  /** Depth-2 graveyards and chunks inside / outside the wreckField biome. */
  field: { sites: number; chunks: number };
  other: { sites: number; chunks: number };
  guardedSites: number;
  depthMismatch: number;
}

let densityStats: DensityStats | null = null;

/** 20 seeds × 91 × 91 chunks, counted once for both density tests. */
function densities(): DensityStats {
  if (densityStats) return densityStats;
  const zero = (): Record<Depth, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const st: DensityStats = {
    exp: { derelict: zero(), graveyard: zero() },
    got: { derelict: zero(), graveyard: zero() },
    chunks: zero(),
    field: { sites: 0, chunks: 0 },
    other: { sites: 0, chunks: 0 },
    guardedSites: 0,
    depthMismatch: 0,
  };
  for (let seed = 1; seed <= 20; seed++) {
    for (let cx = -R; cx <= R; cx++) {
      for (let cy = -R; cy <= R; cy++) {
        const info = sectorInfoOfChunk(seed, cx, cy);
        const sites = sitesInChunk(seed, cx, cy);
        const guarded = info.security === 'guarded';
        if (guarded) st.guardedSites += sites.length;
        const nearHome = Math.hypot((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE) < SITES.homeClear;
        if (!guarded && !nearHome) {
          st.chunks[info.depth]++;
          st.exp.derelict[info.depth] += SITES.derelict.density[info.depth];
          st.exp.graveyard[info.depth] += SITES.graveyard.density[info.depth] * (info.biome === 'wreckField' ? GRAVEYARD.biomeMult : 1);
          if (info.depth === 2) {
            const bucket = info.biome === 'wreckField' ? st.field : st.other;
            bucket.chunks++;
            bucket.sites += sites.filter((s) => s.kind === 'graveyard').length;
          }
        }
        for (const s of sites) {
          if (s.depth !== info.depth) st.depthMismatch++;
          st.got[s.kind][s.depth]++;
        }
      }
    }
  }
  return (densityStats = st);
}

describe('site densities', () => {
  it('match the tables per depth (within ±15 %) and never appear in statically Guarded sectors or depth 1', () => {
    const { exp, got, chunks, guardedSites, depthMismatch } = densities();
    expect(guardedSites).toBe(0);
    expect(depthMismatch).toBe(0);
    expect(got.derelict[1] + got.graveyard[1]).toBe(0);
    for (const kind of ['derelict', 'graveyard'] as const) {
      for (const d of [2, 3, 4] as const) {
        // enough chunks for the share to mean something (≥ 20 000 non-Guarded chunks per depth)
        expect(chunks[d]).toBeGreaterThan(20_000);
        const ratio = got[kind][d] / exp[kind][d];
        const what = `${kind} depth ${d}: ${got[kind][d]} of ${exp[kind][d].toFixed(0)} expected`;
        expect(ratio, what).toBeGreaterThan(0.85);
        expect(ratio, what).toBeLessThan(1.15);
      }
    }
  }, 120_000);

  it('a wreckField sector holds about three times as many graveyards per chunk', () => {
    const { field, other } = densities();
    const ratio = field.sites / field.chunks / (other.sites / other.chunks);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(4.5);
  }, 120_000);
});

describe('site placement', () => {
  const SEEDS = [1, 2, 3, 42, 1337];

  it('keeps clear of home, stations, POIs, asteroids, fortresses, landmarks, Echo sites, survey points and other sites', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      // 61 × 61 chunks per seed
      const sites = allSites(seed, 30);
      const forts = fortressSites(seed);
      const landmarks = landmarkSites(seed);
      const echoes = echoSites(seed);
      for (const s of sites) {
        checked++;
        const chunkStations = WORLD_GENS.flatMap((gen) => stationsInArea(seed, s.cx - 3, s.cx + 3, s.cy - 3, s.cy + 3, gen));
        const pois = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => poisInChunk(seed, s.cx + dx, s.cy + dy)));
        const rocks = WORLD_GENS.flatMap((gen) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => generateChunk(seed, s.cx + dx, s.cy + dy, gen).asteroids)));
        // the circles that must keep clear of fixed things (stations, fortresses, landmarks, Echoes, home)
        const outer = s.kind === 'derelict' ? derelictCircles(s) : [{ pos: s.pos, r: GRAVEYARD.radius }];
        // the circles that must keep clear of rocks, POIs and survey points
        const inner = s.kind === 'derelict' ? derelictCircles(s) : [{ pos: s.pos, r: GRAVEYARD_CORE }];
        for (const c of outer) {
          expect(Math.hypot(c.pos.x, c.pos.y)).toBeGreaterThanOrEqual(SITES.homeClear + c.r);
          for (const st of chunkStations) expect(dist(c.pos, st.pos)).toBeGreaterThanOrEqual(st.clearRadius + c.r + SITES.margin);
          for (const f of forts) {
            expect(dist(c.pos, f.pos)).toBeGreaterThanOrEqual(FORTRESS_LAYOUT.clearRadius + SITES.fortressMargin + c.r);
            expect(dist(c.pos, f.beacon.pos)).toBeGreaterThanOrEqual(c.r + SITES.margin);
          }
          for (const l of landmarks) {
            expect(dist(c.pos, l.pos)).toBeGreaterThanOrEqual(c.r + SITES.margin + 100);
            if (l.kind === 'guild_relay') expect(dist(c.pos, l.pos)).toBeGreaterThanOrEqual(SITES.guildRelayClear + c.r);
          }
          for (const e of echoes) expect(dist(c.pos, e.pos)).toBeGreaterThanOrEqual(ECHO_RADIUS + c.r + SITES.margin);
        }
        for (const c of inner) {
          for (const p of pois) expect(dist(c.pos, p.pos)).toBeGreaterThanOrEqual(poiRadius(p) + c.r + SITES.margin);
          for (const a of rocks) expect(dist(c.pos, a.pos)).toBeGreaterThanOrEqual(a.baseRadius + c.r);
          expect(surveyPointsNear(seed, c.pos, c.r + SITES.margin)).toEqual([]);
        }
        if (s.kind === 'graveyard') {
          for (const m of s.mines) for (const a of rocks) expect(dist(m, a.pos)).toBeGreaterThanOrEqual(a.baseRadius + MINE.armRange);
        }
        // sites never overlap each other
        for (const o of sitesNear(seed, s.pos, 700)) {
          if (o === s) continue;
          if (s.kind === 'derelict' && o.kind === 'derelict') expect(dist(s.pos, o.pos)).toBeGreaterThan(2 * RELAY.distance[0]);
          const a = s.kind === 'derelict' ? derelictCircles(s) : [{ pos: s.pos, r: GRAVEYARD.radius }];
          const b = o.kind === 'derelict' ? derelictCircles(o) : [{ pos: o.pos, r: GRAVEYARD.radius }];
          for (const p of a) for (const q of b) expect(dist(p.pos, q.pos)).toBeGreaterThanOrEqual(p.r + q.r + SITES.margin);
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  }, 120_000);

  it('is the same whatever order the chunks are asked in', () => {
    const chunks: { cx: number; cy: number }[] = [];
    for (let cx = -30; cx <= 30; cx++) for (let cy = -30; cy <= 30; cy++) chunks.push({ cx, cy });
    const forward = JSON.stringify(chunks.map(({ cx, cy }) => sitesInChunk(7, cx, cy)));
    // another seed resets every memo (they hold one seed at a time)
    sitesInChunk(8, 0, 0);
    const backward = JSON.stringify([...chunks].reverse().map(({ cx, cy }) => sitesInChunk(7, cx, cy)).reverse());
    expect(backward).toBe(forward);
    expect(forward).toContain('dl:');
  }, 60_000);

  it('derelicts: three relays 60–120 u out, 120° ± 25° apart, clear of the dock approach', () => {
    const derelicts = SEEDS.flatMap((s) => allSites(s)).filter((s): s is DerelictSite => s.kind === 'derelict');
    expect(derelicts.length).toBeGreaterThan(150);
    for (const d of derelicts) {
      expect(d.id).toBe(`dl:${d.cx},${d.cy}`);
      expect(Math.floor(d.pos.x / CHUNK_SIZE)).toBe(d.cx);
      expect(Math.floor(d.pos.y / CHUNK_SIZE)).toBe(d.cy);
      expect(d.relays).toHaveLength(RELAY.count);
      const bearings = d.relays.map((r, i) => {
        expect(r.id).toBe(`${d.id}:r${i}`);
        expect(r.owner).toBe('derelict');
        expect(r.group).toBe(d.id);
        const len = dist(r.pos, d.pos);
        expect(len).toBeGreaterThanOrEqual(RELAY.distance[0] - 1e-9);
        expect(len).toBeLessThanOrEqual(RELAY.distance[1] + 1e-9);
        return Math.atan2(r.pos.y - d.pos.y, r.pos.x - d.pos.x);
      });
      for (let i = 0; i < bearings.length; i++) {
        const gap = (((bearings[(i + 1) % 3]! - bearings[i]!) * 180) / Math.PI + 720) % 360;
        expect(gap).toBeGreaterThanOrEqual(RELAY.spacingDeg - 2 * RELAY.jitterDeg - 1e-6);
        expect(gap).toBeLessThanOrEqual(RELAY.spacingDeg + 2 * RELAY.jitterDeg + 1e-6);
        // the dock port (+X of the layout) keeps ≥ 35° to every relay
        const off = Math.abs(Math.atan2(Math.sin(bearings[i]! - d.angle), Math.cos(bearings[i]! - d.angle)));
        expect((off * 180) / Math.PI).toBeGreaterThanOrEqual(35 - 1e-6);
      }
    }
  });

  it('rolls model, defence and service by their weights', () => {
    const derelicts = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((s) => allSites(s)).filter((s): s is DerelictSite => s.kind === 'derelict');
    const n = derelicts.length;
    expect(n).toBeGreaterThan(400);
    const share = <T,>(f: (d: DerelictSite) => T, v: T): number => derelicts.filter((d) => f(d) === v).length / n;
    for (const [k, w] of Object.entries(SITES.derelict.defence)) expect(Math.abs(share((d) => d.defence, k) - w)).toBeLessThan(0.07);
    for (const [k, w] of Object.entries(SITES.derelict.service)) expect(Math.abs(share((d) => d.service, k) - w)).toBeLessThan(0.07);
    for (const m of ['a', 'b', 'c', 'd'] as const) expect(Math.abs(share((d) => d.model, m) - 0.25)).toBeLessThan(0.07);
  });

  it('graveyards: 10–20 wrecks, mines by depth in the field, the sleeping party by depth', () => {
    const graveyards = SEEDS.flatMap((s) => allSites(s)).filter((s): s is GraveyardSite => s.kind === 'graveyard');
    expect(graveyards.length).toBeGreaterThan(100);
    let mines = 0;
    let wanted = 0;
    for (const g of graveyards) {
      expect(g.id).toBe(`gy:${g.cx},${g.cy}`);
      expect(g.wrecks).toBeGreaterThanOrEqual(GRAVEYARD.wrecks[0]);
      expect(g.wrecks).toBeLessThanOrEqual(GRAVEYARD.wrecks[1]);
      const [lo, hi] = GRAVEYARD.mines[g.depth];
      expect(g.mines.length).toBeLessThanOrEqual(hi);
      mines += g.mines.length;
      wanted += lo;
      for (const m of g.mines) {
        expect(dist(m, g.pos)).toBeLessThanOrEqual(GRAVEYARD.radius);
        expect(dist(m, g.pos)).toBeGreaterThan(GRAVEYARD_CORE);
      }
      for (let i = 0; i < g.mines.length; i++) for (let j = i + 1; j < g.mines.length; j++) expect(dist(g.mines[i]!, g.mines[j]!)).toBeGreaterThan(2 * MINE.armRange);
      expect(g.sleepers.length === 0 || g.sleepers.join() === GRAVEYARD.sleeperParty[g.depth].join()).toBe(true);
    }
    // nearly every mine finds a free spot
    expect(mines).toBeGreaterThan(0.9 * wanted);
    for (const d of [2, 3, 4] as const) {
      const at = graveyards.filter((g) => g.depth === d);
      if (at.length < 20) continue;
      const share = at.filter((g) => g.sleepers.length > 0).length / at.length;
      expect(Math.abs(share - GRAVEYARD.sleeperChance[d])).toBeLessThan(0.2);
    }
    for (const d of DEPTHS) expect(GRAVEYARD.mines[d][1]).toBeLessThanOrEqual(8);
  });

  it('finds sites and relays by id (also the Guild relays of M4d), rejects malformed ids', () => {
    const sites = allSites(42);
    const d = sites.find((s): s is DerelictSite => s.kind === 'derelict')!;
    const g = sites.find((s) => s.kind === 'graveyard')!;
    expect(siteById(42, d.id)).toBe(d);
    expect(siteById(42, g.id)).toBe(g);
    expect(relayById(42, d.relays[2]!.id)).toBe(d.relays[2]);
    // M4d: a Guild relay id of the seed resolves to its mast (guild/relaySites.ts)
    for (const s of guildRelaySites(42)) expect(relayById(42, s.id)).toEqual(s.relay);
    for (const bad of ['dl:0,0', 'gy:0,0', 'dl:1', 'xx:1,2', `${d.id}:r3`, `${d.id}x`, 'gr:C', 'gr:', `${g.id}:r0`, '']) {
      expect(siteById(42, bad)).toBeNull();
      expect(relayById(42, bad)).toBeNull();
    }
    expect(sitesNear(42, d.pos, 1)).toContain(d);
    expect(sitesNear(42, d.pos, 1).every((s) => dist(s.pos, d.pos) <= 1)).toBe(true);
  });
});

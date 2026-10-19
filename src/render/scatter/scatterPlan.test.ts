import { describe, expect, it } from 'vitest';
import propsRaw from '../../../public/assets/models/props/props.json';
import wreckRaw from '../../../public/assets/models/wreckage/wreckage.json';
import { RESOURCE_IDS } from '../../data/resources';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { buildCatalog, parseDrift, parseLamp, parseSpin, parsePropManifest, parseWreckManifest } from './scatterManifest';
import { chunkScatterInput, sitePois } from './scatterInput';
import {
  GRAVEYARD_DRESSING,
  MAX_PIECES_PER_CHUNK,
  PIRATE_STATION_CLEAR,
  SCATTER_DEPTH,
  planChunk,
  dangerous,
  scatterDensity,
  securityForRing,
  visiblePieces,
  type ScatterChunkInput,
  type ScatterPiece,
} from './scatterPlan';

const catalog = buildCatalog(propsRaw, wreckRaw);
const SEED = 1337;

/** A sweep of chunks across all four rings (the same every run). */
function sweep(): { input: ScatterChunkInput; pieces: ScatterPiece[] }[] {
  const out: { input: ScatterChunkInput; pieces: ScatterPiece[] }[] = [];
  for (let cx = -12; cx <= 12; cx += 1) {
    for (let cy = -12; cy <= 12; cy += 3) {
      const input = chunkScatterInput(SEED, cx, cy);
      out.push({ input, pieces: planChunk(input, catalog) });
    }
  }
  // a few far chunks (rings 3–4)
  for (let i = 0; i < 40; i++) {
    const input = chunkScatterInput(SEED, 25 + i, -30 + (i % 7));
    out.push({ input, pieces: planChunk(input, catalog) });
  }
  return out;
}

describe('scatter manifests (art batch B)', () => {
  it('parses every prop and wreck piece with its motion, spins and lamps', () => {
    const props = parsePropManifest(propsRaw);
    const wrecks = parseWreckManifest(wreckRaw);
    expect(props.map((p) => p.name)).toEqual(expect.arrayContaining(['sat_comm', 'nav_beacon', 'claim_marker', 'ore_canister', 'pirate_mine', 'scrap_raft']));
    expect(wrecks).toHaveLength(8);
    const sat = props.find((p) => p.name === 'sat_comm')!;
    expect(sat.motion).toEqual({ kind: 'tumble', rate: [2, 4] });
    expect(sat.spins).toEqual(expect.arrayContaining([{ node: 'Sat_Dish', axis: 'y', rate: 6 }, { node: 'Sat_Solar', axis: 'z', rate: 2 }]));
    expect(sat.lamps[0]).toMatchObject({ node: 'beacon_0', mode: 'blink', hz: 1 });
    expect(props.find((p) => p.name === 'ore_canister')!.tintNode).toBe('Ore_Window');
    expect(props.find((p) => p.name === 'claim_marker')!.motion.kind).toBe('attached');
    expect(props.find((p) => p.name === 'pirate_mine')!.spins).toEqual([{ node: 'Mine_Core', axis: 'y', rate: 30 }]);
    // wreck pieces with collision circles only yaw, the others tumble
    for (const w of wrecks) {
      if (w.solid) expect(w.motion.kind === 'yaw' || w.motion.kind === 'still').toBe(true);
      else expect(w.motion.kind === 'tumble' || w.motion.kind === 'still').toBe(true);
    }
    expect(wrecks.find((w) => w.name === 'hull_section_a')!.lamps[0]).toMatchObject({ mode: 'irregular', gain: 0.45 });
  });

  it('reads motion and lamp words', () => {
    expect(parseDrift('tumble 5-15 deg/s')).toEqual({ kind: 'tumble', rate: [5, 15] });
    expect(parseDrift('keep upright (mast = local +Y), slow bob').kind).toBe('bob');
    expect(parseDrift('bob, no tumble').kind).toBe('bob');
    expect(parseDrift('slow yaw only').kind).toBe('yaw');
    expect(parseSpin('X', 'spin around local +Y, ~5 deg/s')).toEqual({ node: 'X', axis: 'y', rate: 5 });
    expect(parseSpin('X', 'red blink')).toBeNull();
    expect(parseLamp('b', 'white strobe: 80 ms flash every 1.5 s')).toMatchObject({ mode: 'strobe', hz: 1 / 1.5 });
    expect(parseLamp('b', 'red distress blink: 3 short + pause').mode).toBe('distress');
    expect(parseLamp('b', 'cyan pulse 0.5 Hz')).toMatchObject({ mode: 'pulse', hz: 0.5 });
  });
});

describe('scatter planner', () => {
  it('is deterministic per seed and chunk', () => {
    const a = planChunk(chunkScatterInput(SEED, 3, -2), catalog);
    const b = planChunk(chunkScatterInput(SEED, 3, -2), catalog);
    expect(a).toEqual(b);
    const other = planChunk(chunkScatterInput(SEED + 1, 3, -2), catalog);
    expect(other).not.toEqual(a);
  });

  it('stays sparse: capped per chunk, about one piece per 2 000 u² of a busy chunk at most', () => {
    const all = sweep();
    let total = 0;
    for (const { pieces } of all) {
      expect(pieces.length).toBeLessThanOrEqual(MAX_PIECES_PER_CHUNK);
      total += pieces.length;
    }
    // the average chunk holds only a handful of pieces
    expect(total / all.length).toBeLessThan(8);
    expect(total / all.length).toBeGreaterThan(0.5);
  });

  it('keeps pieces below the plane, clear of rocks and stations, and inside their chunk sites', () => {
    for (const { input, pieces } of sweep()) {
      for (const p of pieces) {
        if (p.attach) {
          // claim markers sit on a rock of this chunk
          expect(input.rocks.some((r) => r.id === p.attach!.asteroid)).toBe(true);
          continue;
        }
        expect(p.height).toBeLessThanOrEqual(-SCATTER_DEPTH.min);
        expect(p.height).toBeGreaterThanOrEqual(-SCATTER_DEPTH.max - 1);
        const radius = catalog.get(p.model)!.radius * p.scale;
        for (const r of input.rocks) expect(Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y)).toBeGreaterThanOrEqual(r.baseRadius + radius + 2 - 1e-9);
        for (const s of input.stations) expect(Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y)).toBeGreaterThanOrEqual(s.radius + radius + 12 - 1e-9);
        // a site hugs its chunk (station drifts and wreck fields may lean over the edge a little; a real
        // graveyard's dressing spreads over its 200 u field)
        const lean = input.pois.some((q) => q.kind === 'graveyard') ? GRAVEYARD_DRESSING.outer + 10 : 80;
        expect(p.pos.x).toBeGreaterThan(input.cx * CHUNK_SIZE - lean);
        expect(p.pos.x).toBeLessThan((input.cx + 1) * CHUNK_SIZE + lean);
      }
    }
  });

  it('dresses pirate space only where it is dangerous, and every station gets approach lights', () => {
    let stations = 0;
    for (const { input, pieces } of sweep()) {
      const pirate = pieces.filter((p) => p.site === 'pirate' || p.site === 'graveyard');
      for (const p of pieces.filter((q) => q.site === 'pirate')) for (const s of input.stations) expect(Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y)).toBeGreaterThan(PIRATE_STATION_CLEAR - 30);
      if (input.security === 'quiet' || input.security === 'guarded') expect(pirate).toEqual([]);
      for (const p of pieces) if (['pirate_mine', 'pirate_stash', 'scrap_raft'].includes(p.model)) expect(dangerous(input.security)).toBe(true);
      const own = input.stations.filter((s) => Math.floor(s.pos.x / CHUNK_SIZE) === input.cx && Math.floor(s.pos.y / CHUNK_SIZE) === input.cy);
      if (own.length > 0) {
        stations++;
        const beacons = pieces.filter((p) => p.model === 'nav_beacon' && p.rank === 0);
        expect(beacons.length).toBe(2);
      }
      for (const p of pieces) if (p.tint) expect(RESOURCE_IDS).toContain(p.tint);
    }
    expect(stations).toBeGreaterThan(0);
    expect(securityForRing(1)).toBe('guarded');
    expect(securityForRing(2)).toBe('contested');
    expect(securityForRing(4)).toBe('pirate');
  });

  it('wreck POIs get a wreck field that always shows its first piece', () => {
    let fields = 0;
    for (let cx = -20; cx <= 20 && fields < 6; cx++) {
      for (let cy = -20; cy <= 20 && fields < 6; cy++) {
        const input = chunkScatterInput(SEED, cx, cy);
        const wreck = input.pois.find((p) => p.kind === 'wreck');
        if (!wreck) continue;
        fields++;
        const pieces = planChunk(input, catalog).filter((p) => p.site === 'wreck');
        expect(pieces.length).toBeGreaterThanOrEqual(2);
        const low = visiblePieces(pieces, scatterDensity(0.35));
        expect(low.some((p) => catalog.get(p.model)!.set === 'wreck')).toBe(true);
        for (const p of pieces) {
          const d = Math.hypot(p.pos.x - wreck.pos.x, p.pos.y - wreck.pos.y);
          expect(d).toBeGreaterThanOrEqual(wreck.radius + 3);
          expect(d).toBeLessThanOrEqual(40);
        }
      }
    }
    expect(fields).toBeGreaterThan(0);
  });

  // M4b world sites of seed 1337 (sim/sites/placement): the graveyard gy:20,-3 (depth 2) and the
  // derelict dl:8,-9 with its three relays
  const GRAVEYARD_CHUNK = { cx: 20, cy: -3 };
  const DERELICT_CHUNK = { cx: 8, cy: -9 };
  const around = (c: { cx: number; cy: number }) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => chunkScatterInput(SEED, c.cx + dx, c.cy + dy)));

  it('passes the M4b sites as POIs after the chunk POIs (graveyard field, derelict and relay discs)', () => {
    const g = sitePois(SEED, GRAVEYARD_CHUNK.cx, GRAVEYARD_CHUNK.cy);
    expect(g.map((p) => p.id)).toContain('gy:20,-3');
    expect(g.find((p) => p.id === 'gy:20,-3')).toMatchObject({ kind: 'graveyard', radius: 200 });
    const d = sitePois(SEED, DERELICT_CHUNK.cx, DERELICT_CHUNK.cy);
    expect(d.filter((p) => p.kind === 'derelict').map((p) => p.id)).toEqual(['dl:8,-9']);
    expect(d.filter((p) => p.kind === 'relay')).toHaveLength(3);
    // appended: the chunk's own POIs keep their indices (the wreck fields keep their streams)
    const input = chunkScatterInput(SEED, DERELICT_CHUNK.cx, DERELICT_CHUNK.cy);
    expect(input.pois.slice(input.pois.length - d.length)).toEqual(d);
  });

  it('a real graveyard is dressed with wreck pieces by its own chunk; nothing else lies in its field', () => {
    for (const input of around(GRAVEYARD_CHUNK)) {
      const field = input.pois.find((p) => p.kind === 'graveyard')!;
      expect(field).toBeDefined();
      const pieces = planChunk(input, catalog);
      const own = input.cx === GRAVEYARD_CHUNK.cx && input.cy === GRAVEYARD_CHUNK.cy;
      const dressing = pieces.filter((p) => p.site === 'graveyard');
      if (own) {
        expect(dressing.length).toBeGreaterThanOrEqual(6);
        expect(dressing.filter((p) => catalog.get(p.model)!.set === 'wreck').length).toBeGreaterThanOrEqual(5);
        // the first piece shows at Low too
        expect(visiblePieces(dressing, scatterDensity(0.35)).length).toBeGreaterThan(0);
      }
      for (const p of pieces) {
        if (p.attach) continue;
        const d = Math.hypot(p.pos.x - field.pos.x, p.pos.y - field.pos.y);
        if (own && p.site === 'graveyard') {
          expect(d).toBeLessThanOrEqual(GRAVEYARD_DRESSING.outer + 10);
          expect(d).toBeGreaterThanOrEqual(GRAVEYARD_DRESSING.inner);
        } else {
          // no decorative graveyard, mine field or other clutter inside the real field
          expect(d).toBeGreaterThanOrEqual(field.radius + catalog.get(p.model)!.radius * p.scale + 8 - 1e-9);
        }
      }
    }
  });

  it('skips the decorative graveyard in a chunk that has a real one; the other sites stay put', () => {
    // a chunk whose decorative graveyard roll succeeds
    let found: { input: ScatterChunkInput; pieces: ScatterPiece[] } | null = null;
    for (let cx = -30; cx <= 30 && !found; cx++) {
      for (let cy = -30; cy <= 30 && !found; cy++) {
        const input = chunkScatterInput(SEED, cx, cy);
        if (input.pois.some((p) => p.kind === 'graveyard')) continue;
        const pieces = planChunk(input, catalog);
        if (pieces.some((p) => p.site === 'graveyard')) found = { input, pieces };
      }
    }
    expect(found).not.toBeNull();
    const { input, pieces } = found!;
    // the same chunk with a (tiny, far-off) real graveyard field reaching into it
    const corner = { x: input.cx * CHUNK_SIZE - 150, y: input.cy * CHUNK_SIZE - 150 };
    const withReal: ScatterChunkInput = { ...input, pois: [...input.pois, { id: 'gy:test', kind: 'graveyard', pos: corner, radius: 1 }] };
    const after = planChunk(withReal, catalog);
    expect(after.filter((p) => p.site === 'graveyard')).toEqual([]);
    // the sites planned before it are untouched
    const early = (list: ScatterPiece[]) => list.filter((p) => p.site === 'station' || p.site === 'wreck' || p.site === 'field' || p.site === 'pirate');
    expect(early(after)).toEqual(early(pieces));
  });

  it('keeps derelict stations and their relays clear of clutter', () => {
    for (const input of around(DERELICT_CHUNK)) {
      const discs = input.pois.filter((p) => p.kind === 'derelict' || p.kind === 'relay');
      // every chunk the station can reach lists it with its three relays (the far corner is out of reach)
      expect([0, 4]).toContain(discs.length);
      if (input.cx === DERELICT_CHUNK.cx && input.cy === DERELICT_CHUNK.cy) expect(discs.length).toBe(4);
      for (const p of planChunk(input, catalog)) {
        if (p.attach) continue;
        const r = catalog.get(p.model)!.radius * p.scale;
        for (const d of discs) expect(Math.hypot(p.pos.x - d.pos.x, p.pos.y - d.pos.y)).toBeGreaterThanOrEqual(d.radius + r + 8 - 1e-9);
      }
    }
  });

  it('a lower graphics density shows a subset; software Low shows nothing', () => {
    const pieces = sweep().flatMap((x) => x.pieces);
    const low = visiblePieces(pieces, scatterDensity(0.35));
    const medium = visiblePieces(pieces, scatterDensity(0.65));
    const high = visiblePieces(pieces, scatterDensity(1));
    expect(high).toHaveLength(pieces.length);
    expect(low.every((p) => medium.includes(p))).toBe(true);
    expect(low.length).toBeLessThan(medium.length);
    expect(low.length / pieces.length).toBeLessThan(0.6);
    expect(visiblePieces(pieces, scatterDensity(0))).toEqual([]);
  });
});

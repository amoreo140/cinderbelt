// M4b golden test (plan, T0): the world sites of M4b (derelicts,
// graveyards, comets) and the events director come from their own hash streams and must never move or
// remove anything that existing saves already know. The digests below were recorded BEFORE any M4b
// change; if this test fails, an M4b change shifted an existing roll – fix the change, never update the
// digests in place.
//
// Covered per seed: POIs, stations (both world generations), asteroids, pirate spawn slots (static
// context, every density), sector local conditions (derived modifiers ignored), distress signals, ion
// storms, Rust fortresses and Echo sites.
import { describe, expect, it } from 'vitest';
import { SECTOR_MODIFIERS } from '../../data/sector';
import { spawnSlots, type SpawnSlot } from '../combat/enemies';
import { distressAt, ionStormIn } from '../discovery/events';
import { echoSites, poisInChunk } from '../discovery/poi';
import { fnv1aHex } from '../math/fnv1a';
import { fortressSites } from '../pirates/sites';
import { regionWorld } from '../regions';
import { sectorState } from '../sector/sector';
import { CHUNK_SIZE, generateChunk } from '../world/generate';
import { stationAt } from '../world/stations';

const SEEDS = [1, 2, 3, 42, 1337] as const;
/** 20 × 20 = 400 chunks spread over the whole world (depths 1–4). */
const CHUNKS: readonly { cx: number; cy: number }[] = Array.from({ length: 400 }, (_, i) => ({ cx: -48 + 5 * (i % 20), cy: -48 + 5 * Math.floor(i / 20) }));
const EPOCHS = 24;
const DISTRESS_BUCKETS = [0, 1, 7, 23, 120] as const;
const STORM_TICKS = [0, 7_000, 54_321, 216_000, 1_000_000] as const;

const digest = (value: unknown): string => fnv1aHex(JSON.stringify(value));

/**
 * A spawn slot as the golden saw it. `baseKind` (set by the M4b Gunner leader roll, T6) is the kind the
 * slot had before that separate roll – the golden compares that one, so the Gunner roll may change
 * `kind` without moving any recorded slot.
 */
const slotView = (s: SpawnSlot): unknown => {
  const { baseKind, ...rest } = s;
  return { ...rest, kind: baseKind ?? s.kind };
};

function goldenOf(seed: number): Record<string, string> {
  const pois = CHUNKS.map(({ cx, cy }) => poisInChunk(seed, cx, cy));
  const stations = CHUNKS.map(({ cx, cy }) => [stationAt(seed, cx, cy, 1), stationAt(seed, cx, cy, 2)]);
  const asteroids = CHUNKS.map(({ cx, cy }) => [generateChunk(seed, cx, cy, 1).asteroids, generateChunk(seed, cx, cy, 2).asteroids]);
  const slots = CHUNKS.map(({ cx, cy }) => (['low', 'normal', 'high'] as const).map((d) => spawnSlots(seed, cx, cy, d).map(slotView)));
  const sectors = regionWorld(seed).regions.map((r) =>
    Array.from({ length: EPOCHS }, (_, epoch) => sectorState(seed, r.seed.id, epoch).modifiers.filter((m) => !SECTOR_MODIFIERS[m.id].derived)),
  );
  const distress = CHUNKS.map(({ cx, cy }) => DISTRESS_BUCKETS.map((b) => distressAt(seed, cx, cy, b)));
  const storms = CHUNKS.map(({ cx, cy }) => STORM_TICKS.map((t) => ionStormIn(seed, { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE }, t)));
  return {
    pois: digest(pois),
    stations: digest(stations),
    asteroids: digest(asteroids),
    slots: digest(slots),
    sectors: digest(sectors),
    distress: digest(distress),
    storms: digest(storms),
    fortresses: digest(fortressSites(seed)),
    echoes: digest(echoSites(seed)),
  };
}

const GOLDEN: Record<number, Record<string, string>> = {
  1: {
    pois: '5c9f0b54',
    stations: '82872748',
    asteroids: '09181fa5',
    slots: '0aaaef8e',
    sectors: 'a33f6d24',
    distress: '32e558a3',
    storms: '9c42e80e',
    fortresses: '1d003b12',
    echoes: '434fb762',
  },
  2: {
    pois: '133e67ee',
    stations: '6918da96',
    asteroids: 'fa479cfb',
    slots: '3b110933',
    sectors: '96a86c7c',
    distress: 'a2cd5b92',
    storms: 'd4a3be23',
    fortresses: '6b3bd40a',
    echoes: 'd63a4f00',
  },
  3: {
    pois: 'c2020ca8',
    stations: '8bd3a4a5',
    asteroids: '99305ad7',
    slots: '44fe2fe3',
    sectors: '6b0d81b5',
    distress: '795cca86',
    storms: '9b3186e7',
    fortresses: '58f274cb',
    echoes: '81a3f416',
  },
  42: {
    pois: 'db6bccee',
    stations: '98df3bfa',
    asteroids: '98039979',
    slots: 'ac45e524',
    sectors: 'e9f3d3a6',
    distress: 'f03f8c31',
    storms: '54e4443f',
    fortresses: '3a10d345',
    echoes: 'ab30e5cd',
  },
  1337: {
    pois: '8ec785fe',
    stations: '82692d51',
    asteroids: 'bcb1dd31',
    slots: 'b7d93ac3',
    sectors: 'c26c6748',
    distress: '3356aeaf',
    storms: '0c7ac0a5',
    fortresses: '5acdac19',
    echoes: '9aa96ddb',
  },
};

describe('M4b golden: existing world content unchanged', () => {
  it.each([...SEEDS])('seed %i', (seed) => {
    const got = goldenOf(seed);
    expect(got).toEqual(GOLDEN[seed]);
  });

  it('the sample is not empty (every digested kind has content)', () => {
    let pois = 0;
    let stations = 0;
    let slots = 0;
    let distress = 0;
    let storms = 0;
    let modifiers = 0;
    for (const seed of SEEDS) {
      for (const { cx, cy } of CHUNKS) {
        pois += poisInChunk(seed, cx, cy).length;
        if (stationAt(seed, cx, cy, 2)) stations++;
        slots += spawnSlots(seed, cx, cy, 'high').length;
        for (const b of DISTRESS_BUCKETS) if (distressAt(seed, cx, cy, b)) distress++;
        for (const t of STORM_TICKS) if (ionStormIn(seed, { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE }, t)) storms++;
      }
      for (const r of regionWorld(seed).regions) for (let e = 0; e < EPOCHS; e++) modifiers += sectorState(seed, r.seed.id, e).modifiers.length;
    }
    for (const n of [pois, stations, slots, distress, storms, modifiers]) expect(n).toBeGreaterThan(0);
  });
});

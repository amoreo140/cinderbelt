// M4b T3: the scanner knows the world sites – pulse signals, discovery within radar range, analysis
// targets – and a site in an explored chunk of an old save is never pre-marked on the map.
import { describe, expect, it } from 'vitest';
import { GRAVEYARD } from '../../data/sites';
import { createEnemy } from '../combat/enemies';
import { add } from '../math/vec2';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { sitesInChunk } from '../sites/placement';
import type { DerelictSite, GraveyardSite, Site } from '../sites/types';
import { chunkKey } from '../world/chunks';
import { placeKind, radarRangeOf, scanTargets } from './scanner';
import { flyingAt, holdScan, ofType, run, tapScan, teleport } from './testing';

const SEED = 42;

function first<K extends Site['kind']>(kind: K): Extract<Site, { kind: K }> {
  for (let r = 5; r < 40; r++) {
    for (let cx = -r; cx <= r; cx++) {
      for (let cy = -r; cy <= r; cy++) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
        const s = sitesInChunk(SEED, cx, cy).find((x) => x.kind === kind);
        if (s) return s as Extract<Site, { kind: K }>;
      }
    }
  }
  throw new Error(`no ${kind}`);
}

const derelict = first('derelict') as DerelictSite;
const graveyard = first('graveyard') as GraveyardSite;

/** A point `d` u from the site, on the side away from home. */
function away(site: Site, d: number) {
  const len = Math.hypot(site.pos.x, site.pos.y);
  return add(site.pos, { x: (site.pos.x / len) * d, y: (site.pos.y / len) * d });
}

describe('scanner pulse and discovery of world sites', () => {
  it('a pulse lists a derelict in range as a derelict signal; radar range puts it on the map', () => {
    const probe = flyingAt(SEED, derelict.pos);
    const radar = radarRangeOf(probe.state);
    const game = flyingAt(SEED, away(derelict, radar * 2));
    const events = tapScan(game);
    expect(ofType(events, 'scanPulse')[0]!.found).toBeGreaterThan(0);
    const signal = game.state.discovery.signals.find((s) => s.id === derelict.id);
    expect(signal).toMatchObject({ id: derelict.id, kind: 'derelict' });
    expect(game.state.discovery.known.has(derelict.id)).toBe(false);
    // fly within radar range: discovered (once), the signal goes
    teleport(game, away(derelict, radar * 0.5));
    const seen = run(game, 31);
    expect(ofType(seen, 'poiDiscovered').filter((e) => e.id === derelict.id)).toEqual([{ type: 'poiDiscovered', id: derelict.id, kind: 'derelict' }]);
    expect(game.state.discovery.known.has(derelict.id)).toBe(true);
    expect(game.state.discovery.signals.some((s) => s.id === derelict.id)).toBe(false);
    expect(ofType(run(game, 61), 'poiDiscovered').filter((e) => e.id === derelict.id)).toEqual([]);
  });

  it('a graveyard is a graveyard signal and is discovered when its field comes within radar range', () => {
    const probe = flyingAt(SEED, graveyard.pos);
    const radar = radarRangeOf(probe.state);
    const game = flyingAt(SEED, away(graveyard, GRAVEYARD.radius + radar * 1.5));
    tapScan(game);
    expect(game.state.discovery.signals.find((s) => s.id === graveyard.id)).toMatchObject({ kind: 'graveyard' });
    teleport(game, away(graveyard, GRAVEYARD.radius + radar * 0.5));
    const seen = run(game, 31);
    expect(ofType(seen, 'poiDiscovered').filter((e) => e.id === graveyard.id)).toEqual([{ type: 'poiDiscovered', id: graveyard.id, kind: 'graveyard' }]);
  });

  it('a site in an explored chunk of a loaded save is not known until seen', () => {
    const game = flyingAt(SEED, { x: 0, y: 0 });
    for (const s of [derelict, graveyard]) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) game.state.world.explored.add(chunkKey(s.cx + dx, s.cy + dy));
    }
    run(game, 5);
    const result = loadSave(toEnvelope(toSave(game, testContext())));
    if (!result.ok) throw new Error('load failed');
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.world.explored.has(chunkKey(derelict.cx, derelict.cy))).toBe(true);
    run(loaded, 60);
    expect(loaded.state.discovery.known.has(derelict.id)).toBe(false);
    expect(loaded.state.discovery.known.has(graveyard.id)).toBe(false);
    expect(loaded.state.discovery.signals.some((s) => s.id === derelict.id || s.id === graveyard.id)).toBe(false);
    teleport(loaded, away(derelict, 20));
    run(loaded, 31);
    expect(loaded.state.discovery.known.has(derelict.id)).toBe(true);
  });

  it('places know their kind by id', () => {
    const game = flyingAt(SEED, { x: 0, y: 0 });
    expect(placeKind(game.state, derelict.id)).toBe('derelict');
    expect(placeKind(game.state, graveyard.id)).toBe('graveyard');
    expect(placeKind(game.state, derelict.relays[0]!.id)).toBeNull();
    expect(placeKind(game.state, 'dl:0,0')).toBeNull();
    expect(placeKind(game.state, 'cm:99999')).toBeNull();
  });
});

describe('analysis of world sites', () => {
  it('a derelict and its relays can be analysed (no Data – the derelict pays at its terminal)', () => {
    const relay = derelict.relays[0]!;
    const game = flyingAt(SEED, away(derelict, 30));
    const keys = scanTargets(game.state, null).map((t) => `${t.kind}:${t.key}`);
    expect(keys).toContain(`derelict:${derelict.id}`);
    const done = ofType(holdScan(game, derelict.pos), 'analysisDone');
    expect(done).toEqual([{ type: 'analysisDone', target: derelict.id, kind: 'derelict', data: 0, first: true }]);
    expect(game.state.discovery.known.has(derelict.id)).toBe(true);
    teleport(game, add(relay.pos, { x: 15, y: 0 }));
    const relayTarget = scanTargets(game.state, null).find((t) => t.key === relay.id);
    expect(relayTarget).toMatchObject({ kind: 'relay', site: derelict });
    const relayDone = ofType(holdScan(game, relay.pos), 'analysisDone');
    expect(relayDone).toEqual([{ type: 'analysisDone', target: relay.id, kind: 'relay', data: 0, first: true }]);
  });

  it('a dormant sleeper is analysed as a wreck under its enemy id', () => {
    const game = flyingAt(SEED, away(graveyard, 30));
    const sleeper = createEnemy({
      id: `gs:${graveyard.cx},${graveyard.cy}:0`,
      kind: 'hammer',
      tier: 1,
      pos: add(game.state.player.body.pos, { x: 20, y: 0 }),
      angle: 0,
      home: graveyard.pos,
      orbit: 1,
    });
    sleeper.ai.mode = 'dormant';
    game.state.combat.enemies.push(sleeper);
    const target = scanTargets(game.state, null).find((t) => t.key === sleeper.id);
    expect(target).toMatchObject({ kind: 'wreck', key: sleeper.id });
    expect(target!.wreck).toBeUndefined();
    sleeper.ai.mode = 'attack';
    expect(scanTargets(game.state, null).some((t) => t.key === sleeper.id)).toBe(false);
  });
});

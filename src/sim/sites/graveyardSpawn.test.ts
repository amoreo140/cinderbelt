// manageSiteWrecks seeds only what is missing (perf audit 2026-10-17, P2.4): a wreck or container already
// in the combat state is not rebuilt from the seed every 30 ticks.
import { describe, expect, it, vi } from 'vitest';
import { flyingAt } from '../discovery/testing';
import * as wrecks from '../discovery/wrecks';
import { manageSiteWrecks, graveyardLayout } from './graveyard';
import { sitesInChunk } from './placement';
import type { GraveyardSite } from './types';

vi.mock('../discovery/wrecks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../discovery/wrecks')>();
  return { ...actual, seedWreck: vi.fn(actual.seedWreck), seedContainers: vi.fn(actual.seedContainers) };
});

const SEED = 42;

function nearestGraveyard(): GraveyardSite {
  const out: GraveyardSite[] = [];
  for (let cx = -40; cx <= 40; cx++) for (let cy = -40; cy <= 40; cy++) for (const s of sitesInChunk(SEED, cx, cy)) if (s.kind === 'graveyard') out.push(s);
  return out.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
}

describe('manageSiteWrecks', () => {
  it('seeds only the missing wrecks and containers; the result matches a full reseed', () => {
    const g = nearestGraveyard();
    const game = flyingAt(SEED, g.pos);
    const state = game.state;
    state.combat.wrecks = [];
    state.combat.containers = [];
    manageSiteWrecks(state);
    const ids = state.combat.wrecks.map((w) => w.id);
    const containerIds = state.combat.containers.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(containerIds.length).toBeGreaterThan(0);
    expect(graveyardLayout(SEED, g).wrecks.length).toBeGreaterThanOrEqual(ids.length);

    const seedWreck = vi.mocked(wrecks.seedWreck);
    const seedContainers = vi.mocked(wrecks.seedContainers);
    seedWreck.mockClear();
    seedContainers.mockClear();
    const before = state.combat.wrecks.slice();
    manageSiteWrecks(state);
    expect(seedWreck).not.toHaveBeenCalled();
    expect(seedContainers).not.toHaveBeenCalled();
    expect(state.combat.wrecks).toEqual(before);
    for (let i = 0; i < before.length; i++) expect(state.combat.wrecks[i]).toBe(before[i]);

    // one wreck and one container gone: exactly they come back, rebuilt the same, at the end
    const lostWreck = state.combat.wrecks.splice(1, 1)[0]!;
    const lostContainer = state.combat.containers.splice(0, 1)[0]!;
    seedWreck.mockClear();
    seedContainers.mockClear();
    manageSiteWrecks(state);
    expect(seedWreck).toHaveBeenCalledTimes(1);
    expect(seedContainers).toHaveBeenCalledTimes(1);
    expect(state.combat.wrecks.at(-1)).toEqual(lostWreck);
    expect(state.combat.containers.at(-1)).toEqual(lostContainer);
    expect(state.combat.wrecks.map((w) => w.id).sort()).toEqual([...ids].sort());
    expect(state.combat.containers.map((c) => c.id).sort()).toEqual([...containerIds].sort());
  });
});

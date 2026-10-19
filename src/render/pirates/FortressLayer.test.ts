import { afterEach, describe, expect, it, vi } from 'vitest';
import { fortressSites } from '../../sim/pirates/sites';
import { Simulation } from '../../sim/Simulation';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { FortressLayer } from './FortressLayer';

// the pirate livery loads textures through the DOM – not needed for the bookkeeping checked here
vi.mock('../combat/livery', () => ({ applyLivery: () => {} }));

const empty = (_s: number, cx: number, cy: number) => ({ cx, cy, asteroids: [] });

interface Owned {
  geometries: Set<unknown>;
  materials: Set<unknown>;
}

describe('FortressLayer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('releases what a fortress built for itself when the ship flies away', () => {
    // no models in unit tests – placeholders everywhere
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, headers: new Headers() }));
    const sim = new Simulation({ seed: 5, startDocked: false, generator: empty });
    const layer = new FortressLayer({ part: () => null } as unknown as ModelLibrary);
    const owned = layer as unknown as Owned;
    const site = fortressSites(sim.state.seed)[0]!;
    const away = { x: site.pos.x + 20_000, y: site.pos.y + 20_000 };
    sim.state.player.body.pos = { ...away };
    layer.update(sim.state, 1 / 60);
    // the first visit creates the shared stand-ins too – measure from after it
    sim.state.player.body.pos = { ...site.pos };
    layer.update(sim.state, 1 / 60);
    sim.state.player.body.pos = { ...away };
    layer.update(sim.state, 1 / 60);
    const base = [owned.geometries.size, owned.materials.size];
    for (let i = 0; i < 10; i++) {
      sim.state.player.body.pos = { ...site.pos };
      layer.update(sim.state, 1 / 60);
      expect(layer.stats().fortresses).toBeGreaterThan(0);
      sim.state.player.body.pos = { ...away };
      layer.update(sim.state, 1 / 60);
    }
    expect([owned.geometries.size, owned.materials.size]).toEqual(base);
    layer.dispose();
  });
});

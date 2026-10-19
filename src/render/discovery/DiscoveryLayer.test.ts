import { afterEach, describe, expect, it, vi } from 'vitest';
import { echoSites } from '../../sim/discovery/poi';
import { Simulation } from '../../sim/Simulation';
import { DiscoveryLayer } from './DiscoveryLayer';

const empty = (_s: number, cx: number, cy: number) => ({ cx, cy, asteroids: [] });

interface Owned {
  ownedGeometries: Set<unknown>;
  ownedMaterials: Set<unknown>;
}

describe('DiscoveryLayer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('releases the rings and placeholders of places the ship flew away from', () => {
    // no models in unit tests – every place uses its placeholder
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, headers: new Headers() }));
    const sim = new Simulation({ seed: 3, startDocked: false, generator: empty });
    const layer = new DiscoveryLayer();
    const owned = layer as unknown as Owned;
    const echo = echoSites(sim.state.seed)[0]!;
    const away = { x: echo.pos.x + 5000, y: echo.pos.y + 5000 };
    // whatever stands far away stays built – it is the baseline
    sim.state.player.body.pos = { ...away };
    layer.update(sim.state, 1 / 60);
    const base = [owned.ownedGeometries.size, owned.ownedMaterials.size];
    for (let i = 0; i < 20; i++) {
      // there and back again: each visit builds the echo beacon anew
      sim.state.player.body.pos = { ...echo.pos };
      layer.update(sim.state, 1 / 60);
      expect(layer.stats().places).toBeGreaterThan(0);
      sim.state.player.body.pos = { ...away };
      layer.update(sim.state, 1 / 60);
    }
    expect(owned.ownedGeometries.size).toBe(base[0]);
    expect(owned.ownedMaterials.size).toBe(base[1]);
    layer.dispose();
  });
});

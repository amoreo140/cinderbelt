// The derived local condition "Comet flyby" (M4b T2, plan §2.3): `sectorState` adds `cometFlyby` exactly
// in the sectors a comet pass crosses during the epoch, on top of the rolled modifiers, which stay
// exactly what they were without comets.
import { describe, expect, it, vi } from 'vitest';
import { regionWorld } from '../regions';
import { cometSectorsInEpoch } from '../sites/comets';
import { sectorState } from './sector';

const SEEDS = [1, 2, 3, 42, 1337] as const;
const EPOCHS = 50;

describe('derived cometFlyby local condition', () => {
  it('appears exactly in the sectors a pass crosses in the epoch (never in the calm first one), last in the list', () => {
    for (const seed of SEEDS) {
      const finite = regionWorld(seed).regions.map((r) => r.seed.id);
      for (let epoch = 0; epoch < EPOCHS; epoch++) {
        const crossed = cometSectorsInEpoch(seed, epoch);
        for (const id of new Set([...finite, ...crossed])) {
          const mods = sectorState(seed, id, epoch).modifiers;
          const flyby = mods.filter((m) => m.id === 'cometFlyby');
          expect(flyby.length).toBe(epoch > 0 && crossed.has(id) ? 1 : 0);
          // last but for the derived convoy condition (M4d), which comes after it
          if (flyby.length) expect(mods.filter((m) => m.id !== 'convoy').at(-1)!.id).toBe('cometFlyby');
        }
      }
    }
  }, 15_000);

  it('leaves the rolled modifiers of 5 seeds × 50 epochs unchanged', async () => {
    const withComets = SEEDS.map((seed) =>
      regionWorld(seed).regions.map((r) =>
        Array.from({ length: EPOCHS }, (_, e) => sectorState(seed, r.seed.id, e).modifiers.filter((m) => m.id !== 'cometFlyby')),
      ),
    );
    // the same module without any comet: the rolls must be identical
    vi.resetModules();
    vi.doMock('../sites/comets', () => ({ cometSectorsInEpoch: () => new Set<string>() }));
    const plain = await import('./sector');
    const without = SEEDS.map((seed) =>
      regionWorld(seed).regions.map((r) => Array.from({ length: EPOCHS }, (_, e) => plain.sectorState(seed, r.seed.id, e).modifiers)),
    );
    vi.doUnmock('../sites/comets');
    expect(withComets).toEqual(without);
    // and the comets do add the condition somewhere
    const added = SEEDS.some((seed) => regionWorld(seed).regions.some((r) => sectorState(seed, r.seed.id, 7).modifiers.some((m) => m.id === 'cometFlyby')));
    expect(added).toBe(true);
  }, 15_000);
});

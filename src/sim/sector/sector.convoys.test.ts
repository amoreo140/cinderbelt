// The derived local condition "Convoy in the area" (M4d T5, plan §2.5): `sectorState` adds `convoy` exactly
// in the sectors a convoy pass crosses during the epoch, last, on top of the rolled modifiers, which stay
// exactly what they were without convoys.
import { describe, expect, it, vi } from 'vitest';
import { SECTOR_MODIFIERS } from '../../data/sector';
import { convoySectorsInEpoch } from '../convoys/schedule';
import { regionWorld } from '../regions';
import { sectorState } from './sector';

const SEEDS = [1, 3, 42] as const;
const EPOCHS = 20;

describe('derived convoy local condition', () => {
  it('is derived, never rolled', () => {
    expect(SECTOR_MODIFIERS.convoy.derived).toBe(true);
  });

  it('appears exactly in the sectors a pass crosses in the epoch (never in the calm first one), last in the list', () => {
    for (const seed of SEEDS) {
      const finite = regionWorld(seed).regions.map((r) => r.seed.id);
      for (let epoch = 0; epoch < EPOCHS; epoch++) {
        const crossed = convoySectorsInEpoch(seed, epoch);
        for (const id of new Set([...finite, ...crossed])) {
          const mods = sectorState(seed, id, epoch).modifiers;
          const convoy = mods.filter((m) => m.id === 'convoy');
          expect(convoy.length).toBe(epoch > 0 && crossed.has(id) ? 1 : 0);
          if (convoy.length) expect(mods[mods.length - 1]!.id).toBe('convoy');
        }
      }
    }
  });

  it('leaves the rolled modifiers unchanged', async () => {
    const withConvoys = SEEDS.map((seed) =>
      regionWorld(seed).regions.map((r) =>
        Array.from({ length: EPOCHS }, (_, e) => sectorState(seed, r.seed.id, e).modifiers.filter((m) => m.id !== 'convoy')),
      ),
    );
    vi.resetModules();
    vi.doMock('../convoys/schedule', () => ({ convoySectorsInEpoch: () => new Set<string>() }));
    const plain = await import('./sector');
    const without = SEEDS.map((seed) =>
      regionWorld(seed).regions.map((r) => Array.from({ length: EPOCHS }, (_, e) => plain.sectorState(seed, r.seed.id, e).modifiers)),
    );
    vi.doUnmock('../convoys/schedule');
    expect(withConvoys).toEqual(without);
    const added = SEEDS.some((seed) => regionWorld(seed).regions.some((r) => sectorState(seed, r.seed.id, 3).modifiers.some((m) => m.id === 'convoy')));
    expect(added).toBe(true);
  });
});

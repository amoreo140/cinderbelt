import { describe, expect, it } from 'vitest';
import { CLAN_IDS } from '../../data/factions';
import { nodeFs } from '../../testing/nodeFs';
import { DEBRIS_SETS, DEBRIS_VARIANTS, debrisPath, debrisSetFor } from './fxModels';

describe('combat debris by faction (art batch B2)', () => {
  it('pirate clans → pirate scrap, the Wardens → Forge-smith shards, everyone else → human plates', () => {
    for (const clan of CLAN_IDS) expect(debrisSetFor(clan)).toBe('pirate');
    expect(debrisSetFor('wardens')).toBe('kovaci');
    expect(debrisSetFor('guild')).toBe('human');
    expect(debrisSetFor('freeTraders')).toBe('human');
    expect(debrisSetFor(null)).toBe('human');
  });

  it('every variant of every set has its file', () => {
    expect(debrisPath('human', 'a')).toBe('assets/models/debris/debris_a.glb');
    expect(debrisPath('pirate', 'e')).toBe('assets/models/debris/debris_pirate_e.glb');
    for (const set of DEBRIS_SETS) {
      for (const v of DEBRIS_VARIANTS[set]) expect(nodeFs().existsSync(`public/${debrisPath(set, v)}`), debrisPath(set, v)).toBe(true);
    }
  });
});

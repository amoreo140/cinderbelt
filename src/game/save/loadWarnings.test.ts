import { describe, expect, it } from 'vitest';
import { loadWarningTexts } from './loadWarnings';

describe('loadWarningTexts', () => {
  it('turns every load warning into a message for the player', () => {
    const texts = loadWarningTexts(
      [
        { code: 'shipReplaced', stationId: 'st:1,2' },
        { code: 'overBudgetLegacy', used: 130, budget: 100 },
      ],
      (id) => (id === 'st:1,2' ? 'Kotva Lyra' : id),
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Kotva Lyra');
    expect(texts[1]).toContain('130');
    expect(texts[1]).toContain('100');
  });

  it('explains clamped capacities and covered nozzles of an old ship (M1, I15)', () => {
    const texts = loadWarningTexts(
      [
        { code: 'capacityClamped', paths: ['player.fuel'] },
        { code: 'coveredNozzleLegacy', engines: 2 },
      ],
      (id) => id,
    );
    expect(texts[0]).toContain('kapacit');
    expect(texts[1]).toContain('2 motory');
    expect(texts[1]).toContain('lodenic');
  });

  it('names the storage where a dropped hangar ship went (V16)', () => {
    const texts = loadWarningTexts([{ code: 'storedShipDropped', shipId: 3, stationId: 'st:1,2' }], (id) => (id === 'st:1,2' ? 'Kotva Lyra' : id));
    expect(texts[0]).toContain('Kotva Lyra');
    expect(texts[0]).toContain('hangár');
  });

  it('says that world site records were dropped (V17)', () => {
    const texts = loadWarningTexts([{ code: 'sitesRepaired', paths: ['sites.berth'] }], (id) => id);
    expect(texts[0]).toContain('relé');
  });

  it('is empty without warnings', () => {
    expect(loadWarningTexts([], (id) => id)).toEqual([]);
  });
});

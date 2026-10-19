import { describe, expect, it } from 'vitest';
import { sk } from '../i18n/sk';
import { NAME_PREFIX_COUNT, NAME_STAR_COUNT, homeStation, type StationDef } from '../sim/world/stations';
import { formatStationName } from './stationName';

const station = (kind: StationDef['kind'], prefix: number, star: number, number: number | null): StationDef => ({
  ...homeStation(),
  id: 'st:1,1',
  kind,
  name: { prefix, star, number },
});

describe('formatStationName', () => {
  it('has name lists matching the generator', () => {
    expect(sk.stationNames.prefixes).toHaveLength(NAME_PREFIX_COUNT);
    expect(sk.stationNames.stars).toHaveLength(NAME_STAR_COUNT);
  });

  it('names the home station', () => {
    expect(formatStationName(homeStation())).toBe('Základňa Počiatok');
  });

  it('names stations with and without number', () => {
    expect(formatStationName(station('station', 2, 1, 12))).toBe('Prístav Lyra-12');
    expect(formatStationName(station('station', 0, 0, null))).toBe('Kotva Vega');
  });

  it('names outposts as patrols', () => {
    expect(formatStationName(station('outpost', 5, 6, 7))).toBe('Hliadka Deneb-7');
  });
});

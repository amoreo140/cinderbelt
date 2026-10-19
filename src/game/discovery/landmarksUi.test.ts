import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { chunkCoord, chunkKey } from '../../sim/world/chunks';
import { landmarkSites } from '../../sim/world/landmarks';
import { regionAt } from '../../sim/regions/field';
import { LANDMARK_SEEN_RANGE, landmarkSector, mapLandmarks, seenLandmarks } from './landmarksUi';

const keyAt = (x: number, y: number) => chunkKey(chunkCoord(x), chunkCoord(y));

describe('seenLandmarks', () => {
  const sites = landmarkSites(42);

  it('knows only the gas giant before any flight', () => {
    expect(seenLandmarks(sites, []).map((s) => s.kind)).toEqual(['gas_giant']);
  });

  it('adds a landmark once an explored chunk lies within sight of it', () => {
    const relay = sites.find((s) => s.kind === 'guild_relay')!;
    const near = keyAt(relay.pos.x + LANDMARK_SEEN_RANGE * 0.7, relay.pos.y);
    const far = keyAt(relay.pos.x + LANDMARK_SEEN_RANGE * 1.3, relay.pos.y + LANDMARK_SEEN_RANGE * 1.3);
    expect(seenLandmarks(sites, [far]).some((s) => s.id === relay.id)).toBe(false);
    expect(seenLandmarks(sites, [far, near]).some((s) => s.id === relay.id)).toBe(true);
  });

  it('ignores malformed keys', () => {
    expect(seenLandmarks(sites, ['', 'x', '1;2']).map((s) => s.kind)).toEqual(['gas_giant']);
  });
});

describe('mapLandmarks', () => {
  it('names the landmarks in the current language', () => {
    setLocale('en');
    expect(mapLandmarks(42, new Set()).map((l) => l.name)).toEqual(['Gas giant']);
    setLocale('sk');
    expect(mapLandmarks(42, new Set()).map((l) => l.name)).toEqual(['Plynný obor']);
  });
});

describe('landmarks in their sectors (sectors spec 5.3)', () => {
  it('binds every landmark to the sector of its anchor', () => {
    for (const site of landmarkSites(42)) expect(landmarkSector(42, site)).toBe(regionAt(42, site.pos.x, site.pos.y).id);
  });

  it('shows a landmark once its sector is known, without moving it', () => {
    const sites = landmarkSites(42);
    const relay = sites.find((s) => s.kind === 'guild_relay')!;
    const home = new Set([landmarkSector(42, relay)]);
    const shown = mapLandmarks(42, new Set(), (id) => home.has(id));
    expect(shown.map((l) => l.id).sort()).toEqual(sites.filter((s) => s.kind === 'gas_giant' || home.has(landmarkSector(42, s))).map((s) => s.id).sort());
    expect(shown.find((l) => l.id === relay.id)!.pos).toEqual(relay.pos);
    expect(mapLandmarks(42, new Set(), () => false).map((l) => l.kind)).toEqual(['gas_giant']);
  });
});

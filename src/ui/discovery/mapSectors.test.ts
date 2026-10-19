// The Sectors map layer's pure parts: the name labels handed to the label layout (only known sectors,
// priority by zoom) and the automatic view's nearest border.
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { sectorIdAt, sectorInfo } from '../../sim/regions/sectors';
import { NO_SECURITY_OVERRIDES, regionWorld } from '../../sim/regions/world';
import { layoutLabels, LABEL_PRIORITY } from '../mapLabels';
import { nearestSectorBorder, sectorMapLabels, sectorStepFor, SECTOR_FAR_SCALE } from './mapSectors';

const SEED = 1337;
const knowledge = (id: string) => sectorInfo(SEED, id)?.startKnowledge ?? 'uncharted';
const data = { seed: SEED, knowledge, overrides: NO_SECURITY_OVERRIDES };

describe('sector map labels', () => {
  afterEach(() => setLocale('sk'));

  it('names only the known sectors in view, with the knowledge glyph and the security', () => {
    setLocale('sk');
    const labels = sectorMapLabels(data, { center: { x: 0, y: 0 }, scale: 0.25, w: 1200, h: 800 });
    const origin = labels.find((l) => l.id === `sector:${sectorIdAt(SEED, 0, 0)}`)!;
    expect(origin.text).toBe('Počiatok');
    expect(origin.sub?.text).toBe('[x] STRÁŽENÝ');
    expect(origin.priority).toBe(LABEL_PRIORITY.sector);
    // every label belongs to a known sector; the unknown ones stay nameless on the map
    for (const l of labels) expect(knowledge(l.id.slice('sector:'.length))).not.toBe('uncharted');
    const unknown = regionWorld(SEED).regions.filter((r) => knowledge(r.seed.id) === 'uncharted' && Math.hypot(r.seed.x, r.seed.y) < 1500);
    expect(unknown.length).toBeGreaterThan(0);
    for (const r of unknown) expect(labels.some((l) => l.id === `sector:${r.seed.id}`)).toBe(false);
  });

  it('zoomed out, sector names win over station labels', () => {
    const near = sectorMapLabels(data, { center: { x: 0, y: 0 }, scale: 0.25, w: 1200, h: 800 });
    const far = sectorMapLabels(data, { center: { x: 0, y: 0 }, scale: SECTOR_FAR_SCALE / 2, w: 1200, h: 800 });
    expect(near.every((l) => l.priority > LABEL_PRIORITY.station)).toBe(true);
    expect(far.length).toBeGreaterThan(near.length - 1);
    expect(far.every((l) => l.priority < LABEL_PRIORITY.station)).toBe(true);
    // a station label at the same spot: near home it keeps its place and the sector name moves or goes
    const origin = near.find((l) => l.text === 'Počiatok' || l.text === 'Origin')!;
    const req = (l: (typeof near)[number]) => ({ ...l, w: 90, h: 30 });
    const station = { id: 'station:0', priority: LABEL_PRIORITY.station, anchor: origin.anchor, w: 120, h: 16, gap: -8, sides: ['below' as const] };
    const placed = layoutLabels([req(origin), station], { w: 1200, h: 800 });
    const st = placed.find((p) => p.id === 'station:0')!;
    expect(st.y).toBeCloseTo(origin.anchor.y - 8);
    const sec = placed.find((p) => p.id === origin.id);
    if (sec) expect(sec.y + sec.h <= st.y || sec.y >= st.y + st.h).toBe(true);
  });

  it('English labels', () => {
    setLocale('en');
    const labels = sectorMapLabels(data, { center: { x: 0, y: 0 }, scale: 0.25, w: 1200, h: 800 });
    expect(labels.find((l) => l.text === 'Origin')?.sub?.text).toBe('[x] GUARDED');
  });
});

describe('sector map helpers', () => {
  it('the sample step follows the zoom (≥ 3 px per sample)', () => {
    expect(sectorStepFor(0.3)).toBe(50);
    expect(sectorStepFor(0.04)).toBe(100);
    expect(sectorStepFor(0.01)).toBe(200);
  });

  it('the nearest sector border from home is within the home sector size', () => {
    const d = nearestSectorBorder(SEED, { x: 0, y: 0 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(1200);
    // the point that far out along some direction is in another sector
    expect(nearestSectorBorder(SEED, { x: 0, y: 0 }, 50)).toBe(50);
  });
});

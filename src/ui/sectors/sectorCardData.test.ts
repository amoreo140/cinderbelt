import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { skSectors } from '../../i18n/skSectors';
import { sectorInfo, sectorIdAt, sectorSecurity } from '../../sim/regions/sectors';
import { NO_SECURITY_OVERRIDES, regionWorld } from '../../sim/regions/world';
import { homeStation } from '../../sim/world/stations';
import { routeSummary, sectorCardData, sectorKnown, sectorsAlong, type SectorCardInput } from './sectorCardData';

const SEED = 1337;

/** Vertical stripes 100 u wide: A for x < 100, B for x < 200 … */
const stripes = (x: number): string => String.fromCharCode(65 + Math.max(0, Math.floor(x / 100)));

describe('route home sampling', () => {
  it('lists the sectors after the start one, in order, each once', () => {
    expect(sectorsAlong((x) => stripes(x), { x: 10, y: 0 }, { x: 350, y: 0 })).toEqual(['B', 'C', 'D']);
    expect(sectorsAlong((x) => stripes(x), { x: 10, y: 0 }, { x: 60, y: 0 })).toEqual([]);
    // leaving a sector and coming back counts it once: A B A C
    const wiggle = (x: number) => (x < 100 ? 'A' : x < 150 ? 'B' : x < 250 ? 'A' : 'C');
    expect(sectorsAlong((x) => wiggle(x), { x: 0, y: 0 }, { x: 400, y: 0 }, 10)).toEqual(['B', 'C']);
  });

  it('a sector narrower than the step can be missed only below the step size', () => {
    const thin = (x: number) => (x >= 200 && x < 220 ? 'T' : 'O');
    expect(sectorsAlong((x) => thin(x), { x: 0, y: 0 }, { x: 400, y: 0 }, 15)).toContain('T');
  });

  it('counts Pirate, Contested and unknown sectors on the route', () => {
    const sec = { a: 'pirate', b: 'contested', c: null, d: 'guarded', e: 'pirate' } as const;
    const sum = routeSummary(['a', 'b', 'c', 'd', 'e'], 1234, (id) => sec[id as keyof typeof sec]);
    expect(sum).toEqual({ sectors: 5, distance: 1234, risks: { pirate: 2, contested: 1, unknown: 1 } });
  });

  it('knows a sector that is Reported, Charted, flown through or the current one', () => {
    expect(sectorKnown('x', 'uncharted', 0, null)).toBe(false);
    expect(sectorKnown('x', 'uncharted', null, null)).toBe(false);
    expect(sectorKnown('x', 'uncharted', 0.1, null)).toBe(true);
    expect(sectorKnown('x', 'uncharted', 0, 'x')).toBe(true);
    expect(sectorKnown('x', 'reported', 0, null)).toBe(true);
  });
});

describe('sector card data (sectors §5.1)', () => {
  afterEach(() => setLocale('sk'));
  const world = regionWorld(SEED);
  const home = homeStation().pos;
  const originId = sectorIdAt(SEED, home.x, home.y);
  const input = (id: string, over: Partial<SectorCardInput> = {}): SectorCardInput => ({
    seed: SEED,
    id,
    from: sectorInfo(SEED, id)!.anchor,
    overrides: NO_SECURITY_OVERRIDES,
    knowledge: (other) => sectorInfo(SEED, other)?.startKnowledge ?? 'uncharted',
    coverage: () => 0,
    current: originId,
    stations: [],
    landmarks: [],
    ...over,
  });

  it('the home sector: name, Guarded, here, a home line instead of a route, the home station', () => {
    setLocale('sk');
    const d = sectorCardData(input(originId, { stations: [{ name: 'Domov', pos: home }, { name: 'Ďaleko', pos: { x: 9000, y: 9000 } }], coverage: () => 0.42 }))!;
    expect(d.name).toBe('Počiatok');
    expect(d.known).toBe(true);
    expect(d.here).toBe(true);
    expect(d.securityWord).toBe(skSectors.security[sectorSecurity(SEED, originId)]);
    expect(d.mapping).toContain('42 %');
    expect(d.stations).toEqual(['Domov']);
    expect('home' in d.route).toBe(true);
    expect(d.environment).toMatch(/^Prostredie: /);
  });

  it('a far known sector: the route home counts its sectors and risks, in both languages', () => {
    const far = world.regions.find((r) => r.seed.depth === 3 && (world.startKnowledge.get(r.seed.id) ?? 'uncharted') !== 'uncharted') ?? world.regions.find((r) => r.seed.depth === 3)!;
    const id = far.seed.id;
    setLocale('sk');
    const sk = sectorCardData(input(id, { knowledge: () => 'reported' }))!;
    expect(sk.known).toBe(true);
    expect(sk.depth).toMatch(/^hĺbka 3/);
    if ('home' in sk.route) throw new Error('not home');
    expect(sk.route.line).toMatch(/^Trasa domov: \d+ sektor/);
    // every sector is known here: no "unknown" chip, and the counts agree with the sampled line
    expect(sk.route.risks.every((r) => r.risk !== 'unknown')).toBe(true);
    setLocale('en');
    const en = sectorCardData(input(id, { knowledge: () => 'reported' }))!;
    if ('home' in en.route) throw new Error('not home');
    expect(en.route.line).toMatch(/^Route home: \d+ sectors? · [\d\s ,]+ u$/);
    expect(en.securityWord.length).toBeGreaterThan(0);
  });

  it('an Uncharted sector never flown through is "Unknown sector" without its security, environment or contents', () => {
    const far = world.regions.find((r) => r.seed.depth === 2 && (world.startKnowledge.get(r.seed.id) ?? 'uncharted') === 'uncharted')!;
    setLocale('en');
    const d = sectorCardData(input(far.seed.id, { current: null, stations: [{ name: 'X', pos: far.seed }] }))!;
    expect(d.known).toBe(false);
    expect(d.name).toBe('Unknown sector');
    expect(d.security).toBeNull();
    expect(d.environment).toBeNull();
    expect(d.stations).toEqual([]);
    expect(d.mapping).toBe('[ ] Uncharted · flown 0%');
    // the unknown sectors on the way are counted as unknown, not by their security
    if ('home' in d.route) throw new Error('not home');
    const unknownOnRoute = d.route.risks.find((r) => r.risk === 'unknown');
    if (unknownOnRoute) expect(unknownOnRoute.text).toMatch(/× unknown$/);
  });

  it('is null for an id that is not a sector of the seed', () => {
    expect(sectorCardData(input(originId, { id: 'nope' }))).toBeNull();
  });
});

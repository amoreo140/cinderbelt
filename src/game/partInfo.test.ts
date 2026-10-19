import { skMining } from '../i18n/skMining';
import { describe, expect, it } from 'vitest';
import { ALL_PART_KEYS, PART_IDS } from '../data/parts';
import { VARIANT_IDS } from '../data/variants';
import { skParts } from '../i18n/skParts';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { ShipGrid } from '../sim/ship/types';
import { formatMetric, partDescription, partInfo } from './partInfo';

/** Thousands are separated by a non-breaking space – compare it as a plain one. */
const plain = (s: string): string => s.replace(/\u00a0/g, ' ');
/** The same for whole objects (rows, advice). */
const plainAll = <T,>(o: T): T => JSON.parse(JSON.stringify(o).replace(/\u00a0/g, ' ')) as T;

function heavyShip(): ShipGrid {
  const grid = createStarterShip();
  const extra = createGrid([
    ['largeCargo', -3, 0],
    ['largeCargo', -3, -2],
    ['largeCargo', -5, 0],
    ['largeCargo', -5, -2],
  ]);
  for (const p of extra.parts) grid.parts.push({ ...p, id: grid.nextId++ });
  return grid;
}

describe('part descriptions', () => {
  it('every part has what / when / trade-off in plain words', () => {
    for (const id of PART_IDS) {
      const d = skParts.parts[id];
      expect(d.what.length, id).toBeGreaterThan(20);
      expect(d.when.length, id).toBeGreaterThan(10);
      expect(d.tradeoff.length, id).toBeGreaterThan(20);
    }
  });
  it('every variant explains its catch', () => {
    for (const v of VARIANT_IDS) expect(skParts.variants[v].length, v).toBeGreaterThan(15);
  });
  it('every part key (base and variants) resolves to a description', () => {
    for (const key of ALL_PART_KEYS) {
      const d = partDescription(key);
      expect(d.description.what, key).toBeTruthy();
      expect(d.variant === null, key).toBe(key.split(':').length === 2);
    }
  });
  it('the gyroscope says what it does and that the cockpit has a small one', () => {
    expect(skParts.parts.gyro.what).toContain('Otáča loď');
    expect(skParts.parts.gyro.what).toContain('Kokpit má malý vstavaný gyroskop');
  });
});

describe('formatMetric', () => {
  it('uses human units with a decimal comma', () => {
    expect(plain(formatMetric('turn180', 3.47))).toBe('3,5 s');
    expect(plain(formatMetric('turn180', 14.2))).toBe('14 s');
    expect(plain(formatMetric('turn180', null))).toBe('neotočí sa');
    expect(plain(formatMetric('accel', 7.2))).toBe('7,2 j/s²');
    expect(plain(formatMetric('fuelRange', 13083))).toBe('13 100 j');
    expect(plain(formatMetric('energyMining', -2))).toBe('−2/s');
    expect(plain(formatMetric('energyMining', 4))).toBe('+4/s');
    expect(plain(formatMetric('hull', 14, 28))).toBe('14 / 28 b');
    expect(plain(formatMetric('dps', 18))).toBe('18 HP/s');
    expect(plain(formatMetric('cannonArc', 120))).toBe('120°');
    expect(plain(formatMetric('brakeTime', null))).toBe('nebrzdí');
  });
});

describe('partInfo', () => {
  it('Gyroskop T2 on the starter ship: a faster half turn, the price in acceleration', () => {
    const info = plainAll(partInfo(createStarterShip(), 'gyro:2'));
    expect(info.title).toBe('Na tvojej lodi');
    const [turn, hull, accel] = info.rows;
    expect(turn).toMatchObject({ id: 'turn180', label: 'Otočka o 180°', before: '3,5 s', after: '2,4 s', trend: 'better', role: 'main' });
    expect(turn!.delta).toBe('−30 %');
    expect(turn!.tip).toBe(skParts.glossary.turn180);
    expect(hull).toMatchObject({ id: 'hull', before: '14 / 28 b', after: '15 / 28 b', trend: 'same' });
    expect(accel).toMatchObject({ id: 'accel', trend: 'worse', role: 'side' });
    expect(info.advice).toBeNull();
    expect(info.notes).toEqual([]);
  });
  it('names the slow turn the gyroscope fixes', () => {
    const info = plainAll(partInfo(heavyShip(), 'gyro:1'));
    expect(info.advice?.tone).toBe('ok');
    expect(info.advice?.text).toMatch(/^Tvoja loď sa otáča pomaly – 180° za \d+(,\d)? s\. S týmto dielom za \d+(,\d)? s\.$/);
  });
  it('warns that another laser drains the battery while mining', () => {
    const info = plainAll(partInfo(createStarterShip(), 'miningLaser:1'));
    expect(info.advice).toEqual({
      tone: 'warn',
      text: 'Pozor: s týmto laserom bude energia pri ťažbe záporná (−2/s) a batéria sa vybije. Pomôže reaktor.',
    });
    const energy = info.rows.find((r) => r.id === 'energyMining')!;
    expect(energy).toMatchObject({ before: '+4/s', after: '−2/s', delta: '−6/s', trend: 'worse' });
  });
  it('a radar that sees no further says so', () => {
    expect(plainAll(partInfo(createStarterShip(), 'radar:1').advice)).toEqual({
      tone: 'info',
      text: 'Tvoj radar už vidí na 180 j – tento nič nepridá. Platí len najlepší radar.',
    });
  });
  it('a cockpit swap shows the bigger hull budget and says it replaces the old one', () => {
    const info = plainAll(partInfo(createStarterShip(), 'cockpit:2'));
    expect(info.rows[0]).toMatchObject({ id: 'hull', before: '14 / 28 b', after: '14 / 48 b', delta: '+20 b', trend: 'better' });
    expect(info.notes).toContain(skParts.effect.replaces);
    // the radar and the like do not change – only what does is listed
    expect(info.rows.map((r) => r.id)).not.toContain('radar');
  });
  it('engines and cannons say what the estimate assumes', () => {
    expect(partInfo(createStarterShip(), 'engine:1').notes).toEqual([skParts.effect.placement.engineForward]);
    expect(partInfo(createStarterShip(), 'cannon:2').notes).toEqual([skParts.effect.placement.cannonArc]);
  });
  it('mining lasers explain that several lasers mine independently (Mining 2.0)', () => {
    for (const key of ['miningLaser:1', 'heavyLaser:2'] as const) {
      expect(partInfo(createStarterShip(), key).notes).toContain(skMining.laserNote);
    }
    expect(skMining.laserNote).toMatch(/±60°/);
  });
  it('the shipyard calls it the draft', () => {
    expect(partInfo(createStarterShip(), 'cargo:1', { draft: true }).title).toBe('Na tvojom návrhu');
  });
  it('a ship without brakes hears about it once, with the engine as the fix', () => {
    const grid = createStarterShip();
    grid.parts = grid.parts.filter((p) => !(p.partId === 'engine' && p.rot === 2));
    expect(partInfo(grid, 'engine:1').advice?.text).toBe(skParts.advice.fixes.noBrake);
    expect(partInfo(grid, 'cargo:1').advice?.text).toBe(skParts.advice.general.noBrake);
  });
  it('a full hull budget blocks any part', () => {
    const grid = heavyShip();
    grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -1, y: 2, rot: 0 });
    grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -1, y: -2, rot: 0 });
    expect(plainAll(partInfo(grid, 'largeCargo:1').advice)).toEqual({
      tone: 'warn',
      text: 'Nezmestí sa: trup má 28 / 28 b a diel potrebuje 3 b. Kokpit T2 unesie 48 b.',
    });
  });
  it('works for every part key on the starter ship and on an empty draft', () => {
    for (const key of ALL_PART_KEYS) {
      const info = partInfo(createStarterShip(), key);
      expect(info.rows.length, key).toBeGreaterThan(1);
      for (const r of info.rows) {
        expect(r.label, key).toBeTruthy();
        expect(r.tip, `${key} ${r.id}`).toBeTruthy();
        expect(r.before, key).not.toContain('NaN');
        expect(r.after, key).not.toContain('NaN');
      }
      expect(() => partInfo({ parts: [], nextId: 1 }, key, { draft: true }), key).not.toThrow();
    }
  });
});

describe('shaped armour in hand (SL2 E2)', () => {
  it('"On your design" counts the shape in hand: a wedge adds half the HP of a full plate', () => {
    const grid = createStarterShip();
    const hpDelta = (shape?: 'wedge' | null): string | null =>
      partInfo(grid, 'armor:1', { draft: true, shape }).rows.find((r) => r.id === 'hp')?.delta ?? null;
    expect(plain(hpDelta() ?? '')).toBe('+40 HP');
    expect(plain(hpDelta(null) ?? '')).toBe('+40 HP');
    expect(plain(hpDelta('wedge') ?? '')).toBe('+20 HP');
  });
});

// M4c T10: part explanations of the new parts (large reactor, repair module, refinery) and of the five
// new variants (M4c).
import { beforeAll, describe, expect, it } from 'vitest';
import { partDefOf, type PartKey } from '../data/parts';
import { setLocale } from '../i18n';
import { createStarterShip } from '../sim/ship/presets';
import { partEffect, shipMetrics, summarizeShip } from './partEffect';
import { formatMetric, partInfo } from './partInfo';
import { partStats } from './shipyardView';

/** Non-breaking and narrow spaces compare as plain ones. */
const plain = (s: string | null): string | null => (s === null ? null : s.replace(/[  ]/g, ' '));
const row = (key: PartKey, id: string) => {
  const r = partInfo(createStarterShip(), key).rows.find((x) => x.id === id);
  if (!r) throw new Error(`${key}: no row ${id}`);
  return { ...r, before: plain(r.before), after: plain(r.after), delta: plain(r.delta) };
};
const mainIds = (key: PartKey) => partEffect(createStarterShip(), key).rows.filter((r) => r.role === 'main').map((r) => r.id);

beforeAll(() => setLocale('sk'));

describe('large reactor', () => {
  it('leads with energy and battery and warns about its blast', () => {
    expect(mainIds('largeReactor:1')).toEqual(['energyMining', 'blast', 'energyCombat', 'battery']);
    const blast = row('largeReactor:1', 'blast');
    expect(blast).toMatchObject({ before: 'žiadny', after: '40 HP', delta: '+40 HP', trend: 'worse', role: 'main' });
    expect(row('largeReactor:2', 'blast').after).toBe('50 HP');
  });
  it('adds its energy and battery to the ship', () => {
    const base = shipMetrics(summarizeShip(createStarterShip()));
    const e = partEffect(createStarterShip(), 'largeReactor:1');
    expect(e.metricsAfter.energyMining! - base.energyMining!).toBeCloseTo(45);
    expect(e.metricsAfter.battery! - base.battery!).toBeCloseTo(120);
    expect(row('largeReactor:1', 'battery').trend).toBe('better');
  });
});

describe('repair module', () => {
  it('shows the repair rate and the workshop energy', () => {
    expect(mainIds('repairModule:1')).toEqual(['repairRate', 'energyWorkshop']);
    expect(row('repairModule:1', 'repairRate')).toMatchObject({ before: '0 HP/s', after: '1 HP/s', delta: '+1 HP/s', trend: 'better' });
    expect(row('repairModule:2', 'repairRate').after).toBe('1,5 HP/s');
    const gen = summarizeShip(createStarterShip()).energyGen;
    const energy = row('repairModule:1', 'energyWorkshop');
    expect(energy.before).toBe('bez dielne');
    expect(energy.after).toBe(plain(formatMetric('energyWorkshop', gen - 3)));
  });
  it('names the repair material of the ship’s parts in a note (Fe for T1 parts, Ti for T2)', () => {
    const note = (grid: ReturnType<typeof createStarterShip>) => partInfo(grid, 'repairModule:1').notes.join(' ');
    expect(note(createStarterShip())).toContain('diely T1 železom');
    expect(note(createStarterShip())).not.toContain('titánom');
    const mixed = createStarterShip();
    mixed.parts[1] = { ...mixed.parts[1]!, tier: 2 };
    expect(note(mixed)).toContain('diely T1 železom a diely T2 titánom');
  });
});

describe('refinery', () => {
  it('shows ore refining, ice to fuel and the workshop energy', () => {
    expect(mainIds('refinery:1')).toEqual(['refineOre', 'refineIce', 'energyWorkshop']);
    expect(row('refinery:1', 'refineOre')).toMatchObject({ before: '0 j/s', after: '0,6 j/s', trend: 'better' });
    expect(row('refinery:1', 'refineIce').after).toBe('0,5 j/s');
    expect(row('refinery:2', 'refineOre').after).toBe('0,9 j/s');
    expect(row('refinery:2', 'refineIce').after).toBe('0,75 j/s');
  });
  it('a second workshop part lowers the workshop energy balance', () => {
    const grid = createStarterShip();
    grid.parts.push({ id: grid.nextId++, partId: 'refinery', tier: 1, x: -3, y: 0, rot: 0 });
    const r = partInfo(grid, 'repairModule:1').rows.find((x) => x.id === 'energyWorkshop')!;
    expect(r.trend).toBe('worse');
    expect(plain(r.delta)).toBe('−3/s');
  });
  it('says what it does first (fuel) and the ore order; the description gives the +15 %', () => {
    const info = partInfo(createStarterShip(), 'refinery:1');
    expect(info.notes.join(' ')).toContain('titán, meď, železo');
    expect(info.description.what.replace(/ /g, ' ')).toContain('15 %');
  });
});

describe('variants against the base part', () => {
  const vs = (key: PartKey) =>
    Object.fromEntries((partInfo(createStarterShip(), key).variantVs ?? []).map((r) => [r.id, [plain(r.delta), r.trend]]));

  it('light armour: mass −50 %, HP −40 %', () => {
    expect(vs('armor:1:light')).toEqual({ mass: ['−50 %', 'better'], hp: ['−40 %', 'worse'] });
  });
  it('focused laser, flywheel gyroscope, buffer reactor, long barrel', () => {
    expect(vs('miningLaser:1:focused')).toEqual({ miningRate: ['+35 %', 'better'], miningEnergy: ['+50 %', 'worse'] });
    expect(vs('gyro:2:flywheel')).toEqual({ mass: ['+75 %', 'worse'], torque: ['+60 %', 'better'] });
    expect(vs('reactor:1:buffer')).toEqual({ battery: ['+200 %', 'better'], energyGen: ['−40 %', 'worse'] });
    expect(vs('cannon:1:longBarrel')).toEqual({ damage: ['+50 %', 'better'], fireRate: ['−50 %', 'worse'], weaponRange: ['+40 %', 'better'] });
  });
  it('a base part has no comparison', () => {
    expect(partInfo(createStarterShip(), 'armor:1').variantVs).toBeNull();
  });
  it('the variant still shows its effect on the ship (light armour: less HP than a plain plate)', () => {
    const light = row('armor:1:light', 'hp');
    const plate = row('armor:1', 'hp');
    expect(light.trend).toBe('better');
    expect(Number(light.after!.replace(/\D/g, ''))).toBeLessThan(Number(plate.after!.replace(/\D/g, '')));
  });
});

describe('part stats of the new parts', () => {
  const stats = (key: PartKey) => Object.fromEntries(partStats(key).map((s) => [s.id, s.value]));
  it('large reactor: energy, battery and blast', () => {
    expect(stats('largeReactor:1')).toMatchObject({ mass: 10, hp: 110, energyGen: 45, battery: 120, blast: 40 });
  });
  it('repair module: rate and draw', () => {
    expect(stats('repairModule:2')).toMatchObject({ hp: 52, repairRate: 1.5, repairEnergy: 4 });
  });
  it('refinery: ice, ore and draw', () => {
    expect(stats('refinery:1')).toMatchObject({ refineIce: 0.5, refineOre: 0.6, refineEnergy: 5 });
  });
  it('every stat has a label and a glossary tip in both languages', () => {
    for (const lang of ['sk', 'en'] as const) {
      setLocale(lang);
      for (const key of ['largeReactor:1', 'repairModule:1', 'refinery:1'] as const) {
        for (const s of partStats(key)) {
          expect(s.label, `${lang} ${key} ${s.id}`).toBeTruthy();
          expect(s.tip, `${lang} ${key} ${s.id}`).toBeTruthy();
        }
      }
    }
    setLocale('sk');
  });
  it('the data match the part definitions', () => {
    expect(partDefOf('refinery:2').refinery?.orePerSecond).toBe(0.9);
  });
});

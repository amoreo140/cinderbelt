import { describe, expect, it } from 'vitest';
import { enSectors } from '../../i18n/enSectors';
import { skSectors } from '../../i18n/skSectors';
import type { Speaker } from '../comms/types';
import { SECTOR_RADIO_GAP, SectorRadio, tauntsIn, type SectorRadioEntry, type SectorRadioVoices } from './sectorRadio';

const voice = (id: string): Speaker => ({ id, name: id, role: id, portrait: 'unknown', faction: 'unknown', kind: 'unknown', accent: '#fff' });
const VOICES: SectorRadioVoices = { watch: voice('watch'), traffic: voice('traffic'), instructor: voice('instructor'), jackal: voice('jackal'), hammer: voice('hammer') };

const entry = (over: Partial<SectorRadioEntry> = {}): SectorRadioEntry => ({
  seed: 7,
  id: 'rg:b:1',
  name: 'Tichý prah',
  security: 'guarded',
  hammer: false,
  training: false,
  tick: 6000,
  ...over,
});

/** A sector id of seed 7 where a pirate taunts (or not). */
const idWhere = (taunts: boolean): string => {
  for (let i = 0; i < 500; i++) if (tauntsIn(7, `rg:b:${i}`) === taunts) return `rg:b:${i}`;
  throw new Error('no such id');
};

describe('sector radio (sectors §3.1)', () => {
  it('the Guild Watch welcomes the pilot in a Guarded sector, by the sector name, in both languages', () => {
    for (const t of [skSectors, enSectors]) {
      const msgs = new SectorRadio().enter(entry(), VOICES, t.radio);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.speaker.id).toBe('watch');
      expect(msgs[0]!.channel).toBe('station');
      expect(msgs[0]!.lines[0]).toContain('Tichý prah');
    }
  });

  it('a live language switch rebuilds the line in the language of the moment (voices, texts, name)', () => {
    const msgs = new SectorRadio().enter(entry(), VOICES, skSectors.radio, () => ({ voices: { ...VOICES, watch: voice('watch-en') }, t: enSectors.radio, name: 'Quiet Threshold' }));
    const again = msgs[0]!.retext!();
    expect(again.speaker.id).toBe('watch-en');
    expect(again.lines[0]).toContain('Quiet Threshold');
    expect(enSectors.radio.welcome.map((f) => f('Quiet Threshold'))).toContain(again.lines[0]);
    // without a source of the current language the line stays as received
    expect(new SectorRadio().enter(entry(), VOICES, skSectors.radio)[0]!.retext).toBeUndefined();
  });

  it('a Quiet sector stays silent', () => {
    expect(new SectorRadio().enter(entry({ security: 'quiet' }), VOICES, skSectors.radio)).toEqual([]);
  });

  it('traffic control warns about a Contested sector, the instructor during the training', () => {
    const traffic = new SectorRadio().enter(entry({ security: 'contested' }), VOICES, skSectors.radio);
    expect(traffic.map((m) => m.speaker.id)).toEqual(['traffic']);
    const training = new SectorRadio().enter(entry({ security: 'contested', training: true }), VOICES, skSectors.radio);
    expect(training.map((m) => [m.speaker.id, m.channel])).toEqual([['instructor', 'training']]);
  });

  it('a Pirate sector: a danger warning, then a pirate taunt in some nests (never during the training)', () => {
    const nest = idWhere(true);
    const quiet = idWhere(false);
    const both = new SectorRadio().enter(entry({ security: 'pirate', id: nest }), VOICES, enSectors.radio);
    expect(both.map((m) => [m.speaker.id, m.channel])).toEqual([
      ['traffic', 'danger'],
      ['jackal', 'danger'],
    ]);
    const rust = new SectorRadio().enter(entry({ security: 'pirate', id: nest, hammer: true }), VOICES, enSectors.radio);
    expect(rust[1]!.speaker.id).toBe('hammer');
    expect(new SectorRadio().enter(entry({ security: 'pirate', id: quiet }), VOICES, enSectors.radio).map((m) => m.speaker.id)).toEqual(['traffic']);
    const training = new SectorRadio().enter(entry({ security: 'pirate', id: nest, training: true }), VOICES, enSectors.radio);
    expect(training.map((m) => m.speaker.id)).toEqual(['instructor']);
  });

  it('about half of the pirate sectors have a taunting pirate, stable for the seed', () => {
    let n = 0;
    for (let i = 0; i < 400; i++) if (tauntsIn(11, `rg:a:${i}`)) n++;
    expect(n / 400).toBeGreaterThan(0.35);
    expect(n / 400).toBeLessThan(0.65);
    expect(tauntsIn(11, 'rg:a:5')).toBe(tauntsIn(11, 'rg:a:5'));
  });

  it('each kind is throttled by game time', () => {
    const radio = new SectorRadio();
    const t0 = 6000;
    expect(radio.enter(entry({ id: 'a', tick: t0 }), VOICES, skSectors.radio)).toHaveLength(1);
    expect(radio.enter(entry({ id: 'b', tick: t0 + 60 * 30 }), VOICES, skSectors.radio)).toHaveLength(0);
    // another kind is not held back by the welcome
    expect(radio.enter(entry({ id: 'c', security: 'contested', tick: t0 + 60 * 31 }), VOICES, skSectors.radio)).toHaveLength(1);
    expect(radio.enter(entry({ id: 'd', tick: t0 + 60 * SECTOR_RADIO_GAP.welcome }), VOICES, skSectors.radio)).toHaveLength(1);
    radio.reset();
    expect(radio.enter(entry({ id: 'e', tick: t0 + 60 * (SECTOR_RADIO_GAP.welcome + 1) }), VOICES, skSectors.radio)).toHaveLength(1);
  });

  it('variants are deterministic: the same entry says the same line, other ticks vary it', () => {
    const a = new SectorRadio().enter(entry(), VOICES, skSectors.radio)[0]!;
    const b = new SectorRadio().enter(entry(), VOICES, skSectors.radio)[0]!;
    expect(a.lines).toEqual(b.lines);
    expect(a.id).toBe(`sector:welcome:rg:b:1@6000`);
    const lines = new Set<string>();
    for (let k = 0; k < 40; k++) lines.add(new SectorRadio().enter(entry({ tick: 6000 + k }), VOICES, skSectors.radio)[0]!.lines[0]!);
    expect(lines.size).toBe(skSectors.radio.welcome.length);
  });

  it('every line of both languages names the sector or stands without it, and none is empty', () => {
    for (const t of [skSectors.radio, enSectors.radio]) {
      for (const list of [t.welcome, t.warnContested, t.warnContestedInstructor, t.warnPirate, t.warnPirateInstructor, t.taunt]) {
        expect(list.length).toBeGreaterThan(0);
        for (const f of list) expect(f('X').length).toBeGreaterThan(10);
      }
    }
    expect(skSectors.radio.welcome.length).toBe(enSectors.radio.welcome.length);
    expect(skSectors.radio.taunt.length).toBe(enSectors.radio.taunt.length);
  });
});

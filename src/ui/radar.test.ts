import { describe, expect, it } from 'vitest';
import { MINE } from '../data/sites';
import { buildGuildContacts, buildRadarContacts, buildSiteContacts, buildThreatContacts, hexColor, pirateGlyph, RADAR_LEGEND, RADAR_STYLES } from './radar';
import { PALETTE } from './theme/tokens';

describe('hexColor', () => {
  it('formats numbers as CSS colors', () => {
    expect(hexColor(0xff7a4d)).toBe('#ff7a4d');
    expect(hexColor(0x00000f)).toBe('#00000f');
  });
});

describe('buildRadarContacts', () => {
  const rocks = [
    { pos: { x: 110, y: 100 }, radius: 2, resource: 'iron' as const },
    { pos: { x: 100, y: 300 }, radius: 2, resource: 'ice' as const },
  ];

  it('keeps contacts in range, relative to the player', () => {
    const contacts = buildRadarContacts(rocks, { x: 100, y: 100 }, 50);
    expect(contacts).toEqual([{ x: 10, y: 0, radius: 2, color: '#ff7a4d' }]);
  });

  it('marks assayed rich ore (Mining 2.0)', () => {
    const contacts = buildRadarContacts([{ ...rocks[0]!, rich: true }], { x: 100, y: 100 }, 50);
    expect(contacts).toEqual([{ x: 10, y: 0, radius: 2, color: '#ff7a4d', rich: true }]);
  });

  it('returns nothing with zero range', () => {
    expect(buildRadarContacts(rocks, { x: 100, y: 100 }, 0)).toEqual([]);
  });
});

describe('buildThreatContacts', () => {
  const center = { x: 100, y: 100 };

  it('places pirates relative to the player with heading and attack state', () => {
    const contacts = buildThreatContacts([{ pos: { x: 130, y: 60 }, angle: 1, attacking: true }], [], center, 100);
    expect(contacts).toEqual([{ kind: 'pirate', x: 30, y: -40, angle: 1, attacking: true, edge: false, glyph: 'shipAttacking' }]);
  });

  it('pins pirates outside the radar range to its edge', () => {
    const [c] = buildThreatContacts([{ pos: { x: 400, y: 100 }, angle: 0, attacking: false }], [], center, 100);
    expect(c).toMatchObject({ x: 100, y: 0, edge: true, glyph: 'shipHostile' });
  });

  it('shows wrecks with loot only inside the range', () => {
    const wrecks = [
      { pos: { x: 120, y: 100 }, loot: true },
      { pos: { x: 90, y: 100 }, loot: false },
      { pos: { x: 500, y: 100 }, loot: true },
    ];
    expect(buildThreatContacts([], wrecks, center, 100)).toEqual([{ kind: 'wreck', x: 20, y: 0, angle: 0, attacking: false, edge: false, glyph: 'wreck' }]);
  });
});

describe('radar grammar (R7)', () => {
  it('ships are filled, objects hollow', () => {
    for (const g of ['shipAttacking', 'shipHostile', 'shipNeutral'] as const) expect(RADAR_STYLES[g].filled).toBe(true);
    for (const g of ['station', 'rock', 'richRock', 'signal', 'place', 'wreck', 'pirateBase'] as const) expect(RADAR_STYLES[g].filled).toBe(false);
  });

  it('red attacks me, amber is hostile but calm', () => {
    expect(pirateGlyph(true)).toBe('shipAttacking');
    expect(pirateGlyph(false)).toBe('shipHostile');
    expect(RADAR_STYLES.shipAttacking.color).toBe(PALETTE.bad);
    expect(RADAR_STYLES.shipHostile.color).toBe(PALETTE.warn);
  });

  it('stations and rocks keep their own colours; rich ore is gold', () => {
    expect(RADAR_STYLES.station.color).toBeNull();
    expect(RADAR_STYLES.rock.color).toBeNull();
    expect(RADAR_STYLES.richRock.color).toBe(PALETTE.oreRich);
  });

  it('the legend lists every glyph once, ships first', () => {
    expect(new Set(RADAR_LEGEND).size).toBe(Object.keys(RADAR_STYLES).length);
    const firstObject = RADAR_LEGEND.findIndex((g) => !RADAR_STYLES[g].filled);
    expect(RADAR_LEGEND.slice(firstObject).every((g) => !RADAR_STYLES[g].filled)).toBe(true);
  });

  it('an attacking pirate beyond the range stays red on the rim', () => {
    const [c] = buildThreatContacts([{ pos: { x: 400, y: 100 }, angle: 0, attacking: true }], [], { x: 100, y: 100 }, 100);
    expect(c).toMatchObject({ edge: true, glyph: 'shipAttacking' });
  });
});

describe('world sites on the radar (M4b)', () => {
  const center = { x: 1000, y: 0 };
  const input = {
    derelicts: [{ pos: { x: 1100, y: 0 }, radius: 30, relays: [{ pos: { x: 1100, y: 60 }, lit: true }, { pos: { x: 1300, y: 0 }, lit: false }] }],
    graveyards: [{ pos: { x: 900, y: 0 }, radius: 200 }, { pos: { x: 600, y: 0 }, radius: 200 }],
    mines: [{ pos: { x: 1050, y: 0 } }, { pos: { x: 1000, y: 120 }, armed: true }],
    comets: [{ pos: { x: 1000, y: 100 } }, { pos: { x: 5000, y: 0 } }],
  };

  it('lists sites in range relative to the player, big objects first', () => {
    const contacts = buildSiteContacts(input, center, 150);
    expect(contacts.map((c) => c.kind)).toEqual(['graveyard', 'derelict', 'relay', 'mine', 'comet']);
    expect(contacts[0]).toMatchObject({ kind: 'graveyard', x: -100, y: 0, radius: 200 });
    expect(contacts[2]).toMatchObject({ kind: 'relay', x: 100, y: 60, on: true });
  });

  it('shows live mines only within their own radar reach', () => {
    const mines = buildSiteContacts(input, center, 300).filter((c) => c.kind === 'mine');
    expect(MINE.radarRange).toBeLessThan(120);
    expect(mines).toEqual([{ kind: 'mine', x: 50, y: 0, on: false, angle: 0, radius: MINE.radius }]);
  });

  it('a graveyard shows while its field reaches into the range', () => {
    const fields = buildSiteContacts(input, center, 250).filter((c) => c.kind === 'graveyard');
    expect(fields.map((c) => c.x)).toEqual([-100, -400]);
    expect(buildSiteContacts(input, center, 150).filter((c) => c.kind === 'graveyard')).toHaveLength(1);
  });

  it('a comet tail points away from home', () => {
    const comet = buildSiteContacts(input, center, 150).find((c) => c.kind === 'comet')!;
    expect(comet.angle).toBeCloseTo(Math.atan2(100, 1000));
  });

  it('nothing with zero range', () => {
    expect(buildSiteContacts(input, center, 0)).toEqual([]);
  });

  it('site glyphs are hollow objects', () => {
    for (const g of ['derelict', 'graveyard', 'comet'] as const) {
      expect(RADAR_STYLES[g].filled).toBe(false);
      expect(RADAR_LEGEND).toContain(g);
    }
  });

  it('a dormant sleeper is drawn as a wreck in range and hidden beyond it', () => {
    const pirates = [
      { pos: { x: 1040, y: 0 }, angle: 0, attacking: false, dormant: true },
      { pos: { x: 2000, y: 0 }, angle: 0, attacking: false, dormant: true },
    ];
    expect(buildThreatContacts(pirates, [], center, 100)).toEqual([{ kind: 'wreck', x: 40, y: 0, angle: 0, attacking: false, edge: false, glyph: 'wreck' }]);
  });
});

describe('Guild ships and relays on the radar (M4d)', () => {
  const center = { x: 0, y: 0 };

  it('lists convoys and the Watch in range only, the Watch drawn over the convoys', () => {
    const contacts = buildGuildContacts(
      {
        watch: [{ pos: { x: 50, y: 0 }, angle: 1 }, { pos: { x: 900, y: 0 }, angle: 0 }],
        convoys: [{ pos: { x: 0, y: 80 }, angle: 0.5 }, { pos: { x: 0, y: 66 }, angle: 0.5, tanker: true }, { pos: { x: 0, y: 700 }, angle: 0 }],
      },
      center,
      150,
    );
    expect(contacts).toEqual([
      { kind: 'convoy', x: 0, y: 80, angle: 0.5, glyph: 'convoy' },
      { kind: 'convoy', x: 0, y: 66, angle: 0.5, tanker: true, glyph: 'convoy' },
      { kind: 'watch', x: 50, y: 0, angle: 1, glyph: 'guildWatch' },
    ]);
    expect(buildGuildContacts({ watch: [{ pos: center, angle: 0 }], convoys: [] }, center, 0)).toEqual([]);
  });

  it('a friendly Watch ship is green and a convoy neutral blue – never the attack red (no friendly fire)', () => {
    expect(RADAR_STYLES.guildWatch).toEqual({ filled: true, color: PALETTE.ok });
    expect(RADAR_STYLES.convoy).toEqual({ filled: true, color: PALETTE.shield });
    expect(RADAR_STYLES.guildRelay.filled).toBe(false);
    for (const g of ['guildWatch', 'convoy', 'guildRelay'] as const) expect(RADAR_LEGEND).toContain(g);
  });

  it('Guild relay masts of the known sites are site contacts after the derelict relays', () => {
    const contacts = buildSiteContacts(
      { derelicts: [], graveyards: [], mines: [], comets: [], guildRelays: [{ pos: { x: 40, y: -30 }, lit: true }, { pos: { x: 400, y: 0 }, lit: false }] },
      center,
      150,
    );
    expect(contacts).toEqual([{ kind: 'guildRelay', x: 40, y: -30, on: true, angle: 0, radius: 0 }]);
  });
});

// M4b T10: the map / radar / scan HUD view models of the world sites and comets.
import { beforeAll, describe, expect, it } from 'vitest';
import { COMET, MINE, RELAY } from '../../data/sites';
import { setLocale } from '../../i18n';
import { createEnemy } from '../../sim/combat/enemies';
import { flyingAt, ofType, run } from '../../sim/discovery/testing';
import { add } from '../../sim/math/vec2';
import { cometAt, cometDefs, nextPassNear, sitesInChunk } from '../../sim/sites';
import { cometPassWindow } from '../../sim/sites/comets';
import type { DerelictSite, GraveyardSite, Site } from '../../sim/sites/types';
import { buildSiteContacts } from '../../ui/radar';
import { nextPassText } from '../../ui/discovery/mapSites';
import { cometMapData, minutesUntil } from './cometMapView';
import { currentReadout, siteReadout } from './scanReadout';
import { siteMapData, siteRadarInput } from './siteMapView';

const SEED = 42;

function first<K extends Site['kind']>(kind: K): Extract<Site, { kind: K }> {
  for (let r = 5; r < 40; r++) {
    for (let cx = -r; cx <= r; cx++) {
      for (let cy = -r; cy <= r; cy++) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
        const s = sitesInChunk(SEED, cx, cy).find((x) => x.kind === kind && (kind !== 'graveyard' || (x as GraveyardSite).mines.length > 1));
        if (s) return s as Extract<Site, { kind: K }>;
      }
    }
  }
  throw new Error(`no ${kind}`);
}

const derelict = first('derelict') as DerelictSite;
const graveyard = first('graveyard') as GraveyardSite;

beforeAll(() => setLocale('sk'));

describe('sites on the map', () => {
  it('lists only known derelicts and graveyards, with the relays and their power', () => {
    const sim = flyingAt(SEED, add(derelict.pos, { x: 0, y: 500 }));
    expect(siteMapData(sim.state)).toEqual([]);
    sim.state.discovery.known.add(derelict.id);
    sim.state.discovery.known.add(graveyard.id);
    sim.state.sites.powered.add(derelict.relays[1]!.id);
    const sites = siteMapData(sim.state);
    expect(sites.map((s) => s.kind)).toEqual(['derelict', 'graveyard']);
    expect(sites[0]).toMatchObject({ id: derelict.id, pos: derelict.pos, relaysLit: 1, label: `Opustená stanica · relé 1/${RELAY.count}` });
    expect(sites[0]!.relays!.map((r) => r.lit)).toEqual([false, true, false]);
    expect(sites[1]).toMatchObject({ id: graveyard.id, label: 'Cintorín lodí' });
  });
});

describe('sites on the radar', () => {
  it('a derelict near the ship is a contact (known or not) with its relays lit by power', () => {
    const sim = flyingAt(SEED, add(derelict.pos, { x: 30, y: 30 }));
    sim.state.sites.powered.add(derelict.relays[0]!.id);
    const input = siteRadarInput(sim.state, 200);
    expect(input.derelicts).toHaveLength(1);
    expect(input.derelicts[0]!.relays.map((r) => r.lit)).toEqual([true, false, false]);
    const contacts = buildSiteContacts(input, sim.state.player.body.pos, 200);
    expect(contacts.filter((c) => c.kind === 'relay')).toHaveLength(3);
  });

  it('gone mines are left out', () => {
    const sim = flyingAt(SEED, graveyard.pos);
    expect(siteRadarInput(sim.state, 100).mines).toHaveLength(graveyard.mines.length);
    sim.state.sites.graveyards.set(graveyard.id, { mines: 0b1, party: 'asleep', data: false, rolls: 0 });
    const mines = siteRadarInput(sim.state, 100).mines;
    expect(mines).toHaveLength(graveyard.mines.length - 1);
    expect(mines[0]!.pos).toEqual(graveyard.mines[1]);
  });

  it('an armed mine (its fuse burning) blinks; the others stay calm', () => {
    const sim = flyingAt(SEED, add(graveyard.mines[0]!, { x: MINE.armRange - 1, y: 0 }));
    expect(siteRadarInput(sim.state, 100).mines.every((m) => !m.armed)).toBe(true);
    const events = run(sim, 5);
    expect(ofType(events, 'mineArmed').map((e) => e.pos)).toContainEqual(graveyard.mines[0]);
    const mines = siteRadarInput(sim.state, 100).mines;
    expect(mines.find((m) => m.pos.x === graveyard.mines[0]!.x && m.pos.y === graveyard.mines[0]!.y)?.armed).toBe(true);
  });
});

describe('comets on the map', () => {
  const id = cometDefs(SEED)[0]!.id;

  it('only known comets, with the track; the nucleus while it passes', () => {
    const w = cometPassWindow(SEED, id, 0)!;
    const sim = flyingAt(SEED, { x: 0, y: 1500 });
    sim.state.tick = Math.floor((w.start + w.end) / 2);
    expect(cometMapData(sim.state)).toEqual([]);
    sim.state.discovery.known.add(id);
    const [c] = cometMapData(sim.state);
    expect(c).toMatchObject({ id, known: true, name: 'Kométa K-1' });
    expect(c!.arc.length).toBeGreaterThan(10);
    expect(c!.now).toEqual(cometAt(SEED, id, sim.state.tick)!.pos);
    sim.state.tick = w.end + 10;
    expect(cometMapData(sim.state)[0]!.now).toBeNull();
  });

  it('the next pass near the player in whole minutes, from nextPassNear', () => {
    const w = cometPassWindow(SEED, id, 0)!;
    const mid = cometAt(SEED, id, Math.floor((w.start + w.end) / 2))!.pos;
    const sim = flyingAt(SEED, add(mid, { x: 300, y: 0 }));
    sim.state.tick = Math.max(0, w.start - 60 * 60 * 7);
    sim.state.discovery.known.add(id);
    const at = nextPassNear(SEED, id, sim.state.player.body.pos, sim.state.tick)!;
    expect(at).not.toBeNull();
    expect(cometMapData(sim.state)[0]!.nextPassMin).toBe(minutesUntil(at, sim.state.tick));
    expect(minutesUntil(at, sim.state.tick)).toBeGreaterThanOrEqual(7);
  });

  it('next pass texts', () => {
    expect(minutesUntil(3600 * 2 + 1, 0)).toBe(3);
    expect(minutesUntil(10, 20)).toBe(0);
    expect(nextPassText(12)).toBe('Najbližší prelet pri tebe: 12 min');
    expect(nextPassText(0)).toBe('Práve prelieta pri tebe');
    expect(nextPassText(null)).toBe('Pri tebe tak skoro nepreletí');
  });
});

describe('scan HUD readouts', () => {
  it('a derelict: relays, defence, the dock clamp', () => {
    const sim = flyingAt(SEED, add(derelict.pos, { x: 0, y: 60 }));
    const r = siteReadout(sim.state, derelict.id)!;
    expect(r.title).toBe('Opustená stanica');
    expect(r.lines.map((l) => l.text)).toEqual([`relé 0/${RELAY.count}`, expect.stringMatching(/^Obrana: /), 'Svorka doku bez napätia – napájaj 3 relé']);
    for (const relay of derelict.relays) sim.state.sites.powered.add(relay.id);
    expect(siteReadout(sim.state, derelict.id)!.lines[2]).toEqual({ text: 'Svorka doku pod napätím – priblíž sa, F', tone: 'ok' });
  });

  it('a relay: how to power it, charging with a bar, powered', () => {
    const sim = flyingAt(SEED, derelict.relays[0]!.pos);
    const id = derelict.relays[0]!.id;
    expect(siteReadout(sim.state, id)!.lines[1]!.text).toBe('Podrž ťažobný laser na prijímači 5 s');
    sim.state.sites.charge = { id, progress: RELAY.powerSeconds * 0.6 };
    const charging = currentReadout(sim.state, null)!;
    expect(charging).toMatchObject({ key: id, charge: 0.6 });
    expect(charging.lines[0]!.text).toBe(`Relé 0/${RELAY.count} · nabíjanie 60 %`);
    sim.state.sites.charge = null;
    sim.state.sites.powered.add(id);
    expect(siteReadout(sim.state, id)!.lines[0]).toEqual({ text: `Relé napájané · 1/${RELAY.count}`, tone: 'ok' });
  });

  it('a comet: composition and what is left, only within the assay reach', () => {
    const id = cometDefs(SEED)[0]!.id;
    const w = cometPassWindow(SEED, id, 0)!;
    const tick = Math.floor((w.start + w.end) / 2);
    const pos = cometAt(SEED, id, tick)!.pos;
    const sim = flyingAt(SEED, add(pos, { x: 30, y: 0 }));
    sim.state.tick = tick;
    expect(currentReadout(sim.state, null)).toBeNull();
    sim.state.discovery.known.add(id);
    const r = currentReadout(sim.state, null)!;
    expect(r.title).toBe('Kométa K-1');
    expect(r.lines[0]!.text).toBe(`ľad 60 % · titán 40 % · zostáva ${COMET.budget} j`);
    expect(r.lines[1]!.text).toBe(`úlomky chvosta ${COMET.tail.shards}/${COMET.tail.shards}`);
    expect(r.lines[2]!.text).toMatch(/^rýchlosť \d+ j\/s$/);
    sim.state.player.body.pos = add(pos, { x: 5000, y: 0 });
    expect(siteReadout(sim.state, id)).toBeNull();
  });

  it('an analysed graveyard sleeper shows its active reactor', () => {
    const sim = flyingAt(SEED, graveyard.pos);
    const id = 'gs:1,2:0';
    const enemy = createEnemy({ id, kind: 'hammer', tier: 1, pos: graveyard.pos, angle: 0, home: graveyard.pos, orbit: 1 });
    sim.state.combat.enemies.push(enemy);
    expect(siteReadout(sim.state, id)).toBeNull();
    sim.state.discovery.scanned.add(id);
    expect(siteReadout(sim.state, id)!.lines[0]).toEqual({ text: 'aktívny reaktor', tone: 'warn' });
  });
});

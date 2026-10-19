// The radio of M4b "World comes alive": space events (micrometeors, ambush, comet flyby), comets, derelict
// stations, graveyard sleepers and the Gunner – who speaks, which toasts the message replaces, the
// throttling keys, deterministic variants and the rebuild in the other language.
import { describe, expect, it } from 'vitest';
import { RELAY } from '../../data/sites';
import { setLocale, textsFor } from '../../i18n';
import { enComms } from '../../i18n/enComms';
import { skComms } from '../../i18n/skComms';
import { createEnemy } from '../../sim/combat/enemies';
import type { EnemyKind } from '../../sim/combat/types';
import { flyingAt } from '../../sim/discovery/testing';
import { ambushParty } from '../../sim/events/ambush';
import { rolledKey } from '../../sim/events/director';
import type { Vec2 } from '../../sim/math/vec2';
import { securityHere } from '../../sim/pirates/sectors';
import { guildCorridorAt, sectorIdAt, sectorInfoAt } from '../../sim/regions/sectors';
import { findDerelict } from '../../sim/sites/derelictTesting';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { homeStation } from '../../sim/world/stations';
import type { RingIndex } from '../../data/economy';
import { clockOf, commsFromEvents, partyOf, watchCovers, type CommsContext } from './mapper';
import { CommsQueue } from './queue';

const SEED = 4242;
const K = skComms.lines;

function ctx(over: Partial<CommsContext> = {}): CommsContext {
  return { texts: skComms, toastOf: (e) => `toast:${e.type}`, dockStation: () => homeStation(), ...over };
}
const noToasts = ctx({ toastOf: () => null });
const map = (state: SimState, events: SimEvent[], c: CommsContext = ctx()) => commsFromEvents(state, events, c);

/** A point (spiralling out from home) that passes the test. */
function spot(test: (p: Vec2) => boolean): Vec2 {
  for (let r = 1200; r < 30000; r += 300) {
    for (let a = 0; a < 48; a++) {
      const p = { x: Math.round(Math.cos((a / 48) * Math.PI * 2) * r), y: Math.round(Math.sin((a / 48) * Math.PI * 2) * r) };
      if (test(p)) return p;
    }
  }
  throw new Error('no spot');
}

/** An ambush key in a depth ≥ 3 sector whose party is led by `leader`. */
function ambushKey(leader: EnemyKind): { key: string; group: string; at: Vec2 } {
  const at = spot((p) => sectorInfoAt(SEED, p.x, p.y).depth >= 3);
  const sector = sectorIdAt(SEED, at.x, at.y);
  const depth = sectorInfoAt(SEED, at.x, at.y).depth as RingIndex;
  for (let b = 1; b < 400; b++) {
    if (ambushParty(SEED, sector, b, depth).kinds[0] === leader) return { key: rolledKey('ambush', sector, b), group: `ab:${sector}@${b}`, at };
  }
  throw new Error(`no ${leader}-led party`);
}

function addShips(state: SimState, ids: readonly [string, EnemyKind][]): void {
  const p = state.player.body.pos;
  ids.forEach(([id, kind], i) => state.combat.enemies.push(createEnemy({ id, kind, tier: 1, pos: { x: p.x + 80 + i * 10, y: p.y }, angle: 0, home: p, orbit: 1 })));
}

const warning = (kind: 'micrometeors' | 'ambush' | 'cometFlyby', key: string, inSeconds: number, dir: number): SimEvent => ({ type: 'eventWarning', key, kind, inSeconds, dir });

describe('comms mapper – bearings', () => {
  it('a world direction is a clock bearing from the bow (12 ahead, 3 right, 6 behind)', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    expect(clockOf(sim.state, 0)).toBe(12);
    expect(clockOf(sim.state, -Math.PI / 2)).toBe(3);
    expect(clockOf(sim.state, Math.PI)).toBe(6);
    expect(clockOf(sim.state, Math.PI / 2)).toBe(9);
    sim.state.player.body.angle = Math.PI / 2;
    expect(clockOf(sim.state, Math.PI / 2)).toBe(12);
    expect(clockOf(sim.state, undefined)).toBe(12);
  });

  it('enemy ids fold into their party (de-duplication)', () => {
    expect(partyOf('pr:3,-4:2')).toBe('pr:3,-4');
    expect(partyOf('ab:r12@345:1')).toBe('ab:r12@345');
    expect(partyOf('dd:-3,4:0')).toBe('dd:-3,4');
    expect(partyOf('gs:7,8:2')).toBe('gs:7,8');
    expect(partyOf('hp:7:1')).toBe('hp:7');
  });
});

describe('comms mapper – micrometeor shower', () => {
  it('the Guild Watch warns where it covers (Quiet / Guarded / the lane): direction, time, replaces the toast', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    expect(watchCovers(sim.state)).toBe(true);
    const e = warning('micrometeors', 'ev:micrometeors:s@3', 8, Math.PI);
    const [m, ...rest] = map(sim.state, [e]);
    expect(rest).toEqual([]);
    expect(m!.msg).toMatchObject({ key: 'watch:micrometeors', channel: 'danger', cooldown: 30, note: 'toast:eventWarning', speaker: { id: 'guildWatch', portrait: 'guild_watch' } });
    expect(m!.events).toEqual([e]);
    expect(m!.msg.lines[0]).toContain('na 6 hodinách');
    expect(m!.msg.lines[0]).toContain('o 8 s');
  });

  it('outside the Watch only the chip and the toast speak', () => {
    const probe = flyingAt(SEED, { x: 300, y: 0 });
    const at = spot((p) => {
      const sec = securityHere(probe.state, p);
      return (sec === 'contested' || sec === 'pirate') && !guildCorridorAt(SEED, p.x, p.y);
    });
    const sim = flyingAt(SEED, at);
    expect(watchCovers(sim.state)).toBe(false);
    expect(map(sim.state, [warning('micrometeors', 'ev:micrometeors:s@3', 8, 0)])).toEqual([]);
  });
});

describe('comms mapper – ambush', () => {
  it('a Hammer-led party taunts from the dark under its alert key; the contacts are the note without a toast', () => {
    const { key, group, at } = ambushKey('hammer');
    const sim = flyingAt(SEED, at);
    const e = warning('ambush', key, 6, -Math.PI / 2);
    const [m] = map(sim.state, [e], noToasts);
    expect(m!.msg).toMatchObject({ key: `alert:${group}`, channel: 'danger', cooldown: 120, speaker: { id: 'pirate:hammer' } });
    expect(K.pirate.ambushWarn).toContain(m!.msg.lines[0]);
    expect(m!.msg.note).toBe('Kontakty na 3 hodinách – prepadnutie.');
    expect(m!.events).toEqual([e]);
    // with a toast the toast's text is the note
    expect(map(sim.state, [e])[0]!.msg.note).toBe('toast:eventWarning');
  });

  it('a Gunner-led party speaks with the Gunner and its own lines', () => {
    const { key, group, at } = ambushKey('gunner');
    const sim = flyingAt(SEED, at);
    const [m] = map(sim.state, [warning('ambush', key, 6, 0)]);
    expect(m!.msg).toMatchObject({ key: `alert:${group}`, speaker: { id: 'pirate:gunner', name: 'Delostrelec Hrdze', role: 'Pirát' } });
    expect(K.gunner.ambush).toContain(m!.msg.lines[0]);
  });

  it('the party’s later alerts fall under the taunt’s cooldown; its toll hail speaks with the Hammer', () => {
    const { key, group, at } = ambushKey('hammer');
    const sim = flyingAt(SEED, at);
    addShips(sim.state, [
      [`${group}:0`, 'hammer'],
      [`${group}:1`, 'jackal'],
    ]);
    const queue = new CommsQueue();
    const [taunt] = map(sim.state, [warning('ambush', key, 6, 0)]);
    expect(queue.push(taunt!.msg, 0)).toBe('shown');
    const [alert] = map(sim.state, [{ type: 'enemyAlert', ref: `${group}:1`, pos: { x: 0, y: 0 } }]);
    expect(alert!.msg.key).toBe(`alert:${group}`);
    expect(queue.push(alert!.msg, 7)).toBe('dropped');
    const toll: SimEvent = { type: 'tollDemanded', group, amount: 400, until: 9999, pos: { x: 0, y: 0 } };
    const [hail] = map(sim.state, [toll]);
    expect(hail!.msg).toMatchObject({ key: `toll:${group}`, reply: 'toll', speaker: { id: 'pirate:hammer' } });
  });

  it('a Gunner group alerts with Gunner lines; sentry drones never talk', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    addShips(sim.state, [
      ['pr:9,9:0', 'gunner'],
      ['pr:9,9:1', 'jackal'],
      ['dd:3,4:0', 'sentry'],
    ]);
    const [m] = map(sim.state, [{ type: 'enemyAlert', ref: 'pr:9,9:1', pos: { x: 0, y: 0 } }]);
    expect(m!.msg).toMatchObject({ key: 'alert:pr:9,9', speaker: { id: 'pirate:gunner' } });
    expect(K.gunner.alert).toContain(m!.msg.lines[0]);
    expect(map(sim.state, [{ type: 'enemyAlert', ref: 'dd:3,4:0', pos: { x: 0, y: 0 } }])).toEqual([]);
  });
});

describe('comms mapper – comets', () => {
  it('the Institute announces a flyby (name, time, bearing) and a sighting', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    const e = warning('cometFlyby', 'ev:comet:cm:3@2', 125, 0);
    const [m] = map(sim.state, [e]);
    expect(m!.msg).toMatchObject({ key: 'comet:cm:3', channel: 'station', note: 'toast:eventWarning', speaker: { id: 'institute', portrait: 'traffic_research', role: 'Výskum Inštitútu' } });
    expect(m!.msg.lines[0]).toContain('Kométa K-4');
    expect(m!.msg.lines[0]).toContain('o 2 min');
    expect(m!.msg.lines[0]).toContain('na 12 hodinách');
    const seen: SimEvent = { type: 'cometSighted', id: 'cm:3', pos: { x: 0, y: 0 } };
    const [s] = map(sim.state, [seen]);
    expect(s!.msg).toMatchObject({ key: 'comet:cm:3', speaker: { id: 'institute' } });
    expect(s!.msg.lines[0]).toContain('Kométa K-4');
    expect(s!.events).toEqual([seen]);
  });
});

describe('comms mapper – derelict stations', () => {
  const site = findDerelict(SEED);
  const relay = (i: number, lit: number): SimEvent => ({ type: 'relayPowered', id: site.relays[i]!.id, site: site.id, lit });

  it('the automaton counts the relays and opens the clamp at the last one', () => {
    const sim = flyingAt(SEED, site.pos);
    const [one] = map(sim.state, [relay(0, 1)]);
    expect(one!.msg).toMatchObject({ key: `derelict:${site.id}`, channel: 'station', speaker: { id: `derelict:${site.id}`, portrait: 'derelict_ai', role: 'Automat stanice', name: 'Hlas stanice' } });
    expect(one!.msg.lines[0]).toContain(`1/${RELAY.count}`);
    const [all] = map(sim.state, [relay(2, RELAY.count)]);
    expect(K.derelict.ready).toContain(all!.msg.lines[0]);
    // M4d Guild relays have no voice here
    expect(map(sim.state, [{ type: 'relayPowered', id: 'gr:lane0', site: 'gr:lane0', lit: 1 }])).toEqual([]);
  });

  it('the defence waking speaks for the relay that woke it (danger), a dead defence quietly', () => {
    const sim = flyingAt(SEED, site.pos);
    const r = relay(1, 2);
    const woke: SimEvent = { type: 'derelictWoke', id: site.id, defence: 'sentries' };
    const out = map(sim.state, [r, woke]);
    expect(out).toHaveLength(1);
    expect(out[0]!.msg).toMatchObject({ key: `derelict:${site.id}`, channel: 'danger' });
    expect(K.derelictWake.sentries).toContain(out[0]!.msg.lines[0]);
    expect(out[0]!.events).toEqual([woke, r]);
    const [none] = map(sim.state, [{ type: 'derelictWoke', id: site.id, defence: 'none' }]);
    expect(none!.msg.channel).toBe('station');
    expect(K.derelictWake.none).toContain(none!.msg.lines[0]);
  });

  it('the clamp answers F: unpowered with the relay count, a bad approach, at once', () => {
    const sim = flyingAt(SEED, site.pos);
    sim.state.sites.powered.add(site.relays[0]!.id);
    const e: SimEvent = { type: 'berthRejected', id: site.id, reason: 'relaysUnpowered', distance: 3, speed: 1, angle: 0 };
    const [m] = map(sim.state, [e]);
    expect(m!.msg).toMatchObject({ key: `derelict:${site.id}`, boost: 3, ttl: 4.5, note: 'toast:berthRejected' });
    expect(m!.msg.lines[0]).toContain(`1/${RELAY.count}`);
    expect(m!.events).toEqual([e]);
    const [bad] = map(sim.state, [{ ...e, reason: 'tooFast' }]);
    expect(K.derelict.rejected).toContain(bad!.msg.lines[0]);
  });

  it('the first berth greets with the journal link (replacing the visit and the journal toasts); later ones welcome back', () => {
    const sim = flyingAt(SEED, site.pos);
    const berthed: SimEvent = { type: 'berthed', id: site.id };
    const visited: SimEvent = { type: 'derelictVisited', id: site.id, data: 80, journal: 'derelictLog_a' };
    const entry = { type: 'journalEntry', id: 'derelictLog_a' } as unknown as SimEvent;
    const [first] = map(sim.state, [berthed, visited, entry]);
    expect(first!.msg).toMatchObject({ key: `derelict:${site.id}`, journal: true, boost: 3, note: 'toast:derelictVisited' });
    expect(K.derelict.greeting).toContain(first!.msg.lines[0]);
    expect(first!.events).toEqual([berthed, visited, entry]);
    const [again] = map(sim.state, [berthed]);
    expect(K.derelict.welcomeBack).toContain(again!.msg.lines[0]);
    expect(again!.msg.journal).toBeUndefined();
    const [bye] = map(sim.state, [{ type: 'berthLeft', id: site.id }]);
    expect(bye!.msg).toMatchObject({ channel: 'flavour', ttl: 2.5 });
    expect(bye!.events).toEqual([]);
  });
});

describe('comms mapper – graveyard sleepers', () => {
  it('the woken party shouts once (its alert in the same step stays silent)', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    addShips(sim.state, [
      ['gs:5,6:0', 'hammer'],
      ['gs:5,6:1', 'jackal'],
    ]);
    const woke: SimEvent = { type: 'sleepersWoke', id: 'gy:5,6', pos: { x: 0, y: 0 } };
    const out = map(sim.state, [{ type: 'enemyAlert', ref: 'gs:5,6:1', pos: { x: 0, y: 0 } }, woke]);
    expect(out).toHaveLength(1);
    expect(out[0]!.msg).toMatchObject({ key: 'alert:gs:5,6', channel: 'danger', cooldown: 120, speaker: { id: 'pirate:hammer' } });
    expect(K.graveyard.sleepersWoke).toContain(out[0]!.msg.lines[0]);
    expect(out[0]!.events).toEqual([woke]);
  });
});

describe('comms mapper – M4b variants and languages', () => {
  it('the same event at the same tick always says the same; other ticks vary', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    const e: SimEvent = { type: 'sleepersWoke', id: 'gy:5,6', pos: { x: 0, y: 0 } };
    const say = () => map(sim.state, [e])[0]!.msg.lines[0];
    expect(say()).toBe(say());
    const seen = new Set<string>();
    for (let t = 0; t < 40; t++) {
      sim.state.tick = t * 977;
      seen.add(say()!);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every new message is rebuilt in English on a language switch (speaker, line, contacts note)', () => {
    const site = findDerelict(SEED);
    const { key, at } = ambushKey('hammer');
    const sim = flyingAt(SEED, at);
    const atHome = flyingAt(SEED, { x: 300, y: 0 });
    try {
      setLocale('sk');
      const ambush = map(sim.state, [warning('ambush', key, 6, -Math.PI / 2)], noToasts)[0]!.msg;
      const watch = map(atHome.state, [warning('micrometeors', 'ev:micrometeors:s@3', 8, 0)])[0]!.msg;
      const comet = map(atHome.state, [warning('cometFlyby', 'ev:comet:cm:0@1', 30, 0)])[0]!.msg;
      const relay = map(atHome.state, [{ type: 'relayPowered', id: site.relays[0]!.id, site: site.id, lit: 1 }])[0]!.msg;
      setLocale('en');
      const en = textsFor('en').comms;
      const a = ambush.retext!();
      expect(en.lines.pirate.ambushWarn).toContain(a.lines[0]);
      expect(a.speaker.name).toBe(enComms.speakers.hammer);
      expect(a.note).toBe("Contacts at 3 o'clock – ambush.");
      const w = watch.retext!();
      expect(w.speaker.name).toBe('Guild Watch');
      expect(w.lines[0]).toContain("at 12 o'clock");
      expect(w.lines[0]).toContain('in 8 s');
      const c = comet.retext!();
      expect(c.speaker.name).toBe(en.speakers.institute);
      expect(c.lines[0]).toContain('Comet K-1');
      const r = relay.retext!();
      expect(r.speaker.role).toBe(en.roles.derelict);
      expect(r.lines[0]).toContain(`1/${RELAY.count}`);
    } finally {
      setLocale('sk');
    }
  });
});

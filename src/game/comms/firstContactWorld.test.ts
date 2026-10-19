// Scripted first contacts of M4b: the first ambush, the first comet and the first derelict relay –
// once per game (read from the sim, so a reload does not replay them), queued in order, deterministic.
import { describe, expect, it } from 'vitest';
import type { RingIndex } from '../../data/economy';
import { setLocale, textsFor } from '../../i18n';
import { skComms } from '../../i18n/skComms';
import { flyingAt } from '../../sim/discovery/testing';
import { ambushParty } from '../../sim/events/ambush';
import { rolledKey } from '../../sim/events/director';
import { sectorIdAt, sectorInfoAt } from '../../sim/regions/sectors';
import { findDerelict } from '../../sim/sites/derelictTesting';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { homeStation } from '../../sim/world/stations';
import { CommsUi } from './commsUi';

const SEED = 4242;
const F = skComms.firstContact;
const ctx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };
const radio = (state: () => SimState) => new CommsUi({ state, render: () => {}, click: () => {}, sound: () => {} });

/** Two ambush keys of a depth ≥ 2 sector, both Hammer-led, and a point in it. */
function ambushKeys(): { keys: [string, string]; at: { x: number; y: number } } {
  for (let r = 1500; r < 30000; r += 300) {
    const at = { x: r, y: 0 };
    const info = sectorInfoAt(SEED, at.x, at.y);
    if (info.depth < 2) continue;
    const sector = sectorIdAt(SEED, at.x, at.y);
    const keys: string[] = [];
    for (let b = 1; b < 200 && keys.length < 2; b++) if (ambushParty(SEED, sector, b, info.depth as RingIndex).kinds[0] === 'hammer') keys.push(rolledKey('ambush', sector, b));
    if (keys.length === 2) return { keys: [keys[0]!, keys[1]!], at };
  }
  throw new Error('no sector');
}

const ambushWarning = (key: string): SimEvent => ({ type: 'eventWarning', key, kind: 'ambush', inSeconds: 6, dir: 0 });

describe('first contact – the first ambush', () => {
  it('the leader’s taunt, the traffic warning and the leader again; the first-pirate exchange is covered', () => {
    const { keys, at } = ambushKeys();
    const sim = flyingAt(SEED, at);
    const s = sim.state;
    s.director.fired.set(keys[0], s.tick);
    const c = radio(() => s);
    c.onStep(s, [ambushWarning(keys[0])], ctx);
    const showing = c.queue.showing!.msg;
    expect(showing).toMatchObject({ channel: 'danger', speaker: { id: 'pirate:hammer' } });
    expect(showing.key.startsWith('alert:ab:')).toBe(true);
    expect(F.ambush).toContain(showing.lines[0]);
    const [warn, retort] = c.queue.queued;
    expect(warn).toMatchObject({ key: 'first:ambush:warn', channel: 'danger', speaker: { id: 'traffic:home' } });
    expect(F.ambushWarn).toContain(warn!.lines[0]);
    expect(retort).toMatchObject({ key: 'first:ambush:retort', speaker: { id: 'pirate:hammer' } });
    expect(F.ambushRetort).toContain(retort!.lines[0]);
  });

  it('not when an ambush came before (a reload keeps the director keys), and only once per game', () => {
    const { keys, at } = ambushKeys();
    const sim = flyingAt(SEED, at);
    const s = sim.state;
    s.director.fired.set(keys[0], 1);
    s.director.fired.set(keys[1], s.tick);
    const c = radio(() => s);
    c.onStep(s, [ambushWarning(keys[1])], ctx);
    expect(skComms.lines.pirate.ambushWarn).toContain(c.queue.showing!.msg.lines[0]);
    expect(c.queue.queued.some((m) => m.key.startsWith('first:'))).toBe(false);
    // a fresh radio with a fresh state: the exchange plays once, not on the next ambush
    const fresh = flyingAt(SEED, at);
    const r = radio(() => fresh.state);
    fresh.state.director.fired.set(keys[0], 1);
    r.onStep(fresh.state, [ambushWarning(keys[0])], ctx);
    expect(r.queue.queued.some((m) => m.key === 'first:ambush:warn')).toBe(true);
    fresh.state.director.fired.clear();
    fresh.state.director.fired.set(keys[1], 2);
    r.queue.clear();
    r.onStep(fresh.state, [ambushWarning(keys[1])], ctx);
    expect(r.queue.queued.some((m) => m.key.startsWith('first:'))).toBe(false);
  });
});

describe('first contact – the first comet', () => {
  const seen = (id: string): SimEvent => ({ type: 'cometSighted', id, pos: { x: 0, y: 0 } });

  it('the observatory, the warner and the observatory’s tip (story)', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    const s = sim.state;
    s.discovery.known.add('cm:2');
    const c = radio(() => s);
    c.onStep(s, [seen('cm:2')], ctx);
    const showing = c.queue.showing!.msg;
    expect(showing).toMatchObject({ key: 'comet:cm:2', channel: 'story', speaker: { id: 'institute' }, note: 'toast:cometSighted' });
    expect(F.comet).toContain(showing.lines[0]);
    const [reaction, again] = c.queue.queued;
    expect(reaction).toMatchObject({ key: 'first:comet:reaction', speaker: { id: 'traffic:home' } });
    expect(F.cometReaction).toContain(reaction!.lines[0]);
    expect(again).toMatchObject({ key: 'first:comet:again', speaker: { id: 'institute' } });
    expect(F.cometAgain).toContain(again!.lines[0]);
  });

  it('a comet when another one is known already is just a sighting', () => {
    const sim = flyingAt(SEED, { x: 300, y: 0 });
    const s = sim.state;
    s.discovery.known.add('cm:0');
    s.discovery.known.add('cm:2');
    const c = radio(() => s);
    c.onStep(s, [seen('cm:2')], ctx);
    expect(skComms.lines.comet.sighted.map((f) => f('Kométa K-3'))).toContain(c.queue.showing!.msg.lines[0]);
    expect(c.queue.queued).toEqual([]);
  });
});

describe('first contact – the first derelict', () => {
  const site = findDerelict(SEED);
  const lit = (i: number, n: number): SimEvent => ({ type: 'relayPowered', id: site.relays[i]!.id, site: site.id, lit: n });

  it('the automaton wakes, the warner answers, the automaton again – rebuilt in English on a switch', () => {
    const sim = flyingAt(SEED, site.pos);
    const s = sim.state;
    s.sites.powered.add(site.relays[0]!.id);
    const c = radio(() => s);
    try {
      setLocale('sk');
      c.onStep(s, [lit(0, 1)], ctx);
      const showing = c.queue.showing!.msg;
      expect(showing).toMatchObject({ key: `derelict:${site.id}`, channel: 'story', speaker: { id: `derelict:${site.id}`, portrait: 'derelict_ai' } });
      expect(F.derelict).toContain(showing.lines[0]);
      const [reaction, again] = c.queue.queued;
      expect(reaction).toMatchObject({ key: 'first:derelict:reaction', speaker: { id: 'traffic:home' } });
      expect(F.derelictReaction).toContain(reaction!.lines[0]);
      expect(again).toMatchObject({ key: 'first:derelict:again', speaker: { id: `derelict:${site.id}` } });
      expect(F.derelictAgain).toContain(again!.lines[0]);
      setLocale('en');
      const en = textsFor('en').comms;
      const panel = c.uiData(() => null, false).panel!;
      expect(en.firstContact.derelict).toContain(panel.lines[0]);
      expect(panel.speaker.name).toBe(en.speakers.derelictAi);
      expect(en.firstContact.derelictReaction).toContain(c.queue.queued[0]!.lines[0]);
    } finally {
      setLocale('sk');
    }
  });

  it('a relay after another derelict relay is just the relay line', () => {
    const sim = flyingAt(SEED, site.pos);
    const s = sim.state;
    s.sites.powered.add('dl:99,99:r0');
    s.sites.powered.add(site.relays[0]!.id);
    const c = radio(() => s);
    c.onStep(s, [lit(0, 1)], ctx);
    expect(F.derelict).not.toContain(c.queue.showing!.msg.lines[0]);
    expect(c.queue.queued).toEqual([]);
  });
});

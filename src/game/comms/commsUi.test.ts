import { describe, expect, it } from 'vitest';
import { flyingAt, run } from '../../sim/discovery/testing';
import { createEnemy } from '../../sim/combat/enemies';
import { homeStation } from '../../sim/world/stations';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { clockLabel, CommsUi, commsSound, radioAllows, type CommsSound } from './commsUi';
import type { CommsMessage, RadioSetting } from './types';
import { setLocale, textsFor } from '../../i18n';
import { instructorSpeaker } from './speakers';

const ctx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };

function ui(state: () => SimState, setting: RadioSetting = 'all') {
  const sounds: [CommsSound, boolean][] = [];
  const c = new CommsUi({ state, render: () => {}, click: () => {}, sound: (k, d) => sounds.push([k, d]) }, setting);
  return { c, sounds };
}

const reject: SimEvent = { type: 'dockRejected', reason: 'tooFar', distance: 9, speed: 0, angle: 0 };
const hunt: SimEvent = { type: 'huntingParty', captain: null, pos: { x: 0, y: 0 } };

describe('radio setting filter', () => {
  it('all lets everything through, important keeps story / danger / training, off nothing', () => {
    expect(radioAllows('all', 'flavour')).toBe(true);
    expect(radioAllows('important', 'danger')).toBe(true);
    expect(radioAllows('important', 'story')).toBe(true);
    expect(radioAllows('important', 'training')).toBe(true);
    expect(radioAllows('important', 'station')).toBe(false);
    expect(radioAllows('important', 'flavour')).toBe(false);
    expect(radioAllows('off', 'danger')).toBe(false);
  });

  it('the events of filtered messages keep their toast', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const all = ui(() => sim.state);
    expect([...all.c.onStep(sim.state, [reject, hunt], ctx)]).toEqual([reject, hunt]);
    const important = ui(() => sim.state, 'important');
    expect([...important.c.onStep(sim.state, [reject, hunt], ctx)]).toEqual([hunt]);
    const off = ui(() => sim.state, 'off');
    expect(off.c.onStep(sim.state, [reject, hunt], ctx).size).toBe(0);
    expect(off.c.uiData(() => null, false).panel).toBeNull();
    expect(off.c.showsToll).toBe(false);
  });
});

describe('CommsUi', () => {
  it('shows a message with a sound (danger ducks the music), queues the next, logs both', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const { c, sounds } = ui(() => sim.state);
    c.onStep(sim.state, [reject], ctx);
    expect(sounds).toEqual([['radio', false]]);
    const d = c.uiData(() => null, false);
    expect(d.panel).toMatchObject({ note: 'toast:dockRejected', channel: 'station', queued: 0, toll: null, docked: false });
    c.onStep(sim.state, [hunt], ctx);
    // the boosted docking answer keeps the air; the hunting party waits
    expect(c.uiData(() => null, false).panel!.queued).toBe(1);
    run(sim, 600);
    c.onStep(sim.state, [], ctx);
    expect(c.uiData(() => null, false).panel!.channel).toBe('danger');
    expect(sounds[1]).toEqual(['danger', true]);
    c.onKey('KeyL', (l) => `Key${l.toUpperCase()}`);
    expect(c.uiData(() => null, false).log!.map((e) => e.channel)).toEqual(['danger', 'station']);
    expect(c.onKey('Escape', (l) => l)).toBe(true);
    expect(c.logOpen).toBe(false);
    expect(c.onKey('Escape', (l) => l)).toBe(false);
  });

  it('keeps the toll message in step with the sim: a staged demand appears, an answer from the panel goes to the sim', () => {
    const sim = flyingAt(4242, { x: 0, y: 1800 });
    const s = sim.state;
    const p = s.player.body.pos;
    s.combat.enemies.push(createEnemy({ id: 'pr:7,7:0', kind: 'hammer', tier: 1, pos: { x: p.x + 40, y: p.y }, angle: 0, home: p, orbit: 1 }));
    s.pirates.toll = { group: 'pr:7,7', amount: 300, until: s.tick + 600 };
    const { c } = ui(() => s);
    c.onStep(s, [], ctx);
    const toll = { amount: '300 kr', seconds: 10, fraction: 1, canPay: true, escape: 250 };
    expect(c.uiData(() => toll, false).panel).toMatchObject({ toll, speaker: { portrait: 'pirate_hammer' } });
    expect(c.showsToll).toBe(true);
    c.handlers.toll('pay');
    expect(c.takeTollAnswer()).toBe('pay');
    expect(c.takeTollAnswer()).toBeNull();
    // the demand vanished without an answer event (the group left): the pinned message goes too
    s.pirates.toll = null;
    c.onStep(s, [], ctx);
    expect(c.uiData(() => toll, false).panel).toBeNull();
  });

  it('holds its messages while hidden (shipyard) and ignores L there', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const { c } = ui(() => sim.state);
    c.onStep(sim.state, [reject], ctx);
    c.setVisible(false, sim.state);
    run(sim, 1200);
    c.onStep(sim.state, [], ctx);
    expect(c.uiData(() => null, true).panel).toBeNull();
    expect(c.onKey('KeyL', (l) => `Key${l.toUpperCase()}`)).toBe(false);
    c.setVisible(true, sim.state);
    c.onStep(sim.state, [], ctx);
    expect(c.uiData(() => null, true).panel).toMatchObject({ docked: true, note: 'toast:dockRejected' });
  });

  it('sounds: the Echo glitches, danger is harsh, the rest is plain radio; the log shows game time', () => {
    const speaker = { id: 'x', name: 'x', role: 'x', portrait: 'echo' as const, faction: 'wardens' as const, kind: 'echo' as const, accent: '#fff' };
    expect(commsSound({ channel: 'story', speaker })).toBe('echo');
    expect(commsSound({ channel: 'danger', speaker: { ...speaker, kind: 'pirate' } })).toBe('danger');
    expect(commsSound({ channel: 'station', speaker: { ...speaker, kind: 'traffic' } })).toBe('radio');
    expect(clockLabel(0)).toBe('0:00');
    expect(clockLabel(60 * 754)).toBe('12:34');
    expect(clockLabel(60 * 3723)).toBe('1:02:03');
  });
});

describe('CommsUi.say (sector entry radio)', () => {
  const line = (key: string, channel: CommsMessage['channel'], tick: number): CommsMessage => ({
    id: `${key}@${tick}`,
    key,
    speaker: { id: key, name: key, role: key, portrait: 'unknown', faction: 'unknown', kind: 'traffic', accent: '#fff' },
    lines: ['Vitaj v sektore.'],
    channel,
    ttl: 3,
    tick,
  });

  it('puts the lines on the air with the opening sound, through the radio filter', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const { c, sounds } = ui(() => sim.state);
    expect(c.say(sim.state, [line('sector:welcome:a', 'station', sim.state.tick)])).toBe(true);
    expect(sounds).toEqual([['radio', false]]);
    expect(c.uiData(() => null, false).panel?.lines).toEqual(['Vitaj v sektore.']);
    const important = ui(() => sim.state, 'important');
    expect(important.c.say(sim.state, [line('sector:welcome:a', 'station', sim.state.tick)])).toBe(false);
    expect(important.c.say(sim.state, [line('sector:warn:a', 'danger', sim.state.tick)])).toBe(true);
    expect(important.sounds).toEqual([['danger', true]]);
    expect(ui(() => sim.state, 'off').c.say(sim.state, [line('sector:warn:a', 'danger', sim.state.tick)])).toBe(false);
  });
});

describe('CommsUi: a live language switch', () => {
  it('re-renders the message on the air, the waiting one and the log in the new language', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const { c } = ui(() => sim.state);
    try {
      setLocale('sk');
      c.onStep(sim.state, [reject], ctx);
      c.onStep(sim.state, [hunt], ctx);
      const sk = c.uiData(() => null, false).panel!;
      expect(textsFor('sk').comms.lines.station.rejected).toContain(sk.lines[0]);
      setLocale('en');
      const en = c.uiData(() => null, false).panel!;
      expect(en.id).toBe(sk.id);
      expect(textsFor('en').comms.lines.station.rejected).toContain(en.lines[0]);
      expect(en.speaker.role).toBe(textsFor('en').comms.roles.traffic);
      expect(en.note).toBe('toast:dockRejected');
      expect(c.queue.queued[0]!.lines[0]).toSatisfy((l: string) => textsFor('en').comms.lines.pirate.hunt.includes(l));
      c.onKey('KeyL', (l) => `Key${l.toUpperCase()}`);
      const log = c.uiData(() => null, false).log!;
      expect(textsFor('en').comms.lines.pirate.hunt).toContain(log[0]!.lines[0]);
      expect(textsFor('en').comms.lines.station.rejected).toContain(log[1]!.lines[0]);
    } finally {
      setLocale('sk');
    }
  });

  it('keeps a message without a rebuild as it was received', () => {
    const sim = flyingAt(4242, { x: 30, y: 0 });
    const { c } = ui(() => sim.state);
    try {
      setLocale('sk');
      const msg: CommsMessage = { id: 'x@1', key: 'x', speaker: instructorSpeaker(textsFor('sk').comms), lines: ['Ahoj.'], channel: 'station', ttl: 3, tick: 1 };
      c.say(sim.state, [msg]);
      setLocale('en');
      expect(c.uiData(() => null, false).panel!.lines).toEqual(['Ahoj.']);
    } finally {
      setLocale('sk');
    }
  });
});

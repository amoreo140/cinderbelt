// M4d radio (T10): the Guild Watch, the relay chain, convoys and the escort on the communicator.
import { describe, expect, it } from 'vitest';
import { RELAY_CHAIN, WATCH } from '../../data/guild';
import { enComms } from '../../i18n/enComms';
import { skComms, type CommsTexts } from '../../i18n/skComms';
import { createEnemy } from '../../sim/combat/enemies';
import type { Contract } from '../../sim/career/types';
import { besideTrader } from '../../sim/convoys/convoyTesting';
import { departureTick } from '../../sim/convoys/schedule';
import { flyingAt } from '../../sim/discovery/testing';
import { syntheticWatch } from '../../sim/npc/testing';
import { sectorInfoAt } from '../../sim/regions/sectors';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { homeStation } from '../../sim/world/stations';
import { sectorName } from '../../ui/sectors/sectorText';
import { CommsUi } from './commsUi';
import { commsFromEvents, partyOf, type CommsContext } from './mapper';
import { traderName } from './speakers';
import { CommsWatch } from './watch';

const SEED = 4242;
const L = skComms.lines;
const ctx = (over: Partial<CommsContext> = {}): CommsContext => ({ texts: skComms, toastOf: (e) => `toast:${e.type}`, dockStation: () => homeStation(), ...over });
const map = (state: SimState, events: SimEvent[]) => commsFromEvents(state, events, ctx());
const radio = (state: () => SimState) => new CommsUi({ state, render: () => {}, click: () => {}, sound: () => {} }, 'all', skComms);
const stepCtx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };

function pirate(state: SimState, id: string, dx: number, mode: 'attack' | 'patrol' = 'attack') {
  const p = state.player.body.pos;
  const e = createEnemy({ id, kind: 'hammer', tier: 1, pos: { x: p.x + dx, y: p.y }, angle: 0, home: { x: p.x + dx, y: p.y }, orbit: 1 });
  e.ai.mode = mode;
  state.combat.enemies.push(e);
  return e;
}

function escortContract(state: SimState, serial: number): Contract {
  const c = { serial, type: 'escort', station: 'home', faction: 'guild', ready: false } as unknown as Contract;
  state.career.contracts.push(c);
  return c;
}

describe('comms mapper – the Guild Watch', () => {
  it('a Watch engagement is a danger line of the guild_watch voice: "covering you" when the pirate goes for the player', () => {
    const sim = flyingAt(SEED, { x: 400, y: 0 });
    const s = sim.state;
    pirate(s, 'pr:1,1:0', 120);
    pirate(s, 'pr:1,1:1', WATCH.defendRange + 200, 'patrol');
    const near: SimEvent = { type: 'watchEngaged', id: 'gw:lane:A:0|1', target: 'pr:1,1:0' };
    const [m] = map(s, [near]);
    expect(m!.msg).toMatchObject({ key: 'watch:engage', channel: 'danger', speaker: { id: 'guildWatch', portrait: 'guild_watch', kind: 'watch' } });
    expect(L.watch.defend).toContain(m!.msg.lines[0]);
    expect(m!.events).toEqual([near]);
    const [far] = map(s, [{ type: 'watchEngaged', id: 'gw:lane:A:0|1', target: 'pr:1,1:1' }]);
    expect(L.watch.engaged).toContain(far!.msg.lines[0]);
  });

  it('the radio drops a second engagement line within its cooldown (the sim throttles it too)', () => {
    const sim = flyingAt(SEED, { x: 400, y: 0 });
    const s = sim.state;
    pirate(s, 'pr:1,1:0', 120);
    const c = radio(() => s);
    const ev: SimEvent = { type: 'watchEngaged', id: 'gw:lane:A:0|1', target: 'pr:1,1:0' };
    s.guild.lastRadio = 0;
    c.onStep(s, [ev], stepCtx);
    expect(c.queue.transcript.filter((m) => m.speaker.id === 'guildWatch')).toHaveLength(1);
    s.tick += 10 * 60;
    c.onStep(s, [ev], stepCtx);
    expect(c.queue.transcript.filter((m) => m.speaker.id === 'guildWatch')).toHaveLength(1);
  });

  it('a damaged Watch ship near the player reports its retreat; one far away says nothing', () => {
    const sim = flyingAt(SEED, { x: 400, y: 0 });
    const s = sim.state;
    s.guild.watch.push(syntheticWatch('gw:lane:A:0|1', { x: 450, y: 0 }), syntheticWatch('gw:lane:A:0|2', { x: 400 + WATCH.liveRadius + 50, y: 0 }));
    const [m] = map(s, [{ type: 'watchRetreated', id: 'gw:lane:A:0|1' }]);
    expect(m!.msg).toMatchObject({ key: 'watch:retreat', speaker: { portrait: 'guild_watch' } });
    expect(L.watch.retreat).toContain(m!.msg.lines[0]);
    expect(map(s, [{ type: 'watchRetreated', id: 'gw:lane:A:0|2' }])).toEqual([]);
  });
});

describe('comms mapper – the relay chain', () => {
  it('repaired, the counterattack warning with the bearing and the Rust taunt, the sector secured', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    s.player.body.angle = 0;
    const [repaired] = map(s, [{ type: 'relayRepaired', lane: 'A' }]);
    expect(repaired!.msg).toMatchObject({ key: 'relay:A', channel: 'station', boost: 3, speaker: { portrait: 'guild_watch' }, note: 'toast:relayRepaired' });
    // the party comes from straight ahead (12 o'clock)
    const hold: SimEvent = { type: 'relayHoldStarted', lane: 'A', at: { x: 320, y: 0 } };
    const [warn, taunt] = map(s, [hold]);
    expect(warn!.msg).toMatchObject({ key: 'relay:A', channel: 'danger', speaker: { portrait: 'guild_watch' } });
    expect(warn!.msg.lines[0]).toContain(skComms.bearing.clock(12));
    expect(warn!.msg.lines[0]).toContain(skComms.bearing.inTime(RELAY_CHAIN.counterattackDelay));
    expect(warn!.events).toEqual([hold]);
    expect(taunt!.msg).toMatchObject({ key: 'alert:rc:A', channel: 'danger', speaker: { id: 'pirate:hammer' }, cooldown: 120 });
    expect(L.pirate.relayCounter).toContain(taunt!.msg.lines[0]);
    // the counterattack ships speak as one party under the taunt's key
    expect(partyOf('rc:A:2')).toBe('rc:A');
    expect(partyOf('ea:7:1:0')).toBe('ea:7:1');

    const sector = sectorInfoAt(SEED, 1700, 0);
    const [secured] = map(s, [{ type: 'sectorSecured', lane: 'A', sector: sector.id }]);
    expect(secured!.msg).toMatchObject({ key: 'relay:A', channel: 'story', speaker: { portrait: 'guild_watch' } });
    expect(secured!.msg.lines[0]).toContain(sectorName(sector.name));
  });

  it('the Watch reports its reinforcement once per fight (not on the first look)', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    const w = new CommsWatch();
    s.guild.hold = { lane: 'A', start: 0, phase: 'fight', reinforced: false };
    expect(w.update(s, skComms)).toEqual([]);
    s.guild.hold.reinforced = true;
    const [m] = w.update(s, skComms).filter((x) => x.key.startsWith('watch:'));
    expect(m).toMatchObject({ key: 'watch:relay:A', channel: 'danger', speaker: { portrait: 'guild_watch' } });
    expect(L.watch.reinforcement).toContain(m!.lines[0]);
    expect(w.update(s, skComms).filter((x) => x.key.startsWith('watch:'))).toEqual([]);
    // interrupted and re-armed: a new fight brings a new reinforcement
    s.guild.hold = { lane: 'A', start: 0, phase: 'idle', reinforced: false };
    w.update(s, skComms);
    s.guild.hold = { lane: 'A', start: 0, phase: 'fight', reinforced: true };
    expect(w.update(s, skComms).filter((x) => x.key.startsWith('watch:'))).toHaveLength(1);
    // a loaded game in the middle of a reinforced fight: nothing on the first look
    const fresh = new CommsWatch();
    expect(fresh.update(s, skComms).filter((x) => x.key.startsWith('watch:'))).toEqual([]);
  });
});

describe('comms mapper – convoys', () => {
  const pass = 'cv:A@2';

  it('a convoy flyby: the trader of the pass announces when and where (traffic_trade, Free Traders)', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    s.player.body.angle = 0;
    const ev: SimEvent = { type: 'eventWarning', key: `ev:convoy:${pass}`, kind: 'convoyFlyby', inSeconds: 120, dir: Math.PI / 2 };
    const [m] = map(s, [ev]);
    expect(m!.msg).toMatchObject({ key: `convoy:${pass}`, channel: 'station', speaker: { id: `trader:${pass}`, portrait: 'traffic_trade', faction: 'freeTraders', role: skComms.roles.convoy } });
    expect(m!.msg.speaker.name).toContain(traderName(pass));
    expect(m!.msg.lines[0]).toContain(skComms.bearing.inTime(120));
    expect(m!.events).toEqual([ev]);
  });

  it('link, unlink by reason, trade thanks once per spree', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    const [linked] = map(s, [{ type: 'convoyLinked', pass }]);
    expect(linked!.msg).toMatchObject({ key: `convoy:${pass}`, channel: 'station', boost: 3, speaker: { portrait: 'traffic_trade' } });
    expect(L.convoy.linked).toContain(linked!.msg.lines[0]);
    const [pirates] = map(s, [{ type: 'convoyUnlinked', pass, reason: 'pirates' }]);
    expect(pirates!.msg.channel).toBe('danger');
    expect(L.convoyUnlinked.pirates).toContain(pirates!.msg.lines[0]);
    const [turn] = map(s, [{ type: 'convoyUnlinked', pass, reason: 'turnaround' }]);
    expect(L.convoyUnlinked.turnaround).toContain(turn!.msg.lines[0]);
    const [traded] = map(s, [{ type: 'convoyTraded', pass, what: 'sell', credits: 120 }]);
    expect(traded!.msg).toMatchObject({ key: `convoy:${pass}:trade`, channel: 'flavour', cooldown: 45 });
    expect(traded!.events).toEqual([]);
  });

  it('a refused link: the trader in reach answers with the reason; nobody in reach – the toast stays', () => {
    const tick = departureTick('A', 2) + 90 * 60;
    const sim = besideTrader(SEED, pass, tick, 8);
    const ev: SimEvent = { type: 'linkRejected', reason: 'tooFast', distance: 8, speed: 6 };
    const [m] = map(sim.state, [ev]);
    expect(m!.msg).toMatchObject({ key: `convoy:${pass}`, boost: 3, speaker: { id: `trader:${pass}` }, note: 'toast:linkRejected' });
    expect(L.convoyRejected.tooFast).toContain(m!.msg.lines[0]);
    const alone = flyingAt(SEED, { x: 0, y: 0 });
    expect(map(alone.state, [ev])).toEqual([]);
  });
});

describe('comms mapper – the escort', () => {
  it('the escort trader departs, stops under fire, sees the ambush ahead and thanks on arrival', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    s.player.body.angle = 0;
    escortContract(s, 7);
    const [dep] = map(s, [{ type: 'escortDeparted', serial: 7 }]);
    expect(dep!.msg).toMatchObject({ key: 'escort:7', speaker: { id: 'trader:es:7', portrait: 'traffic_trade', role: skComms.roles.escort } });
    expect(L.escort.departed).toContain(dep!.msg.lines[0]);
    const [stop] = map(s, [{ type: 'escortStopped', serial: 7 }]);
    expect(stop!.msg).toMatchObject({ key: 'escort:7:stop', channel: 'danger', cooldown: 20 });
    const [amb] = map(s, [{ type: 'escortAmbush', serial: 7, pos: { x: 0, y: -400 } }]);
    expect(amb!.msg.channel).toBe('danger');
    expect(amb!.msg.lines[0]).toContain(skComms.bearing.clock(3));
    const ready: SimEvent = { type: 'contractReady', contractId: 7 };
    const [done] = map(s, [ready]);
    expect(done!.msg).toMatchObject({ key: 'contract:7', speaker: { id: 'trader:es:7' } });
    expect(L.escort.arrived).toContain(done!.msg.lines[0]);
  });

  it('a failed escort: the trader gives up on a missed meeting, the contract desk reports a lost trader', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const s = sim.state;
    s.career.log.push({ tick: s.tick, kind: 'contractFailed', type: 'escort', station: 'home' });
    const missed: SimEvent = { type: 'contractFailed', contractId: 7, reason: 'missed' };
    const [m] = map(s, [missed]);
    expect(m!.msg).toMatchObject({ key: 'contract:7', channel: 'danger', speaker: { id: 'trader:es:7' }, note: 'toast:contractFailed' });
    expect(L.escortFailed.missed).toContain(m!.msg.lines[0]);
    expect(m!.events).toEqual([missed]);
    const [lost] = map(s, [{ type: 'contractFailed', contractId: 7, reason: 'traderLost' }]);
    expect(lost!.msg.speaker.id).toBe('contracts:home');
    expect(L.escortFailed.traderLost).toContain(lost!.msg.lines[0]);
  });
});

describe('comms texts – M4d lines in both languages', () => {
  const lists = (t: CommsTexts): Record<string, readonly unknown[]> => ({
    engaged: t.lines.watch.engaged,
    defend: t.lines.watch.defend,
    retreat: t.lines.watch.retreat,
    relayRepaired: t.lines.watch.relayRepaired,
    relayHold: t.lines.watch.relayHold,
    reinforcement: t.lines.watch.reinforcement,
    secured: t.lines.watch.secured,
    relayCounter: t.lines.pirate.relayCounter,
    flyby: t.lines.convoy.flyby,
    linked: t.lines.convoy.linked,
    ...Object.fromEntries(Object.entries(t.lines.convoyUnlinked).map(([k, v]) => [`unlinked.${k}`, v])),
    ...Object.fromEntries(Object.entries(t.lines.convoyRejected).map(([k, v]) => [`rejected.${k}`, v])),
    traded: t.lines.convoy.traded,
    departed: t.lines.escort.departed,
    stopped: t.lines.escort.stopped,
    ambush: t.lines.escort.ambush,
    arrived: t.lines.escort.arrived,
    ...Object.fromEntries(Object.entries(t.lines.escortFailed).map(([k, v]) => [`failed.${k}`, v])),
    firstWatch: t.firstContact.watch,
    firstWatchReaction: t.firstContact.watchReaction,
    firstWatchAgain: t.firstContact.watchAgain,
    firstConvoy: t.firstContact.convoy,
    firstConvoyReaction: t.firstContact.convoyReaction,
    firstConvoyAgain: t.firstContact.convoyAgain,
  });

  it('every new line has variants in SK and EN, the same keys', () => {
    const sk = lists(skComms);
    const en = lists(enComms);
    expect(Object.keys(en).sort()).toEqual(Object.keys(sk).sort());
    for (const [k, v] of Object.entries(sk)) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(en[k]!.length, k).toBeGreaterThan(0);
    }
    expect(enComms.roles.convoy).not.toBe(skComms.roles.convoy);
  });
});

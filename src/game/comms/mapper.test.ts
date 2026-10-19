import { describe, expect, it } from 'vitest';
import { flyingAt, teleport } from '../../sim/discovery/testing';
import { createEnemy } from '../../sim/combat/enemies';
import { captainDefs, captainEnemyId } from '../../sim/captains/captains';
import { fortressSites } from '../../sim/pirates/sites';
import { homeStation, type StationDef } from '../../sim/world/stations';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { captainPortrait } from '../../data/speakers';
import { skComms } from '../../i18n/skComms';
import { enComms } from '../../i18n/enComms';
import { commsFromEvents, ECHO_STORY_ENTRIES, type CommsContext } from './mapper';
import { CommsWatch } from './watch';

const SEED = 4242;

function ctx(over: Partial<CommsContext> = {}): CommsContext {
  return { texts: skComms, toastOf: (e) => `toast:${e.type}`, dockStation: () => homeStation(), ...over };
}

const map = (state: SimState, events: SimEvent[], c: CommsContext = ctx()) => commsFromEvents(state, events, c);

function withGroup(state: SimState, group: string, kinds: ('jackal' | 'hammer')[]): void {
  const p = state.player.body.pos;
  for (const [i, kind] of kinds.entries()) {
    state.combat.enemies.push(createEnemy({ id: `${group}:${i}`, kind, tier: 1, pos: { x: p.x + 40 + i * 8, y: p.y }, angle: 0, home: { x: p.x + 40, y: p.y }, orbit: 1 }));
  }
}

describe('comms mapper – stations', () => {
  it('traffic control grants docking (no toast) and denies it with the reason as a note (replaces the toast)', () => {
    const sim = flyingAt(SEED, { x: 30, y: 0 });
    const granted = map(sim.state, [{ type: 'dockingStarted', stationId: 'home' }]);
    expect(granted).toHaveLength(1);
    expect(granted[0]!.msg).toMatchObject({ key: 'dock:home', channel: 'station', speaker: { id: 'traffic:home', portrait: 'traffic_home', kind: 'traffic' } });
    expect(granted[0]!.msg.speaker.name).toContain('Základňa Počiatok');
    expect(granted[0]!.events).toEqual([]);
    const reject: SimEvent = { type: 'dockRejected', reason: 'tooFast', distance: 2, speed: 5, angle: 0 };
    const denied = map(sim.state, [reject]);
    expect(denied[0]!.msg).toMatchObject({ key: 'dock:home', note: 'toast:dockRejected' });
    expect(denied[0]!.events).toEqual([reject]);
    // no station nearby: nobody to speak, the toast stays
    expect(map(sim.state, [{ ...reject, reason: 'noStation' }])).toEqual([]);
    expect(map(sim.state, [reject], ctx({ dockStation: () => null }))).toEqual([]);
  });

  it('a station greets a ship entering its zone once (not on the first look or right after undock)', () => {
    const sim = flyingAt(SEED, { x: 600, y: 0 });
    const watch = new CommsWatch();
    expect(watch.update(sim.state, skComms)).toEqual([]);
    teleport(sim, { x: 200, y: 0 });
    const hello = watch.update(sim.state, skComms);
    expect(hello).toHaveLength(1);
    expect(hello[0]).toMatchObject({ key: 'zone:home', channel: 'station', cooldown: 180 });
    expect(watch.update(sim.state, skComms)).toEqual([]);
    // docked → undock inside the zone: no greeting
    sim.state.player.dock = { mode: 'docked', stationId: 'home' } as SimState['player']['dock'];
    expect(watch.update(sim.state, skComms)).toEqual([]);
    sim.state.player.dock = { mode: 'flying' } as SimState['player']['dock'];
    expect(watch.update(sim.state, skComms)).toEqual([]);
  });

  it('a fortress raises the alarm when the ship comes in range', () => {
    const f = fortressSites(SEED)[0]!;
    const sim = flyingAt(SEED, { x: f.pos.x - 900, y: f.pos.y });
    const watch = new CommsWatch();
    watch.update(sim.state, skComms);
    teleport(sim, { x: f.pos.x - 300, y: f.pos.y });
    const alarm = watch.update(sim.state, skComms).filter((m) => m.key.startsWith('fortress:'));
    expect(alarm).toHaveLength(1);
    expect(alarm[0]).toMatchObject({ key: `fortress:${f.id}`, channel: 'danger', speaker: { portrait: 'pirate_hammer', role: 'Pevnosť Hrdze' } });
  });
});

describe('comms mapper – pirates and captains', () => {
  it('the toll demand is an interactive pinned message of the group leader; answers replace it', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    withGroup(sim.state, 'pr:9,9', ['jackal', 'hammer']);
    const demand: SimEvent = { type: 'tollDemanded', group: 'pr:9,9', amount: 650, until: 999, pos: { x: 0, y: 0 } };
    const [m] = map(sim.state, [demand]);
    expect(m!.msg).toMatchObject({ key: 'toll:pr:9,9', reply: 'toll', pinned: true, channel: 'danger', speaker: { portrait: 'pirate_hammer' } });
    expect(m!.msg.lines[0]).toContain('650');
    expect(m!.events).toEqual([demand]);
    for (const e of [
      { type: 'tollPaid', group: 'pr:9,9', amount: 650 },
      { type: 'tollRefused', group: 'pr:9,9', timeout: true },
      { type: 'tollEscaped', group: 'pr:9,9' },
    ] as SimEvent[]) {
      const [r] = map(sim.state, [e]);
      expect(r!.msg).toMatchObject({ key: 'toll:pr:9,9', pinned: false, note: `toast:${e.type}` });
    }
    // jackals only: the jackal voice
    const jackals = flyingAt(SEED, { x: 0, y: 1800 });
    withGroup(jackals.state, 'pr:1,2', ['jackal']);
    expect(map(jackals.state, [{ ...demand, group: 'pr:1,2' } as SimEvent])[0]!.msg.speaker.portrait).toBe('pirate_jackal');
  });

  it('a named captain taunts when he appears, flees, gloats and dies – with his clan portrait', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    const def = captainDefs(SEED)[4]!;
    const p = sim.state.player.body.pos;
    sim.state.combat.enemies.push({ ...createEnemy({ id: captainEnemyId(4), kind: 'hammer', tier: 1, pos: { x: p.x + 50, y: p.y }, angle: 0, home: p, orbit: 1 }) });
    const [hail] = map(sim.state, [{ type: 'enemyAlert', ref: captainEnemyId(4), pos: p }]);
    expect(hail!.msg).toMatchObject({ key: 'cap:4:hail', cooldown: 120, channel: 'danger', speaker: { id: 'cap:4', portrait: captainPortrait(def.clan, 4), kind: 'captain' } });
    const fled = map(sim.state, [{ type: 'captainPromoted', captain: 4, level: 3, trophies: [] }])[0]!;
    const gloat = map(sim.state, [{ type: 'captainPromoted', captain: 4, level: 3, trophies: ['cannon:1'] }])[0]!;
    expect(skComms.lines.captain.fled).toContain(fled.msg.lines[0]);
    expect(skComms.lines.captain.gloat).toContain(gloat.msg.lines[0]);
    const dead = map(sim.state, [{ type: 'captainDefeated', captain: 4 }])[0]!;
    expect(dead.msg).toMatchObject({ key: 'cap:4', note: 'toast:captainDefeated' });
    expect(skComms.lines.captain.defeated).toContain(dead.msg.lines[0]);
  });

  it('a pirate group alert is chatter with a cooldown; scavengers, calm and tolling groups stay silent', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    withGroup(sim.state, 'pr:5,5', ['jackal', 'jackal']);
    const alert: SimEvent = { type: 'enemyAlert', ref: 'pr:5,5:1', pos: { x: 0, y: 0 } };
    expect(map(sim.state, [alert])[0]!.msg).toMatchObject({ key: 'alert:pr:5,5', channel: 'flavour', cooldown: 120, speaker: { portrait: 'pirate_jackal' } });
    sim.state.pirates.toll = { group: 'pr:5,5', amount: 100, until: 9999 };
    expect(map(sim.state, [alert])).toEqual([]);
    sim.state.pirates.toll = null;
    sim.state.combat.enemies[0]!.calm = true;
    expect(map(sim.state, [{ ...alert, ref: 'pr:5,5:0' } as SimEvent])).toEqual([]);
  });

  it('hunting parties, raids, challenges, the fortress hangar and an ambush replace their toasts', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    const f = fortressSites(SEED)[0]!;
    const events: SimEvent[] = [
      { type: 'huntingParty', captain: 2, pos: { x: 0, y: 0 } },
      { type: 'raidAnnounced', serial: 1, kind: 'challenge', pos: { x: 0, y: 0 }, station: null, captain: null, ships: 3, arrive: sim.state.tick + 3 * 3600 },
      { type: 'raidArrived', serial: 1, pos: { x: 0, y: 0 } },
      { type: 'fortressReinforcements', fortress: f.id, count: 2, pos: f.pos },
      { type: 'distressAmbush', id: 'ds:1', pos: { x: 0, y: 0 } },
    ];
    const out = map(sim.state, events);
    expect(out.map((s) => s.msg.channel)).toEqual(['danger', 'danger', 'danger', 'danger', 'danger']);
    expect(out.map((s) => s.events[0])).toEqual(events);
    expect(out[0]!.msg.speaker.id).toBe('cap:2');
    expect(out[1]!.msg.lines[0]).toContain('3 min');
    expect(out[3]!.msg.speaker.name).toBe('Hrdzavá pevnosť I');
  });
});

describe('comms mapper – contracts, distress and the Echo', () => {
  it('the issuer speaks for contracts (Institute with the research voice)', () => {
    const sim = flyingAt(SEED, { x: 0, y: 300 });
    const base = { id: 'home@0.1', type: 'survey', faction: 'institute', station: 'home', ring: 1, risk: 0.1, target: { kind: 'survey', points: [] }, modifiers: [], bonus: 0, part: null } as const;
    sim.state.career.contracts.push({ ...(base as unknown as SimState['career']['contracts'][number]), serial: 7, acceptedTick: 0, seconds: 60, reward: 300, rep: 2, progress: 0, base: 0, ready: false });
    const [acc] = map(sim.state, [{ type: 'contractAccepted', contractId: 7 }]);
    expect(acc!.msg).toMatchObject({ key: 'contract:7', channel: 'station', note: 'toast:contractAccepted', speaker: { portrait: 'traffic_research' } });
    expect(acc!.msg.speaker.role).toContain('Inštitút');
    expect(map(sim.state, [{ type: 'contractReady', contractId: 7 }])[0]!.msg.key).toBe('contract:7');
    sim.state.career.log.push({ tick: sim.state.tick, kind: 'contractCompleted', type: 'delivery', station: 'home' });
    const [done] = map(sim.state, [{ type: 'contractCompleted', contractId: 7, reward: 300, rep: 2, part: null }]);
    expect(done!.msg.speaker).toMatchObject({ portrait: 'traffic_home' });
    expect(done!.msg.speaker.role).toContain('Cech');
  });

  it('a distress call speaks (a trap sounds like a real call), the rescued crew thanks', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    const heard = map(sim.state, [{ type: 'distressHeard', id: 'ds:4', kind: 'trap', pos: { x: 0, y: 0 } }])[0]!;
    const L = skComms.lines.distress;
    expect([...L.fuel, ...L.repair]).toContain(heard.msg.lines[0]);
    expect(heard.msg).toMatchObject({ key: 'distress:heard', channel: 'danger', speaker: { portrait: 'unknown' }, cooldown: 60 });
    // two calls in one step: one message, both toasts replaced
    const two = map(sim.state, [{ type: 'distressHeard', id: 'ds:5', kind: 'fuel', pos: { x: 0, y: 0 } }, { type: 'distressHeard', id: 'ds:6', kind: 'repair', pos: { x: 0, y: 0 } }]);
    expect(two).toHaveLength(1);
    expect(two[0]!.events).toHaveLength(2);
    expect(map(sim.state, [{ type: 'distressResolved', id: 'ds:4', reward: 900 }])[0]!.msg.note).toBe('toast:distressResolved');
    expect(map(sim.state, [{ type: 'rescueFueled', contractId: 3, fuel: 12 }])[0]!.msg.speaker.id).toBe('stranded');
  });

  it('the Echo is unnamed until the decoder entry; a story journal entry rides on its message', () => {
    const sim = flyingAt(SEED, { x: 0, y: 300 });
    const heard: SimEvent = { type: 'echoHeard', echo: 0, fixes: 1, located: false };
    const entry: SimEvent = { type: 'journalEntry', id: 'echo0Heard' };
    const out = map(sim.state, [heard, entry]);
    expect(out).toHaveLength(1);
    expect(out[0]!.msg).toMatchObject({ channel: 'story', journal: true, speaker: { portrait: 'echo', name: skComms.speakers.echoUnknown } });
    expect(out[0]!.events).toEqual([heard, entry]);
    sim.state.discovery.journal.push({ id: 'decoder', tick: 0 });
    const alone = map(sim.state, [{ type: 'journalEntry', id: 'echo1' }]);
    expect(alone[0]!.msg).toMatchObject({ key: 'journal:echo1', journal: true, speaker: { name: skComms.speakers.echoNamed } });
    // other journal entries keep their toast
    expect(ECHO_STORY_ENTRIES.has('anomalies')).toBe(false);
    expect(map(sim.state, [{ type: 'journalEntry', id: 'anomalies' }])).toEqual([]);
    expect(map(sim.state, [{ type: 'keyItemFound', item: 'shard' }])[0]!.msg.channel).toBe('story');
  });

  it('picks the same line variant for the same tick and event, and works with the English texts', () => {
    const sim = flyingAt(SEED, { x: 0, y: 1800 });
    const events: SimEvent[] = [{ type: 'dockingStarted', stationId: 'home' }, { type: 'huntingParty', captain: null, pos: { x: 0, y: 0 } }];
    const a = map(sim.state, events).map((s) => s.msg.lines);
    const b = map(sim.state, events).map((s) => s.msg.lines);
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let tick = 0; tick < 40; tick++) {
      sim.state.tick = tick;
      seen.add(map(sim.state, [events[0]!])[0]!.msg.lines[0]!);
    }
    expect(seen.size).toBeGreaterThan(1);
    const en = map(sim.state, events, ctx({ texts: enComms }));
    expect(en[0]!.msg.speaker.name).toMatch(/traffic$/);
    expect(enComms.lines.station.granted).toContain(en[0]!.msg.lines[0]);
  });

  it('station traffic voices follow the station role', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const as = (kind: StationDef['kind'], model: StationDef['model']): StationDef => ({ ...homeStation(), id: `st:${model}`, kind, model });
    const portraits = (['station_a', 'station_b', 'station_c'] as const).map((m) => map(sim.state, [{ type: 'dockRejected', reason: 'tooFar', distance: 9, speed: 0, angle: 0 }], ctx({ dockStation: () => as('station', m) }))[0]!.msg.speaker.portrait);
    expect(portraits).toEqual(['traffic_trade', 'traffic_mining', 'traffic_research']);
    const outpost = map(sim.state, [{ type: 'dockRejected', reason: 'tooFar', distance: 9, speed: 0, angle: 0 }], ctx({ dockStation: () => as('outpost', 'outpost_a') }));
    expect(outpost[0]!.msg.speaker.portrait).toBe('traffic_outpost');
  });
});

describe('comms mapper – home station (M4c)', () => {
  it('home traffic control announces a built module (replaces its toast); paints and pins stay toasts', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const built: SimEvent = { type: 'homeModuleBuilt', module: 'paintShop' };
    const out = map(sim.state, [built]);
    expect(out).toHaveLength(1);
    expect(out[0]!.msg).toMatchObject({ key: 'home:paintShop', channel: 'station', note: 'toast:homeModuleBuilt', speaker: { id: 'traffic:home', portrait: 'traffic_home' } });
    expect(skComms.lines.home.paintShop).toContain(out[0]!.msg.lines[0]);
    expect(out[0]!.events).toEqual([built]);
    const hall = map(sim.state, [{ type: 'homeModuleBuilt', module: 'trophyHall' }]);
    expect(skComms.lines.home.trophyHall).toContain(hall[0]!.msg.lines[0]);
    expect(map(sim.state, [{ type: 'shipPainted', shipId: 1, paint: 'navy' }])).toEqual([]);
    expect(map(sim.state, [{ type: 'trophyPinned', id: 'cap:1', pinned: true }])).toEqual([]);
  });

  it('SK and EN lines exist for every built-module voice; a later module speaks its name', () => {
    for (const t of [skComms, enComms]) {
      expect(t.lines.home.paintShop.length).toBeGreaterThan(0);
      expect(t.lines.home.trophyHall.length).toBeGreaterThan(0);
      expect(t.lines.home.module.length).toBeGreaterThan(0);
    }
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const en = map(sim.state, [{ type: 'homeModuleBuilt', module: 'paintShop' }], ctx({ texts: enComms }));
    expect(enComms.lines.home.paintShop).toContain(en[0]!.msg.lines[0]);
    const later = map(sim.state, [{ type: 'homeModuleBuilt', module: 'observatory' }]);
    expect(later[0]!.msg.lines[0]).toContain('Observatórium');
  });
});

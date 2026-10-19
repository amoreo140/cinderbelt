// M4d T9: the Guild view models – the escort chip (hull shares, state, distance, next step), the relay
// chip (stage and hint), relay sites hidden on the map until known (offered, active, a stage, charted),
// the relay masts on the radar (lit when powered / secured) and the Watch ships near the ship.
import { describe, expect, it } from 'vitest';
import { ESCORT } from '../../data/convoys';
import { setLocale } from '../../i18n/locale';
import { tx } from '../../i18n';
import type { Contract, ContractTarget } from '../../sim/career/types';
import { IDLE_COMMAND } from '../../sim/commands';
import { flyingAt } from '../../sim/discovery/testing';
import { scheduledWatchNear } from '../../sim/guild/watchRoutes';
import { guildRelaySites } from '../../sim/guild';
import type { GuildRelaySite } from '../../sim/guild/types';
import type { SimState } from '../../sim/Simulation';
import { escortTraderPos, escortStatus, guildStatus, mapRelays, relayKnown, relayRadarInput, relayStatus, watchNear } from './guildView';

const SEED = 1;

function contract(target: ContractTarget, serial = 1): Contract {
  return {
    id: `s@0.${serial}`,
    type: target.kind === 'relay' ? 'relay' : 'escort',
    faction: 'guild',
    station: 'st',
    ring: 1,
    risk: 0.25,
    target,
    modifiers: [],
    bonus: 0,
    part: null,
    serial,
    acceptedTick: 0,
    seconds: 600,
    reward: 1000,
    rep: 10,
    progress: 0,
    base: 0,
    ready: false,
  };
}

const site = (): GuildRelaySite => {
  const s = guildRelaySites(SEED)[0];
  if (!s) throw new Error('no relay site');
  return s;
};

const relayTarget = (s: GuildRelaySite): ContractTarget => ({ kind: 'relay', lane: s.lane, relay: s.id, sector: s.sector, pos: { ...s.pos } });

const escortTarget = (): Extract<ContractTarget, { kind: 'escort' }> => ({ kind: 'escort', lane: 'A', from: 400, to: 2400, meet: { x: 900, y: 300 }, end: { x: 2900, y: 300 }, ambushes: [1200] });

const at = (pos: { x: number; y: number }): SimState => flyingAt(SEED, pos).state;

describe('the Guild chips', () => {
  setLocale('sk');

  it('nothing without an escort or relay contract', () => {
    expect(guildStatus(at({ x: 0, y: 0 }))).toBeNull();
  });

  it('escort before its record: waiting at the meeting point, full hulls, the distance to the meet', () => {
    const state = at({ x: 900, y: 0 });
    state.career.contracts.push(contract(escortTarget()));
    const e = escortStatus(state)!;
    expect(e.state).toBe('waiting');
    expect(e.hull.every((h) => h === 1)).toBe(true);
    expect(e.distance).toBeCloseTo(300, 6);
    expect(e.next).toBe(tx().guild.escort.next.meet);
  });

  it('escort with its record: hull shares per ship, its state and next step, the trader position', () => {
    const state = at({ x: 0, y: 0 });
    const c = contract(escortTarget());
    state.career.contracts.push(c);
    state.convoys.escorts.set(c.serial, { progress: 800, state: 'moving', departed: 10, away: 0, stopUntil: 0, fired: 0, hulls: [ESCORT.traderHull / 2, ESCORT.tankerHull / 4] });
    const e = escortStatus(state)!;
    expect(e.hull).toEqual([0.5, 0.25]);
    expect(e.state).toBe('moving');
    expect(e.next).toBe(tx().guild.escort.next.follow);
    const trader = escortTraderPos(state, c as Parameters<typeof escortTraderPos>[1]);
    expect(e.distance).toBeCloseTo(Math.hypot(trader.x, trader.y), 6);
    expect(trader).not.toEqual(escortTarget().meet);
  });

  it('relay chip: the stage of the lane and its hint', () => {
    const s = site();
    const state = at({ x: 0, y: 0 });
    state.career.contracts.push(contract(relayTarget(s), 2));
    expect(relayStatus(state)).toMatchObject({ lane: s.lane, stage: 'broken' });
    state.guild.relays.set(s.lane, { stage: 'repaired', sector: s.sector, tick: 1 });
    expect(relayStatus(state)).toEqual({ lane: s.lane, stage: 'repaired', hint: tx().guild.relay.hints.power });
    expect(guildStatus(state)).toMatchObject({ escort: null, relay: { stage: 'repaired' } });
  });
});

describe('Guild relays on the map and the radar', () => {
  it('hidden until known: a board offer, an active contract or a stage makes it known', () => {
    const s = site();
    const state = at({ x: 0, y: 0 });
    const known = () => mapRelays(state).find((r) => r.lane === s.lane)!.known;
    // the start sectors of the seed may be charted; the relay's Contested depth-2 sector never is at the start
    expect(relayKnown(state, s)).toBe(false);
    expect(known()).toBe(false);
    state.career.boards.set('st', { epoch: 0, serial: 1, offers: [contract(relayTarget(s))] });
    expect(known()).toBe(true);
    state.career.boards.clear();
    state.career.contracts.push(contract(relayTarget(s)));
    expect(known()).toBe(true);
    state.career.contracts = [];
    state.guild.relays.set(s.lane, { stage: 'secured', sector: s.sector, tick: 1 });
    expect(mapRelays(state).find((r) => r.lane === s.lane)).toMatchObject({ known: true, stage: 'secured' });
  });

  it('the radar shows a mast in range, lit once powered', () => {
    const s = site();
    const state = at(s.pos);
    expect(relayRadarInput(state, s.pos, 300)).toEqual([{ pos: s.pos, lit: false }]);
    state.guild.relays.set(s.lane, { stage: 'powered', sector: s.sector, tick: 1 });
    expect(relayRadarInput(state, s.pos, 300)[0]!.lit).toBe(true);
    expect(relayRadarInput(state, { x: s.pos.x + 5000, y: s.pos.y }, 300)).toEqual([]);
  });
});

describe('watchNear', () => {
  it('the live Watch ships in range, each once (not again at its scheduled pose)', () => {
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    sim.step({ ...IDLE_COMMAND, actions: [{ type: 'debugGuild', what: 'watch', reqId: 1 }] });
    for (let i = 0; i < 3; i++) sim.step(IDLE_COMMAND);
    const state = sim.state;
    expect(state.guild.watch.length).toBeGreaterThan(0);
    const pos = state.player.body.pos;
    const near = watchNear(state, pos, 400);
    for (const w of state.guild.watch) {
      if (Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) > 400) continue;
      expect(near.filter((n) => n.pos === w.body.pos)).toHaveLength(1);
    }
    const scheduled = scheduledWatchNear(state, pos, 400).filter((s) => !state.guild.watch.some((w) => w.id === s.id));
    expect(near.length).toBe(state.guild.watch.filter((w) => Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) <= 400).length + scheduled.length);
  });
});

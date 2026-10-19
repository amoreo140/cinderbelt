// M4b T3: the generic relay module (plan §2.4, §8) – charging by any mining beam on the receiver, decay,
// one charge at a time, permanent power; nothing in relays.ts knows about derelicts (M4d reuses it).
import { describe, expect, it } from 'vitest';
import { RELAY, RELAY_LAYOUT } from '../../data/sites';
import { flyingAt, ofType, run } from '../discovery/testing';
import type { MiningBeam } from '../mining/mining';
import type { Vec2 } from '../math/vec2';
import { Simulation, type SimEvent, type SimState } from '../Simulation';
import { DERELICT_EXTENT, relayCandidates, sitesInChunk } from './placement';
import { beamOnReceiver, receiverPos, relayCharge, stepRelays } from './relays';
import relaysSource from './relays.ts?raw';
import type { DerelictSite, RelaySite } from './types';

const DT = 1 / 60;
const STEPS_TO_POWER = Math.round(RELAY.powerSeconds / DT);

const relay = (id: string, pos: Vec2, group = 'dl:9,9', owner: RelaySite['owner'] = 'derelict'): RelaySite => ({ id, pos, angle: 0, owner, group });

const beam = (from: Vec2, to: Vec2, asteroidId: string | null = null): MiningBeam => ({
  laser: 0,
  from,
  to,
  asteroidId,
  resource: null,
  bonus: 1,
  vein: null,
});

/** A beam from 10 u west of the relay, stopped on the west side of its mast (aimed at the lens). */
const onMast = (r: RelaySite): MiningBeam => {
  const mast = RELAY_LAYOUT.circles[0]!;
  return beam({ x: r.pos.x - 10, y: r.pos.y }, { x: r.pos.x + mast.x - mast.r, y: r.pos.y + mast.y });
};

function sim(): SimState {
  return new Simulation({ seed: 7, startDocked: false }).state;
}

function hold(state: SimState, candidates: readonly RelaySite[], beams: MiningBeam[], steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    state.player.beams = beams;
    stepRelays(state, candidates, events, DT);
  }
  return events;
}

describe('relay receiver', () => {
  const r = relay('dl:9,9:r0', { x: 100, y: 0 });

  it('counts a beam stopped on the mast and aimed at the lens, or passing the lens', () => {
    expect(beamOnReceiver(onMast(r), r)).toBe(true);
    const lens = receiverPos(r);
    expect(beamOnReceiver(beam({ x: lens.x, y: lens.y - 10 }, { x: lens.x, y: lens.y + 0.5 }), r)).toBe(true);
  });

  it('ignores a beam that misses the lens, ends short of the mast or mines a rock', () => {
    // stopped on the mast but its line passes 1.4 u from the centre (the lens radius is 1.2)
    const y = 1.4;
    const mast = RELAY_LAYOUT.circles[0]!;
    const edge = r.pos.x - Math.sqrt(mast.r * mast.r - y * y);
    expect(beamOnReceiver(beam({ x: 80, y }, { x: edge, y }), r)).toBe(false);
    // ends in empty space 2 u short of the mast
    expect(beamOnReceiver(beam({ x: 80, y: 0 }, { x: 96.5, y: 0 }), r)).toBe(false);
    // a beam on a rock never charges
    expect(beamOnReceiver({ ...onMast(r), asteroidId: '1,1:0' }, r)).toBe(false);
  });

  it('follows the relay angle', () => {
    const turned: RelaySite = { ...r, angle: Math.PI / 2 };
    const lens = receiverPos(turned);
    expect(lens.x).toBeCloseTo(r.pos.x, 9);
    expect(lens.y).toBeCloseTo(r.pos.y + RELAY_LAYOUT.powerTarget.x, 9);
  });
});

describe('relay charging', () => {
  const a = relay('dl:9,9:r0', { x: 100, y: 0 });
  const b = relay('dl:9,9:r1', { x: 0, y: 100 });
  const c = relay('dl:9,9:r2', { x: -100, y: 0 });
  const group = [a, b, c];

  it('powers a relay after 5 s of beam, with charging events at the start and every quarter', () => {
    const state = sim();
    const before = hold(state, group, [onMast(a)], STEPS_TO_POWER - 1);
    expect(state.sites.powered.has(a.id)).toBe(false);
    expect(relayCharge(state, a.id)).toBeGreaterThan(0.99);
    expect(ofType(before, 'relayCharging').map((e) => Math.floor(e.progress * 4))).toEqual([0, 1, 2, 3]);
    const after = hold(state, group, [onMast(a)], 1);
    expect(state.sites.powered.has(a.id)).toBe(true);
    expect(state.sites.charge).toBeNull();
    expect(relayCharge(state, a.id)).toBe(1);
    expect(ofType(after, 'relayPowered')).toEqual([{ type: 'relayPowered', id: a.id, site: 'dl:9,9', lit: 1 }]);
    // a powered relay stays powered and takes no more charge
    const later = hold(state, group, [onMast(a)], 600);
    expect(later).toEqual([]);
    expect(state.sites.charge).toBeNull();
  });

  it('counts the lit relays of the group', () => {
    const state = sim();
    hold(state, group, [onMast(a)], STEPS_TO_POWER);
    const second = hold(state, group, [onMast(b)], STEPS_TO_POWER);
    expect(ofType(second, 'relayPowered')).toEqual([{ type: 'relayPowered', id: b.id, site: 'dl:9,9', lit: 2 }]);
    // a relay of another group does not count
    const other = relay('dl:1,1:r0', { x: 300, y: 0 }, 'dl:1,1');
    const third = hold(state, [...group, other], [onMast(other)], STEPS_TO_POWER);
    expect(ofType(third, 'relayPowered')).toEqual([{ type: 'relayPowered', id: other.id, site: 'dl:1,1', lit: 1 }]);
  });

  it('decays without a beam at 0.5 s per second and resumes from what is left', () => {
    const state = sim();
    hold(state, group, [onMast(a)], 120);
    expect(state.sites.charge?.progress).toBeCloseTo(2, 6);
    hold(state, group, [], 120);
    expect(state.sites.charge?.progress).toBeCloseTo(1, 6);
    expect(relayCharge(state, a.id)).toBeCloseTo(1 / RELAY.powerSeconds, 6);
    hold(state, group, [onMast(a)], STEPS_TO_POWER - 60);
    expect(state.sites.powered.has(a.id)).toBe(true);
    // fully decayed = gone
    const fresh = sim();
    hold(fresh, group, [onMast(a)], 60);
    hold(fresh, group, [], 121);
    expect(fresh.sites.charge).toBeNull();
  });

  it('charges one relay at a time: a beam on another relay takes the charge over', () => {
    const state = sim();
    hold(state, group, [onMast(a)], 120);
    const events = hold(state, group, [onMast(b)], 1);
    expect(state.sites.charge).toEqual({ id: b.id, progress: DT });
    expect(relayCharge(state, a.id)).toBe(0);
    expect(ofType(events, 'relayCharging')).toEqual([{ type: 'relayCharging', id: b.id, progress: DT / RELAY.powerSeconds }]);
    // beams on two relays at once: the one being charged keeps the charge, the other waits
    hold(state, group, [onMast(a), onMast(b)], 60);
    expect(state.sites.charge?.id).toBe(b.id);
    expect(state.sites.charge?.progress).toBeCloseTo(61 * DT, 9);
    // several beams on one relay charge it no faster
    const solo = sim();
    hold(solo, group, [onMast(c), onMast(c), onMast(c)], 60);
    expect(solo.sites.charge?.progress).toBeCloseTo(1, 9);
  });

  it('is owner-agnostic: a Guild relay (M4d) charges exactly like a derelict relay', () => {
    const state = sim();
    const guild = relay('gr:A', { x: 500, y: 500 }, 'gr:A', 'guild');
    const events = hold(state, [guild], [onMast(guild)], STEPS_TO_POWER);
    expect(ofType(events, 'relayPowered')).toEqual([{ type: 'relayPowered', id: 'gr:A', site: 'gr:A', lit: 1 }]);
  });

  it('relays.ts imports nothing that knows about derelicts', () => {
    const imports = [...relaysSource.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) expect(path).toMatch(/^(\.\.\/\.\.\/data\/sites|\.\.\/mining\/mining|\.\.\/math\/vec2|\.\.\/Simulation|\.\/types)$/);
    // and names no derelict constant or id
    expect(relaysSource).not.toMatch(/DERELICT|derelictId|'dl:/);
  });
});

describe('relays in the game', () => {
  /** The first derelict of seed 42 (spiral from home). */
  function firstDerelict(seed: number): DerelictSite {
    for (let r = 5; r < 40; r++) {
      for (let cx = -r; cx <= r; cx++) {
        for (let cy = -r; cy <= r; cy++) {
          if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue;
          const d = sitesInChunk(seed, cx, cy).find((s): s is DerelictSite => s.kind === 'derelict');
          if (d) return d;
        }
      }
    }
    throw new Error('no derelict');
  }

  it('the mining laser held on a relay receiver powers it (5 s), through the real mining step', () => {
    const d = firstDerelict(42);
    const target = d.relays[0]!;
    // park 14 u from the relay on the side away from the derelict, facing it
    const out = { x: target.pos.x - d.pos.x, y: target.pos.y - d.pos.y };
    const len = Math.hypot(out.x, out.y);
    const at = { x: target.pos.x + (out.x / len) * 14, y: target.pos.y + (out.y / len) * 14 };
    const game = flyingAt(42, at);
    game.state.player.body = { ...game.state.player.body, angle: Math.atan2(-out.y, -out.x) };
    game.state.player.prevBody = game.state.player.body;
    expect(relayCandidates(game.state)).toEqual([]);
    const aim = receiverPos(target);
    const events = run(game, STEPS_TO_POWER + 30, { mining: true, aim });
    expect(game.state.player.beams.length).toBeGreaterThan(0);
    expect(ofType(events, 'relayPowered')).toEqual([{ type: 'relayPowered', id: target.id, site: d.id, lit: 1 }]);
    expect(relayCandidates(game.state).map((r) => r.id)).toEqual(d.relays.map((r) => r.id));
    expect(DERELICT_EXTENT).toBeGreaterThanOrEqual(RELAY.distance[1]);
  });
});

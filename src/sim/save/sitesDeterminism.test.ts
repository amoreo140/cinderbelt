// World sites and events director determinism across save and load (M4b, save V17): A runs N + M steps,
// B runs N, is saved, loaded and runs M more with the same commands; the events and the saved state must
// match. Situations: a relay charged half-way (then the 2nd relay wakes the sentries), a berth mid-latch
// with terminal takes and the leave, mining a comet nucleus on the move, a graveyard with one mine gone,
// the sleepers awake and another mine mid-fuse, an ambush during its radio warning and in the fight, and
// a rolled micrometeor shower pending and running.
import { describe, expect, it } from 'vitest';
import { AMBUSH, EVENT_DEFS } from '../../data/events';
import { IDLE_COMMAND, type GameAction, type PlayerCommand } from '../commands';
import { flyingAt, teleport } from '../discovery/testing';
import { findSpot, findTrigger, parkedAt } from '../events/testing';
import type { Vec2 } from '../math/vec2';
import { Simulation, type SimEvent } from '../Simulation';
import { cometAt, cometDefs, cometPassWindow, cometStepTick } from '../sites/comets';
import { atClamp, findDerelict, powerRelays } from '../sites/derelictTesting';
import { graveyardLayout, wakeParty } from '../sites/graveyard';
import { touchGraveyard } from '../sites/graveyardState';
import { sitesInChunk } from '../sites/placement';
import { receiverPos } from '../sites/relays';
import type { GraveyardSite } from '../sites/types';
import type { ChunkGenerator } from '../world/generate';
import { loadSave } from './load';
import { restoreSimulation, toEnvelope, toSave } from './serialize';
import { testContext } from './testing';

const ctx = testContext();

type Script = (step: number, sim: Simulation) => PlayerCommand;

function run(sim: Simulation, from: number, to: number, script: Script): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = from; i < to; i++) out.push(...sim.step(script(i, sim)));
  return out;
}

function roundTrip(sim: Simulation, generator?: ChunkGenerator): Simulation {
  const result = loadSave(toEnvelope(toSave(sim, ctx)));
  if (!result.ok) throw new Error(`load failed: ${result.error} ${result.details.join('; ')}`);
  expect(result.warnings).toEqual([]);
  return restoreSimulation(result.save, generator ? { generator } : {});
}

/** A runs N + M, B runs N → save → load → M; returns the events of A's last M steps for checks. */
function check(setup: () => Simulation, script: Script, n: number, m: number, generator?: ChunkGenerator): { a: Simulation; events: SimEvent[]; saved: Simulation } {
  const a = setup();
  const b = setup();
  run(a, 0, n, script);
  run(b, 0, n, script);
  const saved = roundTrip(b, generator);
  expect(JSON.stringify(toSave(saved, ctx))).toBe(JSON.stringify(toSave(b, ctx)));
  const eventsA = run(a, n, n + m, script);
  const eventsB = run(saved, n, n + m, script);
  expect(eventsB).toEqual(eventsA);
  expect(JSON.stringify(toSave(saved, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
  return { a, events: eventsA, saved: b };
}

const types = (events: readonly SimEvent[]): Set<string> => new Set(events.map((e) => e.type));

// ---------------------------------------------------------------- derelict: relays, defence, berth

const SEED = 42;
const SENTRIES = findDerelict(SEED, (d) => d.defence === 'sentries');
const STASH = findDerelict(SEED, (d) => d.service === 'stash');

/** Parked 14 u out from relay 1 of the sentry derelict, facing it; relay 0 already powered. */
function atRelay(): Simulation {
  const d = SENTRIES;
  const target = d.relays[1]!;
  const out = { x: target.pos.x - d.pos.x, y: target.pos.y - d.pos.y };
  const len = Math.hypot(out.x, out.y);
  const sim = flyingAt(SEED, { x: target.pos.x + (out.x / len) * 14, y: target.pos.y + (out.y / len) * 14 });
  sim.state.player.body = { ...sim.state.player.body, angle: Math.atan2(-out.y, -out.x) };
  sim.state.player.prevBody = sim.state.player.body;
  powerRelays(sim, d, 1);
  return sim;
}

const holdBeam: Script = () => ({ ...IDLE_COMMAND, mining: true, aim: receiverPos(SENTRIES.relays[1]!) });

const take = (step: number, item: number): PlayerCommand => ({
  ...IDLE_COMMAND,
  actions: [{ type: 'derelictTake', site: STASH.id, item, reqId: 100 + step } as GameAction],
});

/** At the stash derelict's clamp, all relays powered: F, latch, two takes (one twice), F again, drift. */
function atStashClamp(): Simulation {
  const sim = atClamp(SEED, STASH);
  powerRelays(sim, STASH);
  return sim;
}

const berthScript: Script = (step) => {
  if (step === 0 || step === 240) return { ...IDLE_COMMAND, dock: true };
  if (step === 90) return take(step, 0);
  if (step === 120 || step === 150) return take(step, 1);
  return IDLE_COMMAND;
};

describe('derelict determinism across save and load', () => {
  it('a relay charged half-way: the charge continues, the 2nd relay lights and wakes the sentries', () => {
    // 2.5 s of the 5 s charge
    const { events, saved } = check(atRelay, holdBeam, 150, 600);
    expect(saved.state.sites.charge?.id).toBe(SENTRIES.relays[1]!.id);
    expect(types(events)).toContain('relayPowered');
    expect(types(events)).toContain('derelictWoke');
  });

  it('saved with the sentries awake', () => {
    const { saved } = check(atRelay, holdBeam, 400, 600);
    expect(saved.state.combat.enemies.some((e) => e.kind === 'sentry' && e.id.startsWith(`dd:${SENTRIES.cx},${SENTRIES.cy}:`))).toBe(true);
  });

  it.each([
    // mid-latch
    [20, 400],
    // latched, one item taken (the second take of item 1 is refused after the load)
    [130, 300],
  ])('berthed at a derelict, N=%i, M=%i: latch, terminal takes and the leave match', (n, m) => {
    const { events, saved } = check(atStashClamp, berthScript, n, m);
    expect(saved.state.sites.berth).toBe(STASH.id);
    expect(types(events)).toContain('berthLeft');
  });
});

// ---------------------------------------------------------------- comet

const COMET_SEED = 7;
const empty: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });
const COMET = cometDefs(COMET_SEED)[0]!.id;

/** Flying alongside the comet nucleus (matched velocity, dampers off), 3 000 steps into its pass. */
function alongside(): Simulation {
  const sim = new Simulation({ seed: COMET_SEED, startDocked: false, generator: empty });
  sim.state.tick = cometPassWindow(COMET_SEED, COMET, 0)!.start + 3_000;
  const pose = cometAt(COMET_SEED, COMET, cometStepTick(sim.state))!;
  const v = Math.hypot(pose.vel.x, pose.vel.y);
  const side = { x: -pose.vel.y / v, y: pose.vel.x / v };
  const pos = { x: pose.pos.x + side.x * 12 - pose.vel.x / 60, y: pose.pos.y + side.y * 12 - pose.vel.y / 60 };
  sim.state.player.body = { pos, vel: { ...pose.vel }, angle: Math.atan2(-side.y, -side.x), angVel: 0 };
  sim.state.player.prevBody = sim.state.player.body;
  sim.state.player.dampers = false;
  return sim;
}

const nucleus = (sim: Simulation): Vec2 => cometAt(COMET_SEED, COMET, cometStepTick(sim.state))?.pos ?? sim.state.player.body.pos;
const mineComet: Script = (_step, sim) => ({ ...IDLE_COMMAND, mining: true, aim: nucleus(sim) });

describe('comet determinism across save and load', () => {
  it('mining a comet nucleus on the move: the pass budget and the nuggets match', () => {
    const { a, saved } = check(alongside, mineComet, 90, 240, empty);
    expect(saved.state.sites.comets.get(COMET)!.core).toBeGreaterThan(0);
    expect(a.state.sites.comets.get(COMET)!.core).toBeGreaterThan(saved.state.sites.comets.get(COMET)!.core);
  });
});

// ---------------------------------------------------------------- graveyard

function graveyard(): GraveyardSite {
  const out: GraveyardSite[] = [];
  for (let cx = -30; cx <= 30; cx++) for (let cy = -30; cy <= 30; cy++) for (const s of sitesInChunk(SEED, cx, cy)) if (s.kind === 'graveyard' && s.mines.length > 1 && s.sleepers.length > 0) out.push(s);
  return out.sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0]!;
}
const G = graveyard();

/** By the graveyard: mine 0 gone, the party spawned and woken; the ship parked 4 u from mine 1 (it arms). */
function atGraveyard(): Simulation {
  const sim = flyingAt(SEED, { x: G.pos.x, y: G.pos.y + 260 });
  touchGraveyard(sim.state, G.id).mines = 1;
  for (let i = 0; i < 5; i++) sim.step(IDLE_COMMAND);
  expect(sim.state.combat.enemies.filter((e) => e.id.startsWith(`gs:${G.cx},${G.cy}:`))).toHaveLength(graveyardLayout(SEED, G).sleepers.length);
  wakeParty(sim.state, G, []);
  const mine = G.mines[1]!;
  teleport(sim, { x: mine.x + 4 + sim.state.player.props.boundingRadius, y: mine.y });
  return sim;
}

describe('graveyard determinism across save and load', () => {
  it('one mine gone, the sleepers awake, another mine mid-fuse: the blast and the fight match', () => {
    const { events, saved } = check(atGraveyard, () => IDLE_COMMAND, 40, 600);
    expect(saved.state.sites.graveyards.get(G.id)).toMatchObject({ mines: 1, party: 'awake' });
    expect(toSave(saved, ctx).sites.armed.map(([id]) => id)).toEqual([`${G.id}:m1`]);
    expect(events.filter((e) => e.type === 'mineExploded').map((e) => (e as { id: string }).id)).toContain(`${G.id}:m1`);
  });
});

// ---------------------------------------------------------------- director

const EVENT_SEED = 4242;
const LEAD = AMBUSH.leadSeconds * 60;

function contested(): Simulation {
  const probe = new Simulation({ seed: EVENT_SEED, startDocked: false });
  const spot = findSpot(probe, 2, 'contested');
  const sim = parkedAt(EVENT_SEED, spot.pos);
  sim.state.tick = 11 * 3600 + 15;
  return sim;
}

const ambushScript: Script = (step) => (step === 0 ? { ...IDLE_COMMAND, actions: [{ type: 'debugEvent', kind: 'ambush', reqId: 1 }] } : IDLE_COMMAND);

/** The first naturally rolled micrometeor shower of a Contested depth-2 spot: parked there one step before its trigger. */
function beforeShower(): Simulation {
  const probe = new Simulation({ seed: EVENT_SEED, startDocked: false });
  const spot = findSpot(probe, 2, 'contested');
  const sim = parkedAt(EVENT_SEED, spot.pos);
  findTrigger(sim, spot, 'micrometeors');
  sim.state.tick -= 1;
  return sim;
}

describe('events director determinism across save and load', () => {
  it.each([
    // during the radio warning (the director's warning pending)
    [60, LEAD + 600],
    // in the fight
    [LEAD + 240, 900],
  ])('an ambush, N=%i, M=%i: the spawn happens once and the fight matches', (n, m) => {
    const { a } = check(contested, ambushScript, n, m);
    const all = [...a.state.director.fired.keys()];
    expect(all.some((k) => k.startsWith('ev:ambush:'))).toBe(true);
    expect(a.state.combat.enemies.some((e) => e.id.startsWith('ab:')) || all.some((k) => k.endsWith('#end'))).toBe(true);
  });

  it.each([
    // the warning given, the shower not started yet
    [60, 2400],
    // in the shower
    [EVENT_DEFS.micrometeors.leadSeconds * 60 + 300, 2400],
  ])('a rolled micrometeor shower, N=%i, M=%i: warning, rays and hits match', (n, m) => {
    const { saved } = check(beforeShower, () => IDLE_COMMAND, n, m);
    expect([...saved.state.director.fired.keys()].some((k) => k.startsWith('ev:micrometeors:'))).toBe(true);
  });
});

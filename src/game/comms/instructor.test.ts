import { describe, expect, it } from 'vitest';
import { TRAINING_STEPS } from '../../data/training';
import { enComms } from '../../i18n/enComms';
import { skComms } from '../../i18n/skComms';
import type { PlayerCommand } from '../../sim/commands';
import type { SimEvent } from '../../sim/Simulation';
import { playTraining, step, teleport, trainingSim, undock } from '../../sim/training/testing';
import { homeStation } from '../../sim/world/stations';
import { CommsUi } from './commsUi';
import { Instructor, INSTRUCTOR_KEY, NUDGE_AFTER, NUDGE_GAP, NUDGE_LIMIT, type InstructorInput } from './instructor';
import type { CommsMessage } from './types';

const t = skComms;
const I = t.instructor;
const input = (patch: Partial<InstructorInput> & Pick<InstructorInput, 'state'>): InstructorInput => ({ events: [], clock: 0, quiet: false, hidden: false, texts: t, ...patch });
const oneOf = (variants: readonly string[], line: string | undefined): boolean => variants.includes(line ?? '');

describe('Guild instructor – step messages', () => {
  it('a new training: the intro of step 1 in the instructor\'s voice, once', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    const out = ins.update(input({ state: sim.state }));
    expect(out.msg).toMatchObject({ key: INSTRUCTOR_KEY, channel: 'training', speaker: { id: 'instructor', name: 'Majster Bartoš', portrait: 'guild_instructor' } });
    expect(out.msg!.lines).toHaveLength(1);
    expect(oneOf(I.intro.flyBuoy, out.msg!.lines[0])).toBe(true);
    // nothing new: silence
    expect(ins.update(input({ state: sim.state, clock: 1 })).msg).toBeNull();
    expect(ins.update(input({ state: sim.state, clock: 30 })).msg).toBeNull();
  });

  it('a finished step: praise with the reward and the next step\'s intro in one message; the step toast is replaced', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    ins.update(input({ state: sim.state }));
    undock(sim);
    teleport(sim, sim.state.career.training.sites!.buoyA);
    const events = step(sim, {}, 2);
    const done = events.find((e) => e.type === 'trainingStep')!;
    expect(done).toBeDefined();
    const out = ins.update(input({ state: sim.state, events, clock: 5 }));
    expect(out.events).toEqual([done]);
    expect(out.msg!.lines).toHaveLength(2);
    expect(out.msg!.lines[0]).toContain('50 kr');
    expect(I.praise.map((p) => p('50 kr'))).toContain(out.msg!.lines[0]);
    expect(oneOf(I.intro.mineIron, out.msg!.lines[1])).toBe(true);
  });

  it('the scripted playthrough: one message per step change – nine intros, eight praises, the closing line', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    const said: CommsMessage[] = [];
    const replaced: SimEvent[] = [];
    const real = sim.step.bind(sim);
    sim.step = (cmd: PlayerCommand) => {
      const events = real(cmd);
      const out = ins.update(input({ state: sim.state, events, clock: sim.state.tick / 60 }));
      if (out.msg) said.push(out.msg);
      replaced.push(...out.events);
      return events;
    };
    ins.update(input({ state: sim.state }));
    const events = playTraining(sim);
    expect(sim.state.career.training.status).toBe('done');
    const steps = said.filter((m) => !m.id.includes(':nudge:'));
    expect(steps).toHaveLength(TRAINING_STEPS.length);
    // every step's intro after the first one is said once, after the praise of the one before
    TRAINING_STEPS.slice(1).forEach((def, i) => {
      const m = steps[i]!;
      expect(m.lines).toHaveLength(2);
      expect(oneOf(I.intro[def.id], m.lines[1])).toBe(true);
    });
    const last = steps[steps.length - 1]!;
    expect(oneOf(I.done, last.lines[1])).toBe(true);
    // every trainingStep event's toast is replaced by the praise
    expect(replaced).toEqual(events.filter((e) => e.type === 'trainingStep'));
  });
});

describe('Guild instructor – nudges', () => {
  it('nudges after a minute without progress, then at most once a minute, a few times per step', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    ins.update(input({ state: sim.state, clock: 0 }));
    const at = (clock: number) => ins.update(input({ state: sim.state, clock })).msg;
    expect(at(NUDGE_AFTER - 1)).toBeNull();
    const first = at(NUDGE_AFTER);
    // step 1 is flown: docked, the nudge says "undock"
    expect(oneOf(I.nudgeUndock, first?.lines[0])).toBe(true);
    expect(at(NUDGE_AFTER + 10)).toBeNull();
    expect(at(NUDGE_AFTER + NUDGE_GAP - 1)).toBeNull();
    expect(at(NUDGE_AFTER + NUDGE_GAP)).not.toBeNull();
    let given = 2;
    for (let c = NUDGE_AFTER + NUDGE_GAP + 1; c < 1000; c++) if (at(c)) given++;
    expect(given).toBe(NUDGE_LIMIT);
  });

  it('progress resets the idle clock: undocking, coming closer to the buoy', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    ins.update(input({ state: sim.state, clock: 0 }));
    undock(sim);
    // undocked at 50 s: the clock starts again
    expect(ins.update(input({ state: sim.state, clock: 50 })).msg).toBeNull();
    expect(ins.update(input({ state: sim.state, clock: 100 })).msg).toBeNull();
    // halfway to the buoy at 105 s: progress
    const buoy = sim.state.career.training.sites!.buoyA;
    const p = sim.state.player.body.pos;
    teleport(sim, { x: (p.x + buoy.x) / 2, y: (p.y + buoy.y) / 2 });
    expect(ins.update(input({ state: sim.state, clock: 105 })).msg).toBeNull();
    expect(ins.update(input({ state: sim.state, clock: 105 + NUDGE_AFTER - 1 })).msg).toBeNull();
    // in flight on a flight step: the step's own hint
    const nudge = ins.update(input({ state: sim.state, clock: 105 + NUDGE_AFTER })).msg;
    expect(oneOf(I.nudge.flyBuoy, nudge?.lines[0])).toBe(true);
  });

  it('a dock step in flight: "dock"; the variants are deterministic', () => {
    const run = () => {
      const sim = trainingSim(1337);
      sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'installSide');
      undock(sim);
      const ins = new Instructor();
      ins.update(input({ state: sim.state, clock: 0 }));
      // the rebuild for a language switch is a closure – compare what the message says
      const msg = ins.update(input({ state: sim.state, clock: NUDGE_AFTER })).msg;
      return msg ? { ...msg, retext: undefined } : null;
    };
    const a = run();
    expect(oneOf(I.nudgeDock, a?.lines[0])).toBe(true);
    expect(run()).toEqual(a);
  });
});

describe('Guild instructor – no spam during danger', () => {
  it('holds the step message while danger is on the air, the toast stays; no nudges meanwhile', () => {
    const sim = trainingSim(1337);
    const ins = new Instructor();
    // a toll or danger on the air from the start
    expect(ins.update(input({ state: sim.state, quiet: true })).msg).toBeNull();
    for (let c = 1; c < 300; c += 5) expect(ins.update(input({ state: sim.state, clock: c, quiet: true })).msg).toBeNull();
    // the step finishes while it is still loud: the praise waits, its toast is not taken
    undock(sim);
    teleport(sim, sim.state.career.training.sites!.buoyA);
    const events = step(sim, {}, 2);
    const loud = ins.update(input({ state: sim.state, events, clock: 300, quiet: true }));
    expect(loud).toEqual({ msg: null, events: [] });
    // quiet again: one message – the praise and the step that runs now
    const out = ins.update(input({ state: sim.state, clock: 301 }));
    expect(out.msg!.lines).toHaveLength(2);
    expect(out.msg!.lines[0]).toContain('50 kr');
    expect(oneOf(I.intro.mineIron, out.msg!.lines[1])).toBe(true);
    // the idle clock started when it was said
    expect(ins.update(input({ state: sim.state, clock: 301 + NUDGE_AFTER - 1 })).msg).toBeNull();
  });

  it('through the radio: a danger message on the air keeps the instructor off; he speaks after it', () => {
    const sim = trainingSim(1337);
    const c = new CommsUi({ state: () => sim.state, render: () => {}, click: () => {}, sound: () => {} });
    const ctx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };
    const hunt: SimEvent = { type: 'huntingParty', captain: null, pos: { x: 0, y: 0 } };
    c.onStep(sim.state, [hunt], ctx);
    expect(c.uiData(() => null, true).panel).toMatchObject({ channel: 'danger' });
    expect(c.queue.has(INSTRUCTOR_KEY)).toBe(false);
    // the hunting party's message ends: the instructor's intro follows
    step(sim, {}, 600);
    c.onStep(sim.state, [], ctx);
    c.onStep(sim.state, [], ctx);
    expect(c.uiData(() => null, true).panel).toMatchObject({ channel: 'training', speaker: { name: 'Majster Bartoš' } });
  });

  it('an open toll: the instructor waits', () => {
    const sim = trainingSim(1337);
    sim.state.pirates.toll = { group: 'pr:1,1', amount: 100, until: sim.state.tick + 600 };
    const c = new CommsUi({ state: () => sim.state, render: () => {}, click: () => {}, sound: () => {} });
    c.onStep(sim.state, [], { toastOf: () => null, dockStation: () => null });
    expect(c.queue.has(INSTRUCTOR_KEY)).toBe(false);
    sim.state.pirates.toll = null;
    c.onStep(sim.state, [], { toastOf: () => null, dockStation: () => null });
    expect(c.queue.has(INSTRUCTOR_KEY)).toBe(true);
  });

  it('speaks English with the English texts', () => {
    const sim = trainingSim(1337);
    const out = new Instructor().update(input({ state: sim.state, texts: enComms }));
    expect(out.msg!.speaker.name).toBe('Master Hale');
    expect(enComms.instructor.intro.flyBuoy).toContain(out.msg!.lines[0]);
  });
});

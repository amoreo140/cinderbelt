import { describe, expect, it } from 'vitest';
import { skComms } from '../../i18n/skComms';
import { createEnemy } from '../../sim/combat/enemies';
import { flyingAt } from '../../sim/discovery/testing';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { beginTraining } from '../../sim/training/training';
import { homeStation } from '../../sim/world/stations';
import { CommsUi } from './commsUi';
import { piratesNew } from './firstContact';

const F = skComms.firstContact;
const ctx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };
const radio = (state: () => SimState) => new CommsUi({ state, render: () => {}, click: () => {}, sound: () => {} });

/** A Jackal group next to the ship (as the sim spawns it). */
function group(state: SimState, id: string, kinds: readonly ('jackal' | 'hammer')[] = ['jackal', 'jackal']): void {
  const p = state.player.body.pos;
  kinds.forEach((kind, i) => state.combat.enemies.push(createEnemy({ id: `${id}:${i}`, kind, tier: 1, pos: { x: p.x + 60 + i * 8, y: p.y }, angle: Math.PI, home: p, orbit: 1 })));
}
const alert = (ref: string): SimEvent => ({ type: 'enemyAlert', ref, pos: { x: 0, y: 0 } });

describe('first contact – pirates', () => {
  it('the first group that notices the player: the taunt, the traffic warning and the retort, queued in order', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    group(s, 'pr:3,3');
    expect(piratesNew(s)).toBe(true);
    const c = radio(() => s);
    c.onStep(s, [alert('pr:3,3:0')], ctx);
    const showing = c.queue.showing!.msg;
    expect(showing).toMatchObject({ key: 'alert:pr:3,3', channel: 'danger', speaker: { id: 'pirate:jackal' } });
    expect(F.pirate).toContain(showing.lines[0]);
    const [warn, retort] = c.queue.queued;
    expect(warn).toMatchObject({ key: 'first:pirate:warn', channel: 'danger', speaker: { id: 'traffic:home' } });
    expect(F.warnTraffic).toContain(warn!.lines[0]);
    expect(retort).toMatchObject({ key: 'first:pirate:retort', speaker: { id: 'pirate:jackal' } });
    expect(F.pirateRetort).toContain(retort!.lines[0]);
  });

  it('during the training the Guild instructor warns', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    beginTraining(sim.state);
    const s = sim.state;
    group(s, 'pr:3,3');
    const c = radio(() => s);
    c.onStep(s, [alert('pr:3,3:1')], ctx);
    const warn = c.queue.queued.find((m) => m.key === 'first:pirate:warn')!;
    expect(warn.speaker.id).toBe('instructor');
    expect(F.warnInstructor).toContain(warn.lines[0]);
    // and the instructor's own step talk does not jump in while the exchange is on
    expect(c.queue.has('training')).toBe(false);
  });

  it('only once – the next group is ordinary chatter; a player who has beaten pirates gets none', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    group(s, 'pr:3,3');
    // a Hammer leads the second group (the Jackal voice has a per-speaker cooldown for chatter)
    group(s, 'pr:4,4', ['hammer']);
    const c = radio(() => s);
    c.onStep(s, [alert('pr:3,3:0')], ctx);
    c.queue.clear();
    c.onStep(s, [alert('pr:4,4:0')], ctx);
    expect(c.queue.showing!.msg).toMatchObject({ key: 'alert:pr:4,4', channel: 'flavour' });
    expect(c.queue.queued).toHaveLength(0);

    const vet = flyingAt(4242, { x: 300, y: 0 });
    vet.state.stats.kills = 3;
    group(vet.state, 'pr:3,3');
    const v = radio(() => vet.state);
    v.onStep(vet.state, [alert('pr:3,3:0')], ctx);
    expect(v.queue.showing!.msg.channel).toBe('flavour');
    expect(v.queue.queued).toHaveLength(0);
  });

  it('a toll as the first contact: the toll speaks, the warning follows once it is answered', () => {
    const sim = flyingAt(4242, { x: 0, y: 1800 });
    const s = sim.state;
    group(s, 'pr:7,7', ['hammer', 'jackal']);
    s.pirates.toll = { group: 'pr:7,7', amount: 300, until: s.tick + 600 };
    const c = radio(() => s);
    const demand: SimEvent = { type: 'tollDemanded', group: 'pr:7,7', amount: 300, until: s.tick + 600, pos: { x: 0, y: 0 } };
    c.onStep(s, [alert('pr:7,7:0'), demand], ctx);
    expect(c.queue.showing!.msg.reply).toBe('toll');
    expect(c.queue.has('first:pirate:warn')).toBe(false);
    s.pirates.toll = null;
    const paid: SimEvent = { type: 'tollPaid', group: 'pr:7,7', amount: 300 };
    c.onStep(s, [paid], ctx);
    expect(c.queue.has('first:pirate:warn')).toBe(true);
  });
});

describe('first contact – the Echo', () => {
  it('the first signal: the glitched unknown voice, a puzzled traffic control, the signal again', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    const c = radio(() => s);
    const heard: SimEvent = { type: 'echoHeard', echo: 0, fixes: 1, located: false };
    const entry: SimEvent = { type: 'journalEntry', id: 'echo0Heard' };
    c.onStep(s, [heard, entry], ctx);
    const first = c.queue.showing!.msg;
    expect(first).toMatchObject({ channel: 'story', journal: true, speaker: { id: 'echo', name: 'Neznámy signál' } });
    expect(F.echo).toContain(first.lines[0]);
    const [reaction, again] = c.queue.queued;
    expect(reaction).toMatchObject({ key: 'first:echo:reaction', speaker: { id: 'traffic:home' } });
    expect(F.echoReaction).toContain(reaction!.lines[0]);
    expect(again).toMatchObject({ key: 'first:echo:again', speaker: { id: 'echo', name: 'Neznámy signál' } });
    expect(F.echoAgain).toContain(again!.lines[0]);
    // a later signal is the ordinary Echo line
    c.queue.clear();
    c.onStep(s, [heard], ctx);
    expect(skComms.lines.echo.heard).toContain(c.queue.showing!.msg.lines[0]);
    expect(c.queue.queued).toHaveLength(0);
  });
});

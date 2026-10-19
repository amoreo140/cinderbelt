// M4d first contacts (T10): the first live Guild Watch fight and the first convoy flyby, once each.
import { describe, expect, it } from 'vitest';
import { skComms } from '../../i18n/skComms';
import { createEnemy } from '../../sim/combat/enemies';
import { flyingAt } from '../../sim/discovery/testing';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { homeStation } from '../../sim/world/stations';
import { CommsUi } from './commsUi';
import { firstConvoy } from './firstContact';

const F = skComms.firstContact;
const ctx = { toastOf: (e: SimEvent) => `toast:${e.type}`, dockStation: () => homeStation() };
const radio = (state: () => SimState) => new CommsUi({ state, render: () => {}, click: () => {}, sound: () => {} }, 'all', skComms);
const all = (c: CommsUi) => [c.queue.showing!.msg, ...c.queue.queued];

function engage(s: SimState): SimEvent {
  const p = s.player.body.pos;
  s.combat.enemies.push(createEnemy({ id: 'pr:5,5:0', kind: 'jackal', tier: 1, pos: { x: p.x + 300, y: p.y }, angle: 0, home: p, orbit: 1 }));
  // the sim sets lastRadio in the step it speaks
  s.guild.lastRadio = s.tick;
  return { type: 'watchEngaged', id: 'gw:lane:A:0|1', target: 'pr:5,5:0' };
}

describe('first contact – the Guild Watch', () => {
  it('the first Watch fight: the Watch, the traffic warner and the Watch again; never again', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    const c = radio(() => s);
    c.onStep(s, [], ctx);
    s.tick += 1;
    c.onStep(s, [engage(s)], ctx);
    const [first, reaction, again] = all(c);
    expect(first).toMatchObject({ key: 'watch:engage', channel: 'danger', speaker: { portrait: 'guild_watch' } });
    expect(F.watch).toContain(first!.lines[0]);
    expect(reaction).toMatchObject({ key: 'first:watch:reaction', speaker: { id: 'traffic:home' } });
    expect(F.watchReaction).toContain(reaction!.lines[0]);
    expect(again).toMatchObject({ key: 'first:watch:again', speaker: { portrait: 'guild_watch' } });
    expect(F.watchAgain).toContain(again!.lines[0]);
    s.tick += 120 * 60;
    c.onStep(s, [engage(s)], ctx);
    expect(c.queue.transcript.filter((m) => m.id.startsWith('first:watch:'))).toHaveLength(2);
  });

  it('a game where the Watch has spoken before (a loaded save) does not replay it', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    s.guild.lastRadio = 100;
    s.tick = 5000;
    const c = radio(() => s);
    c.onStep(s, [], ctx);
    s.tick += 1;
    c.onStep(s, [engage(s)], ctx);
    expect(all(c).map((m) => m.key)).toEqual(['watch:engage']);
    expect(skComms.lines.watch.engaged.concat(skComms.lines.watch.defend)).toContain(c.queue.showing!.msg.lines[0]);
  });
});

describe('first contact – convoys', () => {
  const flyby = (pass: string): SimEvent => ({ type: 'eventWarning', key: `ev:convoy:${pass}`, kind: 'convoyFlyby', inSeconds: 110, dir: 0 });

  it('the first convoy flyby: the trader, the warner and the trader again; a later pass only announces itself', () => {
    const sim = flyingAt(4242, { x: 300, y: 0 });
    const s = sim.state;
    const c = radio(() => s);
    s.director.fired.set('ev:convoy:cv:A@1', s.tick);
    expect(firstConvoy(s, 'ev:convoy:cv:A@1')).toBe(true);
    c.onStep(s, [flyby('cv:A@1')], ctx);
    const [first, reaction, again] = all(c);
    expect(first).toMatchObject({ key: 'convoy:cv:A@1', channel: 'story', speaker: { id: 'trader:cv:A@1', portrait: 'traffic_trade' } });
    expect(F.convoy).toContain(first!.lines[0]);
    expect(reaction).toMatchObject({ key: 'first:convoy:reaction', speaker: { id: 'traffic:home' } });
    expect(again).toMatchObject({ key: 'first:convoy:again', speaker: { id: 'trader:cv:A@1' } });
    s.director.fired.set('ev:convoy:cv:B@1', s.tick);
    expect(firstConvoy(s, 'ev:convoy:cv:B@1')).toBe(false);
    const d = radio(() => s);
    d.onStep(s, [flyby('cv:B@1')], ctx);
    expect(all(d).map((m) => m.key)).toEqual(['convoy:cv:B@1']);
  });
});

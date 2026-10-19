// M4b T6: where the Gunner and the sentry show up in the pirate logic – hunting parties out of a depth-2
// Pirate sector, every 3rd fortress reinforcement, and the toll of any group kind that may hail
// (regular groups and the director's ambush parties; never sentries, sleepers or reinforcements).
import { describe, expect, it } from 'vitest';
import { GUNNER, HUNT } from '../../data/pirates';
import { createEnemy } from '../combat/enemies';
import { flyingAt, ofType, run } from '../discovery/testing';
import { add, rotate } from '../math/vec2';
import { sectorInfoAt } from '../regions';
import { createGrid } from '../ship/grid';
import type { Simulation } from '../Simulation';
import { reinforcementKind } from './fortress';
import { groupOf } from './pirates';
import { securityHere } from './sectors';
import { fortressSites, fortressToWorld } from './sites';

const fighter = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['gyro', 0, 2],
    ['cannon', 1, 1, 0],
    ['cannon', 1, -1, 0],
    ['armor', 1, 0, 0],
    ['reactor', -1, 0],
    ['shield', 0, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0, 0],
    ['engine', 2, 0, 2],
    ['engine', -1, 1, 1],
    ['engine', -1, -1, 3],
  ]);

/** Ship in the Pirate sector of fortress `index` of `seed`, near its beacon. */
function atFortress(seed: number, index: number): Simulation {
  const f = fortressSites(seed)[index]!;
  const sim = flyingAt(seed, { x: f.beacon.pos.x - 40, y: f.beacon.pos.y }, fighter());
  sim.state.world.newlyExplored = [];
  return sim;
}

describe('toll groups (M4b: any group prefix that may hail)', () => {
  it('regular groups and ambush parties toll; sentries, sleepers, hunts, raids and reinforcements never do', () => {
    expect(groupOf('pr:12,-3:1')).toBe('pr:12,-3');
    expect(groupOf('ab:rg:A:3.1@57:0')).toBe('ab:rg:A:3.1@57');
    expect(groupOf('ab:rg:B:0@-2:3')).toBe('ab:rg:B:0@-2');
    for (const id of ['dd:4,5:0', 'gs:4,5:1', 'hp:3:0', 'rd:2:1', 'fr:0:4', 'cap:2', 'zb:1,1:0', 'player']) expect(groupOf(id), id).toBeNull();
  });

  it('a Hammer-led ambush party hails for a toll like a regular group', () => {
    let hailed = 0;
    for (let bucket = 0; bucket < 12 && hailed === 0; bucket++) {
      const sim = atFortress(4242, 0);
      sim.state.credits = 5000;
      const p = sim.state.player.body.pos;
      const group = `ab:rg:A:9.9@${bucket}`;
      sim.state.combat.enemies = [
        createEnemy({ id: `${group}:0`, kind: 'hammer', tier: 1, pos: add(p, { x: 100, y: 0 }), angle: Math.PI, home: add(p, { x: 100, y: 0 }), orbit: 1 }),
        createEnemy({ id: `${group}:1`, kind: 'gunner', tier: 1, pos: add(p, { x: 110, y: 12 }), angle: Math.PI, home: add(p, { x: 100, y: 0 }), orbit: -1 }),
      ];
      const events = run(sim, 3);
      const toll = ofType(events, 'tollDemanded')[0];
      if (!toll) continue;
      hailed++;
      expect(toll.group).toBe(group);
      // the whole party holds fire while it waits for the answer – the Gunner too
      const party = sim.state.combat.enemies.filter((e) => e.id.startsWith(`${group}:`));
      expect(party.map((e) => e.ai.mode)).toEqual(['hail', 'hail']);
      expect(ofType(run(sim, 120), 'shotFired').filter((e) => e.owner.startsWith(`${group}:`))).toHaveLength(0);
    }
    expect(hailed).toBe(1);
  });

  it('an ambush toll runs the whole pay / refuse / escape flow (the group is not lost on the next tick)', () => {
    const hail = (answer: 'pay' | 'refuse' | 'escape'): void => {
      for (let bucket = 0; bucket < 12; bucket++) {
        const sim = atFortress(4242, 0);
        sim.state.credits = 5000;
        const p = sim.state.player.body.pos;
        const group = `ab:rg:A:9.9@${bucket}`;
        sim.state.combat.enemies = [
          createEnemy({ id: `${group}:0`, kind: 'hammer', tier: 1, pos: add(p, { x: 100, y: 0 }), angle: Math.PI, home: add(p, { x: 100, y: 0 }), orbit: 1 }),
          createEnemy({ id: `${group}:1`, kind: 'jackal', tier: 1, pos: add(p, { x: 110, y: 12 }), angle: Math.PI, home: add(p, { x: 100, y: 0 }), orbit: -1 }),
        ];
        if (ofType(run(sim, 3), 'tollDemanded').length === 0) continue;
        // still demanded a while later
        run(sim, 30);
        expect(sim.state.pirates.toll?.group).toBe(group);
        const party = () => sim.state.combat.enemies.filter((e) => e.id.startsWith(`${group}:`));
        if (answer === 'pay') {
          expect(ofType(run(sim, 1, { toll: 'pay' }), 'tollPaid')[0]).toMatchObject({ group });
          expect(sim.state.pirates.paid.has(group)).toBe(true);
          expect(party().every((e) => e.calm === true)).toBe(true);
          expect(ofType(run(sim, 300), 'shotFired').filter((e) => e.owner.startsWith(`${group}:`))).toHaveLength(0);
        } else if (answer === 'refuse') {
          expect(ofType(run(sim, 1, { toll: 'refuse' }), 'tollRefused')[0]).toMatchObject({ group, timeout: false });
          expect(party().every((e) => e.ai.mode === 'attack')).toBe(true);
        } else {
          const at = sim.state.player.body.pos;
          sim.state.player.body = { ...sim.state.player.body, pos: { x: at.x - 400, y: at.y } };
          expect(ofType(run(sim, 1), 'tollEscaped')[0]).toMatchObject({ group });
        }
        return;
      }
      throw new Error('no ambush party hailed');
    };
    hail('pay');
    hail('refuse');
    hail('escape');
  });

  it('a sentry never hails', () => {
    const sim = atFortress(4242, 0);
    const p = sim.state.player.body.pos;
    const home = add(p, { x: 60, y: 0 });
    sim.state.combat.enemies = [0, 1, 2].map((i) => createEnemy({ id: `dd:7,7:${i}`, kind: 'sentry', tier: 1, pos: add(home, { x: 0, y: 10 * i }), angle: Math.PI, home, orbit: 1 }));
    const events = run(sim, 120);
    expect(ofType(events, 'enemyAlert').length).toBeGreaterThan(0);
    expect(ofType(events, 'tollDemanded')).toHaveLength(0);
    expect(sim.state.pirates.toll).toBeNull();
  });
});

describe('Gunners in hunting parties (M4b §2.6 b)', () => {
  it('a party out of a depth-2 Pirate sector swaps one Jackal for a Gunner; elsewhere it stays as before', () => {
    let withGunner = 0;
    let without = 0;
    for (const seed of [4242, 1, 2, 3, 42]) {
      for (let index = 0; index < fortressSites(seed).length; index++) {
        const sim = atFortress(seed, index);
        sim.state.pirates.attention = 65;
        const hunt = ofType(run(sim, 2), 'huntingParty')[0];
        if (!hunt) continue;
        const party = sim.state.combat.enemies.filter((e) => e.id.startsWith('hp:'));
        const expected = sectorInfoAt(seed, hunt.pos.x, hunt.pos.y).depth === GUNNER.huntDepth && securityHere(sim.state, hunt.pos) === 'pirate';
        // the party size never changes
        expect(party.length).toBe(HUNT.jackals + (hunt.captain === null ? 1 : 0));
        const gunners = party.filter((e) => e.kind === 'gunner');
        if (expected) {
          withGunner++;
          expect(gunners).toHaveLength(1);
          expect(party.filter((e) => e.kind === 'jackal')).toHaveLength(HUNT.jackals - 1);
          expect(gunners[0]!.ai.mode).toBe('attack');
        } else {
          without++;
          expect(gunners).toHaveLength(0);
        }
      }
    }
    expect(withGunner).toBeGreaterThan(0);
    expect(withGunner + without).toBeGreaterThan(3);
  });
});

describe('Gunners among fortress reinforcements (M4b §2.6 c)', () => {
  it('every 3rd reinforcement is a Gunner', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(reinforcementKind)).toEqual(['jackal', 'jackal', 'gunner', 'jackal', 'jackal', 'gunner', 'jackal', 'jackal', 'gunner']);
  });

  it('the fortress launches them in that order', () => {
    const seed = 4242;
    const f = fortressSites(seed)[0]!;
    const sim = flyingAt(seed, fortressToWorld(f, rotate({ x: -60, y: 0 }, 0)), fighter());
    const kinds = new Map<string, string>();
    for (let i = 0; i < 400 && kinds.size < 4; i++) {
      sim.state.player.hp.clear();
      sim.state.player.shield = sim.state.player.props.shield.capacity;
      run(sim, 30);
      for (const e of sim.state.combat.enemies) if (e.id.startsWith(`fr:${f.index}:`)) kinds.set(e.id, e.kind);
      // make room for the next wave (at most three alive)
      sim.state.combat.enemies = sim.state.combat.enemies.filter((e) => !e.id.startsWith(`fr:${f.index}:`));
    }
    expect(kinds.get(`fr:${f.index}:0`)).toBe('jackal');
    expect(kinds.get(`fr:${f.index}:1`)).toBe('jackal');
    expect(kinds.get(`fr:${f.index}:2`)).toBe('gunner');
    expect(kinds.get(`fr:${f.index}:3`)).toBe('jackal');
  });
});

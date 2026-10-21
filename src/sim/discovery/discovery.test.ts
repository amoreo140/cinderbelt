import { describe, expect, it } from 'vitest';
import { ANOMALIES, CACHE, DATA_REWARDS, GIANT_SHELL_HP, GRAVITY_PULL } from '../../data/poi';
import { cargoMass } from '../../data/resources';
import { SCANNER } from '../../data/scanner';
import { PITY_MAX_MISSES } from '../../data/plans';
import { DISTRESS } from '../../data/events';
import { IDLE_COMMAND } from '../commands';
import { length, sub, type Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import { act, dockedSim, expectFailure, expectOk } from '../station/testHarness';
import { partUnlocked } from './archive';
import { distressAt, distressBucket, ionStormAt } from './events';
import { echoSites } from './poi';
import { awardFragment, rollFragment } from './plans';
import { pulseCooldownTicks } from './scanner';
import { shellHp } from './giants';
import { findPoi, flyingAt, holdScan, ofType, run, tapScan, teleport } from './testing';
import { hasJournal } from './state';

const SEED = 4242;

describe('scanner pulse (5.4)', () => {
  it('a tap sends a pulse for 15 energy, then the scanner recharges', () => {
    const sim = flyingAt(SEED, { x: 700, y: 0 });
    const energy = sim.state.player.energy;
    const events = tapScan(sim);
    expect(ofType(events, 'scanPulse')).toHaveLength(1);
    expect(sim.state.player.energy).toBeLessThan(energy - SCANNER.pulseEnergy + 1);
    expect(sim.state.discovery.scanner.cooldown).toBeGreaterThan(0);
    expect(ofType(tapScan(sim), 'scanFailed')[0]?.reason).toBe('cooldown');
    run(sim, pulseCooldownTicks(sim.state));
    expect(ofType(tapScan(sim), 'scanPulse')).toHaveLength(1);
    expect(hasJournal(sim.state, 'scanner')).toBe(true);
  });

  it('needs 15 energy', () => {
    const sim = flyingAt(SEED, { x: 700, y: 0 });
    sim.state.player.energy = 5;
    const failed = ofType(tapScan(sim), 'scanFailed')[0];
    expect(failed).toMatchObject({ reason: 'energy', required: SCANNER.pulseEnergy });
    expect(failed?.available).toBeGreaterThanOrEqual(5); // the reactor recharges during the tap
    expect(failed?.available).toBeLessThan(SCANNER.pulseEnergy);
  });

  it('shows a signal with an uncertainty circle; flying close answers it', () => {
    const anomaly = findPoi(SEED, 'anomaly');
    const from = { x: anomaly.pos.x + 400, y: anomaly.pos.y };
    const sim = flyingAt(SEED, from);
    tapScan(sim);
    const signal = sim.state.discovery.signals.find((s) => s.id === anomaly.id)!;
    expect(signal).toBeDefined();
    expect(signal.kind).toBe('anomaly');
    expect(signal.radius).toBeCloseTo(400 * SCANNER.signalRadiusFactor, 0);
    expect(length(sub(signal.pos, anomaly.pos))).toBeLessThanOrEqual(signal.radius);
    expect(sim.state.discovery.known.has(anomaly.id)).toBe(false);
    teleport(sim, { x: anomaly.pos.x + 80, y: anomaly.pos.y });
    const events = run(sim, SCANNER.discoverInterval + 1);
    expect(ofType(events, 'poiDiscovered').map((e) => e.id)).toContain(anomaly.id);
    expect(sim.state.discovery.signals.some((s) => s.id === anomaly.id)).toBe(false);
  });
});

describe('caches – triangulation (5.3.4)', () => {
  it('each pulse from a new place shrinks the circle; after 4 the cache appears and opens with F', () => {
    const cache = findPoi(SEED, 'cache');
    const around = (a: number): Vec2 => ({ x: cache.pos.x + Math.cos(a) * 250, y: cache.pos.y + Math.sin(a) * 250 });
    const sim = flyingAt(SEED, around(0));
    const fix = () => sim.state.discovery.fixes.get(cache.id)!;
    tapScan(sim);
    expect(fix().radius).toBe(CACHE.firstRadius);
    // the same spot changes nothing
    run(sim, pulseCooldownTicks(sim.state));
    tapScan(sim);
    expect(fix().pulses).toHaveLength(1);
    let located = false;
    for (const a of [1.3, 2.6, 3.9]) {
      teleport(sim, around(a));
      run(sim, pulseCooldownTicks(sim.state));
      sim.state.player.energy = sim.state.player.props.batteryCapacity;
      located = ofType(tapScan(sim), 'cacheLocated').length > 0 || located;
    }
    expect(located).toBe(true);
    expect(sim.state.discovery.known.has(cache.id)).toBe(true);
    expect(sim.state.discovery.dataTotal).toBeGreaterThanOrEqual(DATA_REWARDS.cache);
    teleport(sim, { x: cache.pos.x - 6, y: cache.pos.y });
    const credits = sim.state.credits;
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'cacheOpened')).toHaveLength(1);
    expect(sim.state.credits).toBeGreaterThan(credits);
    expect(sim.state.discovery.opened.has(cache.id)).toBe(true);
    expect(hasJournal(sim.state, 'cacheFound')).toBe(true);
  });
});

describe('analysis (hold Tab)', () => {
  it('scans an anomaly once for Data and a journal entry', () => {
    const anomaly = findPoi(SEED, 'anomaly');
    const sim = flyingAt(SEED, { x: anomaly.pos.x + 70, y: anomaly.pos.y });
    const events = holdScan(sim, anomaly.pos);
    expect(ofType(events, 'analysisStarted')).toHaveLength(1);
    const done = ofType(events, 'analysisDone');
    expect(done).toEqual([{ type: 'analysisDone', target: anomaly.id, kind: 'anomaly', data: DATA_REWARDS.anomaly[anomaly.ring], first: true }]);
    expect(sim.state.discovery.dataFund).toBe(DATA_REWARDS.anomaly[anomaly.ring]);
    expect(hasJournal(sim.state, 'anomalies')).toBe(true);
    expect(sim.state.discovery.atlas.has(`anomalies:${anomaly.type}`)).toBe(true);
    const again = ofType(holdScan(sim, anomaly.pos), 'analysisDone');
    expect(again[0]).toMatchObject({ first: false, data: 0 });
  });

  it('releasing early cancels; nothing in range = no target', () => {
    const anomaly = findPoi(SEED, 'anomaly');
    const sim = flyingAt(SEED, { x: anomaly.pos.x + 70, y: anomaly.pos.y });
    const events = [...run(sim, 60, { scan: true, aim: anomaly.pos }), ...run(sim, 1)];
    expect(ofType(events, 'analysisCancelled')).toHaveLength(1);
    expect(ofType(events, 'analysisDone')).toHaveLength(0);
    // far from everything (empty space near home)
    const empty = flyingAt(SEED, { x: 0, y: 0 });
    expect(ofType(holdScan(empty, { x: 30, y: 30 }), 'scanFailed')[0]?.reason).toBe('noTarget');
  });
});

describe('Echo-0 (5.7.2, 10.10)', () => {
  it('three pulses from different places locate Echo-0', () => {
    const echo = echoSites(SEED)[0]!;
    const sim = flyingAt(SEED, { x: 0, y: 0 });
    const spots: Vec2[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }];
    const events = [];
    for (const p of spots) {
      teleport(sim, p);
      run(sim, pulseCooldownTicks(sim.state));
      sim.state.player.energy = sim.state.player.props.batteryCapacity;
      events.push(...tapScan(sim), ...run(sim, 2));
    }
    const heard = ofType(events, 'echoHeard');
    expect(heard.map((e) => e.fixes)).toEqual([1, 2, 3]);
    expect(heard.at(-1)!.located).toBe(true);
    expect(sim.state.discovery.known.has('echo:0')).toBe(true);
    expect(hasJournal(sim.state, 'echo0Heard')).toBe(true);
    // Echo-0 analysed → 100 Data, a log entry and a hidden Archive node
    teleport(sim, { x: echo.pos.x + 40, y: echo.pos.y });
    const done = ofType(holdScan(sim, echo.pos), 'analysisDone');
    expect(done[0]).toMatchObject({ target: 'echo:0', data: DATA_REWARDS.echo });
    expect(hasJournal(sim.state, 'echo0')).toBe(true);
    expect(hasJournal(sim.state, 'decoder')).toBe(true);
  });

  it('Echo-1 stays silent without the decoder and Echo-2 without the shard', () => {
    const sites = echoSites(SEED);
    const sim = flyingAt(SEED, { x: sites[1]!.pos.x * 0.8, y: sites[1]!.pos.y * 0.8 });
    expect(ofType(tapScan(sim), 'echoHeard').filter((e) => e.echo === 1)).toHaveLength(0);
    sim.state.discovery.archive.add('echoDecoder');
    run(sim, pulseCooldownTicks(sim.state));
    sim.state.player.energy = sim.state.player.props.batteryCapacity;
    expect(ofType(tapScan(sim), 'echoHeard').filter((e) => e.echo === 1)).toHaveLength(1);
    teleport(sim, { x: sites[2]!.pos.x * 0.85, y: sites[2]!.pos.y * 0.85 });
    run(sim, pulseCooldownTicks(sim.state));
    sim.state.player.energy = sim.state.player.props.batteryCapacity;
    expect(ofType(tapScan(sim), 'echoHeard').filter((e) => e.echo === 2)).toHaveLength(0);
    sim.state.discovery.keyItems.add('shard');
    run(sim, pulseCooldownTicks(sim.state));
    sim.state.player.energy = sim.state.player.props.batteryCapacity;
    expect(ofType(tapScan(sim), 'echoHeard').filter((e) => e.echo === 2)).toHaveLength(1);
    expect(hasJournal(sim.state, 'ruleResonance')).toBe(true);
  });
});

describe('Archive (3.2.4)', () => {
  it('buys nodes with Data and credits, in order, and gates the M2d parts', () => {
    const sim = dockedSim();
    sim.state.credits = 5000;
    expect(partUnlocked(sim.state, 'battery:1')).toBe(false);
    expectFailure(sim, { type: 'craft', key: 'battery:1', count: 1 }, 'partLocked');
    expectFailure(sim, { type: 'archiveBuy', node: 'battery' }, 'notEnoughData');
    sim.state.discovery.dataTotal = 400;
    sim.state.discovery.dataFund = 400;
    // level 2 only after level 1 in the branch
    expectFailure(sim, { type: 'archiveBuy', node: 'heavyLaser' }, 'archiveLocked');
    const events = act(sim, { type: 'archiveBuy', node: 'battery' });
    expectOk(events);
    expect(ofType(events, 'archiveBought')).toEqual([{ type: 'archiveBought', node: 'battery' }]);
    expect(sim.state.discovery.dataFund).toBe(380);
    expect(sim.state.credits).toBe(4800);
    expect(partUnlocked(sim.state, 'battery:2')).toBe(true);
    expectOk(act(sim, { type: 'archiveBuy', node: 'heavyLaser' }));
    expect(partUnlocked(sim.state, 'heavyLaser:1')).toBe(true);
    // M4c: the on-board refinery (Mining 2) is a part node now
    expect(partUnlocked(sim.state, 'refinery:1')).toBe(false);
    expectOk(act(sim, { type: 'archiveBuy', node: 'refinery' }));
    expect(partUnlocked(sim.state, 'refinery:2')).toBe(true);
    // Logistics: the Institute 2 licence; later content; a hidden node
    expectFailure(sim, { type: 'archiveBuy', node: 'instituteLicense' }, 'archiveLocked');
    expectFailure(sim, { type: 'archiveBuy', node: 'resonantLaser' }, 'archiveLocked');
    expectFailure(sim, { type: 'archiveBuy', node: 'echoDecoder' }, 'archiveLocked');
    sim.state.discovery.journal.push({ id: 'echo0', tick: 0 });
    expectOk(act(sim, { type: 'archiveBuy', node: 'echoDecoder' }));
    expectFailure(sim, { type: 'archiveBuy', node: 'echoDecoder' }, 'archiveLocked');
  });

  it('variants need their plan or node to be crafted', () => {
    const sim = dockedSim();
    sim.state.credits = 99999;
    sim.state.stations.get('home')!.resources.iron = 500;
    sim.state.stations.get('home')!.resources.copper = 500;
    expectFailure(sim, { type: 'craft', key: 'engine:1:overdrive', count: 1 }, 'partLocked');
    sim.state.discovery.plans.add('overdrive');
    expectOk(act(sim, { type: 'craft', key: 'engine:1:overdrive', count: 1 }));
    expect(sim.state.stations.get('home')!.parts['engine:1:overdrive']).toBe(1);
  });
});

describe('fragments and plans (3.2.3)', () => {
  it('bad luck protection: never more than 5 misses in a row from one source', () => {
    const sim = dockedSim();
    let misses = 0;
    let found = 0;
    for (let i = 0; i < 60; i++) {
      const plan = rollFragment(sim.state, 'miner', `wreck:test${i}`);
      if (plan) {
        found++;
        misses = 0;
      } else misses++;
      expect(misses).toBeLessThanOrEqual(PITY_MAX_MISSES);
    }
    expect(found).toBeGreaterThan(8);
    // deterministic: the same state and id = the same result
    const a = dockedSim();
    const b = dockedSim();
    expect(rollFragment(a.state, 'pirate', 'x')).toBe(rollFragment(b.state, 'pirate', 'x'));
  });

  it('three fragments make a plan; a duplicate turns into 30 Data', () => {
    const sim = dockedSim();
    const events: Parameters<typeof awardFragment>[2] = [];
    awardFragment(sim.state, 'eco', events);
    awardFragment(sim.state, 'eco', events);
    expect(sim.state.discovery.fragments.get('eco')).toBe(2);
    awardFragment(sim.state, 'eco', events);
    expect(sim.state.discovery.plans.has('eco')).toBe(true);
    expect(sim.state.discovery.fragments.has('eco')).toBe(false);
    expect(partUnlocked(sim.state, 'engine:2:eco')).toBe(true);
    awardFragment(sim.state, 'eco', events);
    expect(ofType(events, 'fragmentFound').map((e) => [e.count, e.complete, e.duplicate])).toEqual([
      [1, false, false],
      [2, false, false],
      [3, true, false],
      [3, true, true],
    ]);
    expect(sim.state.discovery.dataFund).toBe(DATA_REWARDS.duplicateFragment);
    expect(hasJournal(sim.state, 'plans')).toBe(true);
  });
});

const heavyShip = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['heavyLaser', 1, 0],
    ['miningLaser', 1, 1],
    ['reactor', -1, 0],
    ['reactor', 0, 1],
    ['cargo', 0, -1],
    ['engine', -1, 1],
  ]);

describe('giant asteroids (5.3)', () => {
  it('only the heavy laser breaks the shell, then the core is mined', () => {
    const giant = findPoi(SEED, 'giant');
    const sim = flyingAt(SEED, { x: giant.pos.x - 22, y: giant.pos.y }, heavyShip());
    const events = run(sim, 60 * 6, { mining: true, aim: giant.pos });
    const left = shellHp(sim.state, giant.id);
    expect(left).toBeLessThan(GIANT_SHELL_HP);
    const all = [...events, ...run(sim, 60 * 25, { mining: true, aim: giant.pos })];
    expect(ofType(all, 'giantBroken')).toHaveLength(1);
    expect(shellHp(sim.state, giant.id)).toBe(0);
    for (const r of ['iron', 'copper', 'ice', 'titanium'] as const) sim.state.player.cargo[r] = 0;
    const before = 0;
    teleport(sim, { x: giant.pos.x - 16, y: giant.pos.y });
    run(sim, 60, { mining: true, aim: giant.pos });
    expect(sim.state.player.cargo[giant.resource]).toBeGreaterThan(before);
    expect(hasJournal(sim.state, 'giantCore')).toBe(true);
  });

  it('an ordinary mining laser does not scratch the shell', () => {
    const giant = findPoi(SEED, 'giant');
    const sim = flyingAt(SEED, { x: giant.pos.x - 22, y: giant.pos.y });
    run(sim, 120, { mining: true, aim: giant.pos });
    expect(shellHp(sim.state, giant.id)).toBe(GIANT_SHELL_HP);
  });
});

describe('anomalies (5.3, 5.5)', () => {
  it('a gravity anomaly pulls and its core gives the sling once per 5 minutes', () => {
    const g = findPoi(SEED, 'anomaly', (a) => a.type === 'gravity');
    const sim = flyingAt(SEED, { x: g.pos.x + 45, y: g.pos.y });
    sim.state.player.dampers = false;
    run(sim, 30);
    expect(sim.state.player.body.vel.x).toBeLessThan(-0.5);
    teleport(sim, { x: g.pos.x + 2, y: g.pos.y });
    const events = run(sim, 2);
    expect(ofType(events, 'buffGained')).toEqual([{ type: 'buffGained', buff: 'sling', seconds: 15 }]);
    teleport(sim, { x: g.pos.x + 2, y: g.pos.y });
    expect(ofType(run(sim, 2), 'buffGained')).toHaveLength(0);
    expect(hasJournal(sim.state, 'ruleSling')).toBe(true);
  });

  it('a starter ship with a full hold escapes a gravity well from the core edge at full thrust (F3)', () => {
    const g = findPoi(SEED, 'anomaly', (a) => a.type === 'gravity');
    const sim = flyingAt(SEED, { x: g.pos.x + ANOMALIES.gravity.core, y: g.pos.y });
    const p = sim.state.player;
    p.cargo.iron = p.props.cargoCapacity;
    // the pull must stay below the laden starter's own acceleration
    expect(GRAVITY_PULL).toBeLessThan(p.props.thrust.forward / (p.props.mass + cargoMass(p.cargo)));
    run(sim, 60 * 20, { flight: { forward: 1, strafe: 0, turn: 0 } });
    expect(length(sub(p.body.pos, g.pos))).toBeGreaterThan(ANOMALIES.gravity.field);
  });

  it('the ion core drops the shield and fills the battery', () => {
    const ion = findPoi(SEED, 'anomaly', (a) => a.type === 'ion');
    const sim = flyingAt(SEED, { x: ion.pos.x + 1, y: ion.pos.y });
    sim.state.player.energy = 0;
    run(sim, 1);
    expect(sim.state.player.energy).toBeGreaterThan(sim.state.player.props.batteryCapacity - 1);
    expect(sim.state.discovery.buffs[0]?.kind).toBe('charge');
  });
});

describe('wreck POIs (5.3.1)', () => {
  it('appear near the player, carry loot once and are remembered as looted', () => {
    // a small wreck is loaded whole (medium and large ones are salvaged since M3.6)
    const poi = findPoi(SEED, 'wreck', (p) => p.size === 0);
    const sim = flyingAt(SEED, { x: poi.pos.x + 200, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const w = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    expect(w).toBeDefined();
    expect(w.id).toBeLessThan(0);
    teleport(sim, { x: w.body.pos.x - w.props.boundingRadius - 4, y: w.body.pos.y });
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'salvaged')).toHaveLength(1);
    expect(sim.state.discovery.opened.has(poi.id)).toBe(true);
    teleport(sim, { x: poi.pos.x + 2000, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    expect(sim.state.combat.wrecks.some((x) => x.poi === poi.id)).toBe(false);
    teleport(sim, { x: poi.pos.x + 200, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const again = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    expect(Object.keys(again.loot.parts)).toHaveLength(0);
  });
});

/** The first distress signal of the given kind (chunk, segment). */
function findDistress(kind: 'fuel' | 'repair' | 'trap') {
  for (let b = 0; b < 400; b++) {
    for (let cx = -14; cx < 14; cx++) for (let cy = -14; cy < 14; cy++) {
      const d = distressAt(SEED, cx, cy, b);
      if (d && d.kind === kind) return { d, bucket: b };
    }
  }
  throw new Error('no distress');
}

describe('distress signals (5.3.5)', () => {
  it('a stranded miner is heard and helped with fuel for credits and guild reputation', () => {
    const { d, bucket } = findDistress('fuel');
    const sim = flyingAt(SEED, { x: d.pos.x + 300, y: d.pos.y });
    sim.state.tick = bucket * DISTRESS.bucketSeconds * 60 + 10 - ((bucket * DISTRESS.bucketSeconds * 60 + 10) % SCANNER.discoverInterval) + SCANNER.discoverInterval;
    expect(distressBucket(sim.state.tick)).toBe(bucket);
    const heard = run(sim, SCANNER.discoverInterval);
    expect(ofType(heard, 'distressHeard').map((e) => e.id)).toContain(d.id);
    teleport(sim, { x: d.pos.x - DISTRESS.shipRadius - sim.state.player.props.boundingRadius - 4, y: d.pos.y });
    const credits = sim.state.credits;
    const fuel = sim.state.player.fuel;
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'distressResolved')).toHaveLength(1);
    expect(sim.state.credits).toBeGreaterThan(credits);
    expect(sim.state.player.fuel).toBeCloseTo(fuel - d.fuel, 0);
    expect(sim.state.career.rep.guild.points).toBe(DISTRESS.rep);
  });

  it('a trap springs an ambush when the ship comes close', () => {
    const { d, bucket } = findDistress('trap');
    const sim = flyingAt(SEED, { x: d.pos.x + 60, y: d.pos.y });
    sim.state.tick = bucket * DISTRESS.bucketSeconds * 60 + SCANNER.discoverInterval * 2;
    const events = run(sim, SCANNER.discoverInterval + 1);
    expect(ofType(events, 'distressAmbush')).toHaveLength(1);
    expect(sim.state.combat.enemies.filter((e) => e.id.startsWith('amb:'))).toHaveLength(DISTRESS.ambushShips);
  });
});

describe('ion storms (5.5)', () => {
  it('are deterministic and knock the shield out while they last', () => {
    let found: { pos: Vec2; tick: number } | null = null;
    for (let t = 0; t < 200 && !found; t++) {
      const tick = t * 3 * 60 * 60 + 90 * 60;
      for (const pos of [{ x: 2500, y: 0 }, { x: 0, y: 2600 }, { x: -2600, y: 300 }]) {
        if (ionStormAt(SEED, pos, tick)) {
          found = { pos, tick };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    expect(ionStormAt(SEED, found!.pos, found!.tick)).toBe(true);
    const sim = flyingAt(SEED, found!.pos, createGrid([['cockpit', 0, 0], ['shield', 1, 0], ['reactor', -1, 0], ['engine', 0, 1]]));
    sim.state.tick = found!.tick;
    sim.state.player.shield = 50;
    sim.step(IDLE_COMMAND);
    expect(sim.state.player.shield).toBe(0);
  });
});

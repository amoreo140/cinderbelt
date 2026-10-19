// Saboteur / exploiter mode of the balance bot (tools/bot/saboteur): harness checks run by default;
// the multi-seed suite is opt-in: BOT_SLOW=1 npm run test:bot. The findings themselves are
// reproduced in findings.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { COMET, DERELICT, GRAVEYARD } from '../../src/data/sites';
import { flyingAt } from '../../src/sim/discovery/testing';
import { directorAction } from '../../src/sim/events/director';
import { siteProbes } from './saboteur/sites';
import { shapeProbes } from './saboteur/shapes';
import { homeProbes } from './saboteur/home';
import { GUILD_PROBE_IDS, guildProbes } from './saboteur/guild';
import { guildAction } from '../../src/sim/guild';
import { CONVOY, ESCORT } from '../../src/data/convoys';
import { HOME_MODULES } from '../../src/data/home';
import { INSTALL_FEE } from '../../src/data/economy';
import { computeProperties } from '../../src/sim/ship/properties';
import { envVar } from './node';
import { cloneSim, Driver, newGame } from './saboteur/harness';
import { fleetProbes } from './saboteur/fleet';
import { buildSaboteurReport } from './saboteur/report';
import { chartFarm, coverageFarm, liquidate, scuttleFarm } from './saboteur/scenarios';
import { chaosRun, oracle } from './saboteur/softlock';
import { runSaboteurSeed } from './saboteur/suite';
import { netWorth } from './saboteur/value';
import { trainingFarm, trainingRewardValue } from './saboteur/training';

describe('saboteur – Guild Training (M3.7)', () => {
  it('selling every training reward never gains more than the rewards themselves, nothing pays twice', () => {
    for (const penalty of ['mild', 'hard'] as const) {
      const r = trainingFarm(3, penalty);
      expect(r.exploit, r.detail).toBe(false);
      expect(r.gain, r.detail).toBeLessThanOrEqual(trainingRewardValue() + (r.metrics?.mined ?? 0) + 1);
      expect(r.metrics?.skipAgain).toBe(0);
      expect(r.metrics?.skipFromCopy).toBe(0);
      expect(r.metrics?.loans ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('saboteur – hangar, fleet and templates (M4a)', () => {
  it('every fleet probe gains nothing', () => {
    const probes = fleetProbes(3);
    expect(probes.map((p) => p.id)).toEqual(['fleetSwitch', 'fleetLaunder', 'fleetLoan', 'fleetHardHull', 'fleetCrafted', 'fleetTemplates', 'fleetSaveCopy']);
    for (const p of probes) expect(p.exploit, `${p.id}: ${p.detail}`).toBe(false);
    const by = Object.fromEntries(probes.map((p) => [p.id, p]));
    // the probes really ran their loops (not a vacuous pass)
    expect(by.fleetSwitch!.metrics?.switches).toBe(12);
    expect(by.fleetSwitch!.metrics?.firstSale ?? 0).toBeGreaterThan(0);
    expect(by.fleetLaunder!.metrics?.fee ?? 0).toBeGreaterThan(0);
    expect(by.fleetLaunder!.metrics?.fee).toBe(by.fleetLaunder!.metrics?.shipyardFee);
    expect(by.fleetLoan!.metrics?.loansWhileFlyable).toBe(0);
    expect(by.fleetLoan!.metrics?.returned ?? 0).toBeGreaterThan(0);
    expect(by.fleetHardHull!.metrics?.dissolved).toBe(1);
    expect(by.fleetHardHull!.gain).toBeLessThan(0);
    expect(by.fleetCrafted!.metrics).toMatchObject({ slot1: 5000, slot2: 15000 });
    expect(by.fleetTemplates!.metrics?.lockedTried ?? 0).toBeGreaterThan(0);
    expect(by.fleetTemplates!.metrics?.rebuildPaid ?? 0).toBeGreaterThan(0);
  });

  it('net worth counts the ships stored in the hangar', () => {
    const d = new Driver(newGame(3, 'mild'));
    d.state.credits += 20_000;
    const before = netWorth(d.state);
    expect(d.act({ type: 'hangarBuySlot' })).toBe(true);
    expect(d.act({ type: 'hangarNewShip', cockpit: 'cockpit:1', acquire: 'buy' })).toBe(true);
    const after = netWorth(d.state);
    // the parked starter (intact, empty hold) is worth what it was worth as the active ship
    expect(d.state.fleet.stored).toHaveLength(1);
    expect(after.hangar).toBeCloseTo(before.ship, 6);
  });
});

describe('saboteur – coverage farm (sectors 1b)', () => {
  it('charting a sector pays once; re-flying its chunks, also after save → load, pays nothing', () => {
    const r = coverageFarm(3, 8 * 60);
    expect(r.exploit, r.detail).toBe(false);
    expect(r.metrics?.firstLapData ?? 0, r.detail).toBeGreaterThan(0);
    expect(r.metrics?.laps ?? 0, r.detail).toBeGreaterThan(2);
  });
});

describe('saboteur – chart farm (sectors 2)', () => {
  it('a chart sells once, a bought chart never, the contract covers the sale, survey points pay once', () => {
    const r = chartFarm(3);
    expect(r.exploit, r.detail).toBe(false);
    expect(r.metrics?.charted, r.detail).toBe(1);
    expect(r.metrics?.saleGain, r.detail).toBe(r.metrics?.price);
    expect(r.metrics?.bought, r.detail).toBe(1);
    expect(r.metrics?.contractReward ?? 0, r.detail).toBeGreaterThan(0);
  });
});

describe('saboteur harness', () => {
  it('strips the ship to the smallest valid hull and sells every part', () => {
    const d = new Driver(newGame(2, 'mild'));
    const removed = d.stripToMinimum();
    expect(removed).toBeGreaterThan(5);
    const props = computeProperties(d.state.player.grid);
    expect(props.thrust.forward).toBeGreaterThan(0);
    expect(d.state.player.grid.parts.some((p) => p.partId === 'cockpit')).toBe(true);
    const worth = netWorth(d.state).total;
    d.sellStorageParts();
    expect(Object.values(d.state.stations.get('home')!.parts).every((n) => !n)).toBe(true);
    expect(netWorth(d.state).total).toBeCloseTo(worth, 6); // selling is neutral at liquidation value
  });

  it('burns credits on round-trips and keeps nothing of value', () => {
    const d = new Driver(newGame(2, 'mild'));
    liquidate(d);
    expect(d.state.credits).toBeLessThan(10);
    expect(netWorth(d.state).total).toBeLessThan(netWorth(newGame(2, 'mild').state).total / 2);
  });

  it('a save → restore copy plays on identically', () => {
    const a = new Driver(newGame(4, 'mild'));
    a.undock();
    a.flyTo({ x: 200, y: 50 }, { seconds: 20 });
    const b = new Driver(cloneSim(a.sim));
    a.idle(5);
    b.idle(5);
    expect(b.state.tick).toBe(a.state.tick);
    expect(b.state.player.body).toEqual(a.state.player.body);
    expect(b.state.credits).toBe(a.state.credits);
  });

  it('scenarios are deterministic for a seed', () => {
    expect(scuttleFarm(3, 'hard', 120)).toEqual(scuttleFarm(3, 'hard', 120));
  });

  it('the recovery oracle finds a fresh game recoverable', () => {
    const o = oracle(newGame(5, 'mild'), 5 * 60, 6 * 60);
    expect(o.stuck).toBe(false);
    expect(o.attempts[0]!.note).toBe('ore sold');
  });
});

// Slow: two seeds × the whole suite (≈ 1–2 min). Opt-in: BOT_SLOW=1 npm run test:bot
describe.skipIf(!envVar('BOT_SLOW'))('saboteur – slow multi-seed suite', () => {
  it('runs every scenario, judges every random sequence and builds the report', () => {
    const reports = [1, 2].map((seed) => runSaboteurSeed(seed, { hours: 0.5, chaosRuns: 2 }));
    for (const r of reports) {
      expect(r.loops.length).toBeGreaterThan(10);
      expect(r.recoveries).toHaveLength(4);
      for (const c of [...r.chaos, ...r.targeted]) expect(c.attempts.length).toBeGreaterThan(0);
    }
    const md = buildSaboteurReport(reports, { hours: 0.5, chaosRuns: 2, chaosPenalties: ['mild', 'none', 'hard'], wallSeconds: 0 });
    expect(md).toContain('## Findings: before → after');
    expect(md).toContain('## Rules implemented');
    // the Guild loan, the scuttle cost, the quote floor and the W1 refined price ceiling hold on these seeds too
    for (const l of reports.flatMap((r) => r.loops)) expect(l.exploit, `${l.id} ${l.penalty} seed ${l.seed}: ${l.detail}`).toBe(false);
  });

  it('a random adversarial sequence is reproducible from its seed and run number', () => {
    const a = chaosRun(3, 'mild', 1);
    const b = chaosRun(3, 'mild', 1);
    expect(b.moves).toEqual(a.moves);
    expect(b.stuck).toBe(a.stuck);
    expect(b.tick).toBe(a.tick);
  });
});

describe('saboteur – world sites and events (M4b)', () => {
  it('every site probe gains nothing and really ran', () => {
    const probes = siteProbes(3);
    expect(probes.map((p) => p.id)).toEqual(['siteTerminal', 'graveyardFarm', 'cometBudget', 'relayCharge', 'mineFarm', 'eventTriggers']);
    for (const p of probes) expect(p.exploit, `${p.id}: ${p.detail}`).toBe(false);
    const by = Object.fromEntries(probes.map((p) => [p.id, p]));
    // the terminal paid its Data once per derelict and every item was taken once
    expect(by.siteTerminal!.metrics).toMatchObject({ stashData: DERELICT.data, planData: DERELICT.data, fabricatorData: DERELICT.data });
    expect(by.siteTerminal!.metrics?.stashTaken).toBe(by.siteTerminal!.metrics?.stashItems);
    expect(by.siteTerminal!.metrics?.fabricatorTaken).toBe(1);
    expect(by.graveyardFarm!.metrics).toMatchObject({ first: GRAVEYARD.data, second: 0, again: 0, fromCopy: 0, refill: 0, copyRefill: 0 });
    expect(by.graveyardFarm!.metrics?.rolls).toBeLessThanOrEqual(GRAVEYARD.fragmentRolls);
    expect(by.graveyardFarm!.metrics?.gained ?? 0).toBeGreaterThan(0);
    // the comet probe mined the whole nucleus budget (not a vacuous pass)
    expect(by.cometBudget!.metrics?.core).toBeCloseTo(COMET.budget * COMET.grade, 0);
    expect(by.relayCharge!.metrics?.powered).toBe(1);
    expect(by.mineFarm!.metrics?.blown2).toBe(0);
  });

  it('debugEvent (forced showers and ambushes) is refused in a production build', () => {
    vi.stubEnv('DEV', false);
    try {
      const sim = flyingAt(3, { x: 0, y: 2200 });
      for (const kind of ['micrometeors', 'ambush'] as const) {
        expect(directorAction(sim.state, { type: 'debugEvent', kind, reqId: 1 })[0]).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('saboteur – shaped armour (SL2 E2)', () => {
  it('every shape probe gains nothing and really ran', () => {
    const probes = shapeProbes(3);
    expect(probes.map((p) => p.id)).toEqual(['shapeReshape', 'shapeRepairSurvey', 'shapeRemoveDamaged', 'shapeLoot', 'shapeCrafted', 'shapeTemplates', 'shapeMirror']);
    for (const p of probes) expect(p.exploit, `${p.id}: ${p.detail}`).toBe(false);
    const by = Object.fromEntries(probes.map((p) => [p.id, p]));
    // reshapes: every shape twice, one fee each; damaged plates refused unless the max HP stays
    expect(by.shapeReshape!.metrics).toMatchObject({ reshapes: 20, fees: 20 * INSTALL_FEE + 4 * INSTALL_FEE, refused: 7, carried: 3 });
    // the Tab route never beats the station repair; repair parity up to one rounding step
    expect(by.shapeRepairSurvey!.metrics?.tabRoutes ?? 0).toBeGreaterThan(1000);
    expect(by.shapeRepairSurvey!.metrics?.cheapestMargin).toBeGreaterThanOrEqual(2 * INSTALL_FEE);
    expect(by.shapeRepairSurvey!.metrics?.worstCredits).toBeLessThanOrEqual(1);
    // removing a damaged wedge: the full plate's repair for the same missing HP, = station repair
    const rm = by.shapeRemoveDamaged!.metrics!;
    expect(rm.wedgePaid).toBeGreaterThan(0);
    expect([rm.fullPaid, rm.stationPaid]).toEqual([rm.wedgePaid, rm.wedgePaid]);
    // one wedge in, one plate out (only the destroyed plate is lost); a damaged one as scrap
    expect(by.shapeLoot!.metrics).toMatchObject({ intactArmor: -1, damagedArmor: -2, loaded: 1 });
    expect(by.shapeCrafted!.metrics?.checks ?? 0).toBeGreaterThanOrEqual(29);
    expect(by.shapeTemplates!.metrics?.paid ?? 0).toBeGreaterThan(0);
    expect(by.shapeTemplates!.metrics?.paidCopy).toBe(by.shapeTemplates!.metrics?.paid);
    expect(by.shapeMirror!.metrics).toMatchObject({ acquired: 1, paidBlocked: INSTALL_FEE });
    expect(by.shapeMirror!.metrics?.paid).toBe(by.shapeMirror!.metrics?.quoted);
  });
});

describe('saboteur – home and workshop (M4c)', () => {
  it('every home / workshop probe gains nothing and really ran; the refine survey finds no W1 pair', () => {
    const probes = homeProbes(3);
    expect(probes.map((p) => p.id)).toEqual([
      'refineArbitrage',
      'refineSurvey',
      'refinedCarry',
      'refinedSellTwice',
      'repairStorageOnly',
      'repairBank',
      'blastOwnWreck',
      'paintElsewhere',
      'paintCrafted',
      'homeBuildCrafted',
      'trophyPinCrafted',
    ]);
    for (const p of probes) expect(p.exploit, `${p.id}: ${p.detail}`).toBe(false);
    const by = Object.fromEntries(probes.map((p) => [p.id, p]));
    // buy → refine → sell loses on both legs between home and G1 (and into the demand), no stacked bonus
    expect(by.refineArbitrage!.metrics?.legs ?? 0).toBeGreaterThanOrEqual(2);
    expect(by.refineArbitrage!.metrics?.refined ?? 0).toBeGreaterThan(200);
    expect(by.refineArbitrage!.metrics?.worstMargin ?? 0).toBeLessThan(0);
    expect(by.refineArbitrage!.metrics?.stacked).toBe(0);
    // W1 closed (M4d, refined price ceiling): no station's refined price reaches the cheapest buy anywhere –
    // it was ring 2 → ring 4 iron +0.30 kr/u before
    expect(by.refineSurvey!.metrics?.stations ?? 0).toBeGreaterThan(20);
    expect(by.refineSurvey!.metrics?.bestMargin ?? 1).toBeLessThanOrEqual(-0.1 + 1e-9);
    expect(by.refineSurvey!.metrics?.positivePairs).toBe(0);
    expect(by.refineSurvey!.metrics?.['margin:titanium'] ?? 0).toBeLessThan(0);
    // refined ore: never grows, the ledger caps the bonus, the hangar keeps it with its ship
    expect(by.refinedCarry!.metrics?.produced ?? 0).toBeGreaterThan(100);
    expect(by.refinedCarry!.metrics?.switches).toBe(4);
    expect(by.refinedCarry!.metrics?.bonus ?? 0).toBeLessThanOrEqual((by.refinedCarry!.metrics?.allowed ?? 0) + 1);
    expect(by.refinedSellTwice!.metrics?.refusals).toBe(5);
    // the repair module: nothing from storage, exactly the material in the hold; B1 (fixed): a T1 and a T2
    // neighbour still swap the bank, but no unit burns – 3 Fe + 3 Ti heal 20 + ~46.7 HP
    const rep = by.repairStorageOnly!.metrics!;
    expect(rep.storageOnlyHp).toBe(0);
    expect(rep.used).toBe(2);
    expect(rep.healed).toBeGreaterThan(20);
    expect(rep.mixedSwitches).toBeGreaterThan(0);
    expect(rep.mixedWasted).toBe(0);
    expect(rep.mixedHealedT1 + rep.mixedHealedT2).toBeGreaterThan(60);
    expect(by.repairBank!.metrics?.craftedBankFe ?? 0).toBeLessThanOrEqual(1 + 1e-6);
    expect(by.repairBank!.metrics?.craftedHealed ?? 0).toBeGreaterThan(0);
    // one blast per large reactor, no cut of the player's own wreck, the reactor comes back intact
    expect(by.blastOwnWreck!.metrics).toMatchObject({ blasts: 1, cuts: 0, reactorBack: 1 });
    expect(by.paintElsewhere!.metrics?.checks ?? 0).toBeGreaterThanOrEqual(4);
    expect(by.paintCrafted!.metrics?.refused ?? 0).toBeGreaterThanOrEqual(10);
    expect(by.homeBuildCrafted!.metrics?.spent).toBe(HOME_MODULES.paintShop.credits + HOME_MODULES.trophyHall.credits);
    expect(by.trophyPinCrafted!.metrics?.pinned).toBe(6);
  });
});

describe('saboteur – Guild and trade (M4d)', () => {
  it('every convoy, escort, relay, Watch and notes probe gains nothing (G1–G3 fixed)', () => {
    const probes = guildProbes(3);
    expect(probes.map((p) => p.id)).toEqual([...GUILD_PROBE_IDS]);
    for (const p of probes) expect(p.exploit, `${p.id}: ${p.detail}`).toBe(false);
    const by = Object.fromEntries(probes.map((p) => [p.id, p]));
    // the convoy trade: any buy → convoy sale loses, ≤ 0.9 × the station; 200 u per pass whatever the player does
    expect(by.convoyArbitrage!.metrics?.worstMargin ?? 1).toBeLessThan(0);
    expect(by.convoyArbitrage!.metrics?.worstRatio ?? 1).toBeLessThanOrEqual(CONVOY.sellMult);
    expect(by.convoyArbitrage!.metrics).toMatchObject({ ring1: 1, ring2: 2 });
    expect(by.convoyCap!.metrics).toMatchObject({ sold: CONVOY.buyCap, relinkSale: 0, copySale: 0 });
    expect(by.convoyItems!.gain).toBeLessThan(0);
    expect(by.convoyItems!.metrics?.fragments).toBe(1);
    expect(by.tankerFuel!.metrics?.bought ?? 99).toBeLessThanOrEqual(CONVOY.fuelCap);
    expect(by.tankerFuel!.metrics?.copyRefill).toBe(0);
    expect(by.convoySaveLoad!.metrics).toMatchObject({ linkKept: 1, capLeft: CONVOY.buyCap - 100 });
    // the escort: the deposit is 10 % of the reward and comes back once (the honest paths hold)
    const dep = by.escortDeposit!.metrics!;
    expect(dep.deposit).toBe(Math.round(dep.reward * ESCORT.deposit));
    expect(dep.ready).toBe(1);
    expect(dep.honestBroken).toBe(0);
    expect(by.escortStack!.metrics?.convoys ?? 2).toBe(2);
    // the relay pays once per lane; no stale or new slip for a secured lane
    expect(by.relayDoublePay!.metrics).toMatchObject({ secured: 1, ready: 1, stale: 0, fresh: 0 });
    expect(by.relayDoublePay!.metrics?.paid).toBe(by.relayDoublePay!.metrics?.reward);
    // no friendly fire; Watch kills leave no cargo
    expect(by.watchNoValue!.metrics).toMatchObject({ hits: 0, watchCargo: 0, ramHull: 0 });
    expect(by.watchNoValue!.metrics?.watchKills ?? 0).toBeGreaterThan(0);
    expect(by.mapNotesNoValue!.metrics).toMatchObject({ made: 30, copySame: 1 });
    // findings G1–G3 (saboteur-report.md), fixed after T16
    // G1 (fixed): a re-armed relay hold brings back only the ships not shot down – no fresh party, no loot twice
    expect(by.relayHoldFarm!.exploit, by.relayHoldFarm!.detail).toBe(false);
    expect(by.relayHoldFarm!.gain).toBe(0);
    expect(by.relayHoldFarm!.metrics?.kills ?? 99).toBeLessThanOrEqual(3);
    // G2 (fixed): the cancel of an escort whose convoy departed is never free – no deposit back, no slip to accept again
    expect(by.escortCancelFarm!.exploit, by.escortCancelFarm!.detail).toBe(false);
    expect(by.escortCancelFarm!.gain).toBe(0);
    expect(by.escortCancelFarm!.metrics?.cycles ?? 99).toBe(0);
    // G3 (fixed): a crafted escort deposit in a save loads clamped to the contract's – never paid out
    expect(by.escortDeposit!.exploit, by.escortDeposit!.detail).toBe(false);
    expect(dep.craftedPaid).toBe(0);
  });

  it('every debugGuild command is refused in a production build (G4 fixed)', () => {
    vi.stubEnv('DEV', false);
    try {
      const sim = flyingAt(3, { x: 0, y: 900 });
      const before = { ...sim.state.player.body.pos };
      for (const what of ['secure', 'convoy', 'watch'] as const) {
        expect(guildAction(sim.state, { type: 'debugGuild', what, reqId: 1 })[0]).toMatchObject({ ok: false, reason: 'serviceUnavailable' });
      }
      // G4 (saboteur-report.md): `watch` moved the ship up to 6 000 u beside the nearest scheduled Watch ship
      expect(sim.state.player.body.pos).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

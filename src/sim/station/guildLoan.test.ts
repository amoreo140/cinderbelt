import { describe, expect, it } from 'vitest';
import { INSTALL_FEE, partBuyPrice, partSellPrice, resourcePrice, scrapResources } from '../../data/economy';
import { emptyCargo, type ResourceId } from '../../data/resources';
import { blueprintMatches, missingParts } from '../ship/blueprint';
import { hullBudgetOf } from '../ship/budget';
import { fullEquivalentHp, fullMaxHp, maxHp } from '../ship/hp';
import { STATION_SERVICES } from '../../data/stations';
import { IDLE_COMMAND } from '../commands';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import { draftBaseHash } from '../shipyard/commit';
import { applyStroke, createDraft, draftOps } from '../shipyard/draft';
import type { EditorOp } from '../shipyard/editor';
import type { ShipGrid } from '../ship/types';
import type { SimEvent, Simulation } from '../Simulation';
import { HOME_STATION_ID, homeStation } from '../world/stations';
import { guildLoanOffer, LOAN_ENGINE_KEY, LOAN_LASER_KEY, mountLoan, reachableWorth } from './guildLoan';
import { act, customStation, dockedAt, dockedSim, expectOk } from './testHarness';

/** A liquidated ship: cockpit, one forward engine and a hold – nothing worth selling. */
const stripped = (): ShipGrid =>
  createGrid([
    ['cockpit', 1, 0],
    ['cargo', 0, 0],
    ['engine', -1, 0, 0],
  ]);
/** The same without the engine (rocks or pirates took it). */
const engineless = (): ShipGrid =>
  createGrid([
    ['cockpit', 1, 0],
    ['cargo', 0, 0],
  ]);

const homeParts = (sim: Simulation) => sim.state.stations.get(HOME_STATION_ID)?.parts ?? {};
const loans = (events: SimEvent[]) => events.filter((e) => e.type === 'guildLoan');
const loanParts = (sim: Simulation) => sim.state.player.grid.parts.filter((p) => p.loan);

/** Broke at home with the given ship and an empty home storage. */
function brokeAtHome(grid: ShipGrid = stripped(), credits = 5): Simulation {
  const sim = dockedSim(grid);
  sim.state.credits = credits;
  sim.state.stations.get(HOME_STATION_ID)!.parts = {};
  return sim;
}

function commit(sim: Simulation, ops: EditorOp[]): SimEvent[] {
  const { player } = sim.state;
  const draft = applyStroke(createDraft(HOME_STATION_ID, player.grid, player.hp, homeParts(sim)), ops).draft;
  return act(sim, { type: 'shipyardCommit', baseHash: draftBaseHash(draft), ops: draftOps(draft), acquire: draft.acquire });
}

describe('Guild loan – who gets it', () => {
  it('lends a T1 laser to a broke player without one and mounts it on the hull for free', () => {
    const sim = brokeAtHome();
    expect(guildLoanOffer(sim.state, homeStation())).toEqual([LOAN_LASER_KEY]);
    const events = sim.step(IDLE_COMMAND);
    expect(loans(events)).toEqual([{ type: 'guildLoan', stationId: HOME_STATION_ID, parts: { [LOAN_LASER_KEY]: 1 } }]);
    const p = sim.state.player;
    expect(p.props.lasers).toHaveLength(1);
    expect(loanParts(sim)).toHaveLength(1);
    // mounted for free (S3): nothing charged, the storage untouched
    expect(sim.state.credits).toBe(5);
    expect(homeParts(sim)).toEqual({});
    // the laser is at the bow, facing forward, with a free line of fire
    const laser = loanParts(sim)[0]!;
    expect(laser).toMatchObject({ partId: 'miningLaser', tier: 1, rot: 0, x: 2, y: 0 });
    // only once – the ship has a laser now
    expect(loans(sim.step(IDLE_COMMAND))).toEqual([]);
    expect(sim.state.stats.lastEmergencyKit).toBe(0);
  });

  it('lends a forward engine (and a laser) to an engineless broke ship', () => {
    const sim = brokeAtHome(engineless(), 0);
    expect(guildLoanOffer(sim.state, homeStation())).toEqual([LOAN_LASER_KEY, LOAN_ENGINE_KEY]);
    sim.step(IDLE_COMMAND);
    const p = sim.state.player;
    expect(p.props.thrust.forward).toBeGreaterThan(0);
    expect(p.props.lasers).toHaveLength(1);
    expect(loanParts(sim).map((x) => x.partId).sort()).toEqual(['engine', 'miningLaser']);
  });

  it('is available at every station with a shipyard, not only at home (S1)', () => {
    const away = dockedAt(customStation({ id: 'st:1,1', kind: 'station' }), engineless());
    away.state.credits = 0;
    expect(loans(away.step(IDLE_COMMAND))).toHaveLength(1);
    expect(away.state.player.props.thrust.forward).toBeGreaterThan(0);
    // an outpost has no shipyard – no loan there (the tow takes an engineless ship to a shipyard)
    const outpost = dockedAt(customStation({ id: 'st:2,1', kind: 'outpost', services: STATION_SERVICES.outpost }), engineless());
    outpost.state.credits = 0;
    expect(loans(outpost.step(IDLE_COMMAND))).toEqual([]);
  });

  it('needs the reachable worth to be short of the part: credits, sellable parts, cargo and storage here count', () => {
    const price = partBuyPrice(LOAN_LASER_KEY, 1)! + INSTALL_FEE;
    expect(guildLoanOffer(brokeAtHome(stripped(), price).state, homeStation())).toEqual([]);
    // a rich hull: the starter without its laser is worth far more than a laser
    const rich = brokeAtHome({ ...createStarterShip(), parts: createStarterShip().parts.filter((p) => p.partId !== 'miningLaser') }, 0);
    expect(reachableWorth(rich.state, homeStation())).toBeGreaterThan(price);
    expect(guildLoanOffer(rich.state, homeStation())).toEqual([]);
    // cargo and stored resources count at the station's sell price
    const cargo = brokeAtHome();
    cargo.state.stations.get(HOME_STATION_ID)!.resources = { ...emptyCargo(), titanium: 1000 };
    expect(guildLoanOffer(cargo.state, homeStation())).toEqual([]);
  });

  it('a spare in reach blocks it (mount or sell the spare first); a spare at another station or in a shipment does not (S2)', () => {
    const here = brokeAtHome();
    here.state.stations.get(HOME_STATION_ID)!.parts = { 'miningLaser:2': 1 };
    expect(guildLoanOffer(here.state, homeStation())).toEqual([]);
    const onBoard = brokeAtHome();
    onBoard.state.player.salvage = { 'heavyLaser:1': 1 };
    expect(guildLoanOffer(onBoard.state, homeStation())).toEqual([]);
    const elsewhere = brokeAtHome(engineless(), 0);
    elsewhere.state.stations.set('st:3,3', { resources: emptyCargo(), parts: { 'engine:1': 1, 'miningLaser:1': 1 } });
    elsewhere.state.career.shipments.push({ id: 1, from: HOME_STATION_ID, to: 'st:3,3', resources: {}, parts: { 'engine:2': 1 }, arrival: 99 });
    expect(guildLoanOffer(elsewhere.state, homeStation())).toEqual([LOAN_LASER_KEY, LOAN_ENGINE_KEY]);
  });
});

describe('Guild loan – the part never becomes value', () => {
  it('cannot be sold: removing it in the shipyard returns it to the Guild, never to storage', () => {
    const sim = brokeAtHome();
    sim.step(IDLE_COMMAND);
    const laser = loanParts(sim)[0]!;
    const events = commit(sim, [{ op: 'remove', id: laser.id }]);
    expectOk(events);
    expect(homeParts(sim)).toEqual({});
    expect(sim.state.player.grid.parts.some((p) => p.id === laser.id)).toBe(false);
    // nothing in storage to sell
    expect(act(sim, { type: 'sellPart', key: LOAN_LASER_KEY, count: 1 }).some((e) => e.type === 'actionResult' && e.ok)).toBe(false);
    // the player still needs one: the Guild lends it again right away (no cooldown – nothing to farm)
    expect(loans(events)).toHaveLength(1);
    expect(loanParts(sim)).toHaveLength(1);
    expect(sim.state.credits).toBe(5);
  });

  it('a removed loan never cancels against a new owned part of the same type (no free swap to an owned part)', () => {
    const sim = brokeAtHome(stripped(), 3000);
    // pretend the loan was lent earlier
    const lent = mountLoan(sim.state.player.grid, LOAN_LASER_KEY)!;
    sim.state.player.grid = lent;
    const laser = lent.parts.find((p) => p.loan)!;
    const draft = applyStroke(createDraft(HOME_STATION_ID, lent, new Map(), {}), [
      { op: 'remove', id: laser.id },
      { op: 'place', key: LOAN_LASER_KEY, x: laser.x, y: laser.y, rot: 0 },
    ]).draft;
    const before = sim.state.credits;
    expectOk(act(sim, { type: 'shipyardCommit', baseHash: draftBaseHash(draft), ops: draftOps(draft), acquire: draft.acquire }));
    // the new laser was bought (or crafted) – it is owned now, and it cost money
    expect(sim.state.credits).toBeLessThan(before - partBuyPrice(LOAN_LASER_KEY, 1)! + 1);
    expect(loanParts(sim)).toHaveLength(0);
    expect(sim.state.player.props.lasers).toHaveLength(1);
  });

  it('keeps its loan flag when moved and through save and load', () => {
    const sim = brokeAtHome();
    sim.step(IDLE_COMMAND);
    sim.state.credits = 50;
    const laser = loanParts(sim)[0]!;
    expectOk(commit(sim, [{ op: 'move', id: laser.id, x: 1, y: 1, rot: 0 }]));
    expect(sim.state.player.grid.parts.find((p) => p.id === laser.id)).toMatchObject({ loan: true, x: 1, y: 1 });
    const loaded = loadSave(toEnvelope(toSave(sim, testContext())));
    if (!loaded.ok) throw new Error('load failed');
    expect(restoreSimulation(loaded.save).state.player.grid.parts.filter((p) => p.loan)).toHaveLength(1);
  });
});

describe('Guild loan – second code review', () => {
  it('I3: a loan part not in the blueprint does not hide the blueprint gaps (Restore to design stays)', () => {
    const blueprint = createStarterShip();
    const laser = blueprint.parts.find((p) => p.partId === 'miningLaser')!;
    const lost: ShipGrid = { nextId: blueprint.nextId, parts: blueprint.parts.filter((p) => p !== laser).map((p) => ({ ...p })) };
    const lent = mountLoan(lost, LOAN_LASER_KEY)!;
    expect(lent.parts.some((p) => p.loan && !blueprint.parts.some((b) => b.id === p.id))).toBe(true);
    expect(blueprintMatches(blueprint, lent)).toBe(true);
    expect(missingParts(blueprint, lent).map((p) => p.id)).toEqual([laser.id]);
  });

  it('I4: the reachable worth keeps the line to the only forward engine and values damaged parts as scrap here', () => {
    // cockpit – hold – engine: removing the hold or the engine would leave no forward engine
    const sim = brokeAtHome(stripped(), 5);
    expect(reachableWorth(sim.state, homeStation())).toBe(5);
    // a second engine is sellable; a damaged hold off the line counts as scrap at this station
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['engine', 0, 0, 0],
      ['engine', 1, 1, 0],
      ['cargo', 2, 0],
    ]);
    const rich = brokeAtHome(grid, 5);
    const cargo = grid.parts.find((p) => p.partId === 'cargo')!;
    rich.state.player.hp.set(cargo.id, maxHp(cargo) / 2);
    const station = homeStation();
    const scrap = scrapResources('cargo:1', maxHp(cargo) / 2, maxHp(cargo));
    const scrapValue = Object.entries(scrap).reduce((s, [r, n]) => s + n! * resourcePrice(r as ResourceId, station.ring, station.priceJitter[r as ResourceId]).sell, 0);
    expect(reachableWorth(rich.state, station)).toBeCloseTo(5 + partSellPrice('engine:1') + scrapValue, 6);
    expect(scrapValue).toBeLessThan(partSellPrice('cargo:1') / 2);
  });

  it('SL2 E2: a damaged shaped plate is valued as scrap by its full-equivalent HP, like repair and scrap', () => {
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['engine', 0, 0, 0],
      ['armor', 2, 0, 0, 1, 'wedge'],
    ]);
    const sim = brokeAtHome(grid, 5);
    const wedge = grid.parts.find((p) => p.partId === 'armor')!;
    // a wedge (20 HP of a 40 HP plate) at half its HP: the folded rest of the plate is intact
    sim.state.player.hp.set(wedge.id, maxHp(wedge) / 2);
    const station = homeStation();
    const value = (hp: number, max: number): number =>
      Object.entries(scrapResources('armor:1', hp, max)).reduce((s, [r, n]) => s + n! * resourcePrice(r as ResourceId, station.ring, station.priceJitter[r as ResourceId]).sell, 0);
    const full = fullMaxHp(wedge);
    const expected = value(fullEquivalentHp(wedge, maxHp(wedge) / 2), full);
    expect(fullEquivalentHp(wedge, maxHp(wedge) / 2)).toBe(full * 0.75);
    expect(expected).toBeGreaterThan(value(maxHp(wedge) / 2, maxHp(wedge)));
    expect(reachableWorth(sim.state, station)).toBeCloseTo(5 + expected, 6);
    // at full HP it is the whole plate at the buy-back price
    sim.state.player.hp.set(wedge.id, maxHp(wedge));
    expect(reachableWorth(sim.state, station)).toBeCloseTo(5 + partSellPrice('armor:1'), 6);
  });

  it('M18: the loan respects the hull budget – a hull at its budget gets no loan part', () => {
    // a T1 cockpit (28 points), an engine and 26 one-cell holds: full
    const holds: ['cargo', number, number][] = [['cargo', 0, 1], ['cargo', 0, -1]];
    for (let x = 1; x <= 6; x++) for (let y = -2; y <= 1; y++) holds.push(['cargo', x, y]);
    const full = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ...holds]);
    expect(hullBudgetOf(full).used).toBe(28);
    expect(mountLoan(full, LOAN_LASER_KEY)).toBeNull();
    // one hold less: room for the loan
    const room: ShipGrid = { nextId: full.nextId, parts: full.parts.slice(0, -1) };
    expect(mountLoan(room, LOAN_LASER_KEY)).not.toBeNull();
  });
});

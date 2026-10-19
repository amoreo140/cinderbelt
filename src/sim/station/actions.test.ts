import { describe, expect, it } from 'vitest';
import { emergencyFuelTarget } from '../../data/economy';
import { cargoUsed } from '../../data/resources';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../commands';
import { createBody } from '../physics/body';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { HOME_STATION_ID, homeStation, type StationDef } from '../world/stations';
import { emergencyFuelAvailable, stationStorage } from './actions';
import { dockPose } from './dock';
import { towQuote } from './tow';

const homeOnly: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : {}),
});

function docked(): Simulation {
  return new Simulation({ seed: 1, generator: homeOnly });
}

let reqId = 0;
function act(sim: Simulation, a: GameActionInput): SimEvent[] {
  return sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++reqId } as GameAction] });
}

const result = (events: SimEvent[]) => events.find((e) => e.type === 'actionResult');

/** Everything an action may change. */
function snapshot(sim: Simulation) {
  const { player, credits, stations } = sim.state;
  return structuredClone({ credits, cargo: player.cargo, fuel: player.fuel, stations: [...stations], body: player.body });
}

/** The action fails with the given reason and changes nothing. */
function expectFailure(sim: Simulation, a: GameActionInput, reason: string): void {
  const before = snapshot(sim);
  const events = act(sim, a);
  expect(result(events)).toEqual({ type: 'actionResult', reqId, ok: false, reason });
  expect(events.filter((e) => e.type !== 'actionResult')).toEqual([]);
  expect(snapshot(sim)).toEqual(before);
}

const home = () => homeStation();

describe('selling resources', () => {
  it('sells all cargo of a resource for the floored sum', () => {
    const sim = docked();
    sim.state.player.cargo.iron = 52.3;
    const events = act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' });
    expect(result(events)).toEqual({ type: 'actionResult', reqId, ok: true });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: 167, reason: 'sell' });
    expect(sim.state.credits).toBe(250 + 167);
    expect(sim.state.player.cargo.iron).toBe(0);
  });

  it('sells a part of the cargo or from the station storage', () => {
    const sim = docked();
    sim.state.player.cargo.copper = 20;
    act(sim, { type: 'sellResource', resource: 'copper', qty: 10, from: 'ship' });
    expect(sim.state.player.cargo.copper).toBe(10);
    expect(sim.state.credits).toBe(250 + 40);
    stationStorage(sim.state, HOME_STATION_ID).resources.ice = 5;
    act(sim, { type: 'sellResource', resource: 'ice', qty: 'all', from: 'storage' });
    expect(stationStorage(sim.state, HOME_STATION_ID).resources.ice).toBe(0);
    expect(sim.state.credits).toBe(250 + 40 + 12);
  });

  it('rejects invalid quantities without changes', () => {
    const sim = docked();
    sim.state.player.cargo.iron = 5;
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: 6, from: 'ship' }, 'invalidQuantity');
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: 0, from: 'ship' }, 'invalidQuantity');
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: -1, from: 'ship' }, 'invalidQuantity');
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: Number.NaN, from: 'ship' }, 'invalidQuantity');
    expectFailure(sim, { type: 'sellResource', resource: 'copper', qty: 'all', from: 'ship' }, 'invalidQuantity');
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'storage' }, 'invalidQuantity');
  });
});

describe('buying resources', () => {
  it('buys whole units into the station storage for the ceiled cost', () => {
    const sim = docked();
    const events = act(sim, { type: 'buyResource', resource: 'copper', qty: 3 });
    expect(result(events)?.type === 'actionResult' && result(events)).toMatchObject({ ok: true });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -19, reason: 'buy' });
    expect(sim.state.credits).toBe(250 - 19);
    expect(stationStorage(sim.state, HOME_STATION_ID).resources.copper).toBe(3);
    expect(sim.state.player.cargo.copper).toBe(0);
  });

  it('rejects fractional or unaffordable purchases', () => {
    const sim = docked();
    expectFailure(sim, { type: 'buyResource', resource: 'iron', qty: 1.5 }, 'invalidQuantity');
    expectFailure(sim, { type: 'buyResource', resource: 'iron', qty: 0 }, 'invalidQuantity');
    expectFailure(sim, { type: 'buyResource', resource: 'iron', qty: 51 }, 'notEnoughCredits');
    act(sim, { type: 'buyResource', resource: 'iron', qty: 50 });
    expect(sim.state.credits).toBe(0);
  });
});

describe('transfers between ship and storage', () => {
  it('unloads cargo into the storage', () => {
    const sim = docked();
    sim.state.player.cargo.ice = 12.5;
    act(sim, { type: 'transfer', resource: 'ice', qty: 'all', to: 'storage' });
    expect(sim.state.player.cargo.ice).toBe(0);
    expect(stationStorage(sim.state, HOME_STATION_ID).resources.ice).toBe(12.5);
  });

  it('loads only what fits into the cargo hold', () => {
    const sim = docked();
    const p = sim.state.player;
    stationStorage(sim.state, HOME_STATION_ID).resources.iron = 100;
    p.cargo.copper = p.props.cargoCapacity - 30;
    act(sim, { type: 'transfer', resource: 'iron', qty: 'all', to: 'ship' });
    expect(p.cargo.iron).toBe(30);
    expect(stationStorage(sim.state, HOME_STATION_ID).resources.iron).toBe(70);
    expectFailure(sim, { type: 'transfer', resource: 'iron', qty: 5, to: 'ship' }, 'cargoFull');
  });

  it('rejects moving more than available', () => {
    const sim = docked();
    sim.state.player.cargo.iron = 2;
    expectFailure(sim, { type: 'transfer', resource: 'iron', qty: 3, to: 'storage' }, 'invalidQuantity');
    expectFailure(sim, { type: 'transfer', resource: 'iron', qty: 1, to: 'ship' }, 'invalidQuantity');
  });

  it('keeps a separate storage per station', () => {
    const sim = docked();
    sim.state.player.cargo.iron = 10;
    act(sim, { type: 'transfer', resource: 'iron', qty: 'all', to: 'storage' });
    expect(stationStorage(sim.state, 'st:5,5').resources.iron).toBe(0);
    expect(sim.state.stations.has('st:5,5')).toBe(false);
  });
});

describe('refuelling', () => {
  it('turns ice into fuel 1:2, storage first', () => {
    const sim = docked();
    const p = sim.state.player;
    p.fuel = 100;
    stationStorage(sim.state, HOME_STATION_ID).resources.ice = 4;
    p.cargo.ice = 20;
    act(sim, { type: 'refuel', source: 'ice', amount: 'full' });
    expect(p.fuel).toBe(120);
    expect(stationStorage(sim.state, HOME_STATION_ID).resources.ice).toBe(0);
    expect(p.cargo.ice).toBe(14);
  });

  it('uses the ice it has when there is not enough for a full tank', () => {
    const sim = docked();
    const p = sim.state.player;
    p.fuel = 50;
    p.cargo.ice = 5;
    act(sim, { type: 'refuel', source: 'ice', amount: 'full' });
    expect(p.fuel).toBe(60);
    expect(p.cargo.ice).toBe(0);
  });

  it('sells fuel for credits', () => {
    const sim = docked();
    const p = sim.state.player;
    p.fuel = 70;
    const events = act(sim, { type: 'refuel', source: 'credits', amount: 'full' });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -100, reason: 'refuel' });
    expect(p.fuel).toBe(120);
    expect(sim.state.credits).toBe(150);
    p.fuel = 100;
    act(sim, { type: 'refuel', source: 'credits', amount: 50 });
    expect(p.fuel).toBe(120);
    expect(sim.state.credits).toBe(110);
  });

  it('reports every refuel error without changes', () => {
    const sim = docked();
    const p = sim.state.player;
    expectFailure(sim, { type: 'refuel', source: 'ice', amount: 'full' }, 'tankFull');
    p.fuel = 10;
    expectFailure(sim, { type: 'refuel', source: 'ice', amount: 'full' }, 'notEnoughResources');
    expectFailure(sim, { type: 'refuel', source: 'credits', amount: 0 }, 'invalidQuantity');
    sim.state.credits = 50;
    expectFailure(sim, { type: 'refuel', source: 'credits', amount: 'full' }, 'notEnoughCredits');
  });

  it('gives an emergency ration only when nothing else can reach 25 %', () => {
    const sim = docked();
    const p = sim.state.player;
    p.fuel = 0;
    // 250 cr is enough for 30 fuel → no batch needed
    expect(emergencyFuelAvailable(sim.state, home())).toBe(false);
    expectFailure(sim, { type: 'refuel', source: 'emergency', amount: 'full' }, 'notNeeded');
    sim.state.credits = 10;
    p.cargo.ice = 5; // 10 fuel + 5 for credits < 30
    expect(emergencyFuelAvailable(sim.state, home())).toBe(true);
    act(sim, { type: 'refuel', source: 'emergency', amount: 'full' });
    expect(p.fuel).toBe(30);
    expect(p.cargo.ice).toBe(5);
    expect(sim.state.credits).toBe(10);
    expectFailure(sim, { type: 'refuel', source: 'emergency', amount: 'full' }, 'notNeeded');
  });

  it('fills a tiny tank to at least one trip worth (15), not just a quarter of it', () => {
    expect(emergencyFuelTarget(120)).toBe(30);
    expect(emergencyFuelTarget(20)).toBe(15);
    expect(emergencyFuelTarget(10)).toBe(10);
  });
});

describe('services and docking state', () => {
  it('reports serviceUnavailable at a station without the service', () => {
    const outpost: StationDef = {
      ...homeStation(),
      id: 'st:0,0',
      kind: 'outpost',
      services: { ...homeStation().services, market: false, refuel: false },
    };
    const sim = new Simulation({
      seed: 1,
      startDocked: false,
      generator: (_s, cx, cy) => ({ cx, cy, asteroids: [], ...(cx === 0 && cy === 0 ? { station: outpost } : {}) }),
    });
    sim.enterDocked(outpost.id, dockPose(outpost, sim.state.player.props.boundingRadius));
    sim.state.player.cargo.iron = 3;
    sim.state.player.fuel = 10;
    expectFailure(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }, 'serviceUnavailable');
    expectFailure(sim, { type: 'refuel', source: 'ice', amount: 'full' }, 'serviceUnavailable');
  });

  it('processes several actions in order within one step', () => {
    const sim = docked();
    sim.state.player.cargo.iron = 10;
    const events = sim.step({
      ...IDLE_COMMAND,
      actions: [
        { reqId: 1, type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' },
        { reqId: 2, type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' },
      ],
    });
    expect(events.filter((e) => e.type === 'actionResult')).toEqual([
      { type: 'actionResult', reqId: 1, ok: true },
      { type: 'actionResult', reqId: 2, ok: false, reason: 'invalidQuantity' },
    ]);
  });
});

describe('towing', () => {
  function stranded(credits: number, x = 1000): Simulation {
    const sim = new Simulation({ seed: 1, generator: homeOnly });
    act(sim, { type: 'undock' });
    const p = sim.state.player;
    const body = createBody({ x, y: 0 });
    p.body = body;
    p.prevBody = body;
    p.fuel = 0;
    p.cargo.iron = 10;
    sim.state.credits = credits;
    return sim;
  }
  const H = { ...IDLE_COMMAND, emergency: true };

  it('tows to the nearest discovered station for a fee and keeps the cargo', () => {
    const sim = stranded(500);
    const quote = towQuote(sim.state);
    const dist = 1000;
    expect(quote.station.id).toBe(HOME_STATION_ID);
    expect(quote.cost).toBe(Math.ceil(100 + 0.2 * dist));
    expect(quote.free).toBe(false);
    const events = sim.step(H);
    expect(events).toContainEqual({ type: 'towed', stationId: HOME_STATION_ID, cost: 300, cargoLost: false });
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -300, reason: 'tow' });
    expect(events).toContainEqual({ type: 'docked', stationId: HOME_STATION_ID });
    const p = sim.state.player;
    expect(sim.state.credits).toBe(200);
    expect(p.cargo.iron).toBe(10);
    expect(p.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(p.body).toEqual(dockPose(homeStation(), p.props.boundingRadius));
    // a paid tow is only a tow – no free fuel (saboteur report X7); the fuel is bought at the station
    expect(p.fuel).toBe(0);
  });

  it('tows for free but loses the cargo without enough credits – and the Guild tops the tank up to 25 %', () => {
    const sim = stranded(299);
    expect(towQuote(sim.state).free).toBe(true);
    const events = sim.step(H);
    expect(events).toContainEqual({ type: 'towed', stationId: HOME_STATION_ID, cost: 0, cargoLost: true });
    expect(sim.state.credits).toBe(299);
    expect(cargoUsed(sim.state.player.cargo)).toBe(0);
    expect(sim.state.player.fuel).toBe(sim.state.player.props.fuelCapacity * 0.25);
  });

  it('ignores H with fuel left', () => {
    const sim = stranded(500);
    sim.state.player.fuel = 1;
    expect(sim.step(H).some((e) => e.type === 'towed')).toBe(false);
    expect(sim.state.player.dock.mode).toBe('flying');
  });

  it('prefers a closer discovered station over home', () => {
    const outpost: StationDef = { ...homeStation(), id: 'st:4,0', pos: { x: 900, y: 100 }, chunk: { cx: 4, cy: 0 } };
    const gen: ChunkGenerator = (s, cx, cy) => ({ ...homeOnly(s, cx, cy), ...(cx === 4 && cy === 0 ? { station: outpost } : {}) });
    const sim = new Simulation({ seed: 1, generator: gen, startDocked: false });
    sim.state.world.discovered.add(outpost.id);
    // stationById would find nothing for this test station – tow finds it in the active chunks
    const body = createBody({ x: 950, y: 60 });
    sim.state.player.body = body;
    sim.state.world.update(body.pos);
    sim.state.player.fuel = 0;
    expect(towQuote(sim.state).station.id).toBe(outpost.id);
    sim.step(H);
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: outpost.id });
  });
});

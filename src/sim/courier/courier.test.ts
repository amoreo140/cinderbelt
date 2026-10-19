import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND } from '../commands';
import { act, dockedSim, expectFailure, expectOk } from '../station/testHarness';
import { stationById } from '../world/stations';
import { COURIER_BASE_FEE, COURIER_SPEED, courierQuote, shipmentValue } from './courier';

/** A game with Guild level 2 and two discovered stations. */
function courierSim() {
  const sim = dockedSim();
  sim.state.career.rep.guild.level = 2;
  const other = stationById(1, 'st:5,0') ?? stationById(1, 'st:4,1');
  // a valid station id is enough – the courier only needs the position from the world hash
  const id = other?.id ?? findStation();
  sim.state.world.discovered.add(id);
  sim.state.stations.get('home')!.resources.iron = 100;
  sim.state.stations.get('home')!.parts['armor:1'] = 2;
  sim.state.credits = 1000;
  return { sim, id };
}

function findStation(): string {
  for (let cx = -8; cx <= 8; cx++) for (let cy = -8; cy <= 8; cy++) if (stationById(1, `st:${cx},${cy}`)) return `st:${cx},${cy}`;
  throw new Error('no station');
}

describe('courier', () => {
  it('charges 200 cr + 2% of the value and takes distance ÷ 40 u/s', () => {
    const id = findStation();
    const to = stationById(1, id)!;
    const q = courierQuote(1, 'home', id, { iron: 100 }, { 'armor:1': 2 })!;
    expect(q.value).toBe(shipmentValue({ iron: 100 }, { 'armor:1': 2 }));
    expect(q.value).toBe(100 * 4 + 2 * 260);
    expect(q.fee).toBe(Math.ceil(COURIER_BASE_FEE + 0.02 * q.value));
    expect(q.ticks).toBe(Math.round((Math.hypot(to.pos.x, to.pos.y) / COURIER_SPEED) * 60));
  });

  it('needs guild level 2', () => {
    const { sim, id } = courierSim();
    sim.state.career.rep.guild.level = 1;
    expectFailure(sim, { type: 'courierSend', from: 'home', to: id, resources: { iron: 10 }, parts: {} }, 'serviceLocked');
  });

  it('moves the goods out at once and delivers them later', () => {
    const { sim, id } = courierSim();
    const q = courierQuote(1, 'home', id, { iron: 40 }, { 'armor:1': 1 })!;
    const events = act(sim, { type: 'courierSend', from: 'home', to: id, resources: { iron: 40 }, parts: { 'armor:1': 1 } });
    expectOk(events);
    expect(events).toContainEqual({ type: 'creditsChanged', delta: -q.fee, reason: 'courier' });
    expect(sim.state.stations.get('home')!.resources.iron).toBe(60);
    expect(sim.state.stations.get('home')!.parts['armor:1']).toBe(1);
    expect(sim.state.career.shipments).toHaveLength(1);
    const arrival = sim.state.career.shipments[0]!.arrival;
    while (sim.state.tick < arrival) sim.step(IDLE_COMMAND);
    expect(sim.state.stations.get(id)).toBeUndefined();
    const done = sim.step(IDLE_COMMAND);
    expect(done.some((e) => e.type === 'courierDelivered')).toBe(true);
    expect(sim.state.stations.get(id)!.resources.iron).toBe(40);
    expect(sim.state.stations.get(id)!.parts['armor:1']).toBe(1);
    expect(sim.state.career.shipments).toEqual([]);
  });

  it('validates the shipment', () => {
    const { sim, id } = courierSim();
    expectFailure(sim, { type: 'courierSend', from: 'home', to: 'home', resources: { iron: 1 }, parts: {} }, 'sameStation');
    expectFailure(sim, { type: 'courierSend', from: 'home', to: 'st:99,99', resources: { iron: 1 }, parts: {} }, 'unknownStation');
    expectFailure(sim, { type: 'courierSend', from: 'home', to: id, resources: { iron: 500 }, parts: {} }, 'notEnoughResources');
    expectFailure(sim, { type: 'courierSend', from: 'home', to: id, resources: {}, parts: { 'engine:1': 1 } }, 'notEnoughParts');
    expectFailure(sim, { type: 'courierSend', from: 'home', to: id, resources: {}, parts: {} }, 'invalidQuantity');
    sim.state.credits = 0;
    expectFailure(sim, { type: 'courierSend', from: 'home', to: id, resources: { iron: 1 }, parts: {} }, 'notEnoughCredits');
  });

  it('works in flight too', () => {
    const { sim, id } = courierSim();
    act(sim, { type: 'undock' });
    expectOk(act(sim, { type: 'courierSend', from: 'home', to: id, resources: { iron: 5 }, parts: {} }));
  });
});

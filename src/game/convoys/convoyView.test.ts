// M4d T9: convoys in the game layer – the closest-approach ETA, the map's passes (open while something
// is left to buy), the radar ships, the nearest open pass and the F prompt at a trade port.
import { describe, expect, it } from 'vitest';
import { CONVOY } from '../../data/convoys';
import { setLocale } from '../../i18n/locale';
import { tx } from '../../i18n';
import { besideTrader, linkedTo } from '../../sim/convoys/convoyTesting';
import { convoysInFlight, departureTick } from '../../sim/convoys/schedule';
import { convoyOffer } from '../../sim/convoys/trade';
import { closestApproach, convoyOpen, convoyRadarInput, linkPrompt, mapConvoys, nearestOpenConvoy } from './convoyView';

const SEED = 3;
const PASS = 'cv:A@2';
const AT = departureTick('A', 2) + 60 * 60;

describe('closestApproach', () => {
  it('the time to the closest point ahead within the radius, else null', () => {
    expect(closestApproach({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 50 }, 60)).toBeCloseTo(10, 9);
    expect(closestApproach({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 80 }, 60)).toBeNull();
    expect(closestApproach({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -100, y: 0 }, 60)).toBeNull();
    expect(closestApproach({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 60)).toBeNull();
  });
});

describe('the map and the radar', () => {
  it('every pass in flight, at its trader, open until every item is bought', () => {
    const sim = besideTrader(SEED, PASS, AT, 30);
    const map = mapConvoys(sim.state);
    expect(map.map((c) => c.pass)).toEqual(convoysInFlight(SEED, sim.state.tick).map((p) => p.pass));
    const mine = map.find((c) => c.pass === PASS)!;
    expect(mine.open).toBe(true);
    expect(mine.lane).toBe('A');
    const offer = convoyOffer(sim.state, PASS)!;
    const all = offer.items.reduce((m, i) => m | (1 << i.slot), 0);
    sim.state.convoys.trades.set(PASS, { bought: all, sold: 0, fuel: 0 });
    expect(convoyOpen(sim.state, PASS)).toBe(false);
    expect(mapConvoys(sim.state).find((c) => c.pass === PASS)!.open).toBe(false);
  });

  it('the radar gets the trader (and tanker) as convoy ships, a cutter as a Guild ship', () => {
    const sim = besideTrader(SEED, PASS, AT, 30);
    const r = convoyRadarInput(sim.state, sim.state.player.body.pos, 300);
    expect(r.convoys.length).toBeGreaterThanOrEqual(1);
    expect(r.convoys.filter((c) => !c.tanker).length).toBe(1);
  });

  it('the nearest open pass is the flight mark, none while linked', () => {
    const sim = besideTrader(SEED, PASS, AT, 30);
    expect(nearestOpenConvoy(sim.state)?.pass).toBe(PASS);
    const linked = linkedTo(SEED, 'A', 2, 60);
    expect(nearestOpenConvoy(linked.state)).toBeNull();
  });
});

describe('linkPrompt', () => {
  setLocale('sk');
  const l = () => tx().guild.link;

  it('within the tolerances: F to link, with the gap and the relative speed', () => {
    const p = linkPrompt(besideTrader(SEED, PASS, AT, 1).state)!;
    expect(p).toMatchObject({ kind: 'ok', text: l().prompt });
    expect(p.approach!.items.map((i) => [i.id, i.ok])).toEqual([
      ['distance', true],
      ['speed', true],
    ]);
    // its own title and gap row, not the station's "Dokovanie" / "Svorka"
    expect(p.approach!.title).toBe(l().readout);
    expect(p.approach!.items[0]!.label).toBe(l().port);
    expect(p.approach!.items[0]!.label).not.toBe(tx().docking.readout.distance);
    expect(p.approach!.title).not.toBe(tx().docking.readout.title);
  });

  it('too far, too fast, pirates near; none while linked or away from the port', () => {
    expect(linkPrompt(besideTrader(SEED, PASS, AT, CONVOY.linkRange + 4).state)).toMatchObject({ kind: 'info', text: l().approach });
    expect(linkPrompt(besideTrader(SEED, PASS, AT, 1, { x: 4, y: 0 }).state)).toMatchObject({ kind: 'warn', text: l().slowDown });
    expect(linkPrompt(linkedTo(SEED, 'A', 2, 60).state)).toBeNull();
    expect(linkPrompt(besideTrader(SEED, PASS, AT, 200).state)).toBeNull();
  });
});

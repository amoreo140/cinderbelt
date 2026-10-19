// Trophy hall view model (M4c T2): captain and fortress cards, the shelf in shelf order, pins, and the
// greyed list without a hall.
import { describe, expect, it } from 'vitest';
import type { PartKey } from '../../data/parts';
import { tx } from '../../i18n';
import { captainDef } from '../../sim/captains/captains';
import { richSim } from '../../sim/fleet/testing';
import { trophyShelf } from '../../sim/home';
import { fortressStatus } from '../../sim/pirates/fortress';
import { fortressSites } from '../../sim/pirates/sites';
import { sectorInfoAt } from '../../sim/regions/sectors';
import type { Simulation } from '../../sim/Simulation';
import { act, expectOk } from '../../sim/station/testHarness';
import { sectorName } from '../../ui/sectors/sectorText';
import { captainName, fortressLabel, partLabel } from '../board/names';
import { trophyCards, trophyHallView } from './trophyHallView';

const defeat = (sim: Simulation, captain: number, parts: PartKey[] = []) => sim.state.career.trophies.push({ captain, parts });

function destroyFortress(sim: Simulation, i: number, kills = 1): string {
  const site = fortressSites(sim.state.seed)[i]!;
  sim.state.pirates.fortresses.set(site.id, { ...fortressStatus(sim.state, site.id), destroyed: sim.state.tick, kills });
  return site.id;
}

function withHall(): Simulation {
  const sim = richSim();
  expectOk(act(sim, { type: 'homeBuild', module: 'trophyHall' }));
  return sim;
}

describe('trophy cards', () => {
  it('a captain card: name, clan and the replicas; a fortress card: its name and sector', () => {
    const sim = withHall();
    defeat(sim, 2, ['engine:2' as PartKey]);
    const fort = destroyFortress(sim, 1, 2);
    const cards = trophyCards(sim.state);
    expect(cards.map((c) => c.id)).toEqual(['cap:2', fort]);
    const clan = tx().goals.factions[captainDef(sim.state.seed, 2)!.clan];
    expect(cards[0]).toEqual({
      id: 'cap:2',
      title: captainName(sim.state.seed, 2),
      subtitle: tx().home.trophy.captain(clan, [partLabel('engine:2' as PartKey)]),
      replicas: [partLabel('engine:2' as PartKey)],
      pinned: false,
    });
    expect(cards[0]!.subtitle).toContain(clan);
    const site = fortressSites(sim.state.seed)[1]!;
    expect(cards[1]).toEqual({
      id: fort,
      title: fortressLabel(fort),
      subtitle: tx().home.trophy.fortress(sectorName(sectorInfoAt(sim.state.seed, site.pos.x, site.pos.y).name)),
      replicas: [],
      pinned: false,
    });
  });

  it('a captain without replicas has the clan alone as the subtitle', () => {
    const sim = withHall();
    defeat(sim, 0);
    const clan = tx().goals.factions[captainDef(sim.state.seed, 0)!.clan];
    expect(trophyCards(sim.state)[0]!.subtitle).toBe(clan);
  });
});

describe('trophyHallView', () => {
  it('is null until the hall is built', () => {
    const sim = richSim();
    defeat(sim, 1);
    expect(trophyHallView(sim.state)).toBeNull();
  });

  it('the shelf follows trophyShelf (pins first), cards are shared with the list, empty pedestals are null', () => {
    const sim = withHall();
    defeat(sim, 0);
    defeat(sim, 3);
    const fort = destroyFortress(sim, 0);
    expectOk(act(sim, { type: 'trophyPin', id: fort as `fort:${string}`, pinned: true }));
    const view = trophyHallView(sim.state)!;
    expect(view.shelf).toHaveLength(6);
    expect(view.shelf.map((c) => c?.id ?? null)).toEqual(trophyShelf(sim.state));
    expect(view.shelf.slice(0, 3).map((c) => c!.id)).toEqual([fort, 'cap:3', 'cap:0']);
    expect(view.shelf.slice(3)).toEqual([null, null, null]);
    for (const card of view.shelf) if (card) expect(view.all).toContain(card);
    expect(view.all.map((c) => [c.id, c.pinned])).toEqual([
      ['cap:0', false],
      ['cap:3', false],
      [fort, true],
    ]);
  });

  it('no trophies: an empty list and six empty pedestals', () => {
    const view = trophyHallView(withHall().state)!;
    expect(view.all).toEqual([]);
    expect(view.shelf).toEqual([null, null, null, null, null, null]);
  });
});

// Sectors stage 2 in the UI (sectors design §4.1–4.3, §5.1, §6.6): the Cartography view of the Board,
// survey points in flight / on the radar / on the map, their toasts, the chart lines of the sector card,
// the chart contract slip and the training's map callouts. Pure view models over a real simulation.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../../sim/commands';
import { chartStatus, chartTrade } from '../../sim/charts/charts';
import { regionWorld, sectorChunkKeys, sectorInfo, sectorKnowledge, surveyPoints } from '../../sim/regions';
import { Simulation, type SimEvent } from '../../sim/Simulation';
import { trainingSim } from '../../sim/training/testing';
import { TRAINING_STEPS } from '../../data/training';
import { homeStation } from '../../sim/world/stations';
import { setLocale } from '../../i18n';
import { chartLines } from '../../ui/sectors/sectorCardData';
import { sectorName } from '../../ui/sectors/sectorText';
import { cartographyView } from '../board/cartographyView';
import { offerSlip, contractTarget } from '../board/slipView';
import { slipTags } from '../../ui/board/Slip';
import { ExploreUi } from '../discovery/exploreUi';
import { trainingMapNotes } from '../training/trainingMap';
import { computeObjectives } from '../objectives/objectives';
import { firstChartTarget } from '../../sim/charts/charts';
import { badgeDots, mapSurveyMarks, mapSurveySectors, surveyMarksNear, SURVEY_RANGE } from './surveyUi';

const SEED = 1337;
let req = 0;
const act = (sim: Simulation, a: GameActionInput): SimEvent[] => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });

/** A docked game with the training skipped (the "start" fixture's situation). */
function docked(): Simulation {
  const sim = new Simulation({ seed: SEED });
  sim.state.career.training.status = 'skipped';
  sim.step(IDLE_COMMAND);
  return sim;
}

const nearest = (sim: Simulation, pick: (id: string) => boolean): string => {
  const r = regionWorld(sim.state.seed)
    .regions.filter((x) => pick(x.seed.id))
    .sort((a, b) => Math.hypot(a.seed.x, a.seed.y) - Math.hypot(b.seed.x, b.seed.y))[0];
  if (!r) throw new Error('no sector');
  return r.seed.id;
};

/** The nearest depth-1 sector the player can chart and sell. */
const playerSector = (sim: Simulation) =>
  nearest(sim, (id) => chartTrade(SEED, id) === 'player' && sectorInfo(SEED, id)!.depth === 1 && sectorInfo(SEED, id)!.startKnowledge !== 'charted' && surveyPoints(SEED, id).length > 0);
/** The nearest Guild sector not Charted yet. */
const guildSector = (sim: Simulation) => nearest(sim, (id) => chartTrade(SEED, id) === 'guild' && sectorKnowledge(sim.state, id) !== 'charted');

/** Mark every survey point of a sector (as pulses would) – the last one charts it. */
function surveyAll(sim: Simulation, id: string): void {
  sim.state.regions.points.set(id, (1 << surveyPoints(SEED, id).length) - 1);
}

describe('Cartography view (Board)', () => {
  it('empty: nothing to sell, Guild charts nearest first with their price and what they reveal', () => {
    setLocale('sk');
    const sim = docked();
    const d = cartographyView(sim.state, homeStation());
    expect(d.sell).toEqual([]);
    expect(d.buy.length).toBeGreaterThan(0);
    expect(d.buy.length).toBeLessThanOrEqual(8);
    for (const r of d.buy) {
      expect(r.side).toBe('buy');
      expect(r.price).toBeGreaterThan(0);
      expect(r.priceText).toMatch(/kr$/);
      expect(r.detail).toMatch(/Zmapuje sektor/);
    }
    const dist = d.buy.map((r) => Number(r.distance.replace(/\D/g, '')));
    expect([...dist].sort((a, b) => a - b)).toEqual(dist);
  });

  it('an own chart is sellable, then sold; a Guild chart without credits is blocked with a reason', () => {
    setLocale('sk');
    const sim = docked();
    const id = playerSector(sim);
    surveyAll(sim, id);
    let row = cartographyView(sim.state, homeStation()).sell.find((r) => r.id === id)!;
    expect(row).toMatchObject({ side: 'sell', state: 'sellable', reason: null, name: sectorName(sectorInfo(SEED, id)!.name) });
    expect(row.detail).toMatch(/meracie body \d\/\d/);
    expect(row.price).toBe(chartStatus(sim.state, id)!.price);
    const credits = sim.state.credits;
    const events = act(sim, { type: 'chartSell', sector: id });
    expect(sim.state.credits).toBe(credits + row.price);
    row = cartographyView(sim.state, homeStation()).sell.find((r) => r.id === id)!;
    expect(row.state).toBe('sold');
    // the toast of the sale
    const explore = new ExploreUi({ state: () => sim.state, send: () => {}, render: () => {}, click: () => {} });
    expect(explore.toast(sim.state, events)?.text).toMatch(/^Mapa predaná: .* · \+\d/);

    const g = guildSector(sim);
    sim.state.credits = 0;
    const buy = cartographyView(sim.state, homeStation(), 100).buy.find((r) => r.id === g)!;
    expect(buy).toMatchObject({ state: 'blocked', reason: 'Nedostatok kreditov' });
  });

  it('buying a Guild chart charts the sector; the toast wins over the station discoveries', () => {
    setLocale('en');
    const sim = docked();
    const g = guildSector(sim);
    sim.state.credits = 100_000;
    const events = act(sim, { type: 'chartBuy', sector: g });
    expect(sectorKnowledge(sim.state, g)).toBe('charted');
    expect(cartographyView(sim.state, homeStation(), 100).buy.some((r) => r.id === g)).toBe(false);
    const explore = new ExploreUi({ state: () => sim.state, send: () => {}, render: () => {}, click: () => {} });
    expect(explore.toast(sim.state, events)?.text).toBe(`Chart bought: ${sectorName(sectorInfo(SEED, g)!.name)} is Charted`);
    setLocale('sk');
  });
});

describe('survey points in the UI', () => {
  it('near the ship: only sectors not Charted, done flags from the saved marks; a Charted sector shows none', () => {
    const sim = docked();
    const id = playerSector(sim);
    const p = surveyPoints(SEED, id)[0]!;
    sim.state.player.body.pos = { ...p.pos };
    let near = surveyMarksNear(sim.state, p.pos, SURVEY_RANGE);
    expect(near[0]).toMatchObject({ sector: id, index: p.index, done: false, marked: 0 });
    sim.state.regions.points.set(id, 1 << p.index);
    near = surveyMarksNear(sim.state, p.pos, SURVEY_RANGE);
    expect(near[0]).toMatchObject({ done: true, marked: 1, total: surveyPoints(SEED, id).length });
    expect(badgeDots(sim.state, id)).toEqual({ done: 1, total: surveyPoints(SEED, id).length });
    surveyAll(sim, id);
    expect(surveyMarksNear(sim.state, p.pos, SURVEY_RANGE).filter((m) => m.sector === id)).toEqual([]);
    expect(badgeDots(sim.state, id)).toBeNull();
  });

  it('a callout "Survey point · Tab" within the pulse range, an approach hint a little beyond; radar glyphs', () => {
    setLocale('sk');
    const sim = docked();
    sim.state.player.dock = { mode: 'flying' } as never;
    const id = playerSector(sim);
    const p = surveyPoints(SEED, id)[0]!;
    const explore = new ExploreUi({ state: () => sim.state, send: () => {}, render: () => {}, click: () => {} });
    sim.state.player.body.pos = { x: p.pos.x + 40, y: p.pos.y };
    let c = explore.callouts(sim.state).find((x) => x.id === `survey:${id}:${p.index}`)!;
    expect(c).toMatchObject({ title: 'Merací bod', keys: 'Tab', action: 'pulz', tone: 'ok' });
    expect(c.detail).toMatch(/zamerané 0\/\d/);
    sim.state.player.body.pos = { x: p.pos.x + 250, y: p.pos.y };
    c = explore.callouts(sim.state).find((x) => x.id === `survey:${id}:${p.index}`)!;
    expect(c).toMatchObject({ keys: null, tone: 'info' });
    expect(c.detail).toMatch(/150 j/);
    const radar = explore.radar(sim.state, 400);
    expect(radar.survey.some((s) => Math.abs(s.x + 250) < 1e-6 && Math.abs(s.y) < 1e-6 && !s.done)).toBe(true);
  });

  it('toasts: a marked point "Survey point 2/4", the last one "you can sell the chart to the Guild"', () => {
    setLocale('sk');
    const sim = docked();
    const id = playerSector(sim);
    const name = sectorName(sectorInfo(SEED, id)!.name);
    const total = surveyPoints(SEED, id).length;
    const explore = new ExploreUi({ state: () => sim.state, send: () => {}, render: () => {}, click: () => {} });
    expect(explore.toast(sim.state, [{ type: 'surveyPointMarked', sector: id, index: 1, pos: { x: 0, y: 0 }, done: 2, total }])?.text).toBe(`Merací bod 2/${total} · ${name}`);
    const charted = explore.toast(sim.state, [
      { type: 'surveyPointMarked', sector: id, index: 2, pos: { x: 0, y: 0 }, done: total, total },
      { type: 'sectorCharted', id, depth: 1, data: 2, via: 'survey' },
    ]);
    expect(charted?.text).toBe(`Sektor zmapovaný: ${name} · +2 D · mapu môžeš predať Cechu`);
  });

  it('the map always shows the points of the current, a surveyed and the contract sectors – not unknown or Charted ones', () => {
    const sim = docked();
    const id = playerSector(sim);
    const unknown = nearest(sim, (x) => sectorKnowledge(sim.state, x) === 'uncharted' && surveyPoints(SEED, x).length > 0 && x !== id && sectorChunkKeys(SEED, x).every((k) => !sim.state.world.explored.has(k)));
    const sectors = mapSurveySectors(sim.state, id);
    expect(sectors).toContain(id);
    expect(sectors).not.toContain(unknown);
    for (const s of sectors) expect(sectorKnowledge(sim.state, s)).not.toBe('charted');
    const marks = mapSurveyMarks(sim.state, id).filter((m) => m.sector === id);
    expect(marks).toHaveLength(surveyPoints(SEED, id).length);
    surveyAll(sim, id);
    expect(mapSurveySectors(sim.state, id)).not.toContain(id);
  });
});

describe('sector card chart lines', () => {
  it('points while not Charted; the price to sell, sold, the Guild price, bought', () => {
    setLocale('sk');
    const base = { points: { done: 1, total: 3 }, trade: 'player' as const, price: 250, own: false, bought: false, sold: false, reserved: false };
    expect(chartLines(base, 'reported')).toEqual({ survey: { line: 'Meracie body 1/3', done: 1, total: 3 }, chart: 'Mapa: po zmapovaní ju Cech kúpi za 250 kr' });
    expect(chartLines({ ...base, points: { done: 3, total: 3 }, own: true }, 'charted').chart).toBe('Mapa: Cech kúpi za 250 kr');
    expect(chartLines({ ...base, own: true, sold: true }, 'charted')).toEqual({ survey: null, chart: 'Mapa: predaná Cechu' });
    expect(chartLines({ ...base, trade: 'guild', price: 450 }, 'uncharted').chart).toBe('Mapa: Cech predáva za 450 kr');
    expect(chartLines({ ...base, trade: 'guild', bought: true }, 'charted').chart).toBe('Mapa: kúpená od Cechu');
    expect(chartLines(null, 'charted')).toEqual({ survey: null, chart: null });
  });
});

describe('chart contract slip', () => {
  it('"First chart" leads the home board after the training: tag, sale note; accepted, it points at the nearest unmarked point', () => {
    setLocale('sk');
    const sim = docked();
    const board = sim.state.career.boards.get('home')!;
    const first = board.offers.find((o) => o.target.kind === 'chart' && o.target.first);
    expect(first).toBeDefined();
    const slip = offerSlip(sim.state, first!, { enabled: true });
    expect(slip.first).toBe(true);
    expect(slip.rewardNote).toBe('vrátane predaja mapy');
    expect(slip.typeName).toBe('Mapa');
    expect(slip.why).toMatch(/^Prvá mapa/);
    expect(slipTags(slip)[0]).toEqual({ text: 'Prvá mapa', tone: 'info' });
    act(sim, { type: 'acceptContract', offerId: first!.id });
    const c = sim.state.career.contracts.find((x) => x.target.kind === 'chart')!;
    const t = c.target as Extract<typeof c.target, { kind: 'chart' }>;
    const target = contractTarget(sim.state, c)!;
    const points = surveyPoints(SEED, t.sector).map((p) => p.pos);
    expect(points.some((p) => p.x === target.x && p.y === target.y)).toBe(true);
    // the map also shows the contract sector's points even when the player never heard of it
    expect(mapSurveySectors(sim.state, null)).toContain(t.sector);
  });
});

describe('"First chart" in the objectives band', () => {
  it('in flight after the training, with no contract: chart the nearest sector – the arrow leads to a survey point', () => {
    setLocale('sk');
    const sim = docked();
    sim.state.player.dock = { mode: 'flying' } as never;
    const first = firstChartTarget(sim.state)!;
    const o = computeObjectives(sim.state).find((x) => x.id === 'hint:firstChart')!;
    expect(o.title).toBe(`Prvá mapa: zmapuj sektor ${sectorName(sectorInfo(SEED, first.id)!.name)} (meracie body, pulz Tab)`);
    expect(surveyPoints(SEED, first.id).some((p) => p.pos.x === o.target!.x && p.pos.y === o.target!.y)).toBe(true);
    // once a chart is sold the offer is over
    sim.state.regions.sold.add(first.id);
    expect(computeObjectives(sim.state).some((x) => x.id === 'hint:firstChart')).toBe(false);
  });
});

describe('Guild Training step 8 on the map', () => {
  it('Origin [x], the Guild Lane, a Reported neighbour [?] and the red corner – only during the checklist', () => {
    setLocale('sk');
    const sim = trainingSim(SEED);
    expect(trainingMapNotes(sim.state)).toEqual([]);
    sim.state.career.training.step = TRAINING_STEPS.findIndex((s) => s.id === 'checklist');
    const notes = trainingMapNotes(sim.state);
    expect(notes.map((n) => n.id)).toEqual(['training-origin', 'training-lane', 'training-reported', 'training-corner']);
    expect(notes[0]!.title).toBe('[x] Počiatok');
    expect(notes[3]).toMatchObject({ detail: 'Tam bez kanóna nelietaj.', tone: 'warn' });
    expect(notes[3]!.title).toMatch(/Šakalí kút$/);
  });
});

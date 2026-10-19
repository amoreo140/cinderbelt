import { describe, expect, it } from 'vitest';
import { RESOURCE_IDS, type Cargo } from '../data/resources';
import type { CombatHudView } from '../game/combatView';
import type { ScanHudData } from '../game/discovery/exploreUi';
import type { EventChipItem } from '../game/sites/types';
import type { ObjectiveItem } from './board/Objectives';
import type { CombatHudData } from './Combat';
import type { EdgeArrowMark } from './EdgeArrowLayer';
import {
  sameCallouts,
  sameCargoTags,
  sameCollision,
  sameDial,
  sameConsoleGauges,
  sameEdgeArrows,
  sameEventChips,
  sameHitMarkers,
  sameHudArrow,
  sameObjectiveBand,
  sameRadar,
  sameSalvagePrompt,
  sameScanWidget,
  sameShipStatus,
  sameThreatBand,
  vignetteSeq,
  type ConsoleGaugesProps,
  type RadarDrawProps,
} from './hudMemo';
import type { CalloutItem } from './theme/Callout';
import type { GaugeProps } from './theme/Meters';

const callout = (over: Partial<CalloutItem> = {}): CalloutItem => ({ id: 'rock:1', x: 100, y: 200, title: 'Iron', detail: '120 %', keys: 'F', action: 'mine', tone: 'info', flip: false, below: false, shift: 0, ...over });

describe('sameCallouts', () => {
  it('ignores where the labels are (the game moves them every frame)', () => {
    expect(sameCallouts({ items: [callout()] }, { items: [callout({ x: 400, y: 20, flip: true, below: true, shift: 30 })] })).toBe(true);
  });

  it('redraws on a changed text, progress, order or count', () => {
    expect(sameCallouts({ items: [callout()] }, { items: [callout({ title: 'Copper' })] })).toBe(false);
    expect(sameCallouts({ items: [callout({ progress: 0.2 })] }, { items: [callout({ progress: 0.3 })] })).toBe(false);
    expect(sameCallouts({ items: [callout(), callout({ id: 'b' })] }, { items: [callout({ id: 'b' }), callout()] })).toBe(false);
    expect(sameCallouts({ items: [callout()] }, { items: [] })).toBe(false);
  });

  it('the progress bar and its percent show whole percents', () => {
    expect(sameCallouts({ items: [callout({ progress: 0.201 })] }, { items: [callout({ progress: 0.203 })] })).toBe(true);
    expect(sameCallouts({ items: [callout()] }, { items: [callout({ progress: 0 })] })).toBe(false);
  });
});

const view = (over: Partial<CombatHudView> = {}): CombatHudView => ({
  shield: { current: 10, max: 20, fraction: 0.5 },
  hull: { current: 20, max: 28, fraction: 20 / 28 },
  silhouette: { cells: [{ x: 0, y: 0, partId: 'cockpit', tier: 1, fraction: 1, part: 1 } as never], minX: 0, maxX: 0, minY: 0, maxY: 0, damaged: 0, missing: 0, outline: 'M0 0' },
  cannons: { total: 2, ready: 2 },
  threat: { nearby: 1, attacking: 1, nearest: { distance: 120, angle: 1 } },
  salvage: null,
  salvageHold: {},
  destroyed: false,
  ...over,
});

describe('sameShipStatus', () => {
  it('ignores the shield, threats and salvage prompt', () => {
    expect(sameShipStatus({ view: view() }, { view: view({ shield: null, threat: { nearby: 0, attacking: 0, nearest: null } }) })).toBe(true);
  });

  it('redraws on a hull, cannon, hold or silhouette change', () => {
    expect(sameShipStatus({ view: view() }, { view: view({ hull: { current: 19, max: 28, fraction: 19 / 28 } }) })).toBe(false);
    expect(sameShipStatus({ view: view() }, { view: view({ cannons: { total: 2, ready: 1 } }) })).toBe(false);
    expect(sameShipStatus({ view: view() }, { view: view({ salvageHold: { 'engine:1': 1 } as never }) })).toBe(false);
    const hit = view();
    hit.silhouette = { ...hit.silhouette, cells: [{ ...(hit.silhouette.cells[0] as object), fraction: 0.5 } as never] };
    expect(sameShipStatus({ view: view() }, { view: hit })).toBe(false);
  });
});

describe('the combat overlays part by part', () => {
  const screen = { width: 1920, height: 1080 };
  const hit = { angle: 1, age: 0.1, intensity: 0.9, shield: false };

  it('hit markers redraw while any fades, else not', () => {
    expect(sameHitMarkers({ hits: [], view: screen }, { hits: [], view: { ...screen } })).toBe(true);
    expect(sameHitMarkers({ hits: [hit], view: screen }, { hits: [hit], view: screen })).toBe(false);
    expect(sameHitMarkers({ hits: [], view: screen }, { hits: [], view: { width: 1280, height: 720 } })).toBe(false);
  });

  it('the pirate band: the distance as a whole number, the bearing to about half a degree', () => {
    const band = (distance: number, angle: number, mode = 'compact') => ({ threat: { nearby: 1, attacking: 1, nearest: { distance, angle } }, mode });
    expect(sameThreatBand(band(120.2, 1), band(119.8, 1.003))).toBe(true);
    expect(sameThreatBand(band(120.2, 1), band(121.4, 1))).toBe(false);
    expect(sameThreatBand(band(120, 1), band(120, 1.02))).toBe(false);
    expect(sameThreatBand(band(120, 1), band(120, 1, 'alert'))).toBe(false);
    expect(sameThreatBand(band(120, 1), { threat: { nearby: 2, attacking: 1, nearest: { distance: 120, angle: 1 } }, mode: 'compact' })).toBe(false);
  });

  it('the salvage prompt: the distance as its text and the in-range flag', () => {
    const prompt = (distance: number, inRange = false) => ({ salvage: { kind: 'wreck' as const, wreckId: 1, distance, inRange, cargo: {}, parts: {} } });
    expect(sameSalvagePrompt(prompt(12.31), prompt(12.34))).toBe(true);
    expect(sameSalvagePrompt(prompt(12.3), prompt(12.6))).toBe(false);
    expect(sameSalvagePrompt(prompt(3, false), prompt(3, true))).toBe(false);
  });

  it('the vignette follows the last hull hit for 0.45 s', () => {
    const data = (hullHit: CombatHudData['hullHit']): CombatHudData => ({ view: view(), hits: [], now: 10, hullHit, threat: null });
    expect(vignetteSeq(data(null))).toBe(-1);
    expect(vignetteSeq(data({ seq: 4, age: 0.2 }))).toBe(4);
    expect(vignetteSeq(data({ seq: 4, age: 0.5 }))).toBe(-1);
  });
});

describe('bands, chips and arrows compare what they show', () => {
  const row = (over: Partial<ObjectiveItem> = {}): ObjectiveItem => ({ id: 'c:1', scale: 'now', trackName: 'Contract', title: 'Deliver', why: '', distance: 1200.2, angle: 0.5, progress: null, ...over });

  it('the objectives band: whole distance, bearing to about half a degree, only the two rows shown', () => {
    expect(sameObjectiveBand({ items: [row()] }, { items: [row({ distance: 1199.6, angle: 0.501, why: 'other' })] })).toBe(true);
    expect(sameObjectiveBand({ items: [row()] }, { items: [row({ distance: 1198.4 })] })).toBe(false);
    expect(sameObjectiveBand({ items: [row()] }, { items: [row({ angle: 0.52 })] })).toBe(false);
    expect(sameObjectiveBand({ items: [row()] }, { items: [row({ distance: null })] })).toBe(false);
    expect(sameObjectiveBand({ items: [row({ progress: { value: 2.2, max: 5 } })] }, { items: [row({ progress: { value: 2.9, max: 5 } })] })).toBe(true);
    expect(sameObjectiveBand({ items: [row({ progress: { value: 2.9, max: 5 } })] }, { items: [row({ progress: { value: 3, max: 5 } })] })).toBe(false);
    const third = (distance: number) => [row(), row({ id: 'b' }), row({ id: 'c', distance })];
    expect(sameObjectiveBand({ items: third(10) }, { items: third(900) })).toBe(true);
    expect(sameObjectiveBand({ items: [row()] }, { items: [row(), row({ id: 'b' })] })).toBe(false);
  });

  it('event chips: the countdown in whole seconds (rounded up); the dial turns by itself', () => {
    const chip = (secondsLeft: number | null, dirDeg: number | null = 30): EventChipItem => ({ key: 'storm:1', kind: 'ionStorm', title: 'Storm', secondsLeft, dirDeg, tone: 'warn', pending: false });
    expect(sameEventChips({ chips: [chip(8.9)] }, { chips: [chip(8.1, 30.2)] })).toBe(true);
    expect(sameEventChips({ chips: [chip(8.1)] }, { chips: [chip(7.9)] })).toBe(false);
    expect(sameEventChips({ chips: [chip(-1)] }, { chips: [chip(-3)] })).toBe(true);
    expect(sameEventChips({ chips: [chip(5)] }, { chips: [chip(null)] })).toBe(false);
    expect(sameEventChips({ chips: [chip(5, 30)] }, { chips: [chip(5, 140)] })).toBe(true);
    expect(sameEventChips({ chips: [chip(5, 30)] }, { chips: [chip(5, null)] })).toBe(false);
    expect(sameEventChips({ chips: [chip(5)] }, { chips: [chip(5)], inline: true })).toBe(false);
  });

  it('edge arrows: whole pixels, half degrees, fades in 8-bit steps', () => {
    const mark = (over: Partial<EdgeArrowMark> = {}): EdgeArrowMark => ({ key: 'route', x: 100.2, y: 40.4, angle: 1, color: '#fff', label: 'Route 1 200 u', ...over });
    expect(sameEdgeArrows({ arrows: [mark()] }, { arrows: [mark({ x: 99.6, y: 40.1, angle: 1.004 })] })).toBe(true);
    expect(sameEdgeArrows({ arrows: [mark()] }, { arrows: [mark({ x: 101 })] })).toBe(false);
    expect(sameEdgeArrows({ arrows: [mark()] }, { arrows: [mark({ angle: 1.02 })] })).toBe(false);
    expect(sameEdgeArrows({ arrows: [mark()] }, { arrows: [mark({ label: 'Route 1 190 u' })] })).toBe(false);
    expect(sameEdgeArrows({ arrows: [mark({ alpha: 0.5 })] }, { arrows: [mark({ alpha: 0.5009 })] })).toBe(true);
    expect(sameEdgeArrows({ arrows: [mark({ alpha: 0.5 })] }, { arrows: [mark({ alpha: 0.51 })] })).toBe(false);
    expect(sameEdgeArrows({ arrows: [mark({ scale: 1.001 })] }, { arrows: [mark({ scale: 1.002 })] })).toBe(true);
    expect(sameEdgeArrows({ arrows: [mark({ flash: 0.3 })] }, { arrows: [mark({ flash: 0 })] })).toBe(false);
    expect(sameEdgeArrows({ arrows: [mark()] }, { arrows: [mark(), mark({ key: 'b' })] })).toBe(false);
  });

  it('the dial: the arrow to half a degree, its whole-degree data and its clock hour', () => {
    expect(sameDial({ deg: 30.1 }, { deg: 30.2 })).toBe(true);
    expect(sameDial({ deg: 30.1 }, { deg: 31 })).toBe(false);
    // data-deg flips at 30.5 while the half-degree step does not
    expect(sameDial({ deg: 30.49 }, { deg: 30.51 })).toBe(false);
    expect(sameDial({ deg: -10 }, { deg: 350 })).toBe(true);
  });

  it('the station arrow: whole pixels, half degrees, its label', () => {
    const arrow = (x: number, angle = 2, label = 'Hub 300 u') => ({ arrow: { x, y: 500.3, angle, label } });
    expect(sameHudArrow(arrow(1800.2), arrow(1799.8, 2.001))).toBe(true);
    expect(sameHudArrow(arrow(1800.2), arrow(1801))).toBe(false);
    expect(sameHudArrow(arrow(1800), arrow(1800, 2, 'Hub 299 u'))).toBe(false);
  });

  it('the collision band: urgency to two decimals, the time as its text', () => {
    const c = (time: number, urgency: number, dampersOff = false) => ({ c: { time, urgency, dampersOff } });
    expect(sameCollision(c(2.01, 0.501), c(2.03, 0.503))).toBe(true);
    expect(sameCollision(c(2, 0.5), c(2, 0.52))).toBe(false);
    expect(sameCollision(c(2, 0.5), c(2.4, 0.5))).toBe(false);
    expect(sameCollision(c(2, 0.5), c(2, 0.5, true))).toBe(false);
  });
});

describe('the scanner widget', () => {
  const scan = (over: Partial<ScanHudData> = {}): ScanHudData => ({ charge: 0.42, ready: false, cooldown: 6, analysis: null, pulse: null, dataFund: 12, buffs: [], storm: false, readout: null, ...over });

  it('the charge as its percent and lit bar', () => {
    expect(sameScanWidget({ d: scan() }, { d: scan({ charge: 0.4204, pulse: 3 }) })).toBe(true);
    expect(sameScanWidget({ d: scan() }, { d: scan({ charge: 0.43 }) })).toBe(false);
    expect(sameScanWidget({ d: scan() }, { d: scan({ cooldown: 5 }) })).toBe(false);
  });

  it('the analysis as its percent', () => {
    const at = (progress: number) => scan({ analysis: { label: 'Rock', progress } });
    expect(sameScanWidget({ d: at(0.501) }, { d: at(0.503) })).toBe(true);
    expect(sameScanWidget({ d: at(0.5) }, { d: at(0.52) })).toBe(false);
    expect(sameScanWidget({ d: scan() }, { d: at(0.5) })).toBe(false);
  });
});

describe('the radar at its pixel resolution', () => {
  // range 800: 80 px of display radius (less the rim) per 800 u – 0.1 px per unit
  const pirate = (angle: number): object => ({ kind: 'pirate', x: 300, y: 10, angle, attacking: true, edge: false, glyph: 'shipAttacking' });
  const radar = (over: Partial<RadarDrawProps> = {}): RadarDrawProps => ({
    range: 800,
    contacts: [{ x: 100, y: -50, radius: 20, color: '#abc' }],
    stations: [],
    threats: [pirate(1)],
    angle: 0.5,
    ring: 1,
    signals: [],
    places: [],
    survey: [],
    pirates: [],
    sectors: null,
    security: 'guarded',
    sites: [],
    guild: [],
    ...over,
  });

  it('a contact that moved less than a pixel, a heading under half a degree: the same picture', () => {
    expect(sameRadar(radar(), radar({ contacts: [{ x: 102, y: -51, radius: 20.5, color: '#abc' }], angle: 0.501 }))).toBe(true);
  });

  it('redraws when a contact crosses a pixel, turns, or anything else changes', () => {
    expect(sameRadar(radar(), radar({ contacts: [{ x: 106, y: -50, radius: 20, color: '#abc' }] }))).toBe(false);
    expect(sameRadar(radar(), radar({ contacts: [{ x: 100, y: -50, radius: 20, color: '#def' }] }))).toBe(false);
    expect(sameRadar(radar(), radar({ contacts: [] }))).toBe(false);
    expect(sameRadar(radar(), radar({ threats: [pirate(1.2)] }))).toBe(false);
    expect(sameRadar(radar(), radar({ angle: 0.52 }))).toBe(false);
    expect(sameRadar(radar(), radar({ range: 900 }))).toBe(false);
    expect(sameRadar(radar(), radar({ security: 'lawless' }))).toBe(false);
  });

  it('a signal crossing the range moves to the rim: redraws even within a pixel', () => {
    const signal = (x: number): object => ({ x, y: 0, radius: 40, kind: 'echo' });
    expect(sameRadar(radar({ signals: [signal(799.9)] }), radar({ signals: [signal(800.2)] }))).toBe(false);
    expect(sameRadar(radar({ signals: [signal(700)] }), radar({ signals: [signal(702)] }))).toBe(true);
  });

  it('sector borders: the same lines at an offset within a pixel', () => {
    const groups = [{ security: 'guarded', adjacent: true, lines: [[0, 0, 10, 10]] }];
    expect(sameRadar(radar({ sectors: { offset: { x: 30, y: 1 }, groups } }), radar({ sectors: { offset: { x: 33, y: 2 }, groups } }))).toBe(true);
    expect(sameRadar(radar({ sectors: { offset: { x: 30, y: 1 }, groups } }), radar({ sectors: { offset: { x: 36, y: 1 }, groups } }))).toBe(false);
    expect(sameRadar(radar({ sectors: { offset: { x: 30, y: 1 }, groups } }), radar({ sectors: { offset: { x: 30, y: 1 }, groups: [] } }))).toBe(false);
  });
});

describe('the flight console', () => {
  const cargo = (over: Partial<Cargo> = {}): Cargo => ({ ...Object.fromEntries(RESOURCE_IDS.map((id) => [id, 0])), ...over }) as Cargo;
  const gauge = (value: number): GaugeProps => ({ kind: 'fuel', label: 'Fuel', value, max: 100, compact: true, segments: 24 });
  const gauges = (over: Partial<ConsoleGaugesProps> = {}): ConsoleGaugesProps => ({ shield: null, hull: null, fuel: gauge(50.21), energy: gauge(80), cargo: gauge(3), mining: null, pops: [], tags: cargo(), ...over });
  const [a, b] = RESOURCE_IDS;

  it('cargo tags: the resources shown and their amounts as written', () => {
    expect(sameCargoTags({ cargo: cargo({ [a!]: 2.01 }) }, { cargo: cargo({ [a!]: 2.03, [b!]: 0.01 }) })).toBe(true);
    expect(sameCargoTags({ cargo: cargo({ [a!]: 2 }) }, { cargo: cargo({ [a!]: 2.4 }) })).toBe(false);
    expect(sameCargoTags({ cargo: cargo() }, { cargo: cargo({ [b!]: 0.06 }) })).toBe(false);
  });

  it('the gauges as they show', () => {
    expect(sameConsoleGauges(gauges(), gauges({ fuel: gauge(50.24) }))).toBe(true);
    expect(sameConsoleGauges(gauges(), gauges({ fuel: gauge(51.1) }))).toBe(false);
    expect(sameConsoleGauges(gauges(), gauges({ hull: gauge(20) }))).toBe(false);
    expect(sameConsoleGauges(gauges(), gauges({ pops: [{ seq: 1, text: '+1' } as never] }))).toBe(false);
    expect(sameConsoleGauges(gauges(), gauges({ tags: null }))).toBe(false);
  });
});

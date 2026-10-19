import { describe, expect, it } from 'vitest';
import { PART_DEFS } from '../../data/parts';
import { applyExhaustBurns, BLOCKED_EXHAUST_THRUST, blockedExhausts, burnNotice, COCKPIT_BURN_FLOOR, EXHAUST_BURN_DPS, groupLoad } from './exhaust';
import { createGrid } from './grid';
import { createStarterShip } from './presets';
import { computeProperties } from './properties';

const ENGINE = PART_DEFS.engine[1].thrust!;

/** Cockpit, a forward engine behind it and – with `covered` – a cargo hold right behind its nozzle. */
const ship = (covered: boolean) =>
  createGrid(
    covered
      ? [['cockpit', 1, 0], ['engine', 0, 0, 0], ['cargo', -1, 0], ['engine', 1, 1, 3]]
      : [['cockpit', 1, 0], ['engine', 0, 0, 0], ['engine', 1, 1, 3]],
  );

describe('blocked exhaust (design 3.4.2)', () => {
  it('finds engines whose nozzle points into another part', () => {
    expect(blockedExhausts(ship(false))).toEqual([]);
    expect(blockedExhausts(ship(true))).toEqual([{ engineId: 2, partId: 3 }]);
    // an engine pushing right (rot 3) under the cockpit blows up (+y), straight into it
    expect(blockedExhausts(createGrid([['cockpit', 0, 0], ['engine', 0, -1, 3]]))).toEqual([{ engineId: 2, partId: 1 }]);
  });

  it('the starter ship covers no nozzle', () => {
    expect(blockedExhausts(createStarterShip())).toEqual([]);
  });

  it('a covered nozzle halves that engine’s thrust and is listed as a burn of its thrust group', () => {
    const free = computeProperties(ship(false));
    const covered = computeProperties(ship(true));
    expect(free.thrust.forward).toBe(ENGINE);
    expect(covered.thrust.forward).toBe(ENGINE * BLOCKED_EXHAUST_THRUST);
    expect(covered.thrust.right).toBe(ENGINE);
    expect(free.exhaustBurns).toEqual([]);
    expect(covered.exhaustBurns).toEqual([{ engineId: 2, partId: 3, group: 'forward' }]);
  });

  it('the part burns at 2 HP/s while its engine group fires at full power, less at part throttle', () => {
    const grid = ship(true);
    const props = computeProperties(grid);
    const s = { grid, hp: new Map<number, number>(), props };
    const max = PART_DEFS.cargo[1].hp;
    // the engine fires forward at full power for one second
    for (let i = 0; i < 60; i++) applyExhaustBurns(s, { x: props.thrust.forward, y: 0 }, 1 / 60);
    expect(s.hp.get(3)).toBeCloseTo(max - EXHAUST_BURN_DPS);
    // half throttle burns half as fast; braking or strafing does not burn this part
    for (let i = 0; i < 60; i++) applyExhaustBurns(s, { x: props.thrust.forward / 2, y: 0 }, 1 / 60);
    expect(s.hp.get(3)).toBeCloseTo(max - EXHAUST_BURN_DPS * 1.5);
    expect(applyExhaustBurns(s, { x: -5, y: -10 }, 1 / 60)).toEqual([]);
    expect(groupLoad({ x: -5, y: -10 }, props.thrust)).toMatchObject({ forward: 0, right: 10 / ENGINE });
  });

  it('never burns the cockpit below 1 HP (I15 – an old ship with a nozzle into the cockpit must not die of it)', () => {
    const grid = createGrid([['cockpit', 0, 0], ['engine', 0, -1, 3]]);
    const props = computeProperties(grid);
    const s = { grid, hp: new Map<number, number>(), props };
    // far longer than the cockpit's HP lasts at 2 HP/s
    for (let i = 0; i < 60 * 600; i++) applyExhaustBurns(s, { x: 0, y: -props.thrust.right }, 1 / 60);
    expect(s.hp.get(1)).toBe(COCKPIT_BURN_FLOOR);
    expect(applyExhaustBurns(s, { x: 0, y: -props.thrust.right }, 1 / 60)).toEqual([]);
  });

  it('announces a burn when it starts and at every quarter of the part’s HP', () => {
    expect(burnNotice({ engineId: 1, partId: 2, before: 30, after: 29.9 }, 30)).toBe(true);
    expect(burnNotice({ engineId: 1, partId: 2, before: 29.9, after: 29.8 }, 30)).toBe(false);
    expect(burnNotice({ engineId: 1, partId: 2, before: 15.01, after: 14.99 }, 30)).toBe(true);
    expect(burnNotice({ engineId: 1, partId: 2, before: 0.01, after: 0 }, 30)).toBe(false);
  });
});

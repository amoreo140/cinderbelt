import { describe, expect, it, vi } from 'vitest';
import { ESCORT } from '../../data/convoys';
import type { EscortState } from '../../sim/convoys/types';
import type { SimState } from '../../sim/Simulation';
import { escortFullHull, escortMoving, escortRenderProgress, escortShipsNow } from './escortLook';

const calls = vi.hoisted(() => ({ list: [] as { serial: number; progress: number }[] }));
vi.mock('../../sim/convoys/escort', () => ({
  // the trader at x = progress, the tanker (when the record has two hulls) 16 u behind
  escortShips: (_s: unknown, serial: number, e: EscortState) => {
    calls.list.push({ serial, progress: e.progress });
    const kinds = e.hulls.length > 1 ? (['trader', 'tanker'] as const) : (['trader'] as const);
    return kinds
      .map((kind, index) => ({ id: `es:${serial}:${kind}`, kind, index, pos: { x: e.progress - index * 16, y: 0 }, heading: 0, vel: { x: 0, y: 0 } }))
      .filter((s) => (e.hulls[s.index] ?? 0) > 0);
  },
}));

const record = (over: Partial<EscortState> = {}): EscortState => ({ progress: 100, state: 'moving', departed: 1, away: 0, stopUntil: 0, fired: 0, hulls: [ESCORT.traderHull, ESCORT.tankerHull], ...over });

function stateWith(escorts: [number, EscortState][], contracts: number[] = escorts.map(([s]) => s)): SimState {
  return {
    convoys: { escorts: new Map(escorts) },
    career: { contracts: contracts.map((serial) => ({ serial, target: { kind: 'escort', lane: 'A', from: 0, to: 3000, meet: { x: 0, y: 0 }, end: { x: 0, y: 0 }, ambushes: [] } })) },
  } as unknown as SimState;
}

describe('escort convoys in the render', () => {
  it('a flying convoy is drawn between the last two steps', () => {
    const step = ESCORT.speed / 60;
    expect(escortRenderProgress(record(), 1)).toBe(100);
    expect(escortRenderProgress(record(), 0)).toBeCloseTo(100 - step);
    expect(escortRenderProgress(record(), 0.5)).toBeCloseTo(100 - step / 2);
    // waiting / stopped convoys stand still
    expect(escortRenderProgress(record({ state: 'waiting' }), 0)).toBe(100);
    expect(escortRenderProgress(record({ state: 'stopped' }), 0)).toBe(100);
    expect(escortMoving({ state: 'done' })).toBe(true);
  });

  it('lists the living ships of accepted escorts with their hull shares', () => {
    calls.list.length = 0;
    const st = stateWith([
      [3, record({ hulls: [ESCORT.traderHull / 4, ESCORT.tankerHull] })],
      [5, record({ state: 'stopped', hulls: [ESCORT.traderHull, 0] })],
    ]);
    const ships = escortShipsNow(st, 1);
    expect(ships.map((s) => s.id)).toEqual(['es:3:trader', 'es:3:tanker', 'es:5:trader']);
    expect(ships[0]!.hull).toBeCloseTo(0.25);
    expect(ships[1]!.hull).toBe(1);
    expect(ships.map((s) => s.moving)).toEqual([true, true, false]);
    expect(escortFullHull('tanker')).toBe(ESCORT.tankerHull);
  });

  it('skips records without a contract and ships out of range', () => {
    const st = stateWith([[3, record({ progress: 100 })], [4, record({ progress: 5000 })]], [3, 4, 9]);
    expect(escortShipsNow(st, 1, [], { x: 0, y: 0 }, 200).map((s) => s.id)).toEqual(['es:3:trader', 'es:3:tanker']);
    expect(escortShipsNow(stateWith([], [3]), 1)).toEqual([]);
    expect(escortShipsNow(stateWith([[7, record()]], []), 1)).toEqual([]);
  });
});

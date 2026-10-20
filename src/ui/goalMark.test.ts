import { describe, expect, it } from 'vitest';
import { goalLabelFlips, goalMark, sameGoalHud, type GoalHud } from './goalMark';

const view = { width: 1000, height: 600 };
const ship = { x: 500, y: 300 };

describe('goalMark', () => {
  it('marks a goal inside the view in place', () => {
    const r = goalMark({ x: 700, y: 300 }, ship, view);
    expect(r.mark).toEqual({ kind: 'onScreen', x: 700, y: 300 });
    expect(r.bearing).toBeCloseTo(0);
  });
  it('gives an edge arrow on each side', () => {
    const right = goalMark({ x: 1400, y: 300 }, ship, view).mark;
    expect(right).toMatchObject({ kind: 'edge', x: 936, y: 300 });
    const left = goalMark({ x: -400, y: 300 }, ship, view).mark;
    expect(left).toMatchObject({ kind: 'edge', x: 64 });
    const top = goalMark({ x: 500, y: -500 }, ship, view).mark;
    expect(top).toMatchObject({ kind: 'edge', y: 64 });
    const bottom = goalMark({ x: 500, y: 1500 }, ship, view).mark;
    expect(bottom).toMatchObject({ kind: 'edge', y: 536 });
  });
  it('treats a point inside the margin as edge', () => {
    expect(goalMark({ x: 990, y: 300 }, ship, view).mark.kind).toBe('edge');
    expect(goalMark({ x: 500, y: 40 }, ship, view).mark.kind).toBe('edge');
  });
  it('bearing is the screen direction from the ship', () => {
    expect(goalMark({ x: 500, y: 500 }, ship, view).bearing).toBeCloseTo(Math.PI / 2);
    expect(goalMark({ x: 300, y: 300 }, ship, view).bearing).toBeCloseTo(Math.PI);
    expect(goalMark({ x: 500, y: 100 }, ship, view).bearing).toBeCloseTo(-Math.PI / 2);
  });
  it('mirrors a goal behind the camera', () => {
    const r = goalMark({ x: 600, y: 300, behind: true }, ship, view);
    expect(r.mark.kind).toBe('edge');
    expect(r.bearing).toBeCloseTo(Math.PI);
  });
});

describe('sameGoalHud', () => {
  const g = (over: Partial<GoalHud> = {}): GoalHud => ({ label: 'Buoy', distance: 97.2, bearing: 0, mark: { kind: 'onScreen', x: 100.2, y: 50 }, ...over });
  it('ignores sub-pixel and sub-unit changes', () => {
    expect(sameGoalHud(g(), g({ distance: 96.8, mark: { kind: 'onScreen', x: 100.4, y: 50 } }))).toBe(true);
  });
  it('sees a changed bearing', () => {
    expect(sameGoalHud(g(), g({ bearing: 0.5 }))).toBe(false);
  });
  it('sees a changed name, distance or mark kind', () => {
    expect(sameGoalHud(g(), g({ label: 'Rock' }))).toBe(false);
    expect(sameGoalHud(g(), g({ distance: 99 }))).toBe(false);
    expect(sameGoalHud(g(), g({ mark: { kind: 'edge', x: 100, y: 50, angle: 0 } }))).toBe(false);
  });
});

describe('goalLabelFlips', () => {
  it('keeps the label right of the ring in free space', () => {
    expect(goalLabelFlips(400, 300, 12, view, [])).toBe(false);
  });
  it('flips at the right screen edge', () => {
    expect(goalLabelFlips(900, 300, 12, view, [])).toBe(true);
  });
  it('flips when a panel is right of the ring and the left is free', () => {
    expect(goalLabelFlips(400, 300, 12, view, [{ x: 450, y: 250, width: 300, height: 100 }])).toBe(true);
  });
  it('stays when both sides are blocked', () => {
    expect(goalLabelFlips(400, 300, 12, view, [{ x: 0, y: 250, width: 1000, height: 100 }])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createGrid } from '../ship/grid';
import { createStarterShip } from '../ship/presets';
import {
  applyStroke,
  canRedo,
  canUndo,
  createDraft,
  draftOps,
  extendStroke,
  HISTORY_LIMIT,
  isDraftDirty,
  rebaseDraft,
  redoDraft,
  resetDraft,
  restoreDraft,
  setAcquire,
  undoDraft,
  type ShipyardDraft,
} from './draft';

const base = () => createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]);
const fresh = (): ShipyardDraft => createDraft('home', base(), new Map(), { 'armor:1': 2 });
const ids = (d: ShipyardDraft) => d.grid.parts.map((p) => p.id);

describe('restoreDraft (M3.8)', () => {
  it('replaces whatever the draft was with the restore ops – one undo step', () => {
    const d0 = applyStroke(fresh(), [{ op: 'place', key: 'armor:1', x: 0, y: 1, rot: 0 }]).draft;
    const ops = [{ op: 'place' as const, key: 'armor:1' as const, x: 1, y: 0, rot: 0 as const }];
    const d1 = restoreDraft(d0, ops);
    expect(draftOps(d1)).toEqual(ops);
    expect(d1.grid.parts.map((p) => [p.partId, p.x, p.y])).toEqual([['cockpit', 0, 0], ['engine', -1, 0], ['armor', 1, 0]]);
    expect(isDraftDirty(d1)).toBe(true);
    const back = undoDraft(d1);
    expect(back.grid).toEqual(d0.grid);
    expect(redoDraft(back).grid).toEqual(d1.grid);
  });

  it('survives the history limit (the restore becomes the locked base of later strokes)', () => {
    let d = restoreDraft(fresh(), [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]);
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      d = applyStroke(d, [{ op: 'move', id: 3, x: 1, y: 0, rot: ((i % 3) + 1) as 1 | 2 | 3 }]).draft;
    }
    expect(d.grid.parts.some((p) => p.partId === 'armor')).toBe(true);
    expect(draftOps(d)[0]).toEqual({ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 });
  });

  it('is a no-op without operations', () => {
    const d = fresh();
    expect(restoreDraft(d, [])).toBe(d);
  });
});

describe('ShipyardDraft', () => {
  it('starts as a copy of the ship with empty history', () => {
    const d = fresh();
    expect(d.grid).toEqual(base());
    expect(d.undo).toEqual([]);
    expect(canUndo(d)).toBe(false);
    expect(canRedo(d)).toBe(false);
    expect(isDraftDirty(d)).toBe(false);
    expect(draftOps(d)).toEqual([]);
  });

  it('applies a stroke as one undo step and skips failing ops', () => {
    const d0 = fresh();
    const { draft: d1, applied, errors } = applyStroke(d0, [
      { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 },
      { op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 },
      { op: 'place', key: 'armor:1', x: 2, y: 0, rot: 0 },
    ]);
    expect(applied).toHaveLength(2);
    expect(errors).toEqual(['occupied']);
    expect(ids(d1)).toEqual([1, 2, 3, 4]);
    expect(d1.undo).toHaveLength(1);
    expect(isDraftDirty(d1)).toBe(true);
    // the original design did not change
    expect(ids(d0)).toEqual([1, 2]);
  });

  it('leaves the draft untouched when nothing applies', () => {
    const d = fresh();
    const r = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 0, y: 0, rot: 0 }]);
    expect(r.draft).toBe(d);
    expect(r.errors).toEqual(['occupied']);
  });

  it('undoes and redoes whole strokes', () => {
    let d = fresh();
    d = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]).draft;
    d = applyStroke(d, [{ op: 'remove', id: 2 }]).draft;
    expect(ids(d)).toEqual([1, 3]);
    d = undoDraft(d);
    expect(ids(d)).toEqual([1, 2, 3]);
    d = undoDraft(d);
    expect(ids(d)).toEqual([1, 2]);
    expect(canUndo(d)).toBe(false);
    expect(undoDraft(d)).toBe(d);
    d = redoDraft(d);
    d = redoDraft(d);
    expect(ids(d)).toEqual([1, 3]);
    expect(redoDraft(d)).toBe(d);
  });

  it('a new stroke clears redo', () => {
    let d = applyStroke(fresh(), [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]).draft;
    d = undoDraft(d);
    expect(canRedo(d)).toBe(true);
    d = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 0, y: 1, rot: 0 }]).draft;
    expect(canRedo(d)).toBe(false);
  });

  it('extends the last stroke while painting', () => {
    let d = applyStroke(fresh(), [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]).draft;
    d = extendStroke(d, [{ op: 'place', key: 'armor:1', x: 2, y: 0, rot: 0 }]).draft;
    d = extendStroke(d, [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]).draft;
    expect(d.undo).toHaveLength(1);
    expect(ids(d)).toEqual([1, 2, 3, 4, 5]);
    expect(ids(undoDraft(d))).toEqual([1, 2]);
  });

  it('skips moves that change nothing', () => {
    const d = fresh();
    expect(applyStroke(d, [{ op: 'move', id: 2, x: -1, y: 0, rot: 0 }]).draft).toBe(d);
  });

  it('resets to the original ship as one undoable stroke', () => {
    let d = applyStroke(fresh(), [
      { op: 'remove', id: 2 },
      { op: 'place', key: 'engine:1', x: 0, y: 1, rot: 1 },
    ]).draft;
    d = resetDraft(d);
    expect(d.grid).toEqual(base());
    expect(isDraftDirty(d)).toBe(false);
    expect(draftOps(d)).toEqual([]);
    d = undoDraft(d);
    expect(ids(d)).toEqual([1, 3]);
    // reset on the original ship adds nothing
    const clean = fresh();
    expect(resetDraft(clean)).toBe(clean);
  });

  it('places after a reset reuse ids from the base', () => {
    let d = applyStroke(fresh(), [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]).draft;
    d = resetDraft(d);
    d = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 0, y: 1, rot: 0 }]).draft;
    expect(draftOps(d)).toEqual([{ op: 'place', key: 'armor:1', x: 0, y: 1, rot: 0 }]);
    expect(d.grid.parts.at(-1)!.id).toBe(3);
  });

  it('keeps at most 100 strokes but never loses their effect', () => {
    expect(HISTORY_LIMIT).toBe(100);
    let d = createDraft('home', createGrid([['cockpit', 0, 0]]), new Map(), {});
    for (let i = 0; i < 110; i++) {
      const rot = (i % 4) as 0 | 1 | 2 | 3;
      d = applyStroke(d, [{ op: 'move', id: 1, x: 0, y: 0, rot: rot === 0 ? 1 : rot }]).draft;
      d = applyStroke(d, [{ op: 'move', id: 1, x: 0, y: 0, rot: 0 }]).draft;
    }
    d = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 1, y: 0, rot: 0 }]).draft;
    expect(d.undo).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 200; i++) d = undoDraft(d);
    expect(canUndo(d)).toBe(false);
    // the oldest moves can no longer be undone, but their result stays in the design
    expect(d.grid.parts).toHaveLength(1);
    expect(draftOps(redoDraft(d)).length).toBeGreaterThan(0);
  });

  it('remembers how missing parts should be acquired', () => {
    const d = setAcquire(fresh(), 'engine:1', 'buy');
    expect(d.acquire).toEqual({ 'engine:1': 'buy' });
    expect(setAcquire(d, 'engine:1', null).acquire).toEqual({});
  });

  it('rebases onto a changed ship by replaying the operations', () => {
    let d = createDraft('home', createStarterShip(), new Map(), {});
    d = applyStroke(d, [{ op: 'place', key: 'armor:1', x: 3, y: 0, rot: 0 }]).draft;
    d = applyStroke(d, [{ op: 'remove', id: 14 }]).draft;
    // meanwhile the ship changed: part 14 no longer exists
    const changed = createStarterShip();
    changed.parts = changed.parts.filter((p) => p.id !== 14);
    const { draft, dropped } = rebaseDraft(d, changed, new Map(), { 'armor:1': 1 });
    expect(dropped).toBe(1);
    expect(draft.base.grid).toEqual(changed);
    expect(draft.base.inventory).toEqual({ 'armor:1': 1 });
    expect(draft.undo).toHaveLength(1);
    expect(draft.grid.parts.some((p) => p.x === 3 && p.y === 0)).toBe(true);
  });
});

describe('shapes in the draft (SL2 E2)', () => {
  const winged = (): ShipyardDraft =>
    createDraft('home', createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ['armor', 0, 1, 0, 1, 'wingL']]), new Map(), {});

  it('a shape-only group move (Shift+M of a wing on the axis) is applied, not dropped as a no-op', () => {
    const r = applyStroke(winged(), [{ op: 'moveGroup', moves: [{ id: 3, x: 0, y: 1, rot: 0, shape: 'wingR' }] }]);
    expect(r.applied).toHaveLength(1);
    expect(r.draft.grid.parts.find((p) => p.id === 3)?.shape).toBe('wingR');
    expect(isDraftDirty(r.draft)).toBe(true);
  });

  it('a group move to the same place and shape is still a no-op (missing shape = keep it)', () => {
    const d = winged();
    expect(applyStroke(d, [{ op: 'moveGroup', moves: [{ id: 3, x: 0, y: 1, rot: 0, shape: 'wingL' }] }]).draft).toBe(d);
    expect(applyStroke(d, [{ op: 'moveGroup', moves: [{ id: 3, x: 0, y: 1, rot: 0 }] }]).draft).toBe(d);
    expect(applyStroke(d, [{ op: 'move', id: 3, x: 0, y: 1, rot: 0 }]).draft).toBe(d);
  });

  it('a group move clearing the shape (null) is a change', () => {
    const r = applyStroke(winged(), [{ op: 'moveGroup', moves: [{ id: 3, x: 0, y: 1, rot: 0, shape: null }] }]);
    expect(r.applied).toHaveLength(1);
    expect(r.draft.grid.parts.find((p) => p.id === 3)).not.toHaveProperty('shape');
  });

  it('a reshape makes the draft dirty; reshaping back makes it clean again', () => {
    const d1 = applyStroke(winged(), [{ op: 'reshape', id: 3, shape: null }]).draft;
    expect(isDraftDirty(d1)).toBe(true);
    const d2 = applyStroke(d1, [{ op: 'reshape', id: 3, shape: 'wingL' }]).draft;
    expect(isDraftDirty(d2)).toBe(false);
  });
});

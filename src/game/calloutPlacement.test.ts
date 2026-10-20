import { describe, expect, it } from 'vitest';
import { calloutSide, edgeArrowBox, hudPanelBoxes, type Box } from './calloutPlacement';
import { NAV_ZONE } from '../ui/hudZones';

const view = { width: 1280, height: 720 };

describe('callout placement', () => {
  it('above and to the right of the anchor in open space', () => {
    expect(calloutSide(600, 400, view)).toEqual({ flip: false, below: false });
  });

  it('left of the anchor near the right edge, below it near the top edge', () => {
    expect(calloutSide(1100, 400, view)).toEqual({ flip: true, below: false });
    expect(calloutSide(600, 90, view)).toEqual({ flip: false, below: true });
  });

  it('hides the label when its anchor is off screen or on the very edge (it would be cut off)', () => {
    expect(calloutSide(600, -40, view)).toBeNull();
    expect(calloutSide(600, 4, view)).toBeNull();
    expect(calloutSide(-10, 300, view)).toBeNull();
    expect(calloutSide(1300, 300, view)).toBeNull();
    expect(calloutSide(600, 730, view)).toBeNull();
  });

  it('a label never reaches above the top edge: a low enough anchor puts it below', () => {
    // just under the old 130 px threshold the label above would start at ~y 10 – still on screen
    const side = calloutSide(600, 140, view)!;
    expect(side.below).toBe(false);
    // a tall label goes below sooner
    expect(calloutSide(600, 140, view, [], 130)!.below).toBe(true);
  });

  it('dodges an edge-arrow label by taking the other side of the anchor', () => {
    // an arrow label right where the label above the anchor would be
    const arrow: Box = { x: 640, y: 290, w: 160, h: 40 };
    expect(calloutSide(600, 400, view, [arrow])).toEqual({ flip: false, below: true });
  });

  it('keeps its side when both sides are taken', () => {
    const above: Box = { x: 640, y: 290, w: 160, h: 40 };
    const below: Box = { x: 640, y: 450, w: 160, h: 40 };
    expect(calloutSide(600, 400, view, [above, below])).toEqual({ flip: false, below: false });
  });

  it('an edge arrow at the top edge covers its head and its label towards the centre', () => {
    // pointing up (angle −π/2): the label sits under the tip
    const box = edgeArrowBox({ x: 640, y: 30, angle: -Math.PI / 2 });
    expect(box.x).toBeLessThan(640);
    expect(box.x + box.w).toBeGreaterThan(640);
    expect(box.y).toBeLessThanOrEqual(10);
    expect(box.y + box.h).toBeGreaterThan(56);
  });

  it('a label that would cover the top-left bands (navigation, objectives) goes below its anchor', () => {
    const saved = { ...NAV_ZONE };
    NAV_ZONE.width = 466;
    NAV_ZONE.height = 238;
    try {
      // a survey point just under the objectives band: above it the label would lie on the band
      expect(calloutSide(300, 300, view, hudPanelBoxes(view))).toEqual({ flip: false, below: true });
      expect(calloutSide(300, 300, view)).toEqual({ flip: false, below: false });
      // a find right of the band near the top edge: below it the label reaches over the band's
      // right end - it slides right, clear of it
      const side = calloutSide(413, 100, view, hudPanelBoxes(view))!;
      expect(side).toMatchObject({ flip: false, below: true });
      expect(413 + 24 + side.shift!).toBeGreaterThanOrEqual(NAV_ZONE.width);
      // too far to slide: it stays (the leader would get too long)
      expect(calloutSide(250, 100, view, hudPanelBoxes(view))!.shift).toBeUndefined();
    } finally {
      Object.assign(NAV_ZONE, saved);
    }
  });

  it('with the view height, the bottom corners (the console, the radar group) are panels too', () => {
    const tall = { width: 1280, height: 720 };
    const boxes = hudPanelBoxes(tall);
    expect(boxes.some((b) => b.x === 0 && b.y + b.h === 720)).toBe(true);
    expect(boxes.some((b) => b.x + b.w === 1280 && b.y + b.h === 720)).toBe(true);
    expect(hudPanelBoxes({ width: 1280 })).toHaveLength(boxes.length - 2);
  });
});

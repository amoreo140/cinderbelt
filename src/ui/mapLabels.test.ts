import { describe, expect, it } from 'vitest';
import { edgeArrow, LABEL_PRIORITY, layoutLabels, rectsOverlap, type LabelRequest } from './mapLabels';

const BOUNDS = { w: 400, h: 300 };
const label = (id: string, priority: number, x: number, y: number, extra: Partial<LabelRequest> = {}): LabelRequest => ({
  id,
  priority,
  anchor: { x, y },
  w: 80,
  h: 14,
  gap: 10,
  ...extra,
});

describe('map label layout', () => {
  it('puts a lone label on its preferred side of the anchor', () => {
    const [p] = layoutLabels([label('a', LABEL_PRIORITY.station, 100, 100)], BOUNDS);
    expect(p).toMatchObject({ id: 'a', side: 'right', x: 110, y: 93, w: 80, h: 14 });
  });

  it('orders by priority: my ship > objectives > stations > POI > ring names > grades', () => {
    const order = [LABEL_PRIORITY.ship, LABEL_PRIORITY.objective, LABEL_PRIORITY.station, LABEL_PRIORITY.poi, LABEL_PRIORITY.ring, LABEL_PRIORITY.grade];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the more important label keeps its spot, the other one moves to another side', () => {
    // the grade is listed first but the station wins the right side
    const placed = layoutLabels([label('grade', LABEL_PRIORITY.grade, 100, 100), label('station', LABEL_PRIORITY.station, 100, 100)], BOUNDS);
    const st = placed.find((p) => p.id === 'station')!;
    const gr = placed.find((p) => p.id === 'grade')!;
    expect(st.side).toBe('right');
    expect(gr.side).not.toBe('right');
    expect(rectsOverlap(st, gr)).toBe(false);
  });

  it('hides a less important label when every side is taken', () => {
    // four more important labels take the four sides around the same anchor
    const crowded = layoutLabels(
      [
        label('grade', LABEL_PRIORITY.grade, 200, 150, { w: 40, h: 12, gap: 2 }),
        label('ship', LABEL_PRIORITY.ship, 200, 150, { w: 120, h: 14, sides: ['right'] }),
        label('obj-l', LABEL_PRIORITY.objective, 200, 150, { w: 120, h: 14, sides: ['left'] }),
        label('obj-a', LABEL_PRIORITY.objective, 200, 150, { w: 120, h: 30, sides: ['above'] }),
        label('obj-b', LABEL_PRIORITY.objective, 200, 150, { w: 120, h: 30, sides: ['below'] }),
      ],
      BOUNDS,
    );
    expect(crowded.map((p) => p.id)).toEqual(['ship', 'obj-l', 'obj-a', 'obj-b']);
    // a marker covering the whole map hides an optional label too
    expect(layoutLabels([label('poi', LABEL_PRIORITY.poi, 200, 150)], BOUNDS, [{ id: 'x', x: 0, y: 0, w: 400, h: 300 }])).toEqual([]);
  });

  it('never clips a label at the edge of the map', () => {
    const placed = layoutLabels([label('ring', LABEL_PRIORITY.ring, 395, 5, { w: 160 }), label('edge', LABEL_PRIORITY.objective, 2, 298, { w: 200 })], BOUNDS);
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(BOUNDS.w);
      expect(p.y + p.h).toBeLessThanOrEqual(BOUNDS.h);
    }
  });

  it('a label wider than the map is dropped (unless it must stay)', () => {
    expect(layoutLabels([label('long', LABEL_PRIORITY.poi, 200, 150, { w: 500 })], BOUNDS)).toEqual([]);
    expect(layoutLabels([label('long', LABEL_PRIORITY.ship, 200, 150, { w: 500, keep: true })], BOUNDS)).toHaveLength(1);
  });

  it('labels that must stay (my ship, objectives) are placed even when everything collides', () => {
    const placed = layoutLabels(
      [
        label('a', LABEL_PRIORITY.objective, 200, 150, { sides: ['right'] }),
        label('b', LABEL_PRIORITY.objective, 200, 150, { sides: ['right'], keep: true }),
      ],
      BOUNDS,
    );
    expect(placed.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('labels avoid the markers of other objects but not their own', () => {
    const obstacles = [
      { id: 'a', x: 95, y: 95, w: 10, h: 10 },
      { id: 'other', x: 112, y: 92, w: 10, h: 16 },
    ];
    const [p] = layoutLabels([label('a', LABEL_PRIORITY.station, 100, 100)], BOUNDS, obstacles);
    expect(p!.side).toBe('left');
    expect(rectsOverlap(p!, obstacles[1]!)).toBe(false);
  });

  it('steps further out when a marker at the same spot (my ship) covers every near side', () => {
    const ship = { id: 'ship', x: 85, y: 85, w: 30, h: 30 };
    const [p] = layoutLabels([label('home', LABEL_PRIORITY.station, 100, 100)], BOUNDS, [ship]);
    expect(p).toMatchObject({ side: 'right', x: 124 });
    expect(rectsOverlap(p!, ship)).toBe(false);
  });

  it('tries the alternative anchors when the main one is crowded', () => {
    const placed = layoutLabels(
      [
        label('target', LABEL_PRIORITY.objective, 200, 100, { w: 300, h: 150, gap: 0, sides: ['below'] }),
        label('ring', LABEL_PRIORITY.ring, 200, 170, { sides: ['above', 'below'], alternates: [{ x: 300, y: 40 }] }),
      ],
      BOUNDS,
    );
    const ring = placed.find((p) => p.id === 'ring')!;
    expect(ring.y + ring.h).toBeLessThanOrEqual(40);
  });

  it('ties keep the input order', () => {
    const placed = layoutLabels([label('first', LABEL_PRIORITY.poi, 100, 100, { sides: ['right'] }), label('second', LABEL_PRIORITY.poi, 100, 100, { sides: ['right'] })], BOUNDS);
    expect(placed.map((p) => p.id)).toEqual(['first']);
  });
});

describe('edge arrow', () => {
  it('is null for a point inside the view', () => {
    expect(edgeArrow(200, 150, 400, 300, 8)).toBeNull();
  });

  it('pins a point outside the view to the edge in its direction', () => {
    const right = edgeArrow(1000, 150, 400, 300, 20)!;
    expect(right.x).toBeCloseTo(380);
    expect(right.y).toBeCloseTo(150);
    expect(right.angle).toBeCloseTo(0);
    const top = edgeArrow(200, -500, 400, 300, 20)!;
    expect(top.y).toBeCloseTo(20);
    expect(top.angle).toBeCloseTo(-Math.PI / 2);
    // a corner direction stays inside the inset rectangle
    const corner = edgeArrow(-900, 900, 400, 300, 20)!;
    expect(corner.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(corner.y).toBeLessThanOrEqual(280 + 1e-9);
  });
});

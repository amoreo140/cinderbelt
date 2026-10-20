import { describe, expect, it } from 'vitest';
import { avoidHudPanels, clusterAngles, flightHudRects, goalLabelOffset, groupEdgeArrows, hudArrowFootprint, hudArrowRect, navArrowFootprint, navArrows, navMarkColor, navMarkIcon, navMarkLabel, overlaps, placeEdgeArrows, placeHudArrows, proximityStyle, slideOutOf, type EdgeArrowInput, type NavMark } from './edgeArrows';
import { PALETTE } from './theme/tokens';
import type { HudZones } from './hudZones';

const view = { width: 1280, height: 720 };

describe('placeEdgeArrows', () => {
  it('skips visible points and pins the rest to the edge', () => {
    const arrows = placeEdgeArrows(
      [
        { screen: { x: 640, y: 360 }, item: 'visible' },
        { screen: { x: 2000, y: 360 }, item: 'right' },
      ],
      view,
      { margin: 40 },
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ x: 1240, y: 360, items: ['right'] });
    expect(arrows[0]!.angle).toBeCloseTo(0);
  });

  it('merges arrows close together, the higher priority leads', () => {
    const arrows = placeEdgeArrows(
      [
        { screen: { x: 2000, y: 360 }, item: 'a', priority: 1 },
        { screen: { x: 2000, y: 380 }, item: 'b', priority: 5 },
        { screen: { x: -900, y: 360 }, item: 'c' },
      ],
      view,
      { margin: 40, mergePx: 50 },
    );
    expect(arrows.map((a) => a.items)).toEqual([['b', 'a'], ['c']]);
  });

  it('keeps at most `max` arrows (merged items still join)', () => {
    const arrows = placeEdgeArrows(
      [
        { screen: { x: 2000, y: 360 }, item: 'a', priority: 3 },
        { screen: { x: -900, y: 360 }, item: 'b', priority: 2 },
        { screen: { x: 640, y: -900 }, item: 'c', priority: 1 },
        { screen: { x: 2000, y: 365 }, item: 'd', priority: 0 },
      ],
      view,
      { margin: 40, mergePx: 40, max: 2 },
    );
    expect(arrows.map((a) => a.items)).toEqual([['a', 'd'], ['b']]);
  });

  it('a point behind the camera points the other way', () => {
    const [a] = placeEdgeArrows([{ screen: { x: 900, y: 360, behind: true }, item: 1 }], view, { margin: 40 });
    expect(a!.x).toBeLessThan(640);
  });

  it('slides out of the HUD panels', () => {
    const arrows = placeEdgeArrows([{ screen: { x: 3000, y: 2000 }, item: 'radar corner' }], view, { margin: 40, avoid: flightHudRects(view) });
    const radar = flightHudRects(view)[1]!;
    const a = arrows[0]!;
    expect(a.x > radar.x && a.y > radar.y && a.y < radar.y + radar.height).toBe(false);
  });
});

describe('flightHudRects', () => {
  const zones = { nav: { width: 466, height: 238 }, topRight: { width: 561, height: 323 } };

  it('keeps a top-edge arrow and its label off the measured objectives band and the open help', () => {
    const rects = flightHudRects(view, zones);
    // a find up and a little left of the centre: its arrow would sit on the top edge over the band
    const [left] = placeEdgeArrows([{ screen: { x: 300, y: -400 }, item: 'up-left' }], view, { margin: 34, avoid: rects });
    // the label hangs below the head, ~75 px either side of it
    expect(left!.x - 75).toBeGreaterThan(zones.nav.width);
    const [right] = placeEdgeArrows([{ screen: { x: 900, y: -400 }, item: 'up-right' }], view, { margin: 34, avoid: rects });
    expect(right!.x + 75).toBeLessThan(view.width - zones.topRight.width);
  });

  it('has no top-right rect before the help is measured', () => {
    expect(flightHudRects(view, { nav: zones.nav, topRight: { width: 0, height: 0 } })).toHaveLength(3);
    expect(flightHudRects(view, zones)).toHaveLength(4);
  });
});

// the pirates-near layout at 1280 × 720: the stack ends at 223, two event chips under it end at 298,
// the radio panel sits above the console (y 380–505)
const column: HudZones = {
  nav: { width: 470, height: 231 },
  topRight: { width: 0, height: 0 },
  chipsBottom: 298,
  log: { x: 16, y: 380, width: 400, height: 125 },
};
const inRect = (a: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) =>
  a.x >= r.x && a.x <= r.x + r.width && a.y >= r.y && a.y <= r.y + r.height;

describe('flightHudRects – the left column', () => {
  it('the top-left rect reaches below the event chips; the radio panel is a rect of its own', () => {
    const rects = flightHudRects(view, column);
    expect(rects[2]!.height).toBeGreaterThanOrEqual(298 + 8);
    expect(rects).toHaveLength(4);
    expect(rects[3]!.y).toBeLessThan(380);
    expect(rects[3]!.y + rects[3]!.height).toBeGreaterThan(505);
    // without chips and radio it is the stack alone
    expect(flightHudRects(view, { nav: column.nav, topRight: column.topRight })[2]!.height).toBe(231 + 20);
  });

  it('a pirate arrow on the left edge slides off the chips and the radio', () => {
    const rects = flightHudRects(view, column);
    for (const y of [-200, 120, 280, 300, 330, 420, 460]) {
      const [a] = placeEdgeArrows([{ screen: { x: -2000, y: 360 + (y - 360) * 6 }, item: y }], view, { margin: 34, avoid: rects });
      if (!a) continue;
      expect(rects.some((r) => inRect(a, r)), `y ${y} → ${Math.round(a.y)}`).toBe(false);
    }
  });
});

describe('a full left column (M4d: the chips reach down to the radio panel)', () => {
  const full: HudZones = { ...column, chipsBottom: 372 };

  it('an edge arrow with no free slot on the left edge steps into the screen past the panels', () => {
    const rects = flightHudRects(view, full);
    for (const y of [-200, 120, 300, 360, 420, 460]) {
      const [a] = placeEdgeArrows([{ screen: { x: -2000, y: 360 + (y - 360) * 6 }, item: y }], view, { margin: 40, avoid: rects });
      if (!a) continue;
      expect(rects.some((r) => inRect(a, r)), `y ${y} → ${Math.round(a.x)}, ${Math.round(a.y)}`).toBe(false);
    }
  });

  it('a note arrow next to the route never ends under the radio panel', () => {
    const marks: EdgeArrowInput<NavMark>[] = [
      { screen: { x: -900, y: 400 }, item: { key: 'route', kind: 'route', title: 'Trasa', distance: 900 } },
      { screen: { x: -900, y: 420 }, item: { key: 'note:1', kind: 'note', icon: 'star', title: 'Echo', distance: 950 } },
    ];
    const rects = flightHudRects(view, full);
    for (const a of navArrows(marks, view, { avoid: rects })) expect(rects.some((r) => inRect(a, r)), a.key).toBe(false);
  });
});

describe('the Guild chips folded up beside the event chips (M4d)', () => {
  it('their part right of the stack is a rect of its own; a top-edge arrow above them stays put', () => {
    const beside: HudZones = { ...column, chipsBottom: 300, chipsRight: 611 };
    const rects = flightHudRects(view, beside);
    expect(rects).toHaveLength(5);
    expect(rects.some((r) => inRect({ x: 600, y: 280 }, r))).toBe(true);
    const [top] = placeEdgeArrows([{ screen: { x: 560, y: -2000 }, item: 'up' }], view, { margin: 40, avoid: rects });
    expect(top!.y).toBe(40);
    // narrower than the stack: no extra rect
    expect(flightHudRects(view, { ...column, chipsRight: 352 })).toHaveLength(4);
  });
});

describe('hudArrowRect (M4d: the route arrow keeps off the station arrow)', () => {
  it('a route arrow to the station slides off the station arrow and its label', () => {
    const station = { x: 760, y: 672, angle: Math.PI / 2, label: 'Základňa Počiatok 1 742 j' };
    const box = hudArrowRect(station);
    expect(inRect(station, box)).toBe(true);
    const [route] = navArrows([{ screen: { x: 770, y: 2000 }, item: { key: 'route', kind: 'route', title: 'Trasa', distance: 1742, seconds: 52 } }], view, {
      avoid: [...flightHudRects(view, column), box],
    });
    expect(inRect(route!, box)).toBe(false);
    // it steps along the edge or up past the station arrow's label, never onto it
    expect(route!.x < box.x || route!.x > box.x + box.width || route!.y < box.y).toBe(true);
  });

  it('on a side edge the route arrow slides along the edge, its label clear of the station label', () => {
    const station = { x: 1232, y: 300, angle: 0, label: 'Základňa Počiatok 1 742 j' };
    const box = hudArrowRect(station);
    const [route] = navArrows([{ screen: { x: 3000, y: 330 }, item: { key: 'route', kind: 'route', title: 'Trasa', distance: 1742, seconds: 52 } }], view, {
      avoid: [...flightHudRects(view, column), box],
    });
    expect(route!.x).toBeGreaterThan(1200);
    expect(Math.abs(route!.y - station.y)).toBeGreaterThan(30);
  });
});

describe('placeHudArrows', () => {
  const zones: HudZones = { nav: { width: 300, height: 100 }, topRight: { width: 110, height: 90 }, chipsBottom: 0, log: null };

  it('the goal arrow steps along its edge off the station arrow and its label', () => {
    const station = { x: 1216, y: 360, angle: 0, label: 'Základňa Počiatok 612 j' };
    const goal = { x: 1216, y: 380, angle: 0.05, label: 'Kontrakt: Vyťaž Ľad' };
    const placed = placeHudArrows(station, goal, view, false, zones);
    expect(placed.station).toMatchObject({ x: 1216, y: 360 });
    expect(placed.goal!.x).toBe(1216);
    expect(overlaps(hudArrowFootprint(placed.station!), hudArrowFootprint(placed.goal!, true), 0)).toBe(false);
  });

  it('a full left column (every spot on the edge settles at the radio panel): the goal arrow steps into the screen', () => {
    for (const [sy, gy] of [
      [332, 332],
      [200, 420],
      [500, 340],
    ] as const) {
      const placed = placeHudArrows({ x: 48, y: sy, angle: Math.PI, label: 'Základňa Počiatok 2 612 j' }, { x: 64, y: gy, angle: Math.PI, label: 'Eskorta 1 240 j' }, view, false, column);
      expect(overlaps(hudArrowFootprint(placed.station!), hudArrowFootprint(placed.goal!, true), 0), `${sy} / ${gy}`).toBe(false);
    }
  });

  it('a goal arrow on the console edge is lifted until its head and label plate clear the console zone', () => {
    const consoleZones: HudZones = { ...zones, console: { width: 352, height: 150 } };
    const goal = { x: 40, y: 700, angle: Math.PI, label: 'Bója Cechu' };
    const placed = placeHudArrows(null, goal, view, false, consoleZones).goal!;
    const plate = hudArrowFootprint(placed, true);
    expect(plate.y + plate.height).toBeLessThanOrEqual(view.height - 150);
    // away from the corners nothing moves
    const far = { x: 640, y: 680, angle: Math.PI / 2, label: 'Bója Cechu' };
    expect(placeHudArrows(null, far, view, false, consoleZones).goal).toEqual(far);
  });

  it('apart already, or only one: each just off the panels', () => {
    const station = { x: 1216, y: 200, angle: 0, label: 'Kotva' };
    const goal = { x: 1216, y: 440, angle: 0, label: 'Cieľ' };
    expect(placeHudArrows(station, goal, view, false, zones)).toEqual({ station, goal });
    expect(placeHudArrows(null, goal, view, false, zones)).toEqual({ station: null, goal });
  });
});

describe('avoidHudPanels', () => {
  const arrow = (x: number, y: number) => ({ x, y, angle: Math.PI });

  it('slides a bottom-edge arrow off the training panel along the edge', () => {
    const panel = { x: 600, y: view.height - 300, width: 480, height: 285 };
    const zones = { nav: column.nav, topRight: column.topRight, training: panel };
    const a = avoidHudPanels(arrow(panel.x + 100, view.height - 40), view, false, zones);
    expect(a.y).toBe(view.height - 40);
    expect(a.x).toBeLessThan(panel.x);
    // clear of the panel: left alone; the panel is also a zone the other arrows avoid
    expect(avoidHudPanels(arrow(1300, view.height - 40), view, false, zones).x).toBe(1300);
    expect(flightHudRects(view, zones)).toContainEqual(panel);
  });

  it('moves an arrow under the stack below the event chips, not onto them', () => {
    const a = avoidHudPanels(arrow(40, 260), view, false, column);
    expect(a.y).toBeGreaterThan(298 + 8);
    // without chips: right below the stack
    expect(avoidHudPanels(arrow(40, 200), view, false, { nav: column.nav, topRight: column.topRight }).y).toBe(231 + 24);
  });

  it('moves an arrow on the radio panel above it, into the gap under the chips', () => {
    for (const y of [370, 420, 500]) {
      const a = avoidHudPanels(arrow(40, y), view, false, column);
      expect(a.y, `y ${y}`).toBeLessThan(380 - 20);
      expect(a.y, `y ${y}`).toBeGreaterThan(298 + 8);
    }
  });

  it('an arrow pushed up by the console lands above the radio panel', () => {
    // a console with a silhouette and several rows reaches up to the radio panel
    const a = avoidHudPanels(arrow(300, 690), view, false, { ...column, console: { width: 640, height: 250 } });
    expect(a.y).toBeLessThan(380 - 20);
  });

  it('with the left column full, the arrow goes right of the radio panel', () => {
    const full: HudZones = { ...column, chipsBottom: 360 };
    const a = avoidHudPanels(arrow(40, 420), view, false, full);
    expect(a.x).toBeGreaterThan(16 + 400);
    expect(a.y).toBe(420);
  });

  it('slides an arrow on the top edge out from under the threat band / radio line', () => {
    const top: HudZones = { ...column, topCentre: { x: 420, y: 16, width: 440, height: 44 } };
    const under = avoidHudPanels({ x: 600, y: 24, angle: -Math.PI / 2 }, view, false, top);
    expect(under.x <= 420 - 150 || under.x >= 860 + 150).toBe(true);
    expect(under.y).toBe(24);
    // the nearer side lands on the top-left stack (470 wide): the arrow goes to the right side
    const wide: HudZones = { ...column, topCentre: { x: 520, y: 16, width: 340, height: 44 } };
    const nearLeft = avoidHudPanels({ x: 540, y: 24, angle: -Math.PI / 2 }, view, false, wide);
    expect(nearLeft.x).toBeGreaterThanOrEqual(860 + 150);
    // an arrow on a side edge or well below the band is left alone
    expect(avoidHudPanels({ x: 1240, y: 24, angle: 0 }, view, false, top).x).toBe(1240);
    expect(avoidHudPanels({ x: 600, y: 300, angle: 0 }, view, false, top)).toEqual({ x: 600, y: 300, angle: 0 });
  });

  it('flightHudRects covers the top-centre zone with the label reach', () => {
    const top: HudZones = { ...column, topCentre: { x: 420, y: 16, width: 440, height: 44 } };
    const r = flightHudRects(view, top).find((q) => q.x < 420 && q.x + q.width > 860 && q.y === 0);
    expect(r).toBeDefined();
  });

  it('leaves an arrow clear of every panel alone', () => {
    expect(avoidHudPanels(arrow(40, 340), view, false, column)).toEqual(arrow(40, 340));
    expect(avoidHudPanels(arrow(1240, 300), view, false, column)).toEqual(arrow(1240, 300));
  });
});

describe('slideOutOf', () => {
  it('moves a side arrow up or down, a bottom arrow sideways', () => {
    const rect = { x: 1000, y: 500, width: 280, height: 220 };
    expect(slideOutOf({ x: 1240, y: 600, angle: 0 }, [rect], view).y).toBe(488);
    expect(slideOutOf({ x: 1100, y: 680, angle: Math.PI / 2 }, [rect], view).x).toBe(988);
    // a bottom-edge arrow pointing more sideways than down still slides sideways (not into the screen)
    expect(slideOutOf({ x: 1100, y: 686, angle: 0.6 }, [rect], view)).toMatchObject({ x: 988, y: 686 });
    // outside = untouched
    expect(slideOutOf({ x: 600, y: 680, angle: Math.PI / 2 }, [rect], view)).toEqual({ x: 600, y: 680, angle: Math.PI / 2 });
  });
});

// ───────────── grouping by direction (hostile pirates, R2) ─────────────

/** A target far off screen in a direction (rad, screen pixels). */
const toward = (item: string, angle: number, priority = 0): EdgeArrowInput<string> => ({
  item,
  screen: { x: 640 + Math.cos(angle) * 3000, y: 360 + Math.sin(angle) * 3000 },
  priority,
});

describe('proximityStyle', () => {
  it('grows and solidifies as the target closes in, clamped', () => {
    const far = proximityStyle(0);
    const near = proximityStyle(1);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(near.opacity).toBeLessThanOrEqual(1);
    expect(far.opacity).toBeGreaterThan(0.3);
    expect(proximityStyle(-3)).toEqual(far);
    expect(proximityStyle(7)).toEqual(near);
  });
});

describe('clusterAngles', () => {
  it('groups close directions and separates distant ones', () => {
    expect(clusterAngles([0.1, 0.2, 2.0, 0.3, 2.1], 0.3).map((g) => [...g].sort())).toEqual([
      [0, 1, 3],
      [2, 4],
    ]);
  });

  it('joins a group across the 0 / 2π seam', () => {
    const groups = clusterAngles([-0.1, 0.1, Math.PI - 0.05, -0.15], 0.3);
    expect(groups).toHaveLength(2);
    expect([...groups.find((g) => g.includes(0))!].sort()).toEqual([0, 1, 3]);
  });

  it('is empty for no angles', () => {
    expect(clusterAngles([], 0.3)).toEqual([]);
  });
});

describe('groupEdgeArrows', () => {
  it('skips points on screen, one arrow per point off screen', () => {
    expect(groupEdgeArrows([{ item: 'a', screen: { x: 600, y: 300 } }], view, { margin: 40 })).toEqual([]);
    const m = groupEdgeArrows([toward('a', 0), toward('b', Math.PI / 2)], view, { margin: 40 });
    expect(m).toHaveLength(2);
    const a = m.find((x) => x.items[0] === 'a')!;
    expect(a.x).toBeCloseTo(1240);
    expect(a.span).toBe(0);
    expect(m.find((x) => x.items[0] === 'b')!.y).toBeCloseTo(680);
  });

  it('three in one direction stay three arrows, four merge into one arc led by the top priority', () => {
    const three = groupEdgeArrows([toward('a', 0), toward('b', 0.1), toward('c', 0.2)], view, { margin: 40 });
    expect(three.every((x) => x.span === 0 && x.items.length === 1)).toBe(true);
    const four = groupEdgeArrows([toward('a', 0), toward('b', 0.1, 5), toward('c', 0.2), toward('d', -0.1), toward('x', Math.PI)], view, { margin: 40 });
    const arc = four.find((x) => x.span > 0)!;
    expect(arc.items).toHaveLength(4);
    expect(arc.items[0]).toBe('b');
    expect(arc.angle).toBeCloseTo(0.05, 1);
    expect(arc.span).toBeGreaterThanOrEqual(0.3);
    expect(four.filter((x) => x.span === 0)).toHaveLength(1);
  });

  it('slides out of the HUD panels like the other edge arrows', () => {
    const [a] = groupEdgeArrows([{ item: 'corner', screen: { x: 3000, y: 2000 } }], view, { margin: 40, avoid: flightHudRects(view) });
    const radar = flightHudRects(view)[1]!;
    expect(a!.x < radar.x || a!.y < radar.y).toBe(true);
  });
});

describe('navArrows (M4d: route, notes, convoys, Guild relays)', () => {
  const mark = (key: string, kind: NavMark['kind'], extra: Partial<NavMark> = {}): NavMark => ({ key, kind, title: key, distance: 500, ...extra });
  const opts = { avoid: [] };

  it('arrows for marks out of view, pins for marks in view', () => {
    const out = navArrows(
      [
        { screen: { x: 2000, y: 360 }, item: mark('n1', 'note', { icon: 'ore' }) },
        { screen: { x: 640, y: 300 }, item: mark('cv', 'convoy') },
        { screen: { x: 640, y: 300, behind: true }, item: mark('r', 'route', { seconds: 52 }) },
      ],
      view,
      opts,
    );
    const pin = out.find((a) => a.pin)!;
    expect(pin).toMatchObject({ key: 'pin:cv', x: 640, y: 300, icon: 'assets/ui/icons/convoy.svg' });
    const arrows = out.filter((a) => !a.pin);
    // the route leads (priority), the note arrow is small with its icon
    expect(arrows.map((a) => a.key)).toEqual(['r', 'n1']);
    expect(arrows[1]).toMatchObject({ small: true, icon: 'assets/ui/icons/note_ore.svg', color: PALETTE.hullShade });
  });

  it('merges close arrows with a count and keeps at most `max`', () => {
    const inputs = Array.from({ length: 8 }, (_, i) => ({ screen: { x: 2000 + i, y: 100 + i * 120 }, item: mark(`n${i}`, 'note', { distance: 100 * i }) }));
    const out = navArrows(inputs, view, { avoid: [], max: 3 });
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.reduce((n, a) => n + (a.count ?? 1), 0)).toBeGreaterThanOrEqual(3);
    // the nearest note leads
    expect(out[0]!.key).toBe('n0');
  });

  it('only notes merge: the route next to a note keeps its own arrow, stepped aside along the edge', () => {
    const out = navArrows(
      [
        { screen: { x: 2000, y: 300 }, item: mark('r', 'route') },
        { screen: { x: 2000, y: 310 }, item: mark('n1', 'note') },
        { screen: { x: 2000, y: 320 }, item: mark('n2', 'note') },
      ],
      view,
      opts,
    );
    expect(out.map((a) => [a.key, a.count])).toEqual([
      ['r', 1],
      ['n1', 2],
    ]);
    expect(Math.abs(out[0]!.y - out[1]!.y)).toBeGreaterThanOrEqual(46);
    expect(out.every((a) => a.x === view.width - 40)).toBe(true);
  });

  it('labels never overlap: a convoy and a relay arrow side by side at the top edge step apart', () => {
    const items = [
      { screen: { x: 600, y: -900 }, item: mark('relay', 'relay', { title: 'Relé Cechu', distance: 1929 }) },
      { screen: { x: 570, y: -900 }, item: mark('cv', 'convoy', { title: 'Konvoj', distance: 1200 }) },
      { screen: { x: 640, y: -900 }, item: mark('n', 'note', { icon: 'flag', title: 'Relé Cechu', distance: 1929 }) },
    ];
    const out = navArrows(items, view, opts);
    expect(out).toHaveLength(3);
    const boxes = out.map((a) => navArrowFootprint(a, items.find((i) => i.item.key === a.key)!.item));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!, 0), `${out[i]!.key} × ${out[j]!.key}`).toBe(false);
    // still on the top edge
    expect(out.every((a) => a.y === 40)).toBe(true);
  });

  it('labels keep clear of the station and goal arrows (obstacles)', () => {
    const station = { x: 640, y: 64, angle: -Math.PI / 2, label: 'Základňa Počiatok 612 j' };
    const box = hudArrowFootprint(station);
    const [cv] = navArrows([{ screen: { x: 650, y: -900 }, item: mark('cv', 'convoy', { title: 'Konvoj', distance: 1200 }) }], view, { avoid: [], obstacles: [box] });
    expect(overlaps(navArrowFootprint(cv!, mark('cv', 'convoy', { title: 'Konvoj', distance: 1200 })), box, 0)).toBe(false);
  });

  it('labels: title, distance, the route ETA', () => {
    const label = (m: Parameters<typeof navMarkLabel>[0]) => navMarkLabel(m).replace(/[  ]/g, ' ');
    expect(label({ title: 'Trasa', distance: 1240.4, seconds: 52 })).toBe('Trasa · 1 240 j · 52 s');
    expect(label({ title: 'bohaté Ti', distance: 820 })).toBe('bohaté Ti · 820 j');
    expect(label({ title: 'Trasa', distance: 90, seconds: 125 })).toBe('Trasa · 90 j · 2:05');
  });

  it('colours and icons by kind', () => {
    expect(navMarkColor({ kind: 'route' })).toBe(PALETTE.glow);
    expect(navMarkColor({ kind: 'relay' })).toBe(PALETTE.trim);
    expect(navMarkColor({ kind: 'note', icon: 'pirate' })).toBe(PALETTE.bad);
    expect(navMarkIcon({ kind: 'route' })).toBeNull();
    expect(navMarkIcon({ kind: 'relay', lit: true })).toBe('assets/ui/icons/guild_relay_lit.svg');
    expect(navMarkIcon({ kind: 'note', icon: 'star' })).toBe('assets/ui/icons/note_star.svg');
  });
});

describe('goal arrow geometry', () => {
  it('the label clears the 44 px head also when the arrow points along the edge', () => {
    for (const angle of [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.3]) {
      const label = 'Guild buoy · 1 240 u';
      const o = goalLabelOffset(angle, label);
      const w = 9 * label.length + 24;
      const labelBox = { x: o.x - w / 2, y: o.y - 17, width: w, height: 34 };
      const head = { x: -22, y: -22, width: 44, height: 44 };
      expect(overlaps(labelBox, head, 0), `angle ${angle}`).toBe(false);
    }
  });
  it('the goal footprint is larger than the station one and grows with the label', () => {
    const a = { x: 1216, y: 360, angle: 0, label: 'Guild buoy · 97 u' };
    const goal = hudArrowFootprint(a, true);
    expect(goal.height).toBeGreaterThanOrEqual(44);
    expect(goal.width).toBeGreaterThan(9 * a.label.length);
    expect(hudArrowFootprint({ ...a, label: a.label + ' xxxxxxxx' }, true).width).toBeGreaterThan(goal.width);
    expect(hudArrowRect(a, true).width).toBeGreaterThan(goal.width);
  });
});

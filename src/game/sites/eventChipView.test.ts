// M4b T7: the HUD event chip view model – severity order, the timer, the direction relative to the bow.
import { describe, expect, it } from 'vitest';
import { tx } from '../../i18n';
import type { ActiveEvent } from '../../sim/events/types';
import { clockHour } from '../../ui/sites/chipFormat';
import { cometTitle, eventChip, eventChips, flybyCometId, relativeDeg } from './eventChipView';

const ship = { pos: { x: 100, y: 50 }, angle: 0 };
const T = 6000;

const ev = (over: Partial<ActiveEvent> & Pick<ActiveEvent, 'kind'>): ActiveEvent => ({ key: `k:${over.kind}`, start: T - 60, end: T + 600, ...over });

describe('event chips', () => {
  it('order by severity: danger, warn, info; the director order within a tone', () => {
    // activeEvents order: ambush, micrometeors, ionStorm, cometFlyby, distress
    const list = [
      ev({ kind: 'micrometeors', key: 'm', dir: 0 }),
      ev({ kind: 'ionStorm', key: 's' }),
      ev({ kind: 'cometFlyby', key: 'ev:comet:cm:2@4', pos: { x: 0, y: 0 } }),
      ev({ kind: 'distress', key: 'd', pos: { x: 0, y: 0 } }),
      ev({ kind: 'ambush', key: 'a', open: true, pos: { x: 0, y: 0 } }),
    ];
    expect(eventChips(list, T, ship).map((c) => c.key)).toEqual(['a', 'm', 's', 'ev:comet:cm:2@4', 'd']);
    expect(eventChips(list, T, ship).map((c) => c.tone)).toEqual(['danger', 'warn', 'warn', 'info', 'info']);
  });

  it('timer: to the start during the lead, then to the end; none for an open event', () => {
    const lead = eventChip(ev({ kind: 'micrometeors', start: T + 480, end: T + 2280, dir: 0 }), T, ship);
    expect(lead.pending).toBe(true);
    expect(lead.secondsLeft).toBeCloseTo(8);
    const running = eventChip(ev({ kind: 'micrometeors', start: T - 60, end: T + 1200, dir: 0 }), T, ship);
    expect(running.pending).toBe(false);
    expect(running.secondsLeft).toBeCloseTo(20);
    const ambush = eventChip(ev({ kind: 'ambush', start: T - 60, end: T - 60, open: true }), T, ship);
    expect(ambush.secondsLeft).toBeNull();
    // an announced ambush counts down to its start
    expect(eventChip(ev({ kind: 'ambush', start: T + 360, end: T + 360, dir: 1 }), T, ship).secondsLeft).toBeCloseTo(6);
  });

  it('direction: clockwise from the bow; micrometeors from their direction, others to their position', () => {
    expect(relativeDeg(0, 0)).toBe(0);
    // y is up: a bearing to the right of a bow pointing +x is −90° in the world, 3 o'clock on the dial
    expect(relativeDeg(-Math.PI / 2, 0)).toBeCloseTo(90);
    expect(relativeDeg(Math.PI / 2, 0)).toBeCloseTo(270);
    expect(relativeDeg(Math.PI / 2, Math.PI / 2)).toBeCloseTo(0);
    // micrometeors from behind
    expect(clockHour(eventChip(ev({ kind: 'micrometeors', dir: Math.PI }), T, ship).dirDeg!)).toBe(6);
    // a distress signal straight below the ship (−y) with the bow up (+y) = behind
    const up = { ...ship, angle: Math.PI / 2 };
    expect(clockHour(eventChip(ev({ kind: 'distress', pos: { x: 100, y: -500 } }), T, up).dirDeg!)).toBe(6);
    // a comet off the right side
    expect(clockHour(eventChip(ev({ kind: 'cometFlyby', key: 'ev:comet:cm:0@1', pos: { x: 900, y: 50 } }), T, up).dirDeg!)).toBe(3);
    // an ion storm is all around: no arrow
    expect(eventChip(ev({ kind: 'ionStorm', pos: { x: 0, y: 0 } }), T, ship).dirDeg).toBeNull();
  });

  it('titles: the event name; a comet flyby by the comet', () => {
    expect(eventChip(ev({ kind: 'micrometeors', dir: 0 }), T, ship).title).toBe(tx().world.events.names.micrometeors);
    expect(flybyCometId('ev:comet:cm:2@4')).toBe('cm:2');
    expect(flybyCometId('ev:ambush:s@3')).toBeNull();
    expect(cometTitle('cm:2')).toBe(tx().world.comet.name(3));
    expect(eventChip(ev({ kind: 'cometFlyby', key: 'ev:comet:cm:2@4' }), T, ship).title).toBe(tx().world.comet.name(3));
  });
});

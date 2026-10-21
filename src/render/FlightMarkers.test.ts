import { describe, expect, it } from 'vitest';
import { FlightMarkers, type FlightMarkerInput } from './FlightMarkers';

const input = (over: Partial<FlightMarkerInput> = {}): FlightMarkerInput => ({
  pos: { x: 100, y: 50 },
  vel: { x: 0, y: 0 },
  radius: 2,
  stop: null,
  marker: true,
  collision: null,
  angle: 0,
  cameraDistance: 28,
  time: 0,
  reducedMotion: false,
  ...over,
});

describe('the bow arrow', () => {
  it('shows ahead of the bow, bright right after the flight starts and dimmed later', () => {
    const m = new FlightMarkers();
    m.update(input({ time: 10 }));
    const fresh = m.stats();
    expect(fresh.bow).toBe(true);
    m.update(input({ time: 11 }));
    expect(m.stats().bowOpacity).toBeCloseTo(fresh.bowOpacity);
    m.update(input({ time: 20 }));
    expect(m.stats().bowOpacity).toBeLessThan(fresh.bowOpacity);
    expect(m.stats().bowOpacity).toBeGreaterThan(0.2);
  });

  it('restarts the emphasis after rest() and after a jump of the ship (a load)', () => {
    const m = new FlightMarkers();
    m.update(input({ time: 0 }));
    m.update(input({ time: 30 }));
    const dim = m.stats().bowOpacity;
    m.rest();
    expect(m.stats().bow).toBe(false);
    m.update(input({ time: 31 }));
    expect(m.stats().bowOpacity).toBeGreaterThan(dim);
    m.update(input({ time: 40 }));
    m.update(input({ time: 41, pos: { x: 900, y: 900 } }));
    expect(m.stats().bowOpacity).toBeGreaterThan(dim);
  });

  it('points the way the bow points, not the way the ship moves', () => {
    const m = new FlightMarkers();
    m.update(input({ angle: Math.PI / 2, vel: { x: 5, y: 0 } }));
    const bow = m.object.children[0]!;
    expect(bow.rotation.y).toBeCloseTo(Math.PI / 2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CONVOY, CONVOY_SHAPES } from '../../data/convoys';
import type { ConvoyPose } from '../../sim/convoys';
import {
  clampBeam,
  convoyShipsNear,
  instancedFlameShader,
  LAMPS,
  legThrottle,
  MARKER_RANGE,
  portMarker,
  renderTick,
  soldOut,
  tradePortOf,
} from './convoyLook';

const near = vi.hoisted(() => ({ poses: [] as unknown[], calls: [] as unknown[][] }));
vi.mock('../../sim/convoys', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  convoysNear: (...args: unknown[]) => {
    near.calls.push(args);
    return near.poses;
  },
}));

/** A pass flying along +x (heading 0) with its trader at `x`, optionally a tanker behind. */
function pass(x: number, opts: { tanker?: boolean; leg?: ConvoyPose['leg']; heading?: number; id?: string } = {}): ConvoyPose {
  const heading = opts.heading ?? 0;
  const ships: ConvoyPose['ships'] = [{ kind: 'trader', pos: { x, y: 0 }, heading }];
  if (opts.tanker) ships.push({ kind: 'tanker', pos: { x: x - CONVOY.tankerGap, y: 0 }, heading });
  return { pass: opts.id ?? 'cv:A@3', lane: 'A', ships, vel: { x: CONVOY.speed * Math.cos(heading), y: CONVOY.speed * Math.sin(heading) }, leg: opts.leg ?? 'out' };
}

describe('convoyLook', () => {
  it('draws the convoys between the last two steps, never before tick 0', () => {
    expect(renderTick(100, 0)).toBe(99);
    expect(renderTick(100, 0.25)).toBeCloseTo(99.25);
    expect(renderTick(100, 1)).toBe(100);
    expect(renderTick(0, 0.5)).toBe(0);
  });

  it('hides the containers only once every rare item of the pass is sold', () => {
    const all = (1 << CONVOY.slots) - 1;
    expect(soldOut(undefined)).toBe(false);
    expect(soldOut({ bought: 0, sold: 200, fuel: 60 })).toBe(false);
    expect(soldOut({ bought: all & ~1, sold: 0, fuel: 0 })).toBe(false);
    expect(soldOut({ bought: all, sold: 0, fuel: 0 })).toBe(true);
  });

  it('lists every ship of the passes near the view with a stable id, flame level and cargo', () => {
    near.poses = [pass(100, { tanker: true }), pass(-300, { id: 'cv:B@1', leg: 'turn' })];
    near.calls = [];
    const trades = new Map([['cv:B@1', { bought: (1 << CONVOY.slots) - 1, sold: 0, fuel: 0 }]]);
    const { ships, poses } = convoyShipsNear(7, { x: 1, y: 2 }, 500, 1234.5, trades);
    expect(near.calls).toEqual([[7, { x: 1, y: 2 }, 500, 1234.5]]);
    expect(poses).toBe(near.poses);
    expect(ships.map((s) => s.id)).toEqual(['cv:A@3:trader', 'cv:A@3:tanker', 'cv:B@1:trader']);
    expect(ships[1]!.pos).toEqual({ x: 100 - CONVOY.tankerGap, y: 0 });
    expect(ships[0]!.throttle).toBe(legThrottle('out'));
    expect(ships[2]!.throttle).toBeLessThan(ships[0]!.throttle);
    expect(ships.map((s) => s.cargo)).toEqual([true, true, false]);
  });

  it('puts the trade port on the trader’s port side at any heading', () => {
    const port = CONVOY_SHAPES.trader.tradePort!;
    const a = tradePortOf({ pos: { x: 10, y: 20 }, heading: 0 });
    expect(a.pos).toEqual({ x: 10 + port.x, y: 20 + port.y });
    expect(a.out).toEqual({ x: -0, y: 1 });
    const b = tradePortOf({ pos: { x: 0, y: 0 }, heading: Math.PI / 2 });
    expect(b.pos.x).toBeCloseTo(-port.y);
    expect(b.pos.y).toBeCloseTo(port.x);
    expect(b.out.x).toBeCloseTo(-1);
    expect(b.out.y).toBeCloseTo(0);
  });

  it('shows the port marker where the ship will sit, fading in, ready only within the link limits', () => {
    const p = pass(0);
    const port = tradePortOf(p.ships[0]!).pos;
    const radius = 3;
    // pinned pose: port + radius outward (+y at heading 0); chevrons point back at the port
    const ready = portMarker([p], { pos: { x: port.x, y: port.y + radius + 1 }, vel: { ...p.vel }, radius })!;
    expect(ready.pos.x).toBeCloseTo(port.x);
    expect(ready.pos.y).toBeCloseTo(port.y + radius);
    expect(ready.dir.x).toBeCloseTo(0);
    expect(ready.dir.y).toBeCloseTo(-1);
    expect(ready.radius).toBe(radius);
    expect(ready.alpha).toBe(1);
    expect(ready.ready).toBe(true);
    // too fast relative to the convoy, too far from the port
    expect(portMarker([p], { pos: { x: port.x, y: port.y + radius + 1 }, vel: { x: 0, y: 0 }, radius })!.ready).toBe(false);
    expect(portMarker([p], { pos: { x: port.x, y: port.y + radius + CONVOY.linkRange + 1 }, vel: { ...p.vel }, radius })!.ready).toBe(false);
    // fading at the edge, gone beyond it
    const edge = portMarker([p], { pos: { x: port.x, y: port.y + MARKER_RANGE - 5 }, vel: p.vel, radius })!;
    expect(edge.alpha).toBeGreaterThan(0);
    expect(edge.alpha).toBeLessThan(1);
    expect(portMarker([p], { pos: { x: port.x, y: port.y + MARKER_RANGE + 1 }, vel: p.vel, radius })).toBeNull();
    // no link during the turn-around → no marker
    expect(portMarker([pass(0, { leg: 'turn' })], { pos: port, vel: p.vel, radius })).toBeNull();
  });

  it('marks the nearest of two ports', () => {
    const a = pass(0, { id: 'cv:A@1' });
    const b = pass(30, { id: 'cv:B@2' });
    const portB = tradePortOf(b.ships[0]!).pos;
    const m = portMarker([a, b], { pos: { x: portB.x, y: portB.y + 4 }, vel: b.vel, radius: 2 })!;
    expect(m.pos.x).toBeCloseTo(portB.x);
  });

  it('runs the link clamp from the trade port to the linked ship', () => {
    const p = pass(50, { heading: 1 });
    const beam = clampBeam([pass(0, { id: 'cv:B@9' }), p], 'cv:A@3', { x: 3, y: 4 })!;
    expect(beam.from).toEqual(tradePortOf(p.ships[0]!).pos);
    expect(beam.to).toEqual({ x: 3, y: 4 });
    expect(clampBeam([p], 'cv:A@4', { x: 0, y: 0 })).toBeNull();
  });

  it('lights the amber beacon above the trade port on the trader and the tanker', () => {
    expect(LAMPS.trader.beacon_3).toBe('amber');
    expect(LAMPS.tanker.beacon_3).toBe('amber');
    expect(LAMPS.cutter.strobe_0).toBe('strobe');
  });

  it('turns the flame vertex shader into an instanced one', () => {
    const src = `uniform float uWidth;
void main() {
  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 along = mat3(modelMatrix) * vec3(0.0, 1.0, 0.0);
}`;
    const out = instancedFlameShader(src);
    expect(out).toContain('mat4 flameModel = modelMatrix * instanceMatrix;');
    expect(out).toContain('(flameModel * vec4(0.0');
    expect(out).toContain('mat3(flameModel)');
    expect(out.match(/modelMatrix/g)).toHaveLength(1);
    expect(() => instancedFlameShader('void main() {}')).toThrow();
  });
});

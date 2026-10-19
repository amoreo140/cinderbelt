// Deliberate ramming (M21 ram damage): the saboteur's legal way to break its own parts – nose first
// (bow parts) or stern first (accelerate at the rock, turn around while coasting, hit with the
// engines). Picks a big enough rock with a clear lane, so the contact cell is predictable.
import { IDLE_COMMAND } from '../../../src/sim/commands';
import type { Vec2 } from '../../../src/sim/math/vec2';
import { dist, norm, pathClear } from '../flight';
import { Driver, TPS } from './harness';

export interface RamTarget {
  id: string;
  pos: Vec2;
  r: number;
  /** Where the run-up starts (on a clear lane to the rock). */
  start: Vec2;
}

/** Nearest rock of radius ≥ `minRadius` with a clear straight run-up of `runUp` units. */
export function pickRamTarget(d: Driver, minRadius = 2.4, runUp = 180): RamTarget | null {
  const s = d.state;
  const pos = s.player.body.pos;
  const rocks = s.world
    .asteroids()
    .filter((a) => s.world.remaining(a) > 0 && s.world.radiusOf(a) >= minRadius && dist(a.pos, pos) > 40)
    .sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos));
  for (const a of rocks.slice(0, 40)) {
    const r = s.world.radiusOf(a);
    const base = Math.atan2(pos.y - a.pos.y, pos.x - a.pos.x);
    for (let k = 0; k < 12; k++) {
      const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const start = { x: a.pos.x + dir.x * (r + runUp), y: a.pos.y + dir.y * (r + runUp) };
      const touch = { x: a.pos.x + dir.x * (r + 1), y: a.pos.y + dir.y * (r + 1) };
      if (pathClear(s, start, touch, a.id, s.player.props.boundingRadius + 1.5)) return { id: a.id, pos: a.pos, r, start };
    }
  }
  return null;
}

/**
 * Rams a rock at `speed`. Stern first: accelerate at the rock, then turn the stern to it while
 * coasting (the engines take the hit). Returns true when a damaging impact happened.
 */
export function ram(d: Driver, sternFirst: boolean, speed: number, target: RamTarget | null = pickRamTarget(d)): boolean {
  if (d.state.player.dock.mode === 'docked') d.undock();
  if (!target) return false;
  d.flyTo(target.start, { seconds: 150 });
  if (d.state.player.dock.mode !== 'flying') return false;
  let hit = false;
  let flipped = false;
  const end = d.state.tick + 60 * TPS;
  while (d.state.tick < end && d.state.player.dock.mode === 'flying' && !d.state.player.destroyed) {
    const p = d.state.player;
    const to = { x: target.pos.x - p.body.pos.x, y: target.pos.y - p.body.pos.y };
    const n = norm(to);
    const v = Math.hypot(p.body.vel.x, p.body.vel.y);
    const gap = Math.hypot(to.x, to.y) - target.r;
    if (sternFirst && v >= speed) flipped = true;
    const want = Math.atan2(to.y, to.x) + (sternFirst && flipped ? Math.PI : 0);
    let delta = want - p.body.angle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const turn = Math.max(-1, Math.min(1, delta * 2 - p.body.angVel * 0.6));
    // keep the rock on the line of flight: cancel the sideways drift (in the ship frame)
    const lateralWorld = -p.body.vel.x * n.y + p.body.vel.y * n.x;
    const c = Math.cos(p.body.angle);
    const sn = Math.sin(p.body.angle);
    const leftWorld = { x: -sn, y: c };
    const sideDot = leftWorld.x * -n.y + leftWorld.y * n.x;
    const strafe = Math.max(-1, Math.min(1, -lateralWorld * 0.4 * Math.sign(sideDot || 1)));
    const forward = !flipped && v < speed && Math.abs(delta) < 0.25 ? 1 : 0;
    const events = d.step({ ...IDLE_COMMAND, flight: { forward, strafe, turn }, toggleDampers: p.dampers, aim: { ...p.body.pos } });
    if (events.some((e) => e.type === 'collision' && (e.damage ?? 0) > 0)) hit = true;
    if (hit && (v < 3 || gap > 8)) break;
    if (!hit && gap < -3) break;
  }
  stop(d);
  return hit;
}

/**
 * Kills the velocity after a run-up (nose against the motion, burn): a ship drifting away at ramming
 * speed would otherwise leave the area – and the flight helper's look-ahead grows with the speed.
 */
export function stop(d: Driver, seconds = 40): void {
  const end = d.state.tick + seconds * TPS;
  while (d.state.tick < end && d.state.player.dock.mode === 'flying' && !d.state.player.destroyed) {
    const p = d.state.player;
    const v = Math.hypot(p.body.vel.x, p.body.vel.y);
    if (v < 1.5 || p.fuel <= 0) return;
    let delta = Math.atan2(-p.body.vel.y, -p.body.vel.x) - p.body.angle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const turn = Math.max(-1, Math.min(1, delta * 2 - p.body.angVel * 0.6));
    const forward = Math.abs(delta) < 0.3 ? Math.min(1, v / 10) : 0;
    d.step({ ...IDLE_COMMAND, flight: { forward, strafe: 0, turn }, toggleDampers: !p.dampers, aim: { ...p.body.pos } });
  }
}

// Training sites (M3.7): two buoys in open space in front of the home port and an iron rock with
// veins nearby. Picked once from the asteroids around home when the training starts – pure and
// deterministic (the same world gives the same sites).
import { veinsOf } from '../mining/veins';
import type { Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import type { ShipGrid } from '../ship/types';
import type { Asteroid } from '../world/generate';
import type { TrainingSites } from './types';

/**
 * The Guild's training hull (a line with one reverse engine beside the laser, where the starter ship
 * has its two – thrust acts through the centre of mass, so the off-axis engine does not turn the ship):
 *
 *   y= 1               R
 *   y= 0   E  T  K  C  M
 *        x=-2 -1  0  1  2
 *
 * E forward engine, R reverse engine (its nozzle towards the bow, free), T fuel tank, K cargo hold,
 * C cockpit (built-in gyroscope), M mining laser. It flies forward, brakes with S (and the inertial
 * dampers brake along the bow on their own), turns and mines; it cannot strafe, so a sideways drift
 * stays until the side engines come.
 */
export function createTrainingHull(): ShipGrid {
  return createGrid([
    ['cockpit', 1, 0],
    ['miningLaser', 2, 0, 0],
    ['cargo', 0, 0],
    ['fuelTank', -1, 0],
    ['engine', -2, 0, 0],
    ['engine', 2, 1, 2],
  ]);
}

/** Free space a buoy needs around it (u from any asteroid's surface). */
const BUOY_CLEARANCE = 22;
const ROCK_MIN_AMOUNT = 60;
const ROCK_DISTANCE = { min: 50, max: 220 };

const TAU = Math.PI * 2;
const angleDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

interface Rock {
  a: Asteroid;
  radius: number;
}

function clearance(p: Vec2, rocks: readonly Rock[]): number {
  let min = Infinity;
  for (const r of rocks) min = Math.min(min, Math.hypot(r.a.pos.x - p.x, r.a.pos.y - p.y) - r.radius);
  return min;
}

/** Free corridor (half-width, length in u) in front of the training rock, on its side facing home. */
const CORRIDOR = { halfWidth: 4, length: 24 };

/** No other rock touches the corridor from the rock's surface towards home. */
function approachClear(rock: Rock, home: Vec2, rocks: readonly Rock[]): boolean {
  const dx = home.x - rock.a.pos.x;
  const dy = home.y - rock.a.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  for (const o of rocks) {
    if (o === rock) continue;
    const rx = o.a.pos.x - rock.a.pos.x;
    const ry = o.a.pos.y - rock.a.pos.y;
    const along = rx * ux + ry * uy;
    if (along < -o.radius || along > rock.radius + CORRIDOR.length + o.radius) continue;
    const side = Math.abs(rx * uy - ry * ux);
    if (side < CORRIDOR.halfWidth + o.radius) return false;
  }
  return true;
}

/** Points on a circle around `centre` (step 15°) between `from` and `to` degrees. */
function ring(centre: Vec2, r: number, from: number, to: number): { pos: Vec2; angle: number }[] {
  const out: { pos: Vec2; angle: number }[] = [];
  for (let deg = from; deg <= to; deg += 15) {
    const angle = (deg * Math.PI) / 180;
    out.push({ pos: { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r }, angle });
  }
  return out;
}

/**
 * Picks the sites around a home station at `home` with its port facing `portAngle`.
 * `asteroids` are the asteroids around home with their current radius.
 */
export function pickTrainingSites(home: Vec2, portAngle: number, asteroids: readonly Asteroid[], radiusOf: (a: Asteroid) => number): TrainingSites {
  const rocks: Rock[] = asteroids.map((a) => ({ a, radius: radiusOf(a) }));
  const dist = (a: Asteroid): number => Math.hypot(a.pos.x - home.x, a.pos.y - home.y);
  const byDistance = (x: Rock, y: Rock): number => dist(x.a) - dist(y.a) || (x.a.id < y.a.id ? -1 : 1);
  const iron = rocks.filter((r) => r.a.resource === 'iron' && dist(r.a) >= ROCK_DISTANCE.min && dist(r.a) <= ROCK_DISTANCE.max);
  const good = iron.filter((r) => veinsOf(r.a).length > 0 && r.a.initialAmount >= ROCK_MIN_AMOUNT);
  // the beam must reach it: a free corridor from the side facing home (no other rock in the way)
  const open = good.filter((r) => approachClear(r, home, rocks));
  const rock = open.sort(byDistance)[0] ?? good.sort(byDistance)[0] ?? iron.sort(byDistance)[0] ?? null;
  const rockPos = rock ? rock.a.pos : { x: home.x + Math.cos(portAngle + 0.6) * 110, y: home.y + Math.sin(portAngle + 0.6) * 110 };
  const rockAngle = Math.atan2(rockPos.y - home.y, rockPos.x - home.x);
  const portDeg = Math.round((portAngle * 180) / Math.PI);

  // first buoy: in front of the port, away from the rock (the player has to turn to reach both)
  const aCandidates = ring(home, 100, portDeg - 75, portDeg + 75);
  const aClear = aCandidates.filter((c) => clearance(c.pos, rocks) >= BUOY_CLEARANCE);
  const scoreA = (c: { angle: number }): number => Math.min(angleDist(c.angle, rockAngle), (2 * Math.PI) / 3);
  const buoyA = (aClear.length > 0 ? aClear : aCandidates).reduce((best, c) => {
    if (aClear.length === 0) return clearance(c.pos, rocks) > clearance(best.pos, rocks) ? c : best;
    return scoreA(c) > scoreA(best) + 1e-9 || (Math.abs(scoreA(c) - scoreA(best)) <= 1e-9 && angleDist(c.angle, portAngle) < angleDist(best.angle, portAngle)) ? c : best;
  });

  // second buoy: farther out on the port side, away from both the first buoy and the rock
  const bCandidates = ring(home, 140, portDeg - 120, portDeg + 120);
  const bClear = bCandidates.filter((c) => clearance(c.pos, rocks) >= BUOY_CLEARANCE);
  const scoreB = (c: { angle: number }): number => Math.min(angleDist(c.angle, buoyA.angle), angleDist(c.angle, rockAngle), Math.PI / 2);
  const buoyB = (bClear.length > 0 ? bClear : bCandidates).reduce((best, c) => {
    if (bClear.length === 0) return clearance(c.pos, rocks) > clearance(best.pos, rocks) ? c : best;
    return scoreB(c) > scoreB(best) + 1e-9 || (Math.abs(scoreB(c) - scoreB(best)) <= 1e-9 && angleDist(c.angle, portAngle) < angleDist(best.angle, portAngle)) ? c : best;
  });

  return { buoyA: buoyA.pos, buoyB: buoyB.pos, rock: rock?.a.id ?? '', rockPos: { ...rockPos } };
}

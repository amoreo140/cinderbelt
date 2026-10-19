// Guild Watch balance (M4d T3, plan §2.3 / T3 "fairness/balance"): a pair of sector-patrol cutters against
// T1 pirates in their Guarded sector, and the starter-class fighter helped by the pair. Ten variants each
// (combat RNG and the pirates' approach). "Won" = every pirate destroyed or driven off beyond 500 u. The
// table is printed with WATCH_REPORT=1:
//   WATCH_REPORT=1 npx vitest run src/sim/guild/watchBalance.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { createEnemy } from '../combat/enemies';
import { steerTo } from '../combat/ai';
import type { Enemy, EnemyKind } from '../combat/types';
import { leadPoint } from '../combat/weapons';
import { IDLE_COMMAND, type PlayerCommand } from '../commands';
import { teleport } from '../discovery/testing';
import { add, length, rotate, sub, type Vec2 } from '../math/vec2';
import { createGrid } from '../ship/grid';
import type { ShipGrid } from '../ship/types';
import { Simulation, type SimEvent } from '../Simulation';
import { hash3 } from '../world/hash';
import { homeStation } from '../world/stations';
import { createWatchShip } from './watch';
import { routeById, scheduledAt, type PatrolRoute } from './watchRoutes';

const TICKS = 60;
const SEED = 1;
const VARIANTS = 10;
const REPORT = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.WATCH_REPORT;

/** The starter ship with two cannons, a shield and armour (as in combat/balance.test.ts). */
const armedStarter = (): ShipGrid =>
  createGrid([
    ['cockpit', 1, 0], ['gyro', 0, 0], ['miningLaser', 2, 0, 0], ['reactor', -1, 0], ['cargo', 0, 1], ['cargo', 0, -1],
    ['fuelTank', 1, 1], ['radar', 1, -1], ['engine', -1, 1, 0], ['engine', -1, -1, 0], ['engine', 2, 1, 2], ['engine', 2, -1, 2],
    ['engine', 0, -2, 1], ['engine', 0, 2, 3], ['cannon', 1, 2, 0], ['cannon', 1, -2, 0], ['shield', -1, 2], ['armor', -1, -2],
  ]);

/** The sector patrol with the fewest rocks around its circle (no station near), searched around home. */
function clearSectorRoute(sim: Simulation): { route: PatrolRoute; centre: Vec2 } {
  let best: { route: PatrolRoute; centre: Vec2; rocks: number } | null = null;
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const route = routeById(sim.state, `sector:${i},${j}`);
      if (!route) continue;
      let cx = 0;
      let cy = 0;
      for (const p of route.points) {
        cx += p.x;
        cy += p.y;
      }
      const centre = { x: cx / route.points.length, y: cy / route.points.length };
      sim.state.world.update(centre);
      if (sim.state.world.stationCirclesNear(centre, 600).length > 0) continue;
      const rocks = sim.state.world.circlesNear(centre, 330).length;
      if (!best || rocks < best.rocks) best = { route, centre, rocks };
    }
  }
  if (!best) throw new Error('no sector patrol');
  return best;
}

interface Fight {
  sim: Simulation;
  pirates: string[];
  centre: Vec2;
  route: PatrolRoute;
  /** The pair of cutters takes part (else every Watch ship is kept away). */
  cutters: boolean;
}

/**
 * A fight at a clear sector patrol: the pair of cutters (when `cutters`) on its schedule, `kinds` (T1)
 * coming in from `variant`'s side; the player either takes part (`player`) or waits 200 u from the centre on the far side (pirates despawn beyond 750 u of the player).
 */
function setupFight(kinds: readonly EnemyKind[], variant: number, cutters: boolean, player: boolean): Fight {
  const sim = new Simulation({ seed: SEED, startDocked: false, ...(player ? { grid: armedStarter() } : {}) });
  const { route, centre } = clearSectorRoute(sim);
  sim.state.tick = 600 * (variant + 1);
  sim.state.combat.rng = hash3(0x3a7c, variant, 77);
  const lead = scheduledAt(route, 0, sim.state.tick);
  const a = (variant / VARIANTS) * Math.PI * 2;
  teleport(sim, player ? add(lead.pos, rotate({ x: -30, y: 0 }, a)) : add(centre, rotate({ x: 200, y: 0 }, a + Math.PI)));
  // a bystander: parked at the home station's berth (no pirate's target), still the centre of the spawn bubble
  if (!player) sim.state.player.dock = { mode: 'docked', stationId: homeStation().id };
  sim.state.combat.enemies = [];
  if (cutters) for (let slot = 0; slot < route.members.length; slot++) sim.state.guild.watch.push(createWatchShip(scheduledAt(route, slot, sim.state.tick), sim.state.tick));
  const pirates = kinds.map((kind, k) => {
    const pos = add(centre, rotate({ x: 50 + k * 14, y: (k - (kinds.length - 1) / 2) * 18 }, a));
    const id = `pr:wb:${variant}:${k}`;
    sim.state.combat.enemies.push(createEnemy({ id, kind, tier: 1, pos, angle: a + Math.PI, home: pos, orbit: k % 2 === 0 ? 1 : -1 }));
    return id;
  });
  return { sim, pirates, centre, route, cutters };
}

/** Keeps only the fight's own pirates and cutters (no world spawns, raids, scavengers or other Watch routes). */
function clearAmbient(f: Fight): void {
  const keep = new Set(f.pirates);
  const { combat, guild, tick } = f.sim.state;
  for (const e of combat.enemies) if (!keep.has(e.id)) combat.defeated.set(e.id, tick);
  combat.enemies = combat.enemies.filter((e) => keep.has(e.id));
  guild.watch = f.cutters ? guild.watch.filter((w) => w.route === f.route.id) : [];
}

/** The scripted pilot of combat/balance.test.ts: lead aim at the nearest pirate, ~22 u standoff, fire in range. */
function pilot(sim: Simulation, target: Enemy): PlayerCommand {
  const p = sim.state.player;
  const w = p.props.weapons[0]!;
  const aim = leadPoint(p.body.pos, p.body.vel, target.body.pos, target.body.vel, w.projectileSpeed);
  const d = length(sub(target.body.pos, p.body.pos));
  return { ...IDLE_COMMAND, flight: steerTo(p.body, aim, d > 22 ? 1 : 0), aim, fire: d < w.range * 0.95 };
}

interface Outcome {
  /** All pirates destroyed (or gone beyond 500 u of the fight); else the Watch / the player lost or time ran out. */
  won: boolean;
  seconds: number;
  /** Pirates destroyed (not fled). */
  killed: number;
  /** Cutters not destroyed (a retreat that got away counts as alive). */
  cuttersAlive: number;
  playerDied: boolean;
}

function runFight(f: Fight, playerFights: boolean, limit = 240): Outcome {
  const { sim } = f;
  let killed = 0;
  let cuttersLost = 0;
  const cutters = sim.state.guild.watch.length;
  for (let t = 0; t < limit * TICKS; t++) {
    clearAmbient(f);
    const left = sim.state.combat.enemies.filter((e) => length(sub(e.body.pos, f.centre)) < 500);
    const seconds = t / TICKS;
    if (left.length === 0) return { won: true, seconds, killed, cuttersAlive: cutters - cuttersLost, playerDied: false };
    if (sim.state.player.destroyed) return { won: false, seconds, killed, cuttersAlive: cutters - cuttersLost, playerDied: true };
    // the pair is out of the fight: destroyed, or retreated and gone
    if (f.cutters && sim.state.guild.watch.every((w) => w.mode === 'retreat') && !playerFights) return { won: false, seconds, killed, cuttersAlive: cutters - cuttersLost, playerDied: false };
    sim.state.player.fuel = sim.state.player.props.fuelCapacity;
    let cmd: PlayerCommand = IDLE_COMMAND;
    if (playerFights && sim.state.player.props.weapons.length > 0) {
      const p = sim.state.player.body.pos;
      const target = left.reduce((a, b) => (length(sub(a.body.pos, p)) <= length(sub(b.body.pos, p)) ? a : b));
      cmd = pilot(sim, target);
    }
    const events: SimEvent[] = sim.step(cmd);
    for (const e of events) {
      if (e.type === 'shipDestroyed' && f.pirates.includes(e.ref)) killed++;
      if (e.type === 'npcDestroyed' && e.id.startsWith('gw:')) cuttersLost++;
    }
  }
  return { won: false, seconds: limit, killed, cuttersAlive: cutters - cuttersLost, playerDied: false };
}

function table(name: string, rows: Outcome[]): void {
  if (!REPORT) return;
  const lines = rows.map((r, i) => `${name} v${i}: ${r.won ? 'won ' : 'lost'} ${r.seconds.toFixed(1)} s, killed ${r.killed}, cutters ${r.cuttersAlive}${r.playerDied ? ', player died' : ''}`);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

describe('Guild Watch balance', () => {
  it('2 cutters beat a Hammer + Jackal (T1) in 40–120 s with a cutter left in ≥ 7 of 10', () => {
    const rows = Array.from({ length: VARIANTS }, (_, v) => runFight(setupFight(['hammer', 'jackal'], v, true, false), false));
    table('2 cutters vs hammer+jackal', rows);
    const good = rows.filter((r) => r.won && r.killed >= 1 && r.seconds >= 40 && r.seconds <= 120 && r.cuttersAlive >= 1).length;
    expect(good).toBeGreaterThanOrEqual(7);
  }, 120_000);

  it('2 cutters do not beat a depth-3 trio (Gunner, Hammer, Jackal T1) alone in ≥ 6 of 10', () => {
    const rows = Array.from({ length: VARIANTS }, (_, v) => runFight(setupFight(['gunner', 'hammer', 'jackal'], v, true, false), false));
    table('2 cutters vs gunner+hammer+jackal', rows);
    expect(rows.filter((r) => !r.won).length).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('the starter-class fighter with 2 cutters kills a Hammer + 2 Jackals in ≤ 70 % of its time alone', () => {
    const kinds: EnemyKind[] = ['hammer', 'jackal', 'jackal'];
    const alone = Array.from({ length: VARIANTS }, (_, v) => runFight(setupFight(kinds, v, false, true), true));
    const helped = Array.from({ length: VARIANTS }, (_, v) => runFight(setupFight(kinds, v, true, true), true));
    table('player alone', alone);
    table('player + 2 cutters', helped);
    const mean = (rows: Outcome[]) => rows.reduce((s, r) => s + (r.won ? r.seconds : 240), 0) / rows.length;
    expect(mean(helped)).toBeLessThanOrEqual(0.7 * mean(alone));
  }, 180_000);
});

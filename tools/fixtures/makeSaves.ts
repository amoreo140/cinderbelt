// Test save positions ("fixtures"): deterministic saves at given points of the game, so e2e specs,
// screenshots and manual checks start there in seconds instead of playing there from the main menu.
//
//   npm run fixtures            → regenerates tests/fixtures/saves/*.json and its README.md
//   FIXTURES=shapes,shapes-fight npm run fixtures
//                               → regenerates only the named files and their README sections (the
//                                 fixtures they fork from are built in memory, not written)
//
// Progression saves come from the real simulation: the scripted Guild Training (sim/training/testing)
// and the balance bot (tools/bot) on a fixed seed. Situation saves fork a progression save and put the
// ship into a spot the bot does not reach quickly (state edits are listed per fixture in the README).
// The generator is pure and deterministic: the same code gives byte-identical files.
import { HANGAR } from '../../src/data/economy';
import { cargoUsed, emptyCargo, RESOURCE_IDS, type ResourceId } from '../../src/data/resources';
import { partKey } from '../../src/data/parts';
import { applyDeath } from '../../src/sim/death/death';
import { rebuildShip, splitGrid } from '../../src/sim/combat/damage';
import { spawnSlots } from '../../src/sim/combat/enemies';
import { lootEmpty, salvageTarget } from '../../src/sim/combat/wrecks';
import { echoSites } from '../../src/sim/discovery/poi';
import { generatedNameIndex } from '../../src/sim/fleet/names';
import { emptyShipLog, nextSlotPrice } from '../../src/sim/fleet/state';
import type { ShipGrid } from '../../src/sim/ship/types';
import { findPoi, holdScan, run, tapScan } from '../../src/sim/discovery/testing';
import { length, sub, type Vec2 } from '../../src/sim/math/vec2';
import { isRich, oreGrade } from '../../src/sim/mining/grade';
import { veinsOf } from '../../src/sim/mining/veins';
import { fortressSites } from '../../src/sim/pirates/sites';
import { loadSave } from '../../src/sim/save/load';
import { restoreSimulation, toEnvelope, toSave } from '../../src/sim/save/serialize';
import type { SaveGame } from '../../src/sim/save/types';
import { DIFFICULTY_PRESETS } from '../../src/sim/settings';
import { hullBudgetOf } from '../../src/sim/ship/budget';
import { createGrid, validateGrid } from '../../src/sim/ship/grid';
import { mirrorShape } from '../../src/sim/ship/shape';
import { gridToSave } from '../../src/sim/save/gridSave';
import { blockedOutputs, looseShapes } from '../../src/sim/shipyard/design';
import { encodeTemplate } from '../../src/sim/templates/codec';
import { createStarterShip } from '../../src/sim/ship/presets';
import { computeProperties } from '../../src/sim/ship/properties';
import { gridTemplateParts } from '../../src/sim/templates/normalize';
import { maxHp } from '../../src/sim/ship/hp';
import { SIM_DT, Simulation, type SimEvent } from '../../src/sim/Simulation';
import { checkDock, dockHeading, dockPoint } from '../../src/sim/station/dock';
import { receiverPos } from '../../src/sim/sites/relays';
import { act, dockHome, mineAtRock, playTraining, stepId, teleport, trainingSim, undock } from '../../src/sim/training/testing';
import { CHUNK_SIZE } from '../../src/sim/world/chunks';
import { ringIndexAt } from '../../src/sim/world/rings';
import { HOME_STATION_ID, homeStation, stationById, stationsInArea, type StationDef } from '../../src/sim/world/stations';
import { GRAVEYARD, MINE } from '../../src/data/sites';
import { sectorIdAt, sectorInfoAt, sectorSecurity } from '../../src/sim/regions';
import { derelictDockTarget, nearestBerth } from '../../src/sim/sites/berth';
import { cometAt, cometDefs, cometPassWindow } from '../../src/sim/sites/comets';
import { graveyardLayout } from '../../src/sim/sites/graveyard';
import { sitesInChunk } from '../../src/sim/sites/placement';
import type { DerelictSite, GraveyardSite, Site } from '../../src/sim/sites/types';
import { dockPose } from '../../src/sim/station/dock';
import { stormAt } from '../../src/sim/events/storms';
import { archiveNode } from '../../src/data/archive';
import { HOME_MODULES } from '../../src/data/home';
import type { PartKey } from '../../src/data/parts';
import { captainDefs } from '../../src/sim/captains/captains';
import { LOG_MAX } from '../../src/sim/career/types';
import { paintOf } from '../../src/sim/fleet/state';
import { trophiesOf } from '../../src/sim/home';
import { fortressStatus } from '../../src/sim/pirates/fortress';
import { workshopMounts } from '../../src/sim/ship/workshop';
import type { RepUnlock } from '../../src/data/factions';
import { CONVOY } from '../../src/data/convoys';
import { RELAY_CHAIN } from '../../src/data/guild';
import type { NoteIcon } from '../../src/data/navigation';
import { RELAY } from '../../src/data/sites';
import type { ContractOffer } from '../../src/sim/career/types';
import { createEnemy } from '../../src/sim/combat/enemies';
import { boardContext, boardEpoch, currentBoard, ensureBoard } from '../../src/sim/contracts/board';
import { escortAvailable, escortOffer } from '../../src/sim/convoys/escort';
import { linkPose } from '../../src/sim/convoys/link';
import { convoyAt, convoyPassWindow, convoysInFlight } from '../../src/sim/convoys/schedule';
import type { ConvoyPose } from '../../src/sim/convoys/types';
import { guildRelaySite, MAST_RADIUS } from '../../src/sim/guild/relaySites';
import type { GuildRelaySite } from '../../src/sim/guild/types';
import { scheduledWatchNear } from '../../src/sim/guild/watchRoutes';
import { createRng } from '../../src/sim/math/rng';
import { securityHere } from '../../src/sim/pirates/sectors';
import { gridFromSave } from '../../src/sim/save/gridSave';
import { IDLE_COMMAND } from '../../src/sim/commands';
import { BotLog, DEFAULT_BOT_OPTIONS, Pilot } from '../bot/pilot';
import { node } from '../bot/node';

export const FIXTURE_DIR = 'tests/fixtures/saves';
/** The seed of every fixture – the same world as the `?play` quick start (seed 1337). */
export const FIXTURE_SEED = 1337;
/** A fixed timestamp keeps the files byte-identical between runs. */
const STAMP = '2026-10-17T12:00:00.000Z';
const TICKS_PER_HOUR = Math.round(3600 / SIM_DT);

export interface Fixture {
  name: string;
  save: SaveGame;
  /** One line: what the save is for. */
  purpose: string;
  /** The fixture this one was forked from (null = played from a new game). */
  base: string | null;
  /** How it was made: played by the bot / script, and any direct state edits. */
  made: string;
}

const t2Parts = (save: SaveGame): number => save.player.grid.parts.filter((p) => p.tier >= 2).length;

const newSim = (): Simulation =>
  new Simulation({ seed: FIXTURE_SEED, settings: { seedText: String(FIXTURE_SEED), ...DIFFICULTY_PRESETS.standard, fallenFromHardcore: false } });

function snapshot(sim: Simulation, name: string): SaveGame {
  const save = toSave(sim, { gameId: `fixture-${name}`, name: `Fixture ${name}`, createdAt: STAMP, savedAt: STAMP, reason: 'manual', gameVersion: 'fixture' });
  // the fixture must load through the same path as a player's save
  const check = loadSave(toEnvelope(save));
  if (!check.ok) throw new Error(`fixture ${name} does not load: ${check.error} ${check.details.join('; ')}`);
  return save;
}

/** A fresh simulation from a progression save (the save itself stays untouched). */
const fork = (save: SaveGame): Simulation => restoreSimulation(structuredClone(save));

function assert(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`fixture generator: ${what}`);
}

const dockedAt = (sim: Simulation): string => {
  const d = sim.state.player.dock;
  return d.mode === 'flying' ? '(flying)' : d.stationId;
};

const docked = (sim: Simulation, station = HOME_STATION_ID): boolean => {
  const d = sim.state.player.dock;
  return d.mode === 'docked' && d.stationId === station;
};

/** Undock at the station and stop: the ship flies (dampers on). */
function launch(sim: Simulation): void {
  if (sim.state.player.dock.mode === 'docked') undock(sim);
  run(sim, 2);
  assert(sim.state.player.dock.mode === 'flying', 'undock failed');
}

/** Place the stopped ship at `pos`, the bow towards `look`, and let the world settle around it. */
function park(sim: Simulation, pos: Vec2, look: Vec2, ticks = 30): void {
  teleport(sim, pos, Math.atan2(look.y - pos.y, look.x - pos.x));
  sim.state.player.dampers = true;
  run(sim, ticks);
}

/** Back home by the dock clamp (the docking manoeuvre of the training helper). */
function backHome(sim: Simulation): void {
  dockHome(sim);
  assert(docked(sim), `docking at home failed (${sim.state.player.dock.mode})`);
}

/** Recharged and topped up, as after a calm flight (fixtures should not start on an empty battery). */
function freshShip(sim: Simulation): void {
  const p = sim.state.player;
  p.energy = p.props.batteryCapacity;
  p.shield = p.props.shield.capacity;
  p.heat.clear();
}

// ---------------------------------------------------------------- progression

/** The bot plays on until the game time passes `untilTick` and it is about to undock (from its base station). */
function botUntil(sim: Simulation, pilot: Pilot, untilTick: number, name: string): SaveGame {
  const state = sim.state;
  const limit = untilTick + TICKS_PER_HOUR;
  while (state.tick < limit) {
    if (state.player.destroyed) applyDeath(sim);
    const cmd = pilot.command();
    // stop on the tick the bot leaves a station: the station business (sell, refit, refuel) is done
    const stop = state.tick >= untilTick && state.player.dock.mode === 'docked' && cmd.actions?.some((a) => a.type === 'undock');
    const save = stop ? snapshot(sim, name) : null;
    // the command is stepped either way – the bot's station script has already handed out the undock
    const events: SimEvent[] = sim.step(cmd);
    pilot.onEvents(events);
    assert(!pilot.aborted, `the bot got stuck: ${pilot.aborted}`);
    if (save) return save;
  }
  throw new Error(`the bot did not dock within an hour after tick ${untilTick}`);
}

/** The first Echo signal triangulated and scanned (the player's own scanner, the ship teleported). */
function scanFirstEcho(sim: Simulation): void {
  const echo = echoSites(sim.state.seed)[0]!;
  launch(sim);
  // three pulses from three spots (the same as the e2e Echo-0 test)
  for (const [dx, dy] of [[0, 0], [220, 0], [0, 220]] as const) {
    park(sim, { x: echo.pos.x * 0.45 + dx, y: echo.pos.y * 0.45 + dy }, echo.pos);
    for (let i = 0; i < 600 && sim.state.discovery.scanner.cooldown > 0; i++) run(sim, 1);
    freshShip(sim);
    tapScan(sim);
  }
  assert(sim.state.discovery.known.has('echo:0'), 'Echo-0 was not triangulated');
  park(sim, { x: echo.pos.x - 15, y: echo.pos.y - 9 }, echo.pos);
  freshShip(sim);
  for (let i = 0; i < 4 && !sim.state.discovery.scanned.has('echo:0'); i++) holdScan(sim, echo.pos);
  assert(sim.state.discovery.scanned.has('echo:0'), 'Echo-0 was not scanned');
}

/** Archive nodes bought at home with the real action; the Data fund is topped up when short. */
function buyArchive(sim: Simulation, nodes: readonly string[], data: number): number {
  const d = sim.state.discovery;
  const topUp = Math.max(0, data - d.dataFund);
  d.dataFund += topUp;
  d.dataTotal += topUp;
  for (const node of nodes) {
    act(sim, { type: 'archiveBuy', node });
    assert(d.archive.has(node as never), `the Archive node ${node} was not bought`);
  }
  return topUp;
}

function progression(): Fixture[] {
  const out: Fixture[] = [];

  // start: a new game with "Skip training" – docked at home with the starter ship
  const start = newSim();
  out.push({
    name: 'start',
    save: snapshot(start, 'start'),
    purpose: 'A new game with the training skipped: docked at home, starter ship, starting storage.',
    base: null,
    made: 'New game (Skip training), nothing played.',
  });

  // training-mid: the Guild Training up to the first shipyard step (side engines)
  const mid = trainingSim(FIXTURE_SEED);
  undock(mid);
  teleport(mid, mid.state.career.training.sites!.buoyA);
  run(mid, 2);
  mineAtRock(mid, 21);
  dockHome(mid);
  act(mid, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' });
  run(mid, 2);
  assert(stepId(mid) === 'installSide' && docked(mid), `training-mid is at ${stepId(mid)}`);
  out.push({
    name: 'training-mid',
    save: snapshot(mid, 'training-mid'),
    purpose: 'Guild Training at step 4 "install the side engines": docked at home, the two reward engines in storage.',
    base: null,
    made: 'Training steps 1–3 played by the scripted playthrough (flights are teleports).',
  });

  // after-training: the whole training played through
  const trained = trainingSim(FIXTURE_SEED);
  playTraining(trained);
  assert(trained.state.career.training.status === 'done' && docked(trained), 'the training did not finish at home');
  out.push({
    name: 'after-training',
    save: snapshot(trained, 'after-training'),
    purpose: 'The Guild Training just finished: docked at home with the ship the training built.',
    base: null,
    made: 'The whole training played by the scripted playthrough (flights are teleports).',
  });

  // hour1 / hour2: the balance bot plays on from the trained game (on this seed it gets further than
  // from "Skip training": a T2 cockpit before 1 h). A training change moves these fixtures too.
  const played = trained;
  const pilot = new Pilot(played, { ...DEFAULT_BOT_OPTIONS, training: 'play' }, new BotLog());
  const hour1 = botUntil(played, pilot, TICKS_PER_HOUR, 'hour1');
  const ring2 = hour1.world.explored.some((key) => {
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    return ringIndexAt(Math.hypot((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE)) >= 2;
  });
  assert(ring2, 'hour1: the bot has not been to ring 2');
  out.push({
    name: 'hour1',
    save: hour1,
    purpose: `About 1 h of bot play (${t2Parts(hour1)} T2 parts, cannons and a shield), ring 2 visited; docked at \`${hour1.player.dockedAt}\` after selling.`,
    base: 'after-training',
    made: 'Played by the balance bot (tools/bot, default options) until it was about to undock after 1:00 h.',
  });

  const hour2 = fork(botUntil(played, pilot, 2 * TICKS_PER_HOUR, 'hour2'));
  scanFirstEcho(hour2);
  backHome(hour2);
  freshShip(hour2);
  const topUp = buyArchive(hour2, ['battery', 'fuelTankPlus', 'echoDecoder'], 20 + 30 + 40);
  const hour2Save = snapshot(hour2, 'hour2');
  out.push({
    name: 'hour2',
    save: hour2Save,
    purpose: `About 2 h of bot play (${t2Parts(hour2Save)} T2 parts), Echo-0 found and scanned, Archive nodes Battery, Extended tank and Echo decoder; docked at home.`,
    base: 'hour1',
    made:
      'Bot play until it was about to undock after 2:00 h, then scripted: Echo-0 triangulated and scanned with the real scanner ' +
      `(teleports between the spots), docked at home, three Archive nodes bought with the real action` +
      (topUp > 0 ? ` (Data fund topped up by ${topUp} D – the bot does not scan).` : '.'),
  });
  return out;
}

// ---------------------------------------------------------------- situations

/** Stopped on the home dock axis 15 u out from the clamp, the bow at the station (docking rules apply). */
function dockApproach(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const home = homeStation();
  const pt = dockPoint(home, sim.state.player.props.boundingRadius);
  const out = { x: Math.cos(home.portAngle), y: Math.sin(home.portAngle) };
  const pos = { x: pt.x + out.x * 15, y: pt.y + out.y * 15 };
  teleport(sim, pos, dockHeading(home));
  sim.state.player.dampers = true;
  run(sim, 10);
  const check = checkDock(sim.state.player.body, sim.state.player.props.boundingRadius, sim.state.world.stations());
  assert(check.status === 'tooFar', `dock-approach: expected "too far", got ${check.status}`);
  return {
    name: 'dock-approach',
    save: snapshot(sim, 'dock-approach'),
    purpose: 'Flying, stopped on the home dock axis 15 u out from the clamp, bow at the station – fly in and press F.',
    base: 'start',
    made: 'Undocked, then the ship placed on the dock axis (teleport).',
  };
}

/** A pirate group of ring 2 already chasing the ship. */
function piratesNear(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  freshShip(sim);
  // the nearest ring-2 group of the seed, away from fortresses
  const forts = fortressSites(sim.state.seed);
  let best: { home: Vec2; d: number } | null = null;
  for (let cx = -16; cx <= 16; cx++) {
    for (let cy = -16; cy <= 16; cy++) {
      const slots = spawnSlots(sim.state.seed, cx, cy, sim.state.settings.enemyDensity);
      const slot = slots[0];
      if (!slot || ringIndexAt(length(slot.home)) !== 2 || slots.some((s) => s.kind === 'hammer')) continue;
      if (forts.some((f) => length(sub(f.pos, slot.home)) < 700)) continue;
      const d = length(slot.home);
      if (!best || d < best.d) best = { home: slot.home, d };
    }
  }
  assert(best, 'no ring-2 pirate group');
  // 170 u from the group on its outer side, deeper in ring 2 (pirates spawn 140 u or more from the ship)
  const dir = { x: best.home.x / best.d, y: best.home.y / best.d };
  park(sim, { x: best.home.x + dir.x * 170, y: best.home.y + dir.y * 170 }, best.home, 2);
  for (let i = 0; i < 1200 && !sim.state.combat.enemies.some((e) => e.kind === 'jackal'); i++) run(sim, 1);
  const group = sim.state.combat.enemies.filter((e) => e.kind === 'jackal');
  assert(group.length > 0, 'pirates-near: the group did not spawn');
  // then 120 u from the first Jackal (inside its aggro range of 140 u), the bow at it
  const lead = group[0]!.body.pos;
  park(sim, { x: lead.x + dir.x * 120, y: lead.y + dir.y * 120 }, lead, 1);
  const nearest = (): number => Math.min(Infinity, ...sim.state.combat.enemies.map((e) => length(sub(e.body.pos, sim.state.player.body.pos))));
  // let them notice the ship and turn towards it (an attacking Jackal holds its gun range, about 120 u)
  const attacking = (): boolean => sim.state.combat.enemies.some((e) => e.ai.mode === 'attack');
  for (let i = 0; i < 1200 && !(nearest() < 130 && attacking()); i++) run(sim, 1);
  assert(nearest() < 130 && attacking() && !sim.state.player.destroyed, `pirates-near: the group did not close in (nearest ${nearest().toFixed(0)} u)`);
  const range = Math.round(nearest() / 10) * 10;
  freshShip(sim);
  return {
    name: 'pirates-near',
    save: snapshot(sim, 'pirates-near'),
    purpose: `Ring 2, a pirate group (Jackals) attacking, the nearest about ${range} u away; shield and battery full.`,
    base: 'hour1',
    made: 'Undocked, the ship placed by a ring-2 group (teleports: to spawn it, then 120 u from it), the simulation ran until they attacked.',
  };
}

/** Just outside the aggro range of the nearest Rust fortress, the bow at it. */
function fortress(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const site = [...fortressSites(sim.state.seed)].sort((a, b) => length(a.pos) - length(b.pos))[0]!;
  const d = length(site.pos);
  const pos = { x: site.pos.x - (site.pos.x / d) * 200, y: site.pos.y - (site.pos.y / d) * 200 };
  park(sim, pos, site.pos, 30);
  // the ambient groups around the fortress stay away for the shot (counted as beaten, they respawn later)
  for (const e of sim.state.combat.enemies) sim.state.combat.defeated.set(e.id, sim.state.tick);
  sim.state.combat.enemies = [];
  freshShip(sim);
  assert(!sim.state.player.destroyed, 'fortress: the ship was destroyed');
  return {
    name: 'fortress',
    save: snapshot(sim, 'fortress'),
    purpose: `Ring 2, 200 u in front of the Rust fortress ${site.id} (aggro range 170 u), bow at it, untouched fortress.`,
    base: 'hour2',
    made: 'Undocked, the ship placed in front of the fortress (teleport); the pirate groups around were cleared (marked beaten).',
  };
}

/** Next to a rich veined rock whose grade is assayed, lasers cold and the battery full. */
function richRock(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const seed = sim.state.seed;
  const world = sim.state.world;
  // the nearest rich, veined (not ice) rock around home, searched chunk by chunk
  let rock: ReturnType<typeof world.asteroids>[number] | null = null;
  for (let r = 1; r <= 8 && !rock; r++) {
    for (let a = 0; a < 8 * r && !rock; a++) {
      const at = { x: Math.cos((a / (8 * r)) * 2 * Math.PI) * r * CHUNK_SIZE, y: Math.sin((a / (8 * r)) * 2 * Math.PI) * r * CHUNK_SIZE };
      world.update(at);
      const found = world
        .asteroids()
        .filter((x) => x.resource !== 'ice' && veinsOf(x).length > 0 && isRich(oreGrade(seed, x)) && world.remaining(x) > 50)
        .sort((x, y) => length(x.pos) - length(y.pos));
      rock = found[0] ?? null;
    }
  }
  assert(rock, 'no rich veined rock');
  const radius = world.radiusOf(rock);
  // on the side of the rock facing home, clear of other rocks
  const d = length(rock.pos);
  const gap = radius + sim.state.player.props.boundingRadius + 3;
  const pos = { x: rock.pos.x - (rock.pos.x / d) * gap, y: rock.pos.y - (rock.pos.y / d) * gap };
  park(sim, pos, rock.pos, 20);
  freshShip(sim);
  // a scanner pulse assays the ore grade around (the real scanner)
  tapScan(sim);
  run(sim, 5);
  freshShip(sim);
  // the lasers reach it: checked on a copy, the fixture itself is not mined
  const saved = snapshot(sim, 'rich-rock');
  const probe = fork(saved);
  run(probe, 30, { mining: true, aim: rock.pos });
  assert(probe.state.player.beams.some((b) => b.asteroidId === rock.id), 'rich-rock: the lasers do not reach the rock');
  return {
    name: 'rich-rock',
    save: saved,
    purpose: `Flying next to the rich veined ${rock.resource} rock ${rock.id} (grade ${Math.round(oreGrade(seed, rock) * 100)} %, assayed), bow at it, right mouse mines.`,
    base: 'hour1',
    made: 'Undocked, the ship placed by the rock (teleport), one scanner pulse (real).',
  };
}

/** Several parts damaged and two destroyed (gaps against the ship design), docked at home. */
function damaged(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const p = sim.state.player;
  // destroy two outer parts whose loss leaves the rest connected (a laser and a cargo hold if possible)
  const pick = (id: string, taken: Set<number>) =>
    p.grid.parts.find((x) => x.partId === id && !taken.has(x.id) && splitGrid(p.grid, new Set([...taken, x.id])).detached.length === 0);
  const destroyed = new Set<number>();
  for (const id of ['miningLaser', 'cargo']) {
    const part = pick(id, destroyed);
    if (part) destroyed.add(part.id);
  }
  assert(destroyed.size === 2, 'damaged: no parts to destroy');
  const split = splitGrid(p.grid, destroyed);
  rebuildShip(p, split.remaining!);
  // three more parts worn down (40–70 % HP)
  const worn = p.grid.parts.filter((x) => x.partId !== 'cockpit').slice(0, 3);
  worn.forEach((x, i) => p.hp.set(x.id, Math.round(maxHp(x) * (0.4 + 0.15 * i))));
  backHome(sim);
  return {
    name: 'damaged',
    save: snapshot(sim, 'damaged'),
    purpose: 'Docked at home: a mining laser and a cargo hold destroyed (design gaps), three parts at 40–70 % HP – repairs and "restore design".',
    base: 'hour1',
    made: 'Undocked, parts removed and HP lowered directly (the combat damage functions), docked at home.',
  };
}

/** Next to a salvageable derelict wreck (a place of interest). */
function wreckSalvage(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const poi = findPoi(sim.state.seed, 'wreck');
  park(sim, { x: poi.pos.x - 25, y: poi.pos.y }, poi.pos, 30);
  const wreck = sim.state.combat.wrecks.find((w) => w.poi === poi.id);
  assert(wreck, `wreck-salvage: the wreck ${poi.id} did not load`);
  // close to its hull: within salvage range (F loads the loot)
  const br = sim.state.player.props.boundingRadius;
  const off = sub(sim.state.player.body.pos, wreck.body.pos);
  const dist = length(off) || 1;
  const reach = wreck.props.boundingRadius + br + 2;
  park(sim, { x: wreck.body.pos.x + (off.x / dist) * reach, y: wreck.body.pos.y + (off.y / dist) * reach }, wreck.body.pos, 10);
  for (const e of sim.state.combat.enemies) sim.state.combat.defeated.set(e.id, sim.state.tick);
  sim.state.combat.enemies = [];
  const target = salvageTarget(sim.state.combat.wrecks, sim.state.player.body.pos, br);
  assert(target && target.poi === poi.id && !lootEmpty(target.loot), 'wreck-salvage: the wreck is not salvageable from here');
  freshShip(sim);
  return {
    name: 'wreck-salvage',
    save: snapshot(sim, 'wreck-salvage'),
    purpose: `Flying within salvage range of the derelict ${poi.cls} wreck ${poi.id} (loot aboard) – F salvages, Tab scans.`,
    base: 'hour1',
    made: 'Undocked, the ship placed by the wreck (teleport); nearby pirates cleared (marked beaten).',
  };
}

/** Docked at home with a full hold of mixed ore. */
function cargoFull(base: SaveGame): Fixture {
  const sim = fork(base);
  const p = sim.state.player;
  const mix: Partial<Record<ResourceId, number>> = { iron: 0.35, copper: 0.3, titanium: 0.25, ice: 0.1 };
  const cap = p.props.cargoCapacity;
  for (const r of RESOURCE_IDS) p.cargo[r] = Math.floor(cap * (mix[r] ?? 0));
  p.cargo.iron += cap - cargoUsed(p.cargo);
  assert(p.dock.mode === 'docked' && cargoUsed(p.cargo) === cap, 'cargo-full: the hold is not full');
  return {
    name: 'cargo-full',
    save: snapshot(sim, 'cargo-full'),
    purpose: `Docked at \`${dockedAt(sim)}\` with a full hold (${cap} u: iron, copper, titanium, ice) – the market sells it.`,
    base: 'hour1',
    made: 'The hold filled directly.',
  };
}

/** A T2 fighter (bow +x): two T2 cannons, a T2 shield and armour, three forward engines, no mining. */
const fighterGrid = (): ShipGrid =>
  createGrid([
    ['cockpit', 0, 0, 0, 2],
    ['armor', 1, 0, 0, 2],
    ['cannon', 1, 1, 0, 2],
    ['cannon', 1, -1, 0, 2],
    ['gyro', -1, 0],
    ['reactor', 0, 1, 0, 2],
    ['reactor', 0, -1, 0, 2],
    ['shield', -1, 1, 0, 2],
    ['fuelTank', -1, -1],
    ['engine', -2, 0, 0, 2],
    ['engine', -2, 1, 0, 2],
    ['engine', -2, -1, 0, 2],
    ['engine', 0, 2, 3],
    ['engine', 0, -2, 1],
    ['engine', 1, 2, 2],
    ['engine', 1, -2, 2],
  ]);

/** Docked at home after hour2 with two ships in the hangar (home and the nearest shipyard) and three templates. */
function hangar(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  assert(docked(sim), 'hangar: hour2 is not docked at home');
  // the Archive node "Ship templates" (real action) and credits for two slots (5 000 + 15 000)
  const dataTopUp = buyArchive(sim, ['templates'], 40);
  const slotsPrice = HANGAR.slotPrices[0]! + HANGAR.slotPrices[1]!;
  const creditTopUp = Math.max(0, slotsPrice + 2000 - s.credits);
  s.credits += creditTopUp;
  // the nearest discovered station with a shipyard (other than home)
  const yard = [...s.world.discovered]
    .map((id) => stationById(s.seed, id, s.world.gen))
    .filter((st): st is NonNullable<typeof st> => !!st && st.id !== HOME_STATION_ID && st.services.shipyard)
    .sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0];
  assert(yard, 'hangar: no discovered shipyard station besides home');

  // a slot at home with the real action, one at the yard as if bought there (the same price)
  act(sim, { type: 'hangarBuySlot' });
  assert(s.fleet.slots.get(HOME_STATION_ID) === 1, 'hangar: the home slot was not bought');
  const price = nextSlotPrice(s)!;
  s.credits -= price;
  s.fleet.slots.set(yard.id, 1);

  // the stored ships: a T2 fighter at home (named), the starter-layout miner at the yard (with ore)
  const store = (stationId: string, grid: ShipGrid, name: string | null, fuelShare: number, cargo: Partial<Record<ResourceId, number>>) => {
    assert(validateGrid(grid).length === 0, `hangar: invalid ship for ${stationId}`);
    const props = computeProperties(grid);
    assert(props.thrust.forward > 0 && !hullBudgetOf(grid).over, `hangar: the ship for ${stationId} cannot fly or is over budget`);
    const id = s.fleet.nextShipId++;
    const taken = new Set([s.fleet.active.nameIdx, ...s.fleet.stored.map((x) => x.record.nameIdx)]);
    s.fleet.stored.push({
      record: { id, name, nameIdx: generatedNameIndex(s.seed, id, taken), log: { ...emptyShipLog(), built: s.tick } },
      stationId,
      grid,
      blueprint: grid,
      hp: new Map(),
      fuel: props.fuelCapacity * fuelShare,
      cargo: { ...emptyCargo(), ...cargo },
    });
  };
  store(HOME_STATION_ID, fighterGrid(), 'Osa', 1, {});
  store(yard.id, createStarterShip(), null, 0.6, { iron: 24, copper: 8 });

  // three templates with the real action: the active miner, the fighter, the starter layout
  for (const [name, grid] of [['Miner', s.player.grid], ['Fighter', fighterGrid()], ['Starter', createStarterShip()]] as const) {
    act(sim, { type: 'templateSave', name, parts: gridTemplateParts(grid) });
  }
  assert(s.templates.length === 3, `hangar: ${s.templates.length} templates saved`);
  run(sim, 2);
  assert(docked(sim), 'hangar: not docked at home');
  return {
    name: 'hangar',
    save: snapshot(sim, 'hangar'),
    purpose: `Docked at home with the hour2 miner; in the hangar a T2 fighter "Osa" at home and a starter-layout miner (ore aboard) at \`${yard.id}\`; 2 slots, 3 templates.`,
    base: 'hour2',
    made:
      'Archive node Ship templates bought and the home slot bought with the real actions, the templates saved with the real action; ' +
      `the slot at \`${yard.id}\` (${price} kr) and both stored ships placed directly (state edits)` +
      (dataTopUp > 0 || creditTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D and credits by ${creditTopUp} kr.` : '.'),
  };
}

// ---------------------------------------------------------------- world sites (M4b)

/** The sites of the seed within `r` chunks of home that pass `filter`, nearest to home first. */
function sitesOf<K extends Site['kind']>(seed: number, kind: K, filter: (s: Extract<Site, { kind: K }>) => boolean, r = 30): Extract<Site, { kind: K }>[] {
  const out: Extract<Site, { kind: K }>[] = [];
  for (let cx = -r; cx <= r; cx++) {
    for (let cy = -r; cy <= r; cy++) {
      for (const s of sitesInChunk(seed, cx, cy)) if (s.kind === kind && filter(s as Extract<Site, { kind: K }>)) out.push(s as Extract<Site, { kind: K }>);
    }
  }
  return out.sort((a, b) => length(a.pos) - length(b.pos));
}

/** The regular pirates around stay away for the shot (counted as beaten, they respawn later). */
function clearPirates(sim: Simulation, keep: (id: string) => boolean = () => false): void {
  const c = sim.state.combat;
  for (const e of c.enemies) if (!keep(e.id)) c.defeated.set(e.id, sim.state.tick);
  c.enemies = c.enemies.filter((e) => keep(e.id));
}

/** Flying 150 u from a depth-2 derelict with a sentry defence, its first relay powered, the bow at it. */
function derelict(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const site = sitesOf(sim.state.seed, 'derelict', (d) => d.depth === 2 && d.defence === 'sentries')[0];
  assert(site, 'derelict: no depth-2 derelict with sentries');
  // 150 u out, on the bearing farthest from its relays
  let pos = site.pos;
  let best = -1;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * 2 * Math.PI;
    const p = { x: site.pos.x + Math.cos(a) * 150, y: site.pos.y + Math.sin(a) * 150 };
    const clear = Math.min(...site.relays.map((r) => length(sub(r.pos, p))));
    if (clear > best) {
      best = clear;
      pos = p;
    }
  }
  sim.state.sites.powered.add(site.relays[0]!.id);
  park(sim, pos, site.pos, 30);
  clearPirates(sim);
  freshShip(sim);
  assert(sim.state.sites.derelicts.size === 0 && sim.state.sites.powered.size === 1, 'derelict: unexpected site state');
  return {
    name: 'derelict',
    save: snapshot(sim, 'derelict'),
    purpose: `Flying 150 u from the depth-2 derelict \`${site.id}\` (model ${site.model}, sentry defence, ${site.service} terminal), relay 1 of 3 powered – hold the mining laser on a relay receiver; the 2nd relay wakes the sentries.`,
    base: 'hour2',
    made: 'Undocked, the first relay powered and the ship placed (state edit, teleport); nearby pirates cleared (marked beaten).',
  };
}

/** All three relays of a derelict powered, the ship stopped at its dock clamp – one F berths. */
function derelictDock(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  const site: DerelictSite | undefined = sitesOf(sim.state.seed, 'derelict', (d) => d.defence === 'none')[0];
  assert(site, 'derelict-dock: no derelict without a defence');
  for (const r of site.relays) sim.state.sites.powered.add(r.id);
  // the defence ('none') woke with the 2nd relay, as in play
  sim.state.sites.derelicts.set(site.id, { woke: sim.state.tick, taken: 0, visited: false });
  const pose = dockPose(derelictDockTarget(site), sim.state.player.props.boundingRadius);
  teleport(sim, pose.pos, pose.angle);
  sim.state.player.dampers = true;
  run(sim, 10);
  clearPirates(sim);
  freshShip(sim);
  const near = nearestBerth(sim.state);
  assert(near && near.site.id === site.id && near.powered && near.check.status === 'ok', `derelict-dock: F would not berth (${near?.check.status ?? 'no clamp'})`);
  return {
    name: 'derelict-dock',
    save: snapshot(sim, 'derelict-dock'),
    purpose: `Stopped at the dock clamp of the derelict \`${site.id}\` (model ${site.model}, ${site.service} terminal), all 3 relays powered – press F to berth and open the terminal.`,
    base: 'hour2',
    made: 'Undocked, the three relays powered (state edit, the defence "none" marked woken) and the ship placed at the clamp pose (teleport); nearby pirates cleared.',
  };
}

/** At the edge of a graveyard with mines and a sleeping party, Archive "Tractor beam+" bought. */
function graveyard(base: SaveGame): Fixture {
  const sim = fork(base);
  assert(docked(sim), 'graveyard: the base is not docked at home');
  // the Logistics branch needs the Institute licence (reputation the bot does not earn): the node is
  // granted directly, paid as if bought
  const node = archiveNode('tractorPlus');
  sim.state.discovery.archive.add(node.id);
  const dataTopUp = Math.max(0, node.data - sim.state.discovery.dataFund);
  sim.state.discovery.dataTotal += dataTopUp;
  sim.state.discovery.dataFund += dataTopUp - node.data;
  sim.state.credits = Math.max(0, sim.state.credits - node.credits);
  launch(sim);
  // 20 u outside the field, on the side facing home, the bow at its centre – the nearest graveyard with
  // mines and a party that no ion storm covers for the next minutes (shield and radar work)
  const spot = (g: GraveyardSite): Vec2 => {
    const d = length(g.pos);
    const out = GRAVEYARD.radius + 20;
    return { x: g.pos.x - (g.pos.x / d) * out, y: g.pos.y - (g.pos.y / d) * out };
  };
  const calm = (p: Vec2): boolean => [0, 1, 2, 3, 4, 5].every((m) => !stormAt(sim.state, p, sim.state.tick + m * 3600));
  const site: GraveyardSite | undefined = sitesOf(sim.state.seed, 'graveyard', (g) => g.mines.length > 0 && g.sleepers.length > 0 && calm(spot(g)))[0];
  assert(site, 'graveyard: no graveyard with mines and sleepers');
  park(sim, spot(site), site.pos, 30);
  clearPirates(sim, (id) => id.startsWith('gs:'));
  freshShip(sim);
  const sleepers = sim.state.combat.enemies.filter((e) => e.id.startsWith(`gs:${site.cx},${site.cy}:`));
  assert(sleepers.length === graveyardLayout(sim.state.seed, site).sleepers.length && sleepers.every((e) => e.ai.mode === 'dormant'), 'graveyard: the party is not asleep in place');
  assert(site.mines.every((m) => length(sub(m, sim.state.player.body.pos)) > MINE.armRange + 20), 'graveyard: a mine is too close');
  return {
    name: 'graveyard',
    save: snapshot(sim, 'graveyard'),
    purpose: `At the edge of the depth-${site.depth} ship graveyard \`${site.id}\` (${site.wrecks} wrecks, ${site.mines.length} live mines, a sleeping party ${site.sleepers.join(' + ')}), Archive "Tractor beam+" bought.`,
    base: 'hour2',
    made:
      'Archive node Tractor beam+ granted directly at its price (the Logistics branch needs the Institute licence), undocked, the ship placed outside the field (teleport); regular pirates cleared, the sleepers left asleep' +
      (dataTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D.` : '.'),
  };
}

/** 250 u ahead of a comet nucleus just at the start of its pass, empty hold, Archive "Vein analyser" bought. */
function comet(base: SaveGame): Fixture {
  const sim = fork(base);
  assert(docked(sim), 'comet: the base is not docked at home');
  const dataTopUp = buyArchive(sim, ['veinAnalyzer'], 25);
  const seed = sim.state.seed;
  // the comet of depth ≤ 2 whose next pass starts first after now, outside Pirate sectors
  const next = cometDefs(seed)
    .filter((c) => c.depth <= 2)
    .map((c) => ({ c, w: cometPassWindow(seed, c.id, sim.state.tick + 1)! }))
    .filter((x) => {
      const at = cometAt(seed, x.c.id, x.w.start + 60);
      return x.w.start > sim.state.tick && !!at && sectorSecurity(seed, sectorInfoAt(seed, at.pos.x, at.pos.y).id) !== 'pirate';
    })
    .sort((a, b) => a.w.start - b.w.start)[0];
  assert(next, 'comet: no comet pass ahead');
  const skipped = next.w.start + 60 - sim.state.tick;
  // the game clock moved forward to one second into the pass (docked, nothing else happens meanwhile)
  sim.state.tick = next.w.start + 60;
  launch(sim);
  // another comet is already known, so this one is not the player's first (no first-contact radio scene in the way)
  const other = cometDefs(seed).find((c) => c.id !== next.c.id);
  assert(other, 'comet: there is only one comet');
  sim.state.discovery.known.add(other.id);
  for (const r of RESOURCE_IDS) sim.state.player.cargo[r] = 0;
  const pose = cometAt(seed, next.c.id, sim.state.tick + 2)!;
  const v = length(pose.vel);
  const dir = { x: pose.vel.x / v, y: pose.vel.y / v };
  // 250 u ahead on its path, 25 u to the side so the nucleus passes by
  const pos = { x: pose.pos.x + dir.x * 250 - dir.y * 25, y: pose.pos.y + dir.y * 250 + dir.x * 25 };
  park(sim, pos, pose.pos, 2);
  clearPirates(sim);
  freshShip(sim);
  const now = cometAt(seed, next.c.id, sim.state.tick);
  assert(now && now.t < 0.1, 'comet: the comet is not at the start of its pass');
  const gap = Math.round(length(sub(now.pos, sim.state.player.body.pos)) / 10) * 10;
  return {
    name: 'comet',
    save: snapshot(sim, 'comet'),
    purpose: `About ${gap} u ahead of the nucleus of comet \`${next.c.id}\` (depth ${next.c.depth}, ${Math.round(v)} u/s) at the start of its pass, empty hold, Archive "Vein analyser" – match speed and mine on the move.`,
    base: 'hour2',
    made:
      `Archive node Vein analyser bought with the real action, the game clock moved forward ${fmtTime(skipped)} to the pass (state edit), undocked, the hold emptied and the ship placed ahead of the nucleus (teleport); pirates cleared` +
      (dataTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D.` : '.'),
  };
}

/** A depth-3 Contested sector, a Gunner-led pirate group 300 u ahead (outside its aggro range). */
function gunner(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  freshShip(sim);
  const seed = sim.state.seed;
  let best: { home: Vec2; id: string; d: number } | null = null;
  for (let cx = -24; cx <= 24; cx++) {
    for (let cy = -24; cy <= 24; cy++) {
      const slots = spawnSlots(seed, cx, cy, sim.state.settings.enemyDensity);
      const lead = slots[0];
      if (!lead || lead.kind !== 'gunner') continue;
      const info = sectorInfoAt(seed, lead.home.x, lead.home.y);
      if (info.depth !== 3 || sectorSecurity(seed, info.id) !== 'contested') continue;
      const d = length(lead.home);
      if (!best || d < best.d) best = { home: lead.home, id: lead.id, d };
    }
  }
  assert(best, 'gunner: no Gunner-led group in a depth-3 Contested sector');
  const dir = { x: best.home.x / best.d, y: best.home.y / best.d };
  park(sim, { x: best.home.x + dir.x * 170, y: best.home.y + dir.y * 170 }, best.home, 2);
  const leadId = best.id;
  for (let i = 0; i < 1200 && !sim.state.combat.enemies.some((e) => e.id === leadId); i++) run(sim, 1);
  const lead = sim.state.combat.enemies.find((e) => e.id === leadId);
  assert(lead && lead.kind === 'gunner', 'gunner: the group did not spawn');
  const group = leadId.slice(0, leadId.lastIndexOf(':') + 1);
  clearPirates(sim, (id) => id.startsWith(group));
  park(sim, { x: lead.body.pos.x + dir.x * 300, y: lead.body.pos.y + dir.y * 300 }, lead.body.pos, 1);
  freshShip(sim);
  const size = sim.state.combat.enemies.length;
  assert(size > 0 && !sim.state.player.destroyed, 'gunner: the group is gone');
  const sector = sectorIdAt(seed, sim.state.player.body.pos.x, sim.state.player.body.pos.y);
  return {
    name: 'gunner',
    save: snapshot(sim, 'gunner'),
    purpose: `Depth-3 Contested sector \`${sector}\`, a pirate group of ${size} led by a Gunner (Delostrelec) 300 u ahead, bow at it; shield and battery full.`,
    base: 'hour2',
    made: 'Undocked, the ship placed by the group (teleports: to spawn it, then 300 u from its leader); other pirates cleared (marked beaten).',
  };
}

// ---------------------------------------------------------------- shaped armour (SL2 E2)

/**
 * "Ostroha", a T2 fighter laid with shaped armour (≈ spec ship B after E2): a nose 2×1 on the bow plate,
 * wedges beside the cannons (their arcs stay free), chamfers behind them, a wing pair at the stern. Bow +x.
 */
function shapesGrid(): ShipGrid {
  const chamferS = mirrorShape('chamfer', 0);
  const wedgeS = mirrorShape('wedge', 0);
  return createGrid([
    ['cockpit', 0, 0, 0, 2],
    ['armor', 1, 0, 0, 2],
    ['armor', 2, 0, 0, 2, 'nose2x1'],
    ['cannon', 1, 1, 0, 2],
    ['cannon', 1, -1, 0, 2],
    ['reactor', 0, 1, 0, 2],
    ['reactor', 0, -1, 0, 2],
    ['battery', -1, 0],
    ['shield', -1, 1, 0, 2],
    ['radar', -1, -1],
    ['gyro', -2, 0],
    ['fuelTank', -2, 1],
    ['fuelTank', -2, -1],
    ['engine', -3, 0, 0, 2],
    ['engine', -3, 1, 0, 2],
    ['engine', -3, -1, 0, 2],
    // side thrusters (nozzles out to port / starboard)
    ['engine', -1, 2, 3],
    ['engine', -1, -2, 1],
    ['armor', 0, 2, 0, 2, 'chamfer'],
    ['armor', 0, -2, chamferS.rot, 2, chamferS.shape],
    ['armor', 1, 2, 0, 2, 'wedge'],
    ['armor', 1, -2, wedgeS.rot, 2, wedgeS.shape],
    ['armor', -3, 2, 0, 2, 'wingL'],
    ['armor', -3, -2, 0, 2, 'wingR'],
  ]);
}

/** Docked at home with the shaped fighter "Ostroha": one wedge at 50 % HP, spare armour in storage, a shaped template. */
function shapes(base: SaveGame): Fixture {
  const grid = shapesGrid();
  assert(validateGrid(grid).length === 0, 'shapes: invalid ship');
  const props = computeProperties(grid);
  assert(props.thrust.forward > 0 && !hullBudgetOf(grid).over, 'shapes: the ship cannot fly or is over budget');
  assert(blockedOutputs(grid).length === 0 && looseShapes(grid).length === 0, 'shapes: a blocked nozzle or a loosely held shape');
  const wedge = grid.parts.find((p) => p.shape === 'wedge')!;
  // the ship swapped in the save itself (grid, blueprint, respawn layout, HP), then loaded the normal way
  const edit = structuredClone(base);
  assert(edit.player.dockedAt === HOME_STATION_ID, 'shapes: hour2 is not docked at home');
  edit.player = {
    ...edit.player,
    grid: gridToSave(grid),
    blueprint: gridToSave(grid),
    hp: [[wedge.id, maxHp(wedge) / 2]],
    cooldowns: [],
    heat: [],
    fuel: props.fuelCapacity,
    energy: props.batteryCapacity,
    shield: props.shield.capacity,
    cargo: emptyCargo(),
  };
  edit.respawn = { ...edit.respawn, grid: gridToSave(grid) };
  const home = (edit.stations[HOME_STATION_ID] ??= { resources: emptyCargo(), parts: {} });
  home.parts = { ...home.parts, 'armor:1': 4, 'armor:2': 2 };
  const sim = fork(edit);
  // the Archive node "Ship templates" and the ship saved as a template with the real actions
  const dataTopUp = buyArchive(sim, ['templates'], 40);
  act(sim, { type: 'templateSave', name: 'Ostroha', parts: gridTemplateParts(grid) });
  assert(sim.state.templates.length === 1, 'shapes: the template was not saved');
  assert(encodeTemplate(sim.state.templates[0]!).startsWith('AF2.'), 'shapes: the template code is not AF2');
  run(sim, 2);
  assert(docked(sim), 'shapes: not docked at home');
  return {
    name: 'shapes',
    save: snapshot(sim, 'shapes'),
    purpose:
      'Docked at home with the T2 fighter "Ostroha" in shaped armour (nose 2×1, wedges, chamfers, a wing pair), one wedge at 50 % HP; ' +
      '4× `armor:1` + 2× `armor:2` in storage, the shaped template "Ostroha" (AF2 code) – shipyard shapes, repair, templates.',
    base: 'hour2',
    made:
      'The ship, its blueprint and respawn layout, the wedge HP and the spare armour set in the save directly (state edits); ' +
      'the Archive node Ship templates bought and the template saved with the real actions' +
      (dataTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D.` : '.'),
  };
}

/** The shaped fighter flying in ring 2, a Jackal pair 120 u ahead. */
function shapesFight(base: SaveGame): Fixture {
  const sim = fork(base);
  launch(sim);
  freshShip(sim);
  const seed = sim.state.seed;
  // the nearest ring-2 group of Jackals only (at least two), away from fortresses
  const forts = fortressSites(seed);
  let best: { home: Vec2; d: number } | null = null;
  for (let cx = -16; cx <= 16; cx++) {
    for (let cy = -16; cy <= 16; cy++) {
      const slots = spawnSlots(seed, cx, cy, sim.state.settings.enemyDensity);
      const slot = slots[0];
      if (!slot || slots.length < 2 || ringIndexAt(length(slot.home)) !== 2 || slots.some((x) => x.kind !== 'jackal')) continue;
      if (forts.some((f) => length(sub(f.pos, slot.home)) < 700)) continue;
      const d = length(slot.home);
      if (!best || d < best.d) best = { home: slot.home, d };
    }
  }
  assert(best, 'shapes-fight: no ring-2 Jackal group');
  const home = best.home;
  const dir = { x: home.x / best.d, y: home.y / best.d };
  park(sim, { x: home.x + dir.x * 170, y: home.y + dir.y * 170 }, home, 2);
  const group = () => sim.state.combat.enemies.filter((e) => e.kind === 'jackal' && length(sub(e.home, home)) < 1);
  for (let i = 0; i < 1200 && group().length < 2; i++) run(sim, 1);
  const pair = group().slice(0, 2);
  assert(pair.length === 2, 'shapes-fight: the Jackal pair did not spawn');
  const keep = new Set(pair.map((e) => e.id));
  clearPirates(sim, (id) => keep.has(id));
  const lead = pair[0]!.body.pos;
  park(sim, { x: lead.x + dir.x * 120, y: lead.y + dir.y * 120 }, lead, 1);
  freshShip(sim);
  assert(sim.state.combat.enemies.length === 2 && !sim.state.player.destroyed, 'shapes-fight: the pair is gone');
  const range = Math.round(Math.min(...sim.state.combat.enemies.map((e) => length(sub(e.body.pos, sim.state.player.body.pos)))) / 10) * 10;
  return {
    name: 'shapes-fight',
    save: snapshot(sim, 'shapes-fight'),
    purpose: `The shaped fighter "Ostroha" flying in ring 2, a Jackal pair about ${range} u ahead, bow at it; shield and battery full – hits on shaped plates.`,
    base: 'shapes',
    made: 'Undocked, the ship placed by a ring-2 Jackal group (teleports: to spawn it, then 120 u from its first Jackal); other pirates cleared (marked beaten).',
  };
}

// ---------------------------------------------------------------- home and workshop (M4c)

/** Credits of the home fixtures: enough for both modules (8 000 + 5 000) with a rest. */
const HOME_CREDITS = 25_000;

/**
 * Docked at home (the `hangar` game: "Osa" stored at home), 25 000 kr, two named captains defeated with
 * replicas of the player's parts, the nearest Rust fortress destroyed once; nothing built at home.
 */
function homeDev(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  assert(docked(sim), 'home-dev: the base is not docked at home');
  s.credits = HOME_CREDITS;
  // two captains of different clans, defeated as by the career (state, trophy entry, log), each with the
  // replicas of the player's parts it took when it once destroyed the player
  const defs = captainDefs(s.seed);
  const first = defs[0]!;
  const second = defs.find((d) => d.clan !== first.clan);
  assert(second, 'home-dev: no second captain of another clan');
  const keys = [...new Set(s.player.grid.parts.filter((x) => x.partId !== 'cockpit').map((x) => partKey(x.partId, x.tier, x.variant)))].sort();
  const replicas: PartKey[][] = [keys.slice(0, 2), keys.slice(2, 3)];
  [first, second].forEach((def, i) => {
    s.career.captains.set(def.index, { promotions: 1, defeated: true, trophies: [...replicas[i]!], kills: 1 });
    s.career.trophies.push({ captain: def.index, parts: [...replicas[i]!] });
    s.career.log.push({ tick: s.tick, kind: 'captainDefeated', captain: def.index });
  });
  s.career.log.splice(0, Math.max(0, s.career.log.length - LOG_MAX));
  // the nearest fortress destroyed once (as `destroyFortress` leaves it, with the Resonator)
  const site = [...fortressSites(s.seed)].sort((a, b) => length(a.pos) - length(b.pos))[0]!;
  const f = structuredClone(fortressStatus(s, site.id));
  s.pirates.fortresses.set(site.id, { ...f, core: 0, destroyed: s.tick, kills: 1, turrets: f.turrets.map(() => 0), gens: f.gens.map(() => 0) });
  s.discovery.keyItems.add('resonator');
  run(sim, 2);
  assert(docked(sim) && trophiesOf(s).length === 3, 'home-dev: expected 3 trophies');
  assert(s.fleet.stored.some((x) => x.stationId === HOME_STATION_ID), 'home-dev: no ship in the home hangar');
  return {
    name: 'home-dev',
    save: snapshot(sim, 'home-dev'),
    purpose:
      `Docked at home with ${HOME_CREDITS} kr, nothing built (tab 8 Development): two captains defeated (with replicas) and fortress ${site.id} destroyed once – ` +
      '3 trophies; "Osa" in the home hangar.',
    base: 'hangar',
    made:
      `Credits set to ${HOME_CREDITS} kr; captains ${first.index} and ${second.index} marked defeated with trophy entries (replicas of the ship's parts) ` +
      `and fortress ${site.id} marked destroyed once with the Resonator (state edits).`,
  };
}

/** `home-dev` with the paint shop and the trophy hall built, the active ship racing, "Osa" navy, 3 pins. */
function homeBuilt(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  for (const module of ['paintShop', 'trophyHall'] as const) {
    act(sim, { type: 'homeBuild', module });
    assert(s.home.modules.has(module), `home-built: ${module} was not built`);
  }
  const stored = s.fleet.stored.find((x) => x.stationId === HOME_STATION_ID)!;
  act(sim, { type: 'paintShip', shipId: s.fleet.active.id, paint: 'racing' });
  act(sim, { type: 'paintShip', shipId: stored.record.id, paint: 'navy' });
  assert(paintOf(s.fleet.active) === 'racing' && paintOf(stored.record) === 'navy', 'home-built: the paints were not applied');
  for (const t of trophiesOf(s)) act(sim, { type: 'trophyPin', id: t.id, pinned: true });
  assert(s.home.trophyPins.length === 3, 'home-built: 3 trophies were not pinned');
  run(sim, 2);
  assert(docked(sim), 'home-built: not docked at home');
  const price = HOME_MODULES.paintShop.credits + HOME_MODULES.trophyHall.credits;
  return {
    name: 'home-built',
    save: snapshot(sim, 'home-built'),
    purpose: `Docked at home with the paint shop and the trophy hall built (−${price} kr), the active ship painted racing, "Osa" navy, all 3 trophies pinned.`,
    base: 'home-dev',
    made: 'Both modules built, both ships painted and the trophies pinned with the real actions.',
  };
}

/**
 * Workshop ship (saved under its Slovak name): a T2-cockpit miner with a T1 large reactor, a refinery and a repair module whose edge
 * neighbours include an armour plate and a side engine (both damaged). Bow +x.
 */
const workshopGrid = (): ShipGrid =>
  createGrid([
    ['cockpit', 0, 0, 0, 2],
    ['armor', 1, 0],
    ['miningLaser', 1, 1, 0, 2],
    ['miningLaser', 1, -1, 0, 2],
    ['fuelTank', 0, 1],
    ['gyro', 0, -1],
    ['reactor', -1, 0],
    ['radar', -1, -1],
    ['shield', -1, 1],
    ['largeCargo', -3, -2],
    ['largeReactor', -3, 0],
    ['refinery', -3, 2],
    ['repairModule', -1, 2],
    ['armor', -1, 3],
    // side thrusters (nozzles out to port / starboard), main engines, reverse engines
    ['engine', 0, 2, 3],
    ['engine', 0, -2, 1],
    ['engine', -4, -2],
    ['engine', -4, -1],
    ['engine', -4, 0],
    ['engine', -4, 1],
    ['engine', 1, 2, 2],
    ['engine', 1, -2, 2],
  ]);

/** Flying 200 u from home with the workshop ship: ice, iron and titanium aboard, fuel 40 %, the parts damaged. */
function workshop(base: SaveGame): Fixture {
  const grid = workshopGrid();
  assert(validateGrid(grid).length === 0, 'workshop: invalid ship');
  const props = computeProperties(grid);
  assert(props.thrust.forward > 0 && !hullBudgetOf(grid).over, 'workshop: the ship cannot fly or is over budget');
  assert(blockedOutputs(grid).length === 0, 'workshop: a blocked nozzle');
  const mount = workshopMounts(grid).repairs[0]!;
  const near = grid.parts.filter((p) => mount.neighbours.includes(p.id));
  const armor = near.find((p) => p.partId === 'armor');
  const engine = near.find((p) => p.partId === 'engine');
  assert(armor && engine, 'workshop: the repair module has no armour and engine neighbour');
  // the ship swapped in the save itself (grid, blueprint, respawn layout, HP), then loaded the normal way
  const edit = structuredClone(base);
  assert(edit.player.dockedAt === HOME_STATION_ID, 'workshop: hour2 is not docked at home');
  const hp: [number, number][] = [
    [armor.id, Math.round(maxHp(armor) * 0.45)],
    [engine.id, Math.round(maxHp(engine) * 0.6)],
  ];
  edit.player = {
    ...edit.player,
    grid: gridToSave(grid),
    blueprint: gridToSave(grid),
    hp: hp.sort((a, b) => a[0] - b[0]),
    cooldowns: [],
    heat: [],
    fuel: props.fuelCapacity,
    energy: props.batteryCapacity,
    shield: props.shield.capacity,
    cargo: emptyCargo(),
  };
  edit.respawn = { ...edit.respawn, grid: gridToSave(grid) };
  const sim = fork(edit);
  sim.state.fleet.active.name = 'Workshop';
  // the three M4c Archive nodes with the real action (Large cargo hold first: Construction level 1)
  const dataTopUp = buyArchive(sim, ['largeCargo', 'refinery', 'largeReactor', 'repairModule'], 35 + 150 + 200 + 175);
  launch(sim);
  // 200 u from home on the side away from the dock port, the bow pointing away from the station
  const home = homeStation();
  const away = { x: -Math.cos(home.portAngle), y: -Math.sin(home.portAngle) };
  const pos = { x: home.pos.x + away.x * 200, y: home.pos.y + away.y * 200 };
  park(sim, pos, { x: pos.x + away.x, y: pos.y + away.y }, 30);
  clearPirates(sim);
  freshShip(sim);
  const p = sim.state.player;
  p.cargo = { ...emptyCargo(), ice: 60, iron: 120, titanium: 40 };
  p.fuel = props.fuelCapacity * 0.4;
  const dist = length(sub(p.body.pos, home.pos));
  assert(Math.abs(dist - 200) < 5 && !p.destroyed, `workshop: the ship is ${dist.toFixed(0)} u from home`);
  return {
    name: 'workshop',
    save: snapshot(sim, 'workshop'),
    purpose:
      'Flying 200 u from home with the workshop ship (named “Workshop” in the save): a T1 large reactor, a refinery and a repair module next to a damaged armour plate and side engine; ' +
      '60 ice, 120 iron, 40 titanium aboard, fuel 40 % – the refinery tops up the fuel, then refines; the repair module heals.',
    base: 'hour2',
    made:
      'The ship, its blueprint, respawn layout and HP set in the save directly; the Archive nodes Large cargo hold, Onboard refinery, Large reactor and Repair module ' +
      'bought with the real action; undocked and placed 200 u out (teleport), pirates cleared, the cargo and fuel set (state edits)' +
      (dataTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D.` : '.'),
  };
}

// ---------------------------------------------------------------- Guild and trade (M4d)

/** Guild reputation of the M4d fixtures: level 2 (the Guild relay contract, `guildRelay`). */
const GUILD_LEVEL_2 = { points: 260, level: 2 as const, assignments: {} };

/** The save docked at `stationId` (dock pose, the station discovered) – the game then loads it the normal way. */
function dockedAtStation(base: SaveGame, stationId: string): SaveGame {
  const edit = structuredClone(base);
  const station = stationById(edit.seed, stationId, edit.worldGen);
  assert(station, `no station ${stationId}`);
  const pose = dockPose(station, computeProperties(gridFromSave(edit.player.grid)).boundingRadius);
  edit.player = { ...edit.player, dockedAt: station.id, body: { pos: { ...pose.pos }, vel: { ...pose.vel }, angle: pose.angle, angVel: pose.angVel } };
  if (!edit.world.discoveredStations.includes(station.id)) edit.world.discoveredStations = [...edit.world.discoveredStations, station.id].sort();
  edit.world.center = null;
  return edit;
}

/** The lane-A Guild relay site of the fixture seed. */
function relaySiteA(seed: number): GuildRelaySite {
  const site = guildRelaySite(seed, 'A');
  assert(site, 'no Guild relay site on lane A');
  return site;
}

/** The ship at `pos` with the heading `angle` and the velocity `vel` (flying alongside something). */
function alongside(sim: Simulation, pos: Vec2, angle: number, vel: Vec2): void {
  const body = { pos: { ...pos }, vel: { ...vel }, angle, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.world.update(pos);
}

/**
 * Guild level 2, docked at the station nearest 1 500 u from the lane-A Guild relay site (its board pins the
 * relay slip), the repair materials aboard (80 Fe, 50 Cu, 20 Ti).
 */
function relayReady(base: SaveGame): Fixture {
  const seed = base.seed;
  const site = relaySiteA(seed);
  const r = Math.ceil(RELAY_CHAIN.offerRange / CHUNK_SIZE);
  const cx = Math.floor(site.pos.x / CHUNK_SIZE);
  const cy = Math.floor(site.pos.y / CHUNK_SIZE);
  const station = stationsInArea(seed, cx - r, cx + r, cy - r, cy + r)
    .map((s) => ({ s, d: length(sub(s.pos, site.pos)) }))
    .filter((x) => x.d <= RELAY_CHAIN.offerRange)
    .sort((a, b) => Math.abs(a.d - 1500) - Math.abs(b.d - 1500))[0];
  assert(station, 'relay-ready: no station in the offer range');
  const edit = dockedAtStation(base, station.s.id);
  edit.career.rep.guild = { ...GUILD_LEVEL_2 };
  const sim = fork(edit);
  const p = sim.state.player;
  p.cargo = { ...emptyCargo(), iron: 80, copper: 50, titanium: 20 };
  p.refined = emptyCargo();
  assert(cargoUsed(p.cargo) <= p.props.cargoCapacity, 'relay-ready: the cargo does not fit');
  run(sim, 2);
  const slip = currentBoard(sim.state, station.s).offers.find((o) => o.type === 'relay');
  assert(slip && slip.target.kind === 'relay' && slip.target.lane === 'A', 'relay-ready: no lane-A relay slip on the board');
  const d = Math.round(station.d / 10) * 10;
  return {
    name: 'relay-ready',
    save: snapshot(sim, 'relay-ready'),
    purpose: `Guild level 2, docked at \`${station.s.id}\` with the Guild relay slip on the board (mast \`${site.id}\` in \`${site.sector}\`, about ${d} u away); 80 Fe, 50 Cu, 20 Ti aboard for the repair.`,
    base: 'hour2',
    made: `Docked at \`${station.s.id}\` and Guild reputation set to level 2 (save edits); the cargo set (state edit).`,
  };
}

/** `relay-hold`: the ship's hull this far from the receiver of the mast (u) – inside the mining lasers' reach. */
const RECEIVER_GAP = 8;

/** The relay contract accepted, the mast repaired by F, flying by its receiver with 2 s of the beam charge left. */
function relayHold(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  const site = relaySiteA(s.seed);
  const station = sim.station(dockedAt(sim))!;
  const slip = currentBoard(s, station).offers.find((o) => o.type === 'relay')!;
  act(sim, { type: 'acceptContract', offerId: slip.id });
  const contract = s.career.contracts.find((c) => c.id === slip.id);
  assert(contract, 'relay-hold: the relay contract was not accepted');
  launch(sim);
  // F at the mast: the repair (stage 1) with the materials aboard
  const out = { x: Math.cos(site.angle), y: Math.sin(site.angle) };
  const reach = MAST_RADIUS + s.player.props.boundingRadius + 2;
  park(sim, { x: site.pos.x + out.x * reach, y: site.pos.y + out.y * reach }, site.pos, 2);
  sim.step({ ...IDLE_COMMAND, dock: true });
  assert(s.guild.relays.get('A')?.stage === 'repaired', 'relay-hold: F did not repair the mast');
  // in front of the receiver within the mining lasers' reach, the bow at it; the beam charge 2 s short of
  // full (state edit)
  const receiver = receiverPos(site.relay);
  const towards = sub(receiver, site.pos);
  const k = (length(towards) + s.player.props.boundingRadius + RECEIVER_GAP) / length(towards);
  park(sim, { x: site.pos.x + towards.x * k, y: site.pos.y + towards.y * k }, receiver, 2);
  const beamReach = Math.min(...s.player.props.lasers.map((l) => l.range));
  assert(length(sub(receiver, s.player.body.pos)) - s.player.props.boundingRadius < beamReach, 'relay-hold: the receiver is beyond the reach of the lasers');
  clearPirates(sim);
  freshShip(sim);
  s.sites.charge = { id: site.id, progress: RELAY.powerSeconds - 2 };
  return {
    name: 'relay-hold',
    save: snapshot(sim, 'relay-hold'),
    purpose: `The Guild relay contract accepted, mast \`${site.id}\` repaired, flying ${RECEIVER_GAP} u from its receiver, bow at it, with 2 s of the beam charge left – hold the mining laser on it: powered → the hold warning, the Rust counterattack 320 u out.`,
    base: 'relay-ready',
    made: 'The contract accepted and the mast repaired with F (real actions), undocked and placed (teleports); the relay charge set to 3 of 5 s (state edit); pirates cleared.',
  };
}

/** `relay-hold` powered: the counterattack fight is on, the Guild reinforcement comes 25 s after its start. */
function relayFight(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  // the last 2 s of the beam (state edit: aiming is the player's job)
  s.sites.charge = null;
  s.sites.powered.add(relaySiteA(s.seed).id);
  for (let i = 0; i < 1200 && !s.combat.enemies.some((e) => e.id.startsWith('rc:A:')); i++) {
    clearPirates(sim, (id) => id.startsWith('rc:'));
    run(sim, 1);
  }
  const party = s.combat.enemies.filter((e) => e.id.startsWith('rc:A:'));
  assert(s.guild.hold?.phase === 'fight' && party.length > 0, 'relay-fight: the counterattack did not come');
  freshShip(sim);
  return {
    name: 'relay-fight',
    save: snapshot(sim, 'relay-fight'),
    purpose: `The relay hold of lane A in its fight: the Rust counterattack (${party.map((e) => e.kind).join(' + ')}) just came in 320 u out, the Guild reinforcement (frigate + 2 cutters) arrives 25 s after the start – win it to secure the sector.`,
    base: 'relay-hold',
    made: 'The mast powered (state edit: the last 2 s of the beam), then the simulation ran until the counterattack spawned; other pirates cleared.',
  };
}

/**
 * A lane secured (state edit as the won hold leaves it – the first lane whose relay sector rolls a Watch
 * sector patrol), flying in that sector beside the live patrol.
 */
function secured(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  launch(sim);
  // the nearest scheduled sector patrol ship in the secured sector (Guarded now)
  const patrolIn = (site: GuildRelaySite): { pos: Vec2; heading: number; id: string } | null => {
    for (let rr = 0; rr <= 3000; rr += 150) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * 2 * Math.PI;
        const at = { x: site.pos.x + Math.cos(a) * rr, y: site.pos.y + Math.sin(a) * rr };
        const w = scheduledWatchNear(s, at, 150).find((x) => x.route.startsWith('sector:') && sectorIdAt(s.seed, x.pos.x, x.pos.y) === site.sector);
        if (w) return { pos: w.pos, heading: w.heading, id: w.id };
      }
    }
    return null;
  };
  let found: { site: GuildRelaySite; ship: { pos: Vec2; heading: number; id: string } } | null = null;
  for (const lane of ['A', 'B'] as const) {
    const site = guildRelaySite(s.seed, lane);
    if (!site) continue;
    s.guild.relays.set(lane, { stage: 'secured', sector: site.sector, tick: s.tick });
    const ship = patrolIn(site);
    if (ship) {
      found = { site, ship };
      break;
    }
    s.guild.relays.delete(lane);
  }
  assert(found, 'secured: no relay sector with a Watch sector patrol');
  const { site, ship } = found;
  s.sites.powered.add(site.id);
  const side = { x: Math.sin(ship.heading) * 60, y: -Math.cos(ship.heading) * 60 };
  park(sim, { x: ship.pos.x + side.x, y: ship.pos.y + side.y }, ship.pos, 40);
  clearPirates(sim);
  freshShip(sim);
  assert(securityHere(s, s.player.body.pos) === 'guarded', 'secured: the sector is not Guarded');
  assert(s.guild.watch.some((w) => w.route.startsWith('sector:')), 'secured: no live sector patrol');
  return {
    name: 'secured',
    save: snapshot(sim, 'secured'),
    purpose: `Lane ${site.lane} secured: the Guild relay sector \`${site.sector}\` is Guarded for good, flying 60 u beside a live Guild Watch sector patrol (\`${ship.id}\`) there.`,
    base: 'hour2',
    made: `The relay stage of lane ${site.lane} set to secured and its mast lit (state edits, as a won hold leaves them; lane A's relay sector rolls no sector patrol on this seed), undocked and placed beside the patrol (teleport); pirates cleared.`,
  };
}

/** A pass with a tanker on its outbound leg, ≥ 60 s after its departure and ≥ 4 min before the turn – the clock moved to one when needed. */
function tankerPassNow(sim: Simulation): { pass: string; skipped: number } {
  const s = sim.state;
  const ok = (pose: ConvoyPose | null, tick: number): boolean => {
    if (!pose || pose.leg !== 'out' || !pose.ships.some((x) => x.kind === 'tanker')) return false;
    const w = convoyPassWindow(s.seed, pose.pass)!;
    return tick - w.depart >= 60 * 60 && w.turn - tick >= 240 * 60;
  };
  const now = convoysInFlight(s.seed, s.tick).find((p) => ok(p, s.tick));
  if (now) return { pass: now.pass, skipped: 0 };
  let best: { pass: string; tick: number } | null = null;
  const first = Math.floor(s.tick / CONVOY.periodTicks);
  for (const lane of ['A', 'B'] as const) {
    for (let n = first; n < first + 8; n++) {
      const pass = `cv:${lane}@${n}`;
      const w = convoyPassWindow(s.seed, pass);
      const tick = w ? w.depart + 120 * 60 : -1;
      if (w && tick > s.tick && ok(convoyAt(s.seed, pass, tick), tick) && (!best || tick < best.tick)) best = { pass, tick };
    }
  }
  assert(best, 'no convoy pass with a tanker ahead');
  const skipped = best.tick - s.tick;
  s.tick = best.tick;
  return { pass: best.pass, skipped };
}

/** Flying 250 u beside a scheduled convoy pass with a tanker (at its velocity), 120 Fe (40 refined), 6 000 kr. */
function convoyNear(base: SaveGame): Fixture {
  const sim = fork(base);
  assert(docked(sim), 'convoy-near: the base is not docked at home');
  const s = sim.state;
  const { pass, skipped } = tankerPassNow(sim);
  launch(sim);
  const pose = convoyAt(s.seed, pass, s.tick + 1)!;
  const trader = pose.ships[0]!;
  // 250 u behind the trader on its track (the convoy cleared it – off the track rocks may lie ahead), the
  // same heading and velocity
  const back = { x: -Math.cos(trader.heading), y: -Math.sin(trader.heading) };
  alongside(sim, { x: trader.pos.x + back.x * 250, y: trader.pos.y + back.y * 250 }, trader.heading, pose.vel);
  const p = s.player;
  p.cargo = { ...emptyCargo(), iron: 120 };
  p.refined = { ...emptyCargo(), iron: 40 };
  s.credits = 6000;
  // coasting alongside (the dampers would stop the ship), half a tank (the tanker sells fuel)
  p.dampers = false;
  p.fuel = p.props.fuelCapacity / 2;
  run(sim, 2);
  clearPirates(sim);
  freshShip(sim);
  // the next 30 s must be a calm ride (no rock on the way)
  const probe = fork(snapshot(sim, 'convoy-near'));
  run(probe, 30 * 60);
  const later = convoyAt(s.seed, pass, probe.state.tick)!;
  const drift = length(sub(later.ships[0]!.pos, probe.state.player.body.pos));
  assert(!probe.state.player.destroyed && probe.state.player.hp.size === 0 && drift < 400, `convoy-near: the ride is not calm (${drift.toFixed(0)} u, ${probe.state.player.hp.size} parts hit)`);
  const now = convoyAt(s.seed, pass, s.tick)!;
  const gap = length(sub(now.ships[0]!.pos, p.body.pos));
  assert(!p.destroyed && Math.abs(gap - 250) < 10, `convoy-near: the ship is ${gap.toFixed(0)} u from the trader`);
  return {
    name: 'convoy-near',
    save: snapshot(sim, 'convoy-near'),
    purpose: `Flying 250 u behind the trader of the convoy pass \`${pass}\` (trader + tanker, outbound) at its speed, dampers off; 120 Fe aboard (40 refined), half a tank, 6000 kr – fly to the trade port and press F.`,
    base: 'hour2',
    made:
      (skipped > 0 ? `The game clock moved forward ${fmtTime(skipped)} to the pass (state edit), u` : 'U') +
      'ndocked, the ship placed 250 u behind the trader on its track at its velocity (state edit); the cargo, refined iron, fuel, credits and dampers set (state edits); pirates cleared.',
  };
}

/** `convoy-near` linked to the trader by a real F press at its trade port – the trade is open. */
function convoyLinked(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  const pose = convoysInFlight(s.seed, s.tick + 1).sort((a, b) => length(sub(a.ships[0]!.pos, s.player.body.pos)) - length(sub(b.ships[0]!.pos, s.player.body.pos)))[0];
  assert(pose, 'convoy-linked: no pass in flight');
  const to = linkPose(pose, s.player.props.boundingRadius + 1);
  alongside(sim, to.pos, to.angle, pose.vel);
  sim.step({ ...IDLE_COMMAND, dock: true });
  assert(s.convoys.link?.pass === pose.pass, 'convoy-linked: F did not link');
  const events: SimEvent[] = [];
  for (let i = 0; i < 30; i++) {
    clearPirates(sim);
    events.push(...run(sim, 1));
  }
  const why = events.find((e) => e.type === 'convoyUnlinked');
  assert(s.convoys.link?.pass === pose.pass, `convoy-linked: the link did not hold (${why ? JSON.stringify(why) : '?'})`);
  return {
    name: 'convoy-linked',
    save: snapshot(sim, 'convoy-linked'),
    purpose: `Linked to the trader of \`${pose.pass}\` (F at its trade port): the convoy trade is open – 3 rare items, cargo sale, tanker fuel; F unlinks.`,
    base: 'convoy-near',
    made: 'The ship placed 1 u off the trade port at the convoy velocity (state edit), then F pressed (the real link).',
  };
}

/** An escort contract accepted at the lane station nearest home; flying 200 u from the waiting convoy. */
function escort(base: SaveGame): Fixture {
  const seed = base.seed;
  const probe = fork(base);
  const unlocks = new Set<RepUnlock>(['contractsBasic', 'contractsRing1', 'contractsRing2']);
  const stations = stationsInArea(seed, -30, 30, -30, 30)
    .filter((st) => escortAvailable(boardContext(probe.state, st)))
    .sort((a, b) => length(a.pos) - length(b.pos));
  let found: { station: StationDef; offer: ContractOffer } | null = null;
  for (const station of stations) {
    for (let roll = 1; roll <= 60 && !found; roll++) {
      const draft = escortOffer({ ...boardContext(probe.state, station), unlocks }, createRng(roll));
      if (!draft || draft.risk !== 0.5) continue;
      const id = `${station.id}@${boardEpoch(probe.state.tick)}.90`;
      found = { station, offer: { id, type: 'escort', faction: 'guild', station: station.id, ring: draft.ring, risk: draft.risk, target: draft.target, modifiers: [], bonus: 0, part: null } };
    }
    if (found) break;
  }
  assert(found, 'escort: no escort slip at a lane station');
  const edit = dockedAtStation(base, found.station.id);
  edit.career.rep.guild = { ...GUILD_LEVEL_2 };
  const sim = fork(edit);
  const s = sim.state;
  run(sim, 1);
  ensureBoard(s, found.station).offers.push(found.offer);
  act(sim, { type: 'acceptContract', offerId: found.offer.id });
  const contract = s.career.contracts.find((c) => c.id === found!.offer.id);
  assert(contract && contract.target.kind === 'escort', 'escort: the slip was not accepted');
  const t = contract.target;
  const deposit = s.convoys.escorts.get(contract.serial)?.deposit ?? 0;
  assert(deposit > 0, 'escort: no deposit taken');
  launch(sim);
  // 200 u from the meeting point on the station side, the bow at the convoy (it departs within 150 u)
  const toStation = sub(found.station.pos, t.meet);
  const dir = { x: toStation.x / length(toStation), y: toStation.y / length(toStation) };
  park(sim, { x: t.meet.x + dir.x * 200, y: t.meet.y + dir.y * 200 }, t.meet, 2);
  clearPirates(sim);
  freshShip(sim);
  const e = s.convoys.escorts.get(contract.serial);
  assert(e?.state === 'waiting', 'escort: the convoy is not waiting');
  const ships = e.hulls.length > 1 ? 'trader + tanker' : 'trader';
  return {
    name: 'escort',
    save: snapshot(sim, 'escort'),
    purpose: `An escort contract (lane ${t.lane}, risk 0.5: ${t.ambushes.length} ambushes, ${Math.round(t.to - t.from)} u) accepted at \`${found.station.id}\`, ${deposit} kr deposit held; flying 200 u from the waiting convoy (${ships}) – come within 150 u and it departs.`,
    base: 'hour2',
    made: `Docked at \`${found.station.id}\` with Guild reputation level 2 (save edits), the escort slip put on its board (state edit) and accepted with the real action; undocked and placed (teleport); pirates cleared.`,
  };
}

/**
 * A Watch lane patrol pair in a Guarded depth-2 sector, the ship 300 u away (it may sit in a neighbouring
 * sector – the README says which), a Hammer + Jackal coming at the pair.
 */
function watchFight(base: SaveGame): Fixture {
  const sim = fork(base);
  const s = sim.state;
  launch(sim);
  // a lane patrol pair (slots 0 and 1 of one route) in a Guarded depth-2 sector now, nearest home
  let best: { lead: { pos: Vec2; heading: number; route: string }; d: number; sector: string } | null = null;
  for (let x = -9000; x <= 9000; x += 300) {
    for (let y = -9000; y <= 9000; y += 300) {
      const info = sectorInfoAt(s.seed, x, y);
      if (info.depth !== 2 || sectorSecurity(s.seed, info.id) !== 'guarded') continue;
      const near = scheduledWatchNear(s, { x, y }, 220).filter((w) => w.route.startsWith('lane:'));
      const lead = near.find((w) => w.slot === 0 && near.some((o) => o.route === w.route && o.slot === 1));
      const d = Math.hypot(x, y);
      if (lead && sectorInfoAt(s.seed, lead.pos.x, lead.pos.y).id === info.id && (!best || d < best.d)) best = { lead, d, sector: info.id };
    }
  }
  assert(best, 'watch-fight: no lane patrol pair in a Guarded depth-2 sector');
  const { lead } = best;
  const side = { x: Math.sin(lead.heading), y: -Math.cos(lead.heading) };
  park(sim, { x: lead.pos.x + side.x * 300, y: lead.pos.y + side.y * 300 }, lead.pos, 40);
  clearPirates(sim);
  const live = s.guild.watch.filter((w) => w.route === lead.route);
  assert(live.length >= 2, 'watch-fight: the pair is not live');
  // the pirates (state edit) 160 u beyond the pair, attacking
  const at = { x: live[0]!.body.pos.x - side.x * 160, y: live[0]!.body.pos.y - side.y * 160 };
  (['hammer', 'jackal'] as const).forEach((kind, i) => {
    const pos = { x: at.x + i * 16, y: at.y - i * 12 };
    const e = createEnemy({ id: `fixture:watch-fight:${i}`, kind, tier: 1, pos, angle: Math.atan2(side.y, side.x), home: pos, orbit: i === 0 ? 1 : -1 });
    e.ai.mode = 'attack';
    s.combat.enemies.push(e);
  });
  freshShip(sim);
  const sector = sectorIdAt(s.seed, s.player.body.pos.x, s.player.body.pos.y);
  const security = sectorSecurity(s.seed, sector);
  const where =
    sector === best.sector
      ? `Guarded depth-2 sector \`${sector}\``
      : `${security[0]!.toUpperCase()}${security.slice(1)} sector \`${sector}\` beside the Guarded depth-2 sector \`${best.sector}\``;
  return {
    name: 'watch-fight',
    save: snapshot(sim, 'watch-fight'),
    purpose: `${where}: the Guild Watch lane patrol \`${lead.route}\` (a pair, in \`${best.sector}\`) live 300 u away, a Hammer + Jackal just in 160 u beyond it, attacking – the Watch fights them.`,
    base: 'hour2',
    made: 'Undocked, the ship placed beside the patrol (teleport) until it went live; pirates cleared, then a Hammer + Jackal added beyond the pair in attack mode (state edit).',
  };
}

/** How far the `map-notes` ship sits from the pirate group's home (u) – beyond a Jackal's / Gunner's aggro range. */
const GROUP_GAP = 160;
/** `map-notes`: the ship is placed this many ticks before the comet reaches the spot. */
const SPAWN_LEAD = 90;

/** Archive "Map markers" bought, 4 notes; flying with a pirate group and a comet nucleus in radar range. */
function mapNotes(base: SaveGame): Fixture {
  const sim = fork(base);
  assert(docked(sim), 'map-notes: the base is not docked at home');
  const s = sim.state;
  const seed = s.seed;
  const dataTopUp = buyArchive(sim, ['mapNotes'], archiveNode('mapNotes').data);
  const range = s.player.props.radarRange;
  // a comet pass (depth ≤ 2) that comes near a pirate group home outside Pirate sectors: the ship sits
  // `GROUP_GAP` u from the group (out of its aggro range) towards the comet, both within radar range
  let best: { comet: string; tick: number; home: Vec2 } | null = null;
  for (const c of cometDefs(seed).filter((x) => x.depth <= 2)) {
    const w = cometPassWindow(seed, c.id, s.tick + 1);
    if (!w || w.start <= s.tick) continue;
    for (let tick = w.start + 180; tick < w.end && (!best || tick < best.tick); tick += 600) {
      const pose = cometAt(seed, c.id, tick);
      if (!pose) continue;
      const pcx = Math.floor(pose.pos.x / CHUNK_SIZE);
      const pcy = Math.floor(pose.pos.y / CHUNK_SIZE);
      for (let cx = pcx - 3; cx <= pcx + 3; cx++) {
        for (let cy = pcy - 3; cy <= pcy + 3; cy++) {
          const lead = spawnSlots(seed, cx, cy, s.settings.enemyDensity)[0];
          if (!lead || lead.kind === 'hammer') continue;
          const d = length(sub(lead.home, pose.pos));
          if (d < GROUP_GAP || d > GROUP_GAP + range * 0.8) continue;
          if (sectorSecurity(seed, sectorInfoAt(seed, lead.home.x, lead.home.y).id) === 'pirate') continue;
          if (!best || tick < best.tick) best = { comet: c.id, tick, home: lead.home };
        }
      }
    }
  }
  assert(best, 'map-notes: no comet pass near a pirate group');
  // the clock moved to 1.5 s before the comet gets there: the group spawns meanwhile
  const skipped = best.tick - SPAWN_LEAD - s.tick;
  s.tick = best.tick - SPAWN_LEAD;
  const comet = cometAt(seed, best.comet, best.tick)!;
  // four notes with the real action: home, the comet's path, the pirate group, the Guild relay mast
  const relay = guildRelaySite(seed, 'A');
  const notes: { pos: Vec2; icon: NoteIcon; text: string }[] = [
    { pos: { ...homeStation().pos }, icon: 'star', text: 'Home' },
    { pos: { x: Math.round(comet.pos.x), y: Math.round(comet.pos.y) }, icon: 'ore', text: `Comet path ${best.comet}` },
    { pos: { x: Math.round(best.home.x), y: Math.round(best.home.y) }, icon: 'pirate', text: 'Pirates ahead!' },
    { pos: relay ? { x: Math.round(relay.pos.x), y: Math.round(relay.pos.y) } : { x: 500, y: 500 }, icon: 'flag', text: 'Guild relay' },
  ];
  for (const n of notes) act(sim, { type: 'mapNoteSet', pos: n.pos, icon: n.icon, text: n.text });
  assert(s.navigation.notes.length === 4, 'map-notes: the notes were not set');
  launch(sim);
  // the ship between the comet and the group (both within radar range), the bow at the comet
  const towards = sub(comet.pos, best.home);
  const k = GROUP_GAP / length(towards);
  const pos = { x: best.home.x + towards.x * k, y: best.home.y + towards.y * k };
  park(sim, pos, comet.pos, 2);
  const spawned = (): boolean => s.combat.enemies.some((e) => length(sub(e.body.pos, best!.home)) < 200);
  for (let i = 0; i < 600 && !(spawned() && s.tick >= best.tick); i++) run(sim, 1);
  freshShip(sim);
  const p = s.player.body.pos;
  const group = s.combat.enemies.filter((e) => length(sub(e.body.pos, p)) <= range);
  const now = cometAt(seed, best.comet, s.tick)!;
  assert(group.length > 0 && length(sub(now.pos, p)) <= range, `map-notes: the group (${group.length}, ${s.combat.enemies.map((e) => length(sub(e.body.pos, p)).toFixed(0)).join('/')}) or the comet (${length(sub(now.pos, p)).toFixed(0)} u) is not in radar range ${range}`);
  return {
    name: 'map-notes',
    save: snapshot(sim, 'map-notes'),
    purpose: `Archive "Map markers" bought, 4 map notes (home, comet, pirates, Guild relay); flying with a pirate group and the nucleus of comet \`${best.comet}\` in radar range – fly away and open the map: two stale marks.`,
    base: 'hour2',
    made:
      `Archive node Map markers bought and 4 notes set with the real actions, the game clock moved forward ${fmtTime(skipped)} to the comet pass (state edit), undocked and placed (teleport); the group spawned by the simulation` +
      (dataTopUp > 0 ? `; Data fund topped up by ${dataTopUp} D.` : '.'),
  };
}

// ---------------------------------------------------------------- output

const fmtTime = (tick: number): string => {
  const s = Math.round(tick * SIM_DT);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function shipLine(save: SaveGame): string {
  const counts = new Map<string, number>();
  for (const p of save.player.grid.parts) {
    const k = partKey(p.partId, p.tier, p.variant);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const budget = hullBudgetOf({ parts: save.player.grid.parts, nextId: save.player.grid.nextId });
  const list = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${n}× ${k}`).join(', ');
  return `${save.player.grid.parts.length} parts, hull ${budget.used}/${budget.budget ?? '?'} – ${list}`;
}

function locationLine(save: SaveGame): string {
  if (save.player.dockedAt) return `docked at \`${save.player.dockedAt}\``;
  const { pos, vel } = save.player.body;
  const d = Math.hypot(pos.x, pos.y);
  return `flying at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}), ring ${ringIndexAt(d)}, ${Math.hypot(vel.x, vel.y).toFixed(1)} u/s`;
}

/** The hangar and the templates (only when there are any). */
function fleetLines(save: SaveGame): string[] {
  const { fleet, templates } = save;
  if (fleet.stored.length === 0 && templates.length === 0) return [];
  const ships = fleet.stored.map((x) => `#${x.record.id}${x.record.name ? ` "${x.record.name}"` : ''} at \`${x.stationId}\` (${x.grid.parts.length} parts)`);
  const slots = fleet.slots.map(([id, n]) => `${id} ${n}`).join(', ');
  return [
    `- hangar: active ship #${fleet.active.id}; stored ${ships.length ? ships.join(', ') : '–'}; slots ${slots || '–'}`,
    `- templates: ${templates.length ? templates.map((t) => `${t.name} (${t.parts.length} parts)`).join(', ') : '–'}`,
  ];
}

/** The home station, paints and the workshop state (only when there is any). */
function homeLines(save: SaveGame): string[] {
  const { home, fleet, player } = save;
  const out: string[] = [];
  const painted = [fleet.active, ...fleet.stored.map((x) => x.record)].filter((r) => r.paint !== 'factory').map((r) => `#${r.id} ${r.paint}`);
  if (home.modules.length || home.trophyPins.length || painted.length) {
    const pins = home.trophyPins.map((id) => `\`${id}\``).join(', ');
    out.push(`- home: modules ${home.modules.join(', ') || '–'}; pinned ${pins || '–'}; paints ${painted.join(', ') || '–'}`);
  }
  const refined = Object.entries(player.refined).map(([r, n]) => `${r} ${(n ?? 0).toFixed(1)}`);
  if (refined.length || player.repair) {
    const bank = player.repair ? `part ${player.repair.part}, ${player.repair.bank.toFixed(2)} HP` : '–';
    out.push(`- workshop: refined ${refined.join(', ') || '–'}; repair bank ${bank}`);
  }
  return out;
}

/** The world sites the player touched (only when there are any). */
function sitesLines(save: SaveGame): string[] {
  const { sites } = save;
  const parts: string[] = [];
  const ids = (list: readonly string[]): string => list.map((id) => `\`${id}\``).join(', ');
  if (sites.powered.length) parts.push(`powered relays ${ids(sites.powered)}`);
  if (sites.berth) parts.push(`berthed at \`${sites.berth}\``);
  if (sites.derelicts.length) parts.push(`derelicts ${ids(sites.derelicts.map(([id]) => id))}`);
  if (sites.graveyards.length) parts.push(`graveyards ${ids(sites.graveyards.map(([id]) => id))}`);
  if (sites.comets.length) parts.push(`comets ${ids(sites.comets.map(([id]) => id))}`);
  return parts.length ? [`- world sites: ${parts.join('; ')}`] : [];
}

/** The Guild, convoy and navigation state (M4d, only when there is any). */
function guildLines(save: SaveGame): string[] {
  const { guild, convoys, navigation } = save;
  const out: string[] = [];
  const g: string[] = [];
  if (guild.relays.length) g.push(`relays ${guild.relays.map(([lane, r]) => `${lane} ${r.stage} (\`${r.sector}\`)`).join(', ')}`);
  if (guild.hold) g.push(`hold ${guild.hold.lane} ${guild.hold.phase}${guild.hold.reinforced ? ', reinforced' : ''}`);
  if (guild.watch.length) g.push(`live Watch ${guild.watch.map((w) => `\`${w.id}\` ${w.mode}`).join(', ')}`);
  if (g.length) out.push(`- Guild: ${g.join('; ')}`);
  const c: string[] = [];
  if (convoys.link) c.push(`linked to \`${convoys.link.pass}\``);
  if (convoys.trades.length) c.push(`trades ${convoys.trades.map(([pass, t]) => `\`${pass}\` (items ${t.bought}, sold ${t.sold}, fuel ${t.fuel})`).join(', ')}`);
  if (convoys.escorts.length) c.push(`escorts ${convoys.escorts.map(([serial, e]) => `#${serial} ${e.state}, deposit ${e.deposit} kr`).join(', ')}`);
  if (c.length) out.push(`- convoys: ${c.join('; ')}`);
  if (navigation.notes.length) out.push(`- map notes: ${navigation.notes.map((n) => `${n.icon} "${n.text}"`).join(', ')}`);
  const contracts = save.career.contracts.map((x) => `${x.type}${x.ready ? ' (ready)' : ''}`);
  if (contracts.length) out.push(`- contracts: ${contracts.join(', ')}`);
  return out;
}

/** The table row of a fixture in the README. */
const readmeRow = (f: Fixture): string => `| [\`${f.name}\`](${f.name}.json) | ${f.purpose} |`;

/** The README section of a fixture. */
function readmeSection(f: Fixture): string {
  const s = f.save;
  const t = s.career.training;
  return [
    `### \`${f.name}\``,
    '',
    f.purpose,
    '',
    `- difficulty: ${s.settings.deathPenalty} / ${s.settings.enemyDensity} density / yield ×${s.settings.miningYield} (standard preset), seed \`${s.settings.seedText}\``,
    `- game time ${fmtTime(s.tick)} (tick ${s.tick}), credits ${s.credits}`,
    `- ship: ${shipLine(s)}`,
    `- location: ${locationLine(s)}`,
    `- cargo ${Math.round(cargoUsed(s.player.cargo))} u, fuel ${s.player.fuel.toFixed(0)}, training ${t.status}${t.status === 'active' ? ` (step ${t.step + 1})` : ''}` +
      `, Archive ${s.discovery.archive.length ? s.discovery.archive.join(', ') : '–'}, Data ${s.discovery.dataFund}`,
    ...fleetLines(s),
    ...sitesLines(s),
    ...homeLines(s),
    ...guildLines(s),
    `- made from: ${f.base ? `\`${f.base}\`` : 'a new game'} – ${f.made}`,
    '',
  ].join('\n');
}

/** One fixture's README text: the table row and the section. */
export interface ReadmeEntry {
  name: string;
  row: string;
  section: string;
}

const readmeEntry = (f: Fixture): ReadmeEntry => ({ name: f.name, row: readmeRow(f), section: readmeSection(f) });

/** The rows and sections of an existing README by fixture name (kept for fixtures a partial run does not write). */
export function readmeEntries(text: string): Map<string, ReadmeEntry> {
  const out = new Map<string, ReadmeEntry>();
  const lines = text.split('\n');
  for (const name of FIXTURE_NAMES) {
    const row = lines.find((l) => l.startsWith(`| [\`${name}\`](`));
    const start = lines.indexOf(`### \`${name}\``);
    if (row === undefined || start < 0) continue;
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith('### ')) end++;
    // a section ends with one empty line (the join adds the line break before the next section)
    const section = lines.slice(start, end).join('\n').replace(/\n+$/, '\n');
    out.set(name, { name, row, section });
  }
  return out;
}

function readme(entries: readonly ReadmeEntry[], versions: readonly number[]): string {
  const rows = entries.map((e) => e.row);
  const details = entries.map((e) => e.section);
  const lo = Math.min(...versions);
  const hi = Math.max(...versions);
  const version = lo === hi ? `save version V${hi}` : `save versions V${lo}–V${hi}`;
  return [
    '# Test save positions (fixtures)',
    '',
    '<!-- Generated by `npm run fixtures` (tools/fixtures/makeSaves.ts) – edit the generator, not this file. -->',
    '',
    `Ready-made saves (${version}, seed ${FIXTURE_SEED}, standard difficulty) to start e2e specs, screenshots`,
    'and manual checks at a given point of the game in seconds. Each file is a plain save envelope – the same',
    'format the game stores; the menu Import accepts it too.',
    '',
    '## Loading',
    '',
    '- **Dev server:** `http://localhost:5317/?fixture=hour1` boots straight into the save (no menu, the game is',
    '  not saved – like `?play`). Dev builds only; the production build ignores the parameter.',
    "- **E2E:** `import { loadFixture } from './fixtures';` → `await loadFixture(page, 'hour1');` (waits until the",
    '  simulation runs; then use `window.__cinder` as usual).',
    '',
    '## Regenerating',
    '',
    '`npm run fixtures` rebuilds every file deterministically (about a minute: the bot plays two game hours);',
    '`FIXTURES=shapes,shapes-fight npm run fixtures` rebuilds only the named files and their sections here.',
    'Regenerate after big gameplay or save changes (new state, balance, world generation) so the positions stay',
    'meaningful. The files are **not** required to be current: `src/sim/save/fixtures.test.ts` loads every',
    'fixture through the normal migrate + validate path, so after a save version bump the old files double as',
    'a migration test – regenerate them when convenient, not to make that test pass.',
    '',
    '## Fixtures',
    '',
    '| Fixture | What it is |',
    '|---|---|',
    ...rows,
    '',
    ...details,
  ].join('\n');
}

/** The progression fixtures, all made by `progression()` in this order. */
const PROGRESSION = ['start', 'training-mid', 'after-training', 'hour1', 'hour2'];

/** The situation fixtures in file order: each forks the save `from` (a progression or an earlier situation). */
const SITUATIONS: readonly { name: string; from: string; make: (base: SaveGame) => Fixture }[] = [
  { name: 'dock-approach', from: 'start', make: dockApproach },
  { name: 'pirates-near', from: 'hour1', make: piratesNear },
  { name: 'fortress', from: 'hour2', make: fortress },
  { name: 'rich-rock', from: 'hour1', make: richRock },
  { name: 'damaged', from: 'hour1', make: damaged },
  { name: 'wreck-salvage', from: 'hour1', make: wreckSalvage },
  { name: 'cargo-full', from: 'hour1', make: cargoFull },
  { name: 'hangar', from: 'hour2', make: hangar },
  { name: 'derelict', from: 'hour2', make: derelict },
  { name: 'derelict-dock', from: 'hour2', make: derelictDock },
  { name: 'graveyard', from: 'hour2', make: graveyard },
  { name: 'comet', from: 'hour2', make: comet },
  { name: 'gunner', from: 'hour2', make: gunner },
  { name: 'shapes', from: 'hour2', make: shapes },
  { name: 'shapes-fight', from: 'shapes', make: shapesFight },
  { name: 'home-dev', from: 'hangar', make: homeDev },
  { name: 'home-built', from: 'home-dev', make: homeBuilt },
  { name: 'workshop', from: 'hour2', make: workshop },
  { name: 'relay-ready', from: 'hour2', make: relayReady },
  { name: 'relay-hold', from: 'relay-ready', make: relayHold },
  { name: 'relay-fight', from: 'relay-hold', make: relayFight },
  { name: 'secured', from: 'hour2', make: secured },
  { name: 'convoy-near', from: 'hour2', make: convoyNear },
  { name: 'convoy-linked', from: 'convoy-near', make: convoyLinked },
  { name: 'escort', from: 'hour2', make: escort },
  { name: 'watch-fight', from: 'hour2', make: watchFight },
  { name: 'map-notes', from: 'hour2', make: mapNotes },
];

/** Every fixture name in file order. */
export const FIXTURE_NAMES: readonly string[] = [...PROGRESSION, ...SITUATIONS.map((x) => x.name)];

/**
 * The fixtures in file order – all of them, or only those named in `only` plus what they fork from (each
 * fixture forks a structured clone of its base, so a subset gives the same files as a full run).
 */
export function makeFixtures(only?: ReadonlySet<string>): Fixture[] {
  const need = new Set(only ?? FIXTURE_NAMES);
  for (const x of [...SITUATIONS].reverse()) if (need.has(x.name)) need.add(x.from);
  const made = new Map(progression().map((f) => [f.name, f]));
  for (const x of SITUATIONS) if (need.has(x.name)) made.set(x.name, x.make(made.get(x.from)!.save));
  return FIXTURE_NAMES.filter((name) => need.has(name)).map((name) => made.get(name)!);
}

/**
 * `npm run fixtures`: every fixture, or only those listed in the env variable `FIXTURES` (comma
 * separated; the README keeps the other fixtures' rows and sections). `FIXTURES_DIR` writes elsewhere
 * (e.g. to compare two runs).
 */
export function main(): void {
  const { fs, path, process } = node();
  const started = Date.now();
  const listed = process.env.FIXTURES?.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
  for (const name of listed ?? []) assert(FIXTURE_NAMES.includes(name), `unknown fixture "${name}" (known: ${FIXTURE_NAMES.join(', ')})`);
  const only = listed ? new Set(listed) : undefined;
  const dir = process.env.FIXTURES_DIR ?? FIXTURE_DIR;
  const written = makeFixtures(only).filter((f) => !only || only.has(f.name));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of written) {
    fs.writeFileSync(path.resolve(dir, `${f.name}.json`), `${JSON.stringify(toEnvelope(f.save), null, 2)}\n`);
    console.error(`${f.name.padEnd(16)} ${fmtTime(f.save.tick)}  ${locationLine(f.save)}`);
  }
  // the README: generated entries for the written files, the existing text for the others
  const readmePath = path.resolve(dir, 'README.md');
  const kept = only && fs.existsSync(readmePath) ? readmeEntries(fs.readFileSync(readmePath, 'utf8')) : new Map<string, ReadmeEntry>();
  const entries = FIXTURE_NAMES.flatMap((name) => {
    const f = written.find((x) => x.name === name);
    const e = f ? readmeEntry(f) : kept.get(name);
    return e ? [e] : [];
  });
  const versions = FIXTURE_NAMES.flatMap((name) => {
    const f = written.find((x) => x.name === name);
    if (f) return [f.save.version];
    const file = path.resolve(dir, `${name}.json`);
    return fs.existsSync(file) ? [(JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number }).version] : [];
  });
  fs.writeFileSync(readmePath, `${readme(entries, versions)}\n`);
  console.error(`${written.length} fixtures → ${dir} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

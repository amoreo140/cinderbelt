// Simulation <-> SaveGame (spec M2, 5.8 and 9.4; combat M3a; veins M2d; career M3.5a; discovery M3.5b;
// salvage M3.6; fleet and templates M4a / V16; world sites and the events director M4b / V17; shaped
// armour SL2 E2 / V18; home station, paints and the on-board workshop M4c / V19; the Guild, convoys and map
// notes M4d / V20). Pure functions, no DOM.
import { miningFromSave, miningToSave } from './mining';
import { fleetFromSave, fleetToSave, templatesFromSave, templatesToSave } from './fleet';
import { gridFromSave, gridToSave } from './gridSave';
import { ALL_PART_KEYS, type PartInventory } from '../../data/parts';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import { fnv1aHex } from '../math/fnv1a';
import type { Body } from '../physics/body';
import { Simulation, type GameStats, type RestoredState, type StationState } from '../Simulation';
import { computeProperties } from '../ship/properties';
import type { HpMap, ShipGrid } from '../ship/types';
import type { CombatState, Container, Enemy, Projectile, TractorState, Wreck } from '../combat/types';
import { regionsFromSave, regionsToSave } from './regions';
import { directorFromSave, directorToSave, sitesFromSave, sitesToSave } from './sites';
import { homeFromSave, homeToSave, refinedFromSave, refinedToSave, repairToSave } from './home';
import { guildFromSave, guildToSave } from './guild';
import { convoysFromSave, convoysToSave } from './convoys';
import { navigationFromSave, navigationToSave } from './navigation';
import type { ChunkGenerator } from '../world/generate';
import type { StationId } from '../world/stations';
import {
  SAVE_FORMAT,
  type SavedBodyV1,
  type SavedCombatV16,
  type SavedContainerV6,
  type SavedEnemyV9,
  type SavedProjectileV2,
  type SavedWreckV16,
  type SaveEnvelope,
  type SaveGame,
  type SaveReason,
} from './types';
import { careerFromSave, careerToSave } from './career';
import { discoveryFromSave, discoveryToSave } from './discovery';
import { piratesFromSave, piratesToSave } from './pirates';
import { syncCalm } from '../pirates/pirates';

/** Game data that is not in the simulation (the game layer holds it). */
export interface SaveContext {
  gameId: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  savedAt: string;
  reason: SaveReason;
  gameVersion: string;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const copyCargo = (c: Cargo): Cargo => {
  const out = {} as Cargo;
  for (const r of RESOURCE_IDS) out[r] = c[r];
  return out;
};

const copyBody = (b: Body): SavedBodyV1 => ({
  pos: { x: b.pos.x, y: b.pos.y },
  vel: { x: b.vel.x, y: b.vel.y },
  angle: b.angle,
  angVel: b.angVel,
});

export { gridFromSave, gridToSave };

/** Parts with a positive count in canonical order. */
function partsToSave(inv: PartInventory): PartInventory {
  const out: PartInventory = {};
  for (const key of ALL_PART_KEYS) {
    const n = inv[key] ?? 0;
    if (n > 0) out[key] = n;
  }
  return out;
}

const isEmptyStorage = (s: StationState): boolean =>
  RESOURCE_IDS.every((r) => s.resources[r] <= 0) && ALL_PART_KEYS.every((k) => (s.parts[k] ?? 0) <= 0);

const copyStats = (s: GameStats): GameStats => ({ ...s, mined: copyCargo(s.mined), bestUnitsPerHour: [...s.bestUnitsPerHour] });

const vec = (v: { x: number; y: number }) => ({ x: v.x, y: v.y });

/** A map id → number as sorted pairs. */
const sortedPairs = (m: ReadonlyMap<number, number>): [number, number][] =>
  [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v]);

function combatToSave(c: CombatState): SavedCombatV16 {
  return {
    rng: c.rng,
    nextId: c.nextId,
    enemies: c.enemies.map(
      (e): SavedEnemyV9 => ({
        id: e.id,
        kind: e.kind,
        grid: gridToSave(e.grid),
        hp: sortedPairs(e.hp),
        body: copyBody(e.body),
        energy: e.energy,
        shield: e.shield,
        shieldDelay: e.shieldDelay,
        cooldowns: sortedPairs(e.cooldowns),
        home: vec(e.home),
        maxHull: e.maxHull,
        ai: {
          mode: e.ai.mode, waypoint: vec(e.ai.waypoint), timer: e.ai.timer, orbit: e.ai.orbit, breakOff: e.ai.breakOff,
          react: e.ai.react, seen: vec(e.ai.seen),
        },
        fuel: e.fuel,
        ...(e.hold ? { hold: { cargo: copyCargo(e.hold.cargo), parts: partsToSave(e.hold.parts) } } : {}),
      }),
    ),
    defeated: [...c.defeated].sort((a, b) => byString(a[0], b[0])),
    projectiles: c.projectiles.map(
      (p): SavedProjectileV2 => ({
        id: p.id, owner: p.owner, pos: vec(p.pos), vel: vec(p.vel), ttl: p.ttl, damage: p.damage, tier: p.tier, origin: vec(p.origin),
      }),
    ),
    wrecks: c.wrecks.map(
      (w): SavedWreckV16 => ({
        id: w.id,
        grid: gridToSave(w.grid),
        body: copyBody(w.body),
        loot: { cargo: copyCargo(w.loot.cargo), parts: partsToSave(w.loot.parts) },
        ttl: w.ttl,
        livery: w.livery,
        ...wreckExtras(w),
      }),
    ),
    containers: c.containers.map(
      (x): SavedContainerV6 => ({
        id: x.id,
        body: copyBody(x.body),
        loot: { cargo: copyCargo(x.loot.cargo), parts: partsToSave(x.loot.parts) },
        ttl: x.ttl,
        ...(x.poi ? { poi: x.poi } : {}),
      }),
    ),
  };
}

type WreckExtras = Pick<Wreck, 'poi' | 'cls' | 'contents' | 'dismantle' | 'cutting' | 'from' | 'ship'>;

/** Discovery (M3.5b), dismantling (M3.6) and the ship of a player wreck (V16) – only the fields set. */
function wreckExtras(w: WreckExtras): WreckExtras {
  return {
    ...(w.poi ? { poi: w.poi } : {}),
    ...(w.cls ? { cls: w.cls } : {}),
    ...(w.contents ? { contents: { fragment: w.contents.fragment, shard: w.contents.shard } } : {}),
    ...(w.dismantle ? { dismantle: { intact: [...w.dismantle.intact] } } : {}),
    ...(w.cutting ? { cutting: { partId: w.cutting.partId, progress: w.cutting.progress } } : {}),
    ...(w.from ? { from: w.from } : {}),
    ...(w.ship !== undefined ? { ship: w.ship } : {}),
  };
}

const copyTractor = (t: TractorState | null): TractorState | null =>
  t ? { target: { ...t.target }, rip: t.rip ? { partId: t.rip.partId, progress: t.rip.progress } : null } : null;

function combatFromSave(c: SavedCombatV16): CombatState {
  return {
    rng: c.rng,
    nextId: c.nextId,
    enemies: c.enemies.map((e): Enemy => {
      const grid = gridFromSave(e.grid);
      const body = copyBody(e.body);
      return {
        id: e.id,
        kind: e.kind,
        grid,
        gridVersion: 0,
        hp: new Map(e.hp),
        props: computeProperties(grid),
        body,
        prevBody: body,
        lastLocalForce: { x: 0, y: 0 },
        energy: e.energy,
        shield: e.shield,
        shieldDelay: e.shieldDelay,
        cooldowns: new Map(e.cooldowns),
        home: vec(e.home),
        maxHull: e.maxHull,
        ai: { ...e.ai, waypoint: vec(e.ai.waypoint), seen: vec(e.ai.seen) },
        fuel: e.fuel,
        ...(e.hold ? { hold: { cargo: copyCargo(e.hold.cargo), parts: partsToSave(e.hold.parts) } } : {}),
      };
    }),
    defeated: new Map(c.defeated),
    projectiles: c.projectiles.map((p): Projectile => ({ ...p, pos: vec(p.pos), vel: vec(p.vel), origin: vec(p.origin) })),
    wrecks: c.wrecks.map((w): Wreck => {
      const grid = gridFromSave(w.grid);
      const body = copyBody(w.body);
      return {
        id: w.id,
        grid,
        props: computeProperties(grid),
        body,
        prevBody: body,
        loot: { cargo: copyCargo(w.loot.cargo), parts: partsToSave(w.loot.parts) },
        ttl: w.ttl,
        livery: w.livery,
        ...wreckExtras(w),
      };
    }),
    containers: c.containers.map((x): Container => {
      const body = copyBody(x.body);
      return {
        id: x.id,
        body,
        prevBody: body,
        loot: { cargo: copyCargo(x.loot.cargo), parts: partsToSave(x.loot.parts) },
        ttl: x.ttl,
        ...(x.poi ? { poi: x.poi } : {}),
      };
    }),
  };
}

/** Saves the whole simulation state. A docking in progress is saved as the target state `docked` (spec 9.4). */
export function toSave(sim: Simulation, ctx: SaveContext): SaveGame {
  const { state } = sim;
  const { player, world } = state;
  const dock = player.dock;
  const dockedAt = dock.mode === 'flying' ? null : dock.stationId;
  const body = dock.mode === 'docking' ? dock.to : player.body;

  const stations: SaveGame['stations'] = {};
  for (const id of [...state.stations.keys()].sort(byString)) {
    const s = state.stations.get(id)!;
    if (isEmptyStorage(s)) continue;
    stations[id] = { resources: copyCargo(s.resources), parts: partsToSave(s.parts) };
  }
  const center = world.center();

  return {
    version: 20,
    gameId: ctx.gameId,
    name: ctx.name,
    createdAt: ctx.createdAt,
    savedAt: ctx.savedAt,
    saveReason: ctx.reason,
    gameVersion: ctx.gameVersion,
    seed: state.seed,
    worldGen: world.gen,
    settings: { ...state.settings },
    tick: state.tick,
    credits: state.credits,
    player: {
      grid: gridToSave(player.grid),
      hp: [...player.hp].sort((a, b) => a[0] - b[0]).map(([id, hp]) => [id, hp]),
      body: copyBody(body),
      dampers: player.dampers,
      fuel: player.fuel,
      energy: player.energy,
      cargo: copyCargo(player.cargo),
      dockedAt,
      shield: player.shield,
      shieldDelay: player.shieldDelay,
      cooldowns: sortedPairs(player.cooldowns),
      salvage: partsToSave(player.salvage),
      destroyed: player.destroyed,
      scuttled: player.scuttled === true,
      heat: [...player.heat].sort((a, b) => a[0] - b[0]).map(([id, h]) => [id, h.heat, h.cooling]),
      tractor: copyTractor(player.tractor),
      blueprint: gridToSave(player.blueprint),
      // M4c workshop: clamped to the cargo, a bank only while its part exists (the "death gap" between steps)
      refined: refinedToSave(player.cargo, player.refined),
      repair: repairToSave(player.repair, player.grid),
    },
    respawn: { stationId: state.respawn.stationId, grid: gridToSave(state.respawn.grid) },
    stations,
    world: {
      remaining: [...world.remainingById].sort((a, b) => byString(a[0], b[0])),
      explored: [...world.explored].sort(byString),
      discoveredStations: [...world.discovered].sort(byString),
      center: center ? [center.cx, center.cy] : null,
      veins: [...world.veins].sort((a, b) => byString(a[0], b[0])).map(([id, v]) => [id, [...v.centers], [...v.dirs]]),
      cracked: [...world.cracked].sort((a, b) => byString(a[0], b[0])),
    },
    stats: copyStats(state.stats),
    combat: combatToSave(state.combat),
    career: careerToSave(state.career, state.tick),
    discovery: discoveryToSave(state.discovery),
    pirates: piratesToSave(state.pirates),
    mining: miningToSave(state.mining),
    regions: regionsToSave(state.regions),
    fleet: fleetToSave(state.fleet),
    templates: templatesToSave(state.templates),
    sites: sitesToSave(state.sites),
    director: directorToSave(state.director),
    home: homeToSave(state.home),
    guild: guildToSave(state.guild),
    convoys: convoysToSave(state.convoys),
    navigation: navigationToSave(state.navigation),
  };
}

export interface RestoreOptions {
  /** A world generator replacement (tests only). */
  generator?: ChunkGenerator;
}

/** A simulation from a (validated) save – exactly the state at the time of saving (spec 9.4). */
export function restoreSimulation(save: SaveGame, options: RestoreOptions = {}): Simulation {
  const stations = new Map<StationId, StationState>();
  for (const [id, s] of Object.entries(save.stations)) {
    stations.set(id, { resources: copyCargo(s.resources), parts: partsToSave(s.parts) });
  }
  const hp: HpMap = new Map(save.player.hp.map(([id, v]) => [id, v]));
  const p = save.player;
  const cargo = copyCargo(p.cargo);
  const grid = gridFromSave(p.grid);
  const restore: RestoredState = {
    tick: save.tick,
    credits: save.credits,
    stations,
    respawn: { stationId: save.respawn.stationId, grid: gridFromSave(save.respawn.grid) },
    stats: copyStats(save.stats),
    player: {
      grid,
      hp,
      body: copyBody(p.body),
      dampers: p.dampers,
      fuel: p.fuel,
      energy: p.energy,
      cargo,
      dockedAt: p.dockedAt,
      shield: p.shield,
      shieldDelay: p.shieldDelay,
      cooldowns: new Map(p.cooldowns),
      salvage: partsToSave(p.salvage),
      destroyed: p.destroyed,
      scuttled: p.scuttled,
      heat: new Map(p.heat.map(([id, heat, cooling]) => [id, { heat, cooling }])),
      tractor: copyTractor(p.tractor),
      blueprint: gridFromSave(p.blueprint),
      refined: refinedFromSave(cargo, p.refined),
      repair: repairToSave(p.repair, grid),
    },
    combat: combatFromSave(save.combat),
    career: careerFromSave(save.career),
    discovery: discoveryFromSave(save.discovery),
    pirates: piratesFromSave(save.pirates),
    mining: miningFromSave(save.mining),
    regions: regionsFromSave(save.regions),
    fleet: fleetFromSave(save.fleet),
    templates: templatesFromSave(save.templates),
    sites: sitesFromSave(save.sites),
    director: directorFromSave(save.director),
    // the Simulation puts the built modules' colliders into the World (homeColliders)
    home: homeFromSave(save.home),
    // M4d (V20): a restored link pins the ship beside its trader again from the first step (holdLink)
    guild: guildFromSave(save.guild),
    convoys: convoysFromSave(save.convoys),
    navigation: navigationFromSave(save.navigation),
    world: {
      remaining: new Map(save.world.remaining),
      veins: new Map(save.world.veins.map(([id, centers, dirs]) => [id, { centers: [...centers], dirs: [...dirs] }])),
      cracked: new Map(save.world.cracked),
      explored: save.world.explored,
      discovered: save.world.discoveredStations,
      center: save.world.center ? { cx: save.world.center[0], cy: save.world.center[1] } : null,
      gen: save.worldGen,
    },
  };
  const sim = new Simulation({
    seed: save.seed,
    settings: { ...save.settings },
    restore,
    ...(options.generator ? { generator: options.generator } : {}),
  });
  // a paid group is calm from the first step after loading (I1 – `calm` is derived, not saved)
  syncCalm(sim.state);
  return sim;
}

/** The storage envelope: JSON + checksum. */
export function toEnvelope(save: { version: number }): SaveEnvelope {
  const data = JSON.stringify(save);
  return { format: SAVE_FORMAT, version: save.version, checksum: fnv1aHex(data), data };
}

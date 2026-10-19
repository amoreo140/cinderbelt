// Helpers of the save tests (not used by the game).
import type { SaveContext } from './serialize';
import type { SavedGridV1, SaveGame, SaveGameV1, SaveGameV2, SaveGameV3, SaveGameV4, SaveGameV5, SaveGameV6, SaveGameV7, SaveGameV8, SaveGameV9, SaveGameV10, SaveGameV11, SaveGameV12, SaveGameV13, SaveGameV14, SaveGameV15, SaveGameV16, SaveGameV17, SaveGameV18, SaveGameV19, SaveReason } from './types';

/**
 * The same save as a game of the first world generation – what every older save becomes after the
 * 13 → 14 migration (a new test simulation takes the latest generation).
 */
export function legacyWorldSave(save: SaveGame): SaveGame {
  return { ...save, worldGen: 1 };
}

/**
 * A save in the old V19 format (no Guild, convoy or navigation state) – for migration tests. Only a save
 * in the M4d defaults can be written as V19 (that game had none of it), so relay progress, a live Watch
 * ship, a lost id, a radio line, a trade, a link, an escort convoy or a map note throws.
 */
export function downgradeToV19(save: SaveGame): SaveGameV19 {
  const { guild, convoys, navigation, ...rest } = structuredClone(save);
  if (guild.relays.length > 0 || guild.hold !== null || guild.watch.length > 0 || guild.lost.length > 0 || guild.lastRadio !== -1e9) throw new Error('Guild state has no V19 form');
  if (convoys.trades.length > 0 || convoys.link !== null || convoys.escorts.length > 0) throw new Error('convoy state has no V19 form');
  if (navigation.notes.length > 0 || navigation.nextNote !== 1) throw new Error('map notes have no V19 form');
  return { ...rest, version: 19 };
}

/**
 * A save in the old V18 format (no home station, paints, refined ore or repair bank) – for migration
 * tests. Only a save in the M4c defaults can be written as V18 (that game had none of it), so a built
 * module, a pin, a paint, refined ore or a bank throws.
 */
export function downgradeToV18(save: SaveGame): SaveGameV18 {
  const s = downgradeToV19(save);
  const { home, player, fleet, ...rest } = s;
  if (home.modules.length > 0 || home.trophyPins.length > 0) throw new Error('a home with modules or pins has no V18 form');
  const records = [fleet.active, ...fleet.stored.map((x) => x.record)];
  if (records.some((r) => r.paint !== 'factory')) throw new Error('a painted ship has no V18 form');
  if (Object.keys(player.refined).length > 0 || fleet.stored.some((x) => Object.keys(x.refined).length > 0)) throw new Error('refined ore has no V18 form');
  if (player.repair !== null) throw new Error('a repair bank has no V18 form');
  const { refined: _r, repair: _b, ...oldPlayer } = player;
  const { paint: _p, ...active } = fleet.active;
  const stored = fleet.stored.map(({ record: { paint: _q, ...record }, refined: _x, ...x }) => ({ ...x, record }));
  return { ...rest, version: 18, player: oldPlayer, fleet: { ...fleet, active, stored } };
}

/**
 * A save in the old V17 format (no shaped armour) – for migration tests. Only a save without shapes can
 * be written as V17 (that game never saved one), so a shaped part or template part throws.
 */
export function downgradeToV17(save: SaveGame): SaveGameV17 {
  const s = structuredClone(downgradeToV18(save));
  const grids = [s.player.grid, s.player.blueprint, s.respawn.grid, ...s.combat.enemies.map((e) => e.grid), ...s.combat.wrecks.map((w) => w.grid)];
  for (const x of s.fleet.stored) grids.push(x.grid, x.blueprint);
  if (grids.some((g) => g.parts.some((p) => p.shape !== undefined))) throw new Error('a shaped grid has no V17 form');
  if (s.templates.some((t) => t.parts.some((p) => p.length !== 4))) throw new Error('a shaped template has no V17 form');
  return { ...s, version: 17, templates: s.templates as SaveGameV17['templates'] };
}

/** A save in the old V16 format (no world sites, no events director) – for migration tests. */
export function downgradeToV16(save: SaveGame): SaveGameV16 {
  const { sites: _s, director: _d, ...s } = downgradeToV17(save);
  return { ...s, version: 16 };
}

/** A save in the old V15 format (no fleet, no templates, wrecks without their ship) – for migration tests. */
export function downgradeToV15(save: SaveGame): SaveGameV15 {
  const { fleet: _f, templates: _t, ...s } = downgradeToV16(save);
  const wrecks = s.combat.wrecks.map(({ ship: _s, ...w }) => w);
  return { ...s, version: 15, combat: { ...s.combat, wrecks } };
}

/** A save in the old V14 format (no sector charts, no region generator) – for migration tests. */
export function downgradeToV14(save: SaveGame): SaveGameV14 {
  const { regions: _r, ...s } = downgradeToV15(save);
  return { ...s, version: 14 };
}

/** A save in the old V13 format (no world generation) – for migration tests. */
export function downgradeToV13(save: SaveGame): SaveGameV13 {
  const { worldGen: _w, ...s } = downgradeToV14(save);
  return { ...s, version: 13 };
}

/** A save in the old V12 format (the same fields; the training hull without a reverse engine) – for migration tests. */
export function downgradeToV12(save: SaveGame): SaveGameV12 {
  return { ...downgradeToV13(save), version: 12 };
}

/** A save in the old V11 format (no nuggets, nothing assayed – Mining 2.0) – for migration tests. */
export function downgradeToV11(save: SaveGame): SaveGameV11 {
  const { mining: _m, ...s } = downgradeToV12(save);
  return { ...s, version: 11 };
}

/** A save in the old V10 format (no paid tolls) – for migration tests. */
export function downgradeToV10(save: SaveGame): SaveGameV10 {
  const s = downgradeToV11(save);
  const { paid: _p, ...pirates } = s.pirates;
  return { ...s, version: 10, pirates };
}

/** A save in the old V9 format ("First Day" instead of the Guild Training) – for migration tests. */
export function downgradeToV9(save: SaveGame): SaveGameV9 {
  const s = downgradeToV10(save);
  const { training: _t, ...career } = s.career;
  return { ...s, version: 9, career: { ...career, firstDay: { step: 2, status: 'active', base: 0 } } };
}

/** A save in the old V8 format (pirates without fuel and gunner reaction) – for migration tests. */
export function downgradeToV8(save: SaveGame): SaveGameV8 {
  const s = downgradeToV9(save);
  const enemies = s.combat.enemies.map(({ fuel: _f, ai: { react: _r, seen: _s, ...ai }, ...e }) => ({ ...e, ai }));
  return { ...s, version: 8, combat: { ...s.combat, enemies } };
}

/** A save in the old V7 format (no Guild loan parts, no scuttle flag) – for migration tests. */
export function downgradeToV7(save: SaveGame): SaveGameV7 {
  const s = downgradeToV8(save);
  const strip = (g: SavedGridV1): SavedGridV1 => ({ nextId: g.nextId, parts: g.parts.map(({ loan: _l, ...p }) => p) });
  const { scuttled: _s, ...player } = s.player;
  const { bestUnitsPerHour: _u, ...stats } = s.stats;
  return {
    ...s,
    version: 7,
    stats,
    player: { ...player, grid: strip(player.grid), blueprint: strip(player.blueprint) },
    respawn: { ...s.respawn, grid: strip(s.respawn.grid) },
  };
}

/** A save in the old V6 format (no ship blueprint) – for migration tests. */
export function downgradeToV6(save: SaveGame): SaveGameV6 {
  const s = downgradeToV7(save);
  const { blueprint: _b, ...player } = s.player;
  return { ...s, version: 6, player };
}

/** A save in the old V5 format (no tractor beam, containers or dismantling) – for migration tests. */
export function downgradeToV5(save: SaveGame): SaveGameV5 {
  const s = downgradeToV6(save);
  const { tractor: _t, ...player } = s.player;
  const { containers: _c, ...combat } = s.combat;
  const { cut: _x, ...discovery } = s.discovery;
  const { pirates: _p, ...rest } = s;
  return {
    ...rest,
    version: 5,
    player,
    combat: { ...combat, wrecks: combat.wrecks.map(({ dismantle: _d, cutting: _k, from: _f, ...w }) => w) },
    discovery,
  };
}

/** A save in the old V4 format (no discoveries, grids without variants, wrecks without POI) – for migration tests. */
export function downgradeToV4(save: SaveGame): SaveGameV4 {
  const { discovery: _discovery, ...rest } = downgradeToV5(save);
  const strip = (g: SavedGridV1): SavedGridV1 => ({ nextId: g.nextId, parts: g.parts.map(({ variant: _v, ...p }) => p) });
  return {
    ...rest,
    version: 4,
    player: { ...rest.player, grid: strip(rest.player.grid) },
    respawn: { ...rest.respawn, grid: strip(rest.respawn.grid) },
    combat: {
      ...rest.combat,
      enemies: rest.combat.enemies.map((e) => ({ ...e, grid: strip(e.grid) })),
      wrecks: rest.combat.wrecks.filter((w) => w.id >= 0).map(({ poi: _p, cls: _c, contents: _x, ...w }) => ({ ...w, grid: strip(w.grid) })),
    },
  };
}

/** A save in the old V3 format (no career) – for migration tests. */
export function downgradeToV3(save: SaveGame): SaveGameV3 {
  const { career: _career, ...rest } = downgradeToV4(save);
  return { ...rest, version: 3 };
}

/** A save in the old V2 format (no veins, no laser heat) – for migration tests. */
export function downgradeToV2(save: SaveGame): SaveGameV2 {
  const { player, world, ...rest } = downgradeToV3(save);
  const { heat: _h, ...oldPlayer } = player;
  const { veins: _v, cracked: _c, ...oldWorld } = world;
  return { ...rest, version: 2, player: oldPlayer, world: oldWorld };
}

/** A save in the old V1 format (no combat) – for migration tests. */
export function downgradeToV1(save: SaveGame): SaveGameV1 {
  const { combat: _combat, stats, player, ...rest } = downgradeToV2(save);
  const { shield: _s, shieldDelay: _d, cooldowns: _c, salvage: _v, destroyed: _x, ...oldPlayer } = player;
  const { kills: _k, ...oldStats } = stats;
  return { ...rest, version: 1, player: oldPlayer, stats: oldStats };
}

export function testContext(reason: SaveReason = 'manual', savedAt = '2026-10-17T12:00:00.000Z'): SaveContext {
  return {
    gameId: 'game-1',
    name: 'Testovacia hra',
    createdAt: '2026-10-17T10:00:00.000Z',
    savedAt,
    reason,
    gameVersion: 'test',
  };
}

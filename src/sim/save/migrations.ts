// Save game migrations (spec M2, 9.3). MIGRATIONS[n] converts data of version n to n + 1.
import { partDef, type PartId, type Tier } from '../../data/parts';
import { emptyCargo } from '../../data/resources';
import { stepIndex } from '../../data/training';
import type { VariantId } from '../../data/variants';
import { createCombatState } from '../combat/combat';
import { legacyCareer } from './career';
import { legacyDiscovery } from './discovery';
import { legacyFleet } from './fleet';
import { legacyConvoys } from './convoys';
import { legacyGuild } from './guild';
import { legacyHome } from './home';
import { legacyNavigation } from './navigation';
import { legacyPirates } from './pirates';
import { legacyRegions } from './regions';
import { legacyDirector, legacySites } from './sites';
import { legacyTraining } from '../training/training';

export const LATEST_SAVE_VERSION = 20;

export type Migration = (data: unknown) => unknown;
export type MigrationTable = Readonly<Record<number, Migration>>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 1 → 2 (M3a – combat): the player without a shield and with uncharged cannons (v1 had none), an empty
 * hold of wreck parts, 0 pirates destroyed and an empty combat state (RNG from the seed).
 */
export function v1ToV2(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.stats)) throw new Error('not a version 1 save');
  const seed = typeof data.seed === 'number' ? data.seed : 0;
  return {
    ...data,
    version: 2,
    player: { ...data.player, shield: 0, shieldDelay: 0, cooldowns: [], salvage: {}, destroyed: false },
    stats: { ...data.stats, kills: 0 },
    combat: { rng: createCombatState(seed).rng, nextId: 1, enemies: [], defeated: [], projectiles: [], wrecks: [] },
  };
}

/**
 * 2 → 3 (M2d – veins and the hull budget): untouched veins (the initial state derives from the asteroid
 * id), no cracked ice and cold lasers. A ship over the hull budget stays (it flies on, warning
 * `overBudgetLegacy` on load and in the shipyard).
 */
export function v2ToV3(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.world) || !isObj(data.combat)) throw new Error('not a version 2 save');
  return {
    ...data,
    version: 3,
    player: { ...data.player, heat: [] },
    world: { ...data.world, veins: [], cracked: [] },
  };
}

/**
 * 3 → 4 (M3.5a – career): no contracts and reputation, "First Day" skipped (a game in progress).
 */
export function v3ToV4(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.world)) throw new Error('not a version 3 save');
  return { ...data, version: 4, career: legacyCareer() };
}

/**
 * 4 → 5 (M3.5b – discoveries): no Data and discoveries; the heavy laser, large cargo and battery that M2d
 * made available directly stay unlocked (Archive nodes). Grids and wrecks do not change (variants and
 * wreck contents are new optional fields).
 */
export function v4ToV5(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.career)) throw new Error('not a version 4 save');
  return { ...data, version: 5, discovery: legacyDiscovery() };
}

/**
 * 5 → 6 (M3.6 – salvage and fortress): a tractor beam without a target, no containers and nothing cut off wrecks,
 * pirate attention 0 and untouched fortresses.
 * POI wrecks of an old game stay as they were (loaded whole); once out of range they are built again,
 * dismantlable.
 */
export function v5ToV6(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.combat) || !isObj(data.discovery)) throw new Error('not a version 5 save');
  return {
    ...data,
    version: 6,
    player: { ...data.player, tractor: null },
    combat: { ...data.combat, containers: [] },
    discovery: { ...data.discovery, cut: [] },
    pirates: legacyPirates(),
  };
}

/**
 * 6 → 7 (M3.8 – flight and damage feedback): the ship blueprint is the layout at load (an older
 * save does not know what the ship looked like before it lost parts).
 */
export function v6ToV7(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.player.grid)) throw new Error('not a version 6 save');
  return { ...data, version: 7, player: { ...data.player, blueprint: structuredClone(data.player.grid) } };
}

/**
 * 7 → 8 (saboteur fixes): no Guild loan parts yet (every part on an old ship is owned), no scuttle
 * pending – a ship destroyed in an old save died to the world – and no recorded best ship (contract
 * quotes use the ships the player has, at least the starter, until the next dock records one).
 */
export function v7ToV8(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player)) throw new Error('not a version 7 save');
  if (!isObj(data.stats)) throw new Error('not a version 7 save');
  return { ...data, version: 8, player: { ...data.player, scuttled: false }, stats: { ...data.stats, bestUnitsPerHour: [0, 0, 0, 0] } };
}

/** Fuel capacity of a saved grid (the sum of its parts' tanks, as computeProperties counts it). */
function savedFuelCapacity(grid: unknown): number {
  if (!isObj(grid) || !Array.isArray(grid.parts)) throw new Error('enemy without a grid');
  let fuel = 0;
  for (const p of grid.parts as { partId: PartId; tier: Tier; variant?: VariantId }[]) fuel += partDef(p.partId, p.tier, p.variant).fuel ?? 0;
  return fuel;
}

/**
 * 8 → 9 (combat fairness): pirates in flight get full tanks of their grid (old pirates never burnt
 * fuel) and a gunner that has already reacted to its target (no reaction pending).
 */
export function v8ToV9(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.combat) || !Array.isArray(data.combat.enemies)) throw new Error('not a version 8 save');
  const enemies = data.combat.enemies.map((e: unknown) => {
    if (!isObj(e) || !isObj(e.ai)) throw new Error('not a version 8 enemy');
    return { ...e, fuel: savedFuelCapacity(e.grid), ai: { ...e.ai, react: 0, seen: { x: 0, y: 0 } } };
  });
  return { ...data, version: 9, combat: { ...data.combat, enemies } };
}

/**
 * 9 → 10 (M3.7 Guild Training): the training replaces the "First Day" onboarding – a game in progress
 * has the training done (a First Day still running is dropped with it; its steps were tips, not
 * progress).
 */
export function v9ToV10(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.career)) throw new Error('not a version 9 save');
  const { firstDay: _f, ...career } = data.career;
  return { ...data, version: 10, career: { ...career, training: legacyTraining() } };
}

/**
 * 10 → 11 (second code review I1): paid tolls are saved – none in an old save (the truce of a group
 * paid off just before saving was lost on load before; it starts empty).
 */
export function v10ToV11(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.pirates)) throw new Error('not a version 10 save');
  return { ...data, version: 11, pirates: { ...data.pirates, paid: [] } };
}

/**
 * 11 → 12 (Mining 2.0): no nuggets in flight and no ore assayed yet (grades of rocks are derived
 * from the seed, so an old world gets them without any data).
 */
export function v11ToV12(data: unknown): unknown {
  if (!isObj(data)) throw new Error('not a version 11 save');
  return { ...data, version: 12, mining: { nextId: 1, nuggets: [], assayed: [] } };
}

/**
 * 12 → 13 (the training hull gets a reverse engine): the Guild Training hull now starts with one
 * reverse engine and the brake step pays only the second one. A training still running before that
 * reward was paid started with the old hull (no reverse engine), so the Guild puts the missing engine
 * into the storage of the reward station – the training still ends with the starter ship and the
 * same total value. A training past the brake step already got both engines; nothing changes.
 */
export function v12ToV13(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.career) || !isObj(data.stations)) throw new Error('not a version 12 save');
  const t = data.career.training;
  const next = { ...data, version: 13 };
  if (!isObj(t) || t.status !== 'active' || typeof t.step !== 'number' || t.step > stepIndex('brakeBuoy')) return next;
  const at = typeof t.rewardAt === 'string' ? t.rewardAt : 'home';
  const old = data.stations[at];
  const storage = isObj(old) && isObj(old.parts) ? old : { resources: emptyCargo(), parts: {} };
  const parts = storage.parts as Record<string, number>;
  return { ...next, stations: { ...data.stations, [at]: { ...storage, parts: { ...parts, 'engine:1': (parts['engine:1'] ?? 0) + 1 } } } };
}

/**
 * 13 → 14 (art batch D station variants): the world generation is saved. Every older game keeps the
 * rules it was generated with (generation 1) – its stations keep their models, collision circles and
 * dock ports, so storage and docked ships stay where they were.
 */
export function v13ToV14(data: unknown): unknown {
  if (!isObj(data)) throw new Error('not a version 13 save');
  return { ...data, version: 14, worldGen: 1 };
}

/**
 * 14 → 15 (sectors stage 2, "maps as a commodity"): the region generator is frozen and saved (gen 1)
 * with the sector charts – nothing surveyed, bought or sold yet. Sectors an old game charted by flight
 * coverage stay Charted (derived from `world.explored`) and are sellable; their Data were paid already.
 */
export function v14ToV15(data: unknown): unknown {
  if (!isObj(data)) throw new Error('not a version 14 save');
  return { ...data, version: 15, regions: legacyRegions() };
}

/**
 * 15 → 16 (M4a "Hangar and Fleet"): the ship flown so far is fleet record 1 with its generated name and
 * the whole game's stats as its log; nothing stored, no slots bought, no templates. Player wrecks still
 * drifting broke off that ship (record 1).
 */
export function v15ToV16(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.combat) || !Array.isArray(data.combat.wrecks)) throw new Error('not a version 15 save');
  const seed = typeof data.seed === 'number' ? data.seed : 0;
  const fleet = legacyFleet(seed, data.stats);
  const wrecks = data.combat.wrecks.map((w: unknown) =>
    isObj(w) && w.livery === 'default' && w.poi === undefined && w.from === undefined ? { ...w, ship: fleet.active.id } : w,
  );
  return { ...data, version: 16, combat: { ...data.combat, wrecks }, fleet, templates: [] };
}

/**
 * 16 → 17 (M4b "World Comes Alive"): no world site touched (no powered relay, no charge, no berth, no derelict,
 * graveyard or comet state, no armed mine) and a director with no event yet. The new sites appear in the
 * old world from their own hash stream; nothing existing moves.
 */
export function v16ToV17(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.fleet) || !Array.isArray(data.templates)) throw new Error('not a version 16 save');
  return { ...data, version: 17, sites: legacySites(), director: legacyDirector() };
}

/**
 * 17 → 18 (SL2 E2 "Shaped Parts"): shaped armour – grid parts may carry `shape`, template parts a 5th
 * element. No new state: the number only. An older game never wrote a shape (the grid save was a
 * whitelist without it, templates were saved as 4-tuples), so there is nothing to convert; data that
 * claims a shape anyway is checked by the V18 validation like any other save (an unknown shape or a
 * shape on a part that cannot have one rejects it, a broken design is repaired as usual).
 */
export function v17ToV18(data: unknown): unknown {
  if (!isObj(data)) throw new Error('not a version 17 save');
  return { ...data, version: 18 };
}

/**
 * 18 → 19 (M4c "Home and Workshop"): nothing built at home and nothing pinned, every ship in its factory
 * paint, no refined ore on the active or a stored ship and no repair bank. Defensive about the
 * unvalidated data (a malformed record is left for the V19 validation to reject).
 */
export function v18ToV19(data: unknown): unknown {
  if (!isObj(data) || !isObj(data.player) || !isObj(data.fleet)) throw new Error('not a version 18 save');
  const paint = (r: unknown): unknown => (isObj(r) ? { ...r, paint: 'factory' } : r);
  const fleet = data.fleet;
  const stored = Array.isArray(fleet.stored) ? fleet.stored.map((s: unknown) => (isObj(s) ? { ...s, record: paint(s.record), refined: {} } : s)) : fleet.stored;
  return {
    ...data,
    version: 19,
    player: { ...data.player, refined: {}, repair: null },
    fleet: { ...fleet, active: paint(fleet.active), stored },
    home: legacyHome(),
  };
}

/**
 * 19 → 20 (M4d "Guild and Trade"): no relay progress, no relay hold, no live Watch ships, no lost Watch
 * ids, no radio line yet; no convoy trades, link or escort convoys (an accepted escort contract gets its
 * convoy waiting at the meeting point on the next step, without a deposit); no map notes. Everything
 * else stays – the V20 validation now accepts the Guild relay slips and the escort slips a V19 game
 * could not save, and the `gr:` masts in `sites.powered`.
 */
export function v19ToV20(data: unknown): unknown {
  if (!isObj(data)) throw new Error('not a version 19 save');
  return { ...data, version: 20, guild: legacyGuild(), convoys: legacyConvoys(), navigation: legacyNavigation() };
}

/**
 * Version 1 is the first (M1 has no saves). A new version = a new entry here + a new validator; a
 * migration fills new fields with defaults and explicitly handles renamed / removed parts and resources
 * (otherwise the validation fails → slot "Damaged").
 */
export const MIGRATIONS: MigrationTable = { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7, 7: v7ToV8, 8: v8ToV9, 9: v9ToV10, 10: v10ToV11, 11: v11ToV12, 12: v12ToV13, 13: v13ToV14, 14: v14ToV15, 15: v15ToV16, 16: v16ToV17, 17: v17ToV18, 18: v18ToV19, 19: v19ToV20 };

export type MigrateResult =
  | { ok: true; data: unknown }
  | { ok: false; error: 'tooNew' | 'migration'; detail: string };

const versionOf = (data: unknown): unknown =>
  typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : undefined;

/** Converts data step by step from version `from` to `latest`. A migration exception comes back as an error. */
export function migrate(
  data: unknown,
  from: number,
  migrations: MigrationTable = MIGRATIONS,
  latest: number = LATEST_SAVE_VERSION,
): MigrateResult {
  if (from > latest) return { ok: false, error: 'tooNew', detail: `version ${from} > ${latest}` };
  let current = data;
  for (let v = from; v < latest; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, error: 'migration', detail: `no migration from version ${v}` };
    try {
      current = step(current);
    } catch (e) {
      return { ok: false, error: 'migration', detail: `migration ${v} → ${v + 1} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (versionOf(current) !== v + 1) {
      return { ok: false, error: 'migration', detail: `migration ${v} → ${v + 1} produced version ${String(versionOf(current))}` };
    }
  }
  return { ok: true, data: current };
}

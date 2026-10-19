// Validation of the M4c state in save V19 ("Home and Workshop") – same style as validate.ts: a clean copy,
// errors with paths. Two passes like the fleet:
//
// - shape (with the rest of the save): the home modules (known, buildable now, unique), the trophy pins
//   (well-formed ids, unique, at most TROPHY_PEDESTALS), refined ore (known resources, ≥ 0, never ice,
//   ≤ the cargo it belongs to) and the repair bank (its part in the grid, ≥ 0) – a bad value rejects the
//   save.
// - repair (after the ships are checked): tunable and derived limits – refined ore follows a cargo the
//   validation scaled down, a bank above one unit of its part's material (a tuned recipe or HP) is
//   clamped, a replaced ship loses both, and a pin whose trophy this save no longer has (fortress
//   placement is tunable) is dropped. Nothing here rejects the save.
import { HOME_MODULE_IDS, isBuildableModule, TROPHY_PEDESTALS, type HomeModuleId } from '../../data/home';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import { trophiesOf } from '../home/trophies';
import type { TrophyId } from '../home/types';
import type { SimState } from '../Simulation';
import { repairMaterialPerHp } from '../ship/workshop';
import { gridShape } from './gridSave';
import type { SavedGridV1, SavedHomeV19, SavedRefinedV19, SavedRepairBankV19, SaveGame } from './types';
import type { Checker } from './validate';

/** Tolerance of the refined ≤ cargo check and the bank's worth (floating-point rounding). */
const EPS = 1e-6;
const TROPHY_ID = /^(cap:(0|[1-9]\d*)|fort:\S+)$/;

/** Structure of `home` (V19). */
export function validateHomeShape(c: Checker, v: unknown, path: string): SavedHomeV19 {
  const o = c.obj(v, path) ?? {};
  const modules = new Set<HomeModuleId>();
  (c.arr(o.modules, `${path}.modules`) ?? []).forEach((raw, i) => {
    const p = `${path}.modules[${i}]`;
    const id = c.oneOf<HomeModuleId>(raw, HOME_MODULE_IDS, p);
    if (!HOME_MODULE_IDS.includes(raw as HomeModuleId)) return;
    if (!isBuildableModule(id)) return c.err(p, 'module not available yet');
    if (modules.has(id)) return c.err(p, 'duplicate module');
    modules.add(id);
  });
  const pins: TrophyId[] = [];
  const list = c.arr(o.trophyPins, `${path}.trophyPins`) ?? [];
  if (list.length > TROPHY_PEDESTALS) c.err(`${path}.trophyPins`, `more than ${TROPHY_PEDESTALS} pins`);
  list.forEach((raw, i) => {
    const p = `${path}.trophyPins[${i}]`;
    const id = c.str(raw, p);
    if (!TROPHY_ID.test(id)) return c.err(p, 'expected a trophy id');
    if (pins.includes(id as TrophyId)) return c.err(p, 'duplicate pin');
    pins.push(id as TrophyId);
  });
  return { modules: HOME_MODULE_IDS.filter((id) => modules.has(id)), trophyPins: pins };
}

/** Refined ore of a ship (V19): known resources, finite ≥ 0, no ice, ≤ `cargo`; positive amounts kept. */
export function validateRefined(c: Checker, v: unknown, path: string, cargo: Cargo): SavedRefinedV19 {
  const o = c.obj(v, path) ?? {};
  const out: SavedRefinedV19 = {};
  for (const k of Object.keys(o)) if (!(RESOURCE_IDS as readonly string[]).includes(k)) c.err(`${path}.${k}`, 'unknown resource');
  for (const r of RESOURCE_IDS) {
    if (o[r] === undefined) continue;
    const n = c.num(o[r], `${path}.${r}`, 0);
    if (n <= 0) continue;
    if (r === 'ice') c.err(`${path}.${r}`, 'ice is never refined');
    else if (n > cargo[r] + EPS) c.err(`${path}.${r}`, `more refined than in the cargo (${cargo[r]})`);
    else out[r] = Math.min(n, cargo[r]);
  }
  return out;
}

/** The repair bank (V19): null, or a part of `grid` and a finite bank ≥ 0. */
export function validateRepair(c: Checker, v: unknown, path: string, grid: SavedGridV1): SavedRepairBankV19 | null {
  if (v === null) return null;
  const o = c.obj(v, path) ?? {};
  const part = c.int(o.part, `${path}.part`);
  const bank = c.num(o.bank, `${path}.bank`, 0);
  if (!grid.parts.some((p) => p.id === part)) c.err(`${path}.part`, `no part with id ${part}`);
  return { part, bank };
}

/** Refined ore cut to a cargo the validation changed (scaled down to the capacity or emptied). */
export function clampSavedRefined(refined: SavedRefinedV19, cargo: Cargo): SavedRefinedV19 {
  const out: SavedRefinedV19 = {};
  for (const r of RESOURCE_IDS) {
    const n = Math.min(refined[r] ?? 0, r === 'ice' ? 0 : cargo[r]);
    if (n > 0) out[r] = n;
  }
  return out;
}

/** The trophy ids this save has (the same rule as the game: `trophiesOf`). */
function trophyIds(save: SaveGame): Set<string> {
  const view = {
    seed: save.seed,
    career: { trophies: save.career.trophies },
    pirates: { fortresses: new Map(save.pirates.fortresses) },
  } satisfies { seed: number; career: Pick<SimState['career'], 'trophies'>; pirates: Pick<SimState['pirates'], 'fortresses'> };
  // trophiesOf reads only these three fields
  return new Set(trophiesOf(view as unknown as SimState).map((t) => t.id));
}

/**
 * The game rules of the M4c state (see the header), after the active and stored ships were checked and
 * their cargo clamped. Changes `save` in place; returns the paths of dropped pins (`sitesRepaired`).
 */
export function repairHome(c: Checker, save: SaveGame): string[] {
  const p = save.player;
  p.refined = clampSavedRefined(p.refined, p.cargo);
  if (p.repair) {
    const part = gridShape(p.grid).parts.find((x) => x.id === p.repair!.part);
    if (!part) p.repair = null;
    else {
      const { perHp } = repairMaterialPerHp(part);
      // the bank is worth less than one unit of the material; recipes and HP are tunable
      if (perHp > 0 && p.repair.bank * perHp > 1 + EPS) {
        c.clamped.push('player.repair.bank');
        p.repair = { part: p.repair.part, bank: 1 / perHp };
      }
    }
  }
  for (const s of save.fleet.stored) s.refined = clampSavedRefined(s.refined, s.cargo);

  const known = trophyIds(save);
  const dropped: string[] = [];
  save.home.trophyPins = save.home.trophyPins.filter((id, i) => {
    if (known.has(id)) return true;
    dropped.push(`home.trophyPins[${i}]`);
    return false;
  });
  return dropped;
}

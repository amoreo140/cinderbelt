// Validation of the fleet and the ship templates in save V16 (M4a "Hangar and Fleet"; shaped template
// parts V18, SL2 E2; paints and refined ore V19, M4c) – same style as validate.ts: a clean copy, errors with paths. Two passes:
//
// - `validateFleetShape` / `validateTemplatesShape` (with the rest of the save): structure and types –
//   a malformed value rejects the save like anywhere else.
// - `repairFleet` (after the active ship is checked): the game rules. Nothing here rejects the save –
//   a stored ship that cannot be (an invalid or oversized grid, Guild loan parts, a duplicate id, a
//   station without a shipyard) is taken apart into a station storage with the warning
//   `storedShipDropped`, like an invalid active ship (`shipReplaced`); names are sanitised, values
//   over capacity clamped, broken templates and templates over the Archive cap dropped (`capacityClamped`).
import { ARCHIVE_NODES, type ArchiveFeature, type ArchiveNodeId } from '../../data/archive';
import { HANGAR } from '../../data/economy';
import { SHIP_NAME_COUNT, TEMPLATE_SLOTS } from '../../data/fleet';
import { PAINT_IDS, type PaintId } from '../../data/paints';
import { ALL_PART_KEYS, partKey, type PartKey } from '../../data/parts';
import { cargoUsed, emptyCargo, RESOURCE_IDS } from '../../data/resources';
import { isSanitizedName, sanitizeName } from '../fleet/names';
import { validateGrid } from '../ship/grid';
import { computeProperties } from '../ship/properties';
import { validTemplateParts } from '../templates/actions';
import { homeStation, stationById, type StationId } from '../world/stations';
import { fitHangar, gridShape } from './gridSave';
import { validateRefined } from './validateHome';
import type { SavedFleetV19, SavedGridV1, SavedShipLogV16, SavedShipRecordV19, SavedStoredShipV19, SavedTemplateV18, SaveGame } from './types';
import type { Checker, LoadWarning } from './validate';

const CAPACITY_EPS = 1e-6;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function shipLog(c: Checker, v: unknown, path: string): SavedShipLogV16 {
  const o = c.obj(v, path) ?? {};
  return {
    distance: c.num(o.distance, `${path}.distance`, 0),
    kills: c.int(o.kills, `${path}.kills`, 0),
    mined: c.num(o.mined, `${path}.mined`, 0),
    deaths: c.int(o.deaths, `${path}.deaths`, 0),
    built: c.int(o.built, `${path}.built`, 0),
  };
}

function shipRecord(c: Checker, v: unknown, path: string): SavedShipRecordV19 {
  const o = c.obj(v, path) ?? {};
  return {
    id: c.int(o.id, `${path}.id`, 1),
    name: o.name === null ? null : c.str(o.name, `${path}.name`),
    nameIdx: c.int(o.nameIdx, `${path}.nameIdx`, 0),
    log: shipLog(c, o.log, `${path}.log`),
    paint: c.oneOf<PaintId>(o.paint, PAINT_IDS, `${path}.paint`),
  };
}

/** Structure of `fleet` (V16; paints and stored refined ore V19). */
export function validateFleetShape(c: Checker, v: unknown, path: string): SavedFleetV19 {
  const o = c.obj(v, path) ?? {};
  const stored = (c.arr(o.stored, `${path}.stored`) ?? []).map((raw, i): SavedStoredShipV19 => {
    const p = `${path}.stored[${i}]`;
    const s = c.obj(raw, p) ?? {};
    const grid = c.grid(s.grid, `${p}.grid`);
    const cargo = c.cargo(s.cargo, `${p}.cargo`);
    return {
      record: shipRecord(c, s.record, `${p}.record`),
      stationId: c.stationId(s.stationId, `${p}.stationId`),
      grid,
      blueprint: c.grid(s.blueprint, `${p}.blueprint`),
      hp: c.hp(s.hp, `${p}.hp`, grid),
      fuel: c.num(s.fuel, `${p}.fuel`, 0),
      cargo,
      refined: validateRefined(c, s.refined, `${p}.refined`, cargo),
    };
  });
  const slots = new Map<StationId, number>();
  (c.arr(o.slots, `${path}.slots`) ?? []).forEach((entry, i) => {
    const p = `${path}.slots[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [stationId, count]');
    const id = c.stationId(entry[0], p);
    if (slots.has(id)) return c.err(p, 'duplicate station');
    slots.set(id, c.int(entry[1], p, 1));
  });
  return {
    nextShipId: c.int(o.nextShipId, `${path}.nextShipId`, 2),
    active: shipRecord(c, o.active, `${path}.active`),
    stored,
    slots: [...slots].sort((a, b) => byString(a[0], b[0])),
  };
}

/**
 * Structure of `templates` (V16; 5-tuples with a shape from V18): names are strings, parts arrays – their
 * content (`validTemplateParts`) is `repairFleet`'s, which drops a template it cannot use.
 */
export function validateTemplatesShape(c: Checker, v: unknown, path: string): SavedTemplateV18[] {
  return (c.arr(v, path) ?? []).map((raw, i) => {
    const p = `${path}[${i}]`;
    const o = c.obj(raw, p) ?? {};
    // unchecked until `repairFleet`: `validTemplateParts` checks every element before it is used
    return { name: c.str(o.name, `${p}.name`), parts: (c.arr(o.parts, `${p}.parts`) ?? []) as SavedTemplateV18['parts'] };
  });
}

const hasFeature = (archive: readonly ArchiveNodeId[], feature: ArchiveFeature): boolean =>
  ARCHIVE_NODES.some((n) => n.unlock.kind === 'feature' && n.unlock.feature === feature && archive.includes(n.id));

/** Hangar slot cap of the save's Archive (sim/fleet/state `hangarSlotCap`). */
const slotCap = (archive: readonly ArchiveNodeId[]): number => (hasFeature(archive, 'hangarPlus') ? HANGAR.maxSlots.plus : HANGAR.maxSlots.base);

/** Template cap of the save's Archive (sim/templates/state `templateCap`). */
function templateCap(archive: readonly ArchiveNodeId[]): number {
  if (hasFeature(archive, 'templates20')) return TEMPLATE_SLOTS.plus;
  if (hasFeature(archive, 'templates')) return TEMPLATE_SLOTS.base;
  return TEMPLATE_SLOTS.none;
}

/** A sanitised name (a name that is not in stored form is cleaned; one that cannot be → generated). */
function repairRecord(c: Checker, r: SavedShipRecordV19, path: string): void {
  if (r.name !== null && !isSanitizedName(r.name)) {
    r.name = sanitizeName(r.name);
    c.clamped.push(`${path}.name`);
  }
  if (r.nameIdx >= SHIP_NAME_COUNT) {
    r.nameIdx %= SHIP_NAME_COUNT;
    c.clamped.push(`${path}.nameIdx`);
  }
}

/** Why a stored ship cannot stand in the hangar (null = it can). */
function storedProblem(save: SaveGame, s: SavedStoredShipV19, taken: ReadonlySet<number>): string | null {
  if (taken.has(s.record.id)) return 'duplicate ship id';
  if (!stationById(save.seed, s.stationId, save.worldGen)?.services.shipyard) return 'not at a station with a shipyard';
  if (s.grid.parts.some((p) => p.loan)) return 'Guild loan parts';
  const fits = fitHangar(s.grid);
  if (!fits || validateGrid(gridShape(fits)).length > 0) return 'invalid ship';
  return null;
}

/** Owned parts and cargo of a dropped stored ship into a storage; returns the station. */
function storeDropped(save: SaveGame, s: SavedStoredShipV19): StationId {
  const own = stationById(save.seed, s.stationId, save.worldGen);
  const id = own && save.world.discoveredStations.includes(own.id) ? own.id : (stationById(save.seed, save.respawn.stationId, save.worldGen) ?? homeStation()).id;
  const storage = (save.stations[id] ??= { resources: emptyCargo(), parts: {} });
  for (const p of s.grid.parts) {
    if (p.loan) continue;
    const key: PartKey = partKey(p.partId, p.tier, p.variant);
    storage.parts[key] = (storage.parts[key] ?? 0) + 1;
  }
  for (const r of RESOURCE_IDS) storage.resources[r] += s.cargo[r];
  storage.parts = Object.fromEntries(ALL_PART_KEYS.filter((k) => storage.parts[k]).map((k) => [k, storage.parts[k]]));
  return id;
}

const withoutLoans = (g: SavedGridV1): SavedGridV1 => ({ nextId: g.nextId, parts: g.parts.map(({ loan: _l, ...p }) => p) });

/** A stored ship that may stand: grid moved into the hangar, blueprint checked, fuel and cargo clamped. */
function repairStored(c: Checker, s: SavedStoredShipV19, path: string): void {
  repairRecord(c, s.record, `${path}.record`);
  const fits = fitHangar(s.grid)!;
  const blueprint = fitHangar(s.blueprint);
  // the blueprint shares the ship's cells: a moved ship (or a broken blueprint) starts a new one from it
  if (fits !== s.grid || blueprint !== s.blueprint || validateGrid(gridShape(s.blueprint)).length > 0) s.blueprint = gridShape(fits);
  s.blueprint = withoutLoans(s.blueprint);
  s.grid = fits;
  const props = computeProperties(gridShape(s.grid));
  s.fuel = c.capped(s.fuel, `${path}.fuel`, 0, props.fuelCapacity);
  const used = cargoUsed(s.cargo);
  if (used > props.cargoCapacity + CAPACITY_EPS) {
    c.clamped.push(`${path}.cargo`);
    const k = props.cargoCapacity / used;
    for (const r of RESOURCE_IDS) s.cargo[r] *= k;
  }
}

/** The game rules of `fleet` and `templates` (see the header). Changes `save` in place. */
export function repairFleet(c: Checker, save: SaveGame): LoadWarning[] {
  const warnings: LoadWarning[] = [];
  const { fleet } = save;
  repairRecord(c, fleet.active, 'fleet.active');

  const taken = new Set([fleet.active.id]);
  const kept: SavedStoredShipV19[] = [];
  [...fleet.stored]
    .sort((a, b) => a.record.id - b.record.id)
    .forEach((s) => {
      const path = `fleet.stored[${fleet.stored.indexOf(s)}]`;
      if (storedProblem(save, s, taken) !== null) {
        warnings.push({ code: 'storedShipDropped', shipId: s.record.id, stationId: storeDropped(save, s) });
        return;
      }
      taken.add(s.record.id);
      repairStored(c, s, path);
      kept.push(s);
    });
  fleet.stored = kept;

  const maxId = Math.max(...taken);
  if (fleet.nextShipId <= maxId) {
    fleet.nextShipId = maxId + 1;
    c.clamped.push('fleet.nextShipId');
  }

  // slots: only at shipyard stations, at least one per stored ship there, at most the Archive's cap
  // (only free slots are given up – a ship is never dropped for the cap)
  const slots = new Map<StationId, number>();
  for (const [id, n] of fleet.slots) {
    if (stationById(save.seed, id, save.worldGen)?.services.shipyard) slots.set(id, n);
    else c.clamped.push(`fleet.slots.${id}`);
  }
  for (const s of fleet.stored) {
    const here = fleet.stored.filter((x) => x.stationId === s.stationId).length;
    if ((slots.get(s.stationId) ?? 0) < here) {
      slots.set(s.stationId, here);
      c.clamped.push(`fleet.slots.${s.stationId}`);
    }
  }
  let total = [...slots.values()].reduce((a, b) => a + b, 0);
  const cap = slotCap(save.discovery.archive);
  for (const id of [...slots.keys()].sort(byString).reverse()) {
    if (total <= cap) break;
    const used = fleet.stored.filter((x) => x.stationId === id).length;
    const free = Math.min(slots.get(id)! - used, total - cap);
    if (free <= 0) continue;
    total -= free;
    c.clamped.push(`fleet.slots.${id}`);
    if (slots.get(id)! - free > 0) slots.set(id, slots.get(id)! - free);
    else slots.delete(id);
  }
  fleet.slots = [...slots].sort((a, b) => byString(a[0], b[0]));

  // templates: sanitised names, valid normalised designs (4-tuples, or 5-tuples with a shape on armour,
  // V18), at most the Archive's cap
  const templates: SavedTemplateV18[] = [];
  save.templates.forEach((t, i) => {
    const name = sanitizeName(t.name);
    const parts = validTemplateParts(t.parts);
    if (name === null || parts === null) {
      c.clamped.push(`templates[${i}]`);
      return;
    }
    if (name !== t.name) c.clamped.push(`templates[${i}].name`);
    templates.push({ name, parts });
  });
  const tcap = templateCap(save.discovery.archive);
  if (templates.length > tcap) {
    c.clamped.push('templates');
    templates.length = tcap;
  }
  save.templates = templates;
  return warnings;
}

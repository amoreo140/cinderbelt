// Fleet and ship templates <-> save (V16, M4a "Hangar and Fleet"; shaped template parts V18, SL2 E2;
// paints and refined ore V19, M4c): the active ship's record, the stored ships (grid, blueprint, HP,
// fuel, cargo, refined ore, station), the bought slots per station and the templates. Maps as sorted
// pairs, so a save is canonical. A record's paint is always written (`paintOf`), but kept in memory
// only when it is not 'factory' (the in-memory form of an unpainted ship has no `paint`).
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import { createFleet, emptyShipLog, paintOf } from '../fleet/state';
import type { FleetState, ShipLog, ShipRecord, StoredShip } from '../fleet/types';
import type { HpMap } from '../ship/types';
import type { ShipTemplate, TemplatePart } from '../templates/types';
import { gridFromSave, gridToSave } from './gridSave';
import { hasRefined, refinedFromSave, refinedToSave } from './home';
import type { SavedFleetV16, SavedFleetV19, SavedShipLogV16, SavedShipRecordV19, SavedStoredShipV19, SavedTemplatePartV18, SavedTemplateV18 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const copyCargo = (c: Cargo): Cargo => {
  const out = {} as Cargo;
  for (const r of RESOURCE_IDS) out[r] = c[r];
  return out;
};

const copyLog = (l: ShipLog | SavedShipLogV16): ShipLog => ({ distance: l.distance, kills: l.kills, mined: l.mined, deaths: l.deaths, built: l.built });

const recordToSave = (r: ShipRecord): SavedShipRecordV19 => ({ id: r.id, name: r.name, nameIdx: r.nameIdx, log: copyLog(r.log), paint: paintOf(r) });
const recordFromSave = (r: SavedShipRecordV19): ShipRecord => ({
  id: r.id,
  name: r.name,
  nameIdx: r.nameIdx,
  log: copyLog(r.log),
  ...(r.paint !== 'factory' ? { paint: r.paint } : {}),
});

const hpToSave = (hp: HpMap): [number, number][] => [...hp].sort((a, b) => a[0] - b[0]).map(([id, v]) => [id, v]);

export function fleetToSave(f: FleetState): SavedFleetV19 {
  return {
    nextShipId: f.nextShipId,
    active: recordToSave(f.active),
    stored: [...f.stored]
      .sort((a, b) => a.record.id - b.record.id)
      .map(
        (s): SavedStoredShipV19 => ({
          record: recordToSave(s.record),
          stationId: s.stationId,
          grid: gridToSave(s.grid),
          blueprint: gridToSave(s.blueprint),
          hp: hpToSave(s.hp),
          fuel: s.fuel,
          cargo: copyCargo(s.cargo),
          refined: s.refined ? refinedToSave(s.cargo, s.refined) : {},
        }),
      ),
    slots: [...f.slots].filter(([, n]) => n > 0).sort((a, b) => byString(a[0], b[0])),
  };
}

export function fleetFromSave(s: SavedFleetV19): FleetState {
  return {
    nextShipId: s.nextShipId,
    active: recordFromSave(s.active),
    stored: s.stored.map(
      (x): StoredShip => ({
        record: recordFromSave(x.record),
        stationId: x.stationId,
        grid: gridFromSave(x.grid),
        blueprint: gridFromSave(x.blueprint),
        hp: new Map(x.hp.map(([id, v]) => [id, v])),
        fuel: x.fuel,
        cargo: copyCargo(x.cargo),
        // missing = nothing refined (the in-memory form of a stored ship without refined ore)
        ...(hasRefined(x.refined) ? { refined: refinedFromSave(x.cargo, x.refined) } : {}),
      }),
    ),
    slots: new Map(s.slots),
  };
}

/** Fresh tuples; a shaped part keeps its shape (index 4), an unshaped one stays a 4-tuple. */
const copyParts = (parts: readonly (TemplatePart | SavedTemplatePartV18)[]): TemplatePart[] =>
  parts.map((p): TemplatePart => (p.length === 5 ? [p[0], p[1], p[2], p[3], p[4]] : [p[0], p[1], p[2], p[3]]));

export const templatesToSave = (t: readonly ShipTemplate[]): SavedTemplateV18[] => t.map((x) => ({ name: x.name, parts: copyParts(x.parts) }));

export const templatesFromSave = (t: readonly SavedTemplateV18[]): ShipTemplate[] => t.map((x) => ({ name: x.name, parts: copyParts(x.parts) }));

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The fleet of a save before V16 (the 15 → 16 migration): the ship flown so far is record 1 with its
 * generated name, and its log is the whole game's stats (it is the only ship the player ever had).
 * Defensive about the unvalidated data – the validation runs after the migration.
 */
export function legacyFleet(seed: number, stats: unknown): SavedFleetV16 {
  const log = emptyShipLog();
  if (isObj(stats)) {
    log.distance = count(stats.distanceFlown);
    log.kills = count(stats.kills);
    log.deaths = count(stats.deaths);
    const mined = isObj(stats.mined) ? stats.mined : {};
    log.mined = RESOURCE_IDS.reduce((sum, r) => sum + count(mined[r]), 0);
  }
  // the V16 form: records without a paint (V19), nothing stored
  const fleet = fleetToSave(createFleet(seed, log));
  const { paint: _paint, ...active } = fleet.active;
  return { nextShipId: fleet.nextShipId, active, stored: [], slots: fleet.slots };
}

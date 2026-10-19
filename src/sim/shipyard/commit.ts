// Commit of a ship design in the simulation (spec M2, 7.3): verify → replay the ops → evaluate → apply at once.
import { ALL_PART_KEYS, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { fnv1aHex } from '../math/fnv1a';
import { maxHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import type { HpMap, ShipGrid } from '../ship/types';
import type { ActionError } from '../station/actions';
import { rebuiltDockPose } from '../station/dock';
import { addParts, ensureStorage, stationStorage, take, takeResources } from '../station/storage';
import type { StationDef } from '../world/stations';
import { evaluateDesign, shipyardContext, type DesignError } from './design';
import type { ShipyardDraft } from './draft';
import { replayOps } from './editor';

/**
 * Fingerprint of the ship and the parts storage – a draft made over another state is stale (`staleDraft`).
 * A shaped part adds `:s=<shape>` (SL2 E2); unshaped grids hash exactly as before shapes existed.
 */
export function shipyardHash(grid: ShipGrid, hp: HpMap, inventory: PartInventory): string {
  const parts = [...grid.parts]
    .sort((a, b) => a.id - b.id)
    .map((p) => `${p.id}:${p.partId}:${p.tier}:${p.x}:${p.y}:${p.rot}${p.loan ? ':loan' : ''}${p.shape !== undefined ? `:s=${p.shape}` : ''}`)
    .join(';');
  const hps = [...hp].sort((a, b) => a[0] - b[0]).map(([id, v]) => `${id}=${v}`).join(';');
  const inv = ALL_PART_KEYS.filter((k) => (inventory[k] ?? 0) > 0).map((k) => `${k}=${inventory[k]}`).join(';');
  return fnv1aHex(`${grid.nextId}|${parts}|${hps}|${inv}`);
}

/** The baseHash the editor sends in `shipyardCommit`. */
export const draftBaseHash = (draft: Pick<ShipyardDraft, 'base'>): string =>
  shipyardHash(draft.base.grid, draft.base.hp, draft.base.inventory);

/** Fingerprint of the current ship and the storage at the station. */
export const currentShipyardHash = (state: SimState, station: StationDef): string =>
  shipyardHash(state.player.grid, state.player.hp, stationStorage(state, station.id).parts);

const fail = (reqId: number, reason: ActionError, detail?: string): SimEvent[] => [
  detail === undefined ? { type: 'actionResult', reqId, ok: false, reason } : { type: 'actionResult', reqId, ok: false, reason, detail },
];

/** The first design error → the action's failure reason. */
function errorReason(error: DesignError): ActionError {
  switch (error.code) {
    case 'unaffordable':
      return 'notEnoughCredits';
    case 'missingResources':
      return 'notEnoughResources';
    case 'missingParts':
      return 'notAvailableHere';
    default:
      return 'invalidDesign';
  }
}

export function shipyardCommit(
  state: SimState,
  station: StationDef,
  action: Extract<GameAction, { type: 'shipyardCommit' }>,
): SimEvent[] {
  const { reqId } = action;
  if (!station.services.shipyard) return fail(reqId, 'serviceUnavailable');
  const player = state.player;
  const inventory = stationStorage(state, station.id).parts;
  if (action.baseHash !== shipyardHash(player.grid, player.hp, inventory)) return fail(reqId, 'staleDraft');

  const replay = replayOps(player.grid, action.ops);
  if (!replay.ok) return fail(reqId, 'invalidDesign', replay.error);

  const report = evaluateDesign(
    { base: { grid: player.grid, hp: player.hp, inventory }, grid: replay.grid, acquire: action.acquire },
    shipyardContext(state, station),
  );
  const first = report.errors[0];
  if (first || !report.props) return fail(reqId, first ? errorReason(first) : 'invalidDesign', first?.code);
  const { cost, props } = report;

  // --- apply (everything verified) ---
  state.credits -= cost.credits;
  takeResources(state, station.id, cost.resources);
  const storage = ensureStorage(state, station.id);
  for (const [key, n] of Object.entries(cost.fromStorage) as [PartKey, number][]) addParts(storage.parts, key, -n);
  for (const [key, n] of Object.entries(cost.toStorage) as [PartKey, number][]) addParts(storage.parts, key, n);
  // damaged parts without a repair are scrapped (M12, M13)
  for (const r of RESOURCE_IDS) storage.resources[r] += cost.scrap[r] ?? 0;

  const oldCoM = player.props.centerOfMass;
  const grid: ShipGrid = { parts: replay.grid.parts.map((p) => ({ ...p })), nextId: replay.grid.nextId };
  const ids = new Set(grid.parts.map((p) => p.id));
  // moved parts carry their HP, removed ones (repaired or scrapped) disappear; a part laid in a shape with
  // another max HP was at full HP (`reshapeDamaged` refuses the rest), so it starts at its new full HP
  const before = new Map(player.grid.parts.map((p) => [p.id, p]));
  for (const id of [...player.hp.keys()]) if (!ids.has(id)) player.hp.delete(id);
  for (const p of grid.parts) {
    const old = before.get(p.id);
    if (old && old.shape !== p.shape && maxHp(old) !== maxHp(p)) player.hp.delete(p.id);
  }
  player.grid = grid;
  player.gridVersion++;
  // the confirmed design is the new blueprint – later losses are measured against it (M3.8)
  player.blueprint = grid;
  player.props = props;
  player.fuel = Math.min(player.fuel, props.fuelCapacity);
  // in the dock the battery and the shield charge automatically (as in enterDocked – a docked save is canonical)
  player.energy = props.batteryCapacity;
  player.shield = props.shield.capacity;
  player.shieldDelay = 0;
  for (const r of RESOURCE_IDS) {
    const amount = cost.cargoMoves[r] ?? 0;
    if (amount <= 0) continue;
    take(player.cargo, r, amount);
    storage.resources[r] += amount;
  }
  player.body = rebuiltDockPose(station, player.body, oldCoM, props.centerOfMass, props.boundingRadius);
  player.prevBody = player.body;
  player.beams = [];

  const events: SimEvent[] = [
    { type: 'actionResult', reqId, ok: true },
    { type: 'shipRebuilt', cost: cost.credits, cargoToStorage: cost.cargoToStorage, fuelLost: cost.fuelLost },
  ];
  if (cost.credits > 0) events.push({ type: 'creditsChanged', delta: -cost.credits, reason: 'shipyard' });
  return events;
}

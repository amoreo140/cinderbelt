import type { DirectorEventKind } from '../data/events';
import type { HomeModuleId } from '../data/home';
import type { NoteIcon } from '../data/navigation';
import type { PaintId } from '../data/paints';
import type { RepFactionId } from '../data/factions';
import type { PartInventory, PartKey } from '../data/parts';
import type { Cargo, ResourceId } from '../data/resources';
import type { AcquireMode } from './shipyard/draft';
import type { EditorOp } from './shipyard/editor';
import type { Vec2 } from './math/vec2';
import type { FlightInput } from './ship/control';
import type { ShipId } from './fleet/types';
import type { TrophyId } from './home/types';
import type { TemplatePart } from './templates/types';
import type { LaneId } from './regions/lanes';

/** A discrete action from the station (spec M2, 7.1). The simulation returns reqId in actionResult. */
export type GameAction = { reqId: number } & (
  | { type: 'undock' }
  | { type: 'sellResource'; resource: ResourceId; qty: number | 'all'; from: 'ship' | 'storage' }
  /** Bought resources go to the station storage. */
  | { type: 'buyResource'; resource: ResourceId; qty: number }
  | { type: 'transfer'; resource: ResourceId; qty: number | 'all'; to: 'ship' | 'storage' }
  /** amount = fuel units. */
  | { type: 'refuel'; source: 'ice' | 'credits' | 'emergency'; amount: number | 'full' }
  /** Bought parts go to the station storage. */
  | { type: 'buyPart'; key: PartKey; count: number }
  /** Only parts in storage are sold (take mounted ones off in the shipyard first). */
  | { type: 'sellPart'; key: PartKey; count: number }
  /** Resources from storage first, then from the cargo; the result goes to storage. */
  | { type: 'craft'; key: PartKey; count: number }
  /**
   * Shipyard design commit: the editor operations against the ship with the fingerprint `baseHash`
   * (draftBaseHash) and the Craft / Buy choice for the missing parts.
   */
  | { type: 'shipyardCommit'; baseHash: string; ops: EditorOp[]; acquire: Partial<Record<PartKey, AcquireMode>> }
  /** Repair the chosen (or all) damaged parts; autoBuy = buy the missing material. */
  | { type: 'repair'; partIds: number[] | 'all'; autoBuy: boolean }
  /** Dev builds only – sets a mounted part's HP (for testing repairs). */
  | { type: 'debugDamage'; partId: number; hp: number }
  // --- career (M3.5a) ---
  /** Accept a slip from the board of the station the ship is docked at. */
  | { type: 'acceptContract'; offerId: string }
  /** Cancel a contract (also in flight) – free within 2 min with the slip returned, then "give up". */
  | { type: 'abandonContract'; contractId: number }
  /** Hand in a completed contract (a Delivery at the destination with the resources). */
  | { type: 'turnInContract'; contractId: number }
  /** Hand over resources for a faction's career assignment (from storage, then from the cargo). */
  | { type: 'deliverAssignment'; faction: RepFactionId }
  /** Courier (Guild 2): a transfer from the storage of station `from` to station `to` (also in flight). */
  | { type: 'courierSend'; from: string; to: string; resources: Partial<Cargo>; parts: PartInventory }
  /** Guild Training (M3.7): skip the rest – the remaining reward parts, the starter ship when docked (also in flight). */
  | { type: 'trainingSkip' }
  /** Guild Training: the player opened the map (M) or the objectives (G) – a checklist item. */
  | { type: 'trainingSeen'; what: 'map' | 'objectives' }
  // --- discoveries (M3.5b) ---
  /** Unlock an Archive node (Data from the fund, a threshold, credits) – docked. */
  | { type: 'archiveBuy'; node: string }
  // --- Cartography (sectors stage 2), docked at any station ---
  /** Sell the player's own chart of a sector to the Guild (credits; once per sector). */
  | { type: 'chartSell'; sector: string }
  /** Buy a Guild chart of a sector (Guarded or on a Guild Lane): Charted, stations discovered, neighbours Reported. */
  | { type: 'chartBuy'; sector: string }
  // --- Hangar and fleet (M4a, sim/fleet/actions.ts) ---
  // Docked at a station with a shipyard, not during the Guild Training, not while destroyed – except
  // `hangarRename` (anywhere, also in flight).
  /** Buy one hangar slot at this station (price by the slots bought so far: HANGAR.slotPrices). */
  | { type: 'hangarBuySlot' }
  /** Swap the active ship with the stored ship `shipId` standing here (the active ship takes its slot). */
  | { type: 'hangarSwitch'; shipId: ShipId }
  /**
   * Park the active ship in a free slot here and start a new ship from a cockpit alone: from this
   * station's storage, or bought / crafted like in the shipyard commit (`acquire`; omitted = storage only).
   */
  | { type: 'hangarNewShip'; cockpit: PartKey; acquire?: AcquireMode }
  /** Rename the active or a stored ship; null = back to the generated name (anywhere). */
  | { type: 'hangarRename'; shipId: ShipId; name: string | null }
  /** Take apart the stored ship `shipId` here: parts (repaired for the fee or scrapped) and cargo to storage. */
  | { type: 'hangarDismantle'; shipId: ShipId }
  // --- Ship templates (M4a, sim/templates/actions.ts), anywhere, capped by the Archive ---
  /** Save a template (normalised parts, see ShipTemplate) under `name` (sanitizeName). */
  | { type: 'templateSave'; name: string; parts: TemplatePart[] }
  /** Rename template `index` (position in `state.templates`). */
  | { type: 'templateRename'; index: number; name: string }
  | { type: 'templateDelete'; index: number }
  // --- World sites and events (M4b, sim/sites/actions.ts, sim/events/director.ts) ---
  /**
   * Take terminal item `item` (`TerminalOfferItem.index`) of derelict `site` while berthed there. For the
   * fabricator item `key` = the part to craft (≤ T2, materials from the ship's cargo, no fee).
   */
  | { type: 'derelictTake'; site: string; item: number; key?: PartKey }
  /** Leave the berth at a derelict (the terminal's "Disconnect"; F in flight does the same). */
  | { type: 'berthLeave' }
  /** Dev builds only (the game sends it only with `import.meta.env.DEV`): force a director event now. */
  | { type: 'debugEvent'; kind: DirectorEventKind }
  // --- Home station (M4c, sim/home) ---
  /** Build a home module, docked at the home station (credits, and resources for future modules). */
  | { type: 'homeBuild'; module: HomeModuleId }
  /** Paint a ship that is at home (the active ship docked there or a ship stored there); free. */
  | { type: 'paintShip'; shipId: ShipId; paint: PaintId }
  /** Pin / unpin a trophy on the trophy hall's pedestals. */
  | { type: 'trophyPin'; id: TrophyId; pinned: boolean }
  // --- Convoy trade (M4d, sim/convoys/trade.ts) – linked to a convoy trader (`convoys.link`) ---
  /** Buy the pass's rare item `slot` (0 plan fragment, 1 variant part, 2 T2 part / second variant). */
  | { type: 'convoyBuy'; slot: number }
  /** Sell ship cargo to the convoy (refined units first, ≤ the pass's cap). */
  | { type: 'convoySell'; resource: ResourceId; qty: number | 'all' }
  /** Buy fuel from the convoy's tanker. */
  | { type: 'convoyFuel'; amount: number | 'full' }
  /** Leave the link (the trade window's "Disconnect"; F in flight does the same). */
  | { type: 'convoyUnlink' }
  // --- Map notes (M4d, sim/navigation/notes.ts), anywhere, needs the Archive node "Map markers" ---
  /** A new note (no `id`) or an edit of note `id`. */
  | { type: 'mapNoteSet'; id?: number; pos: Vec2; icon: NoteIcon; text: string }
  | { type: 'mapNoteDelete'; id: number }
  /**
   * Dev builds only (the game sends it only with `import.meta.env.DEV`, like `debugEvent`): secure a lane's
   * relay sector now, materialise the nearest Watch ship, or move beside the nearest convoy (M4d).
   */
  | { type: 'debugGuild'; what: 'secure' | 'watch' | 'convoy'; lane?: LaneId }
);

export type GameActionType = GameAction['type'];

/** An action without reqId (the game adds it when sending). */
export type GameActionInput = GameAction extends infer A ? (A extends GameAction ? Omit<A, 'reqId'> : never) : never;

export interface PlayerCommand {
  flight: FlightInput;
  toggleDampers: boolean;
  /** H – tow to a station (in flight only, and only when the ship cannot fly – see `towAvailable`). */
  emergency: boolean;
  /**
   * Abandon the ship (C2, an option in the pause menu): the cockpit is destroyed and the usual death
   * sequence follows (events shipScuttled → partDestroyed → playerDestroyed). In flight only.
   */
  scuttle?: boolean;
  /** The world point the mouse aims at. */
  aim: Vec2;
  mining: boolean;
  /** Left button – fire the cannons (M3a). */
  fire: boolean;
  /** F – a new press in flight = a docking attempt. */
  dock: boolean;
  /** Tab held (M3.5b): a tap = a scanner pulse, holding = analysing an object. */
  scan?: boolean;
  /** T – a new press (M3.6): the tractor beam grabs the object under the cursor, or releases it. */
  tractor?: boolean;
  /** Answer to a toll demand (M3.6): Y pays, X refuses. */
  toll?: 'pay' | 'refuse';
  /** Station actions; processed in order at the start of the step. */
  actions: GameAction[];
}

export const IDLE_COMMAND: PlayerCommand = {
  flight: { forward: 0, strafe: 0, turn: 0 },
  toggleDampers: false,
  emergency: false,
  aim: { x: 0, y: 0 },
  mining: false,
  fire: false,
  dock: false,
  actions: [],
};

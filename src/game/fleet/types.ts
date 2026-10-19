// View models and UI handlers of M4a "Hangar and fleet": the contract
// between the game layer (T4 builds these from `SimState`, src/game/fleet/*View.ts) and the UI
// (T5 Hangar modal + Shipyard header, T6 Templates modal + DeathCard, T7 Storages ships).
// Every `reason` / label is a finished, translated text (`tx()`); a present `reason` means the action
// is disabled and the button shows why.
import type { PaintId } from '../../data/paints';
import type { PartKey, Tier } from '../../data/parts';
import type { ShipId, ShipLog } from '../../sim/fleet/types';
import type { HpMap, ShipGrid } from '../../sim/ship/types';
import type { AcquireMode } from '../../sim/shipyard/draft';
import type { TemplateDecodeError } from '../../sim/templates/types';
import type { StationId } from '../../sim/world/stations';
import type { Silhouette } from '../combatView';

// --- Hangar --------------------------------------------------------------------------------------

/** A cockpit the "New ship" action can start from at this station. */
export interface CockpitOption {
  key: PartKey;
  /** Where it comes from: this station's storage (free), bought here, or crafted here. */
  source: 'storage' | 'buy' | 'craft';
  /** Credits it costs (0 from storage; crafting = the credit part of the recipe, materials in the label). */
  price: number;
  /** The `acquire` to send with `hangarNewShip` (undefined for storage). */
  acquire?: AcquireMode;
  /** Disabled: why (not enough credits / materials, locked by the Archive, …). */
  reason?: string;
}

/** One ship card in the Hangar modal (the active ship first, then stored ships by id). */
export interface ShipCardView {
  id: ShipId;
  /** Display name: the custom name or the generated one in the current language. */
  name: string;
  /** The name is generated (rename shows an empty field with the generated name as placeholder). */
  generated: boolean;
  /** The active ship (`state.player`). */
  active: boolean;
  /** Station it stands at; for the active ship the station it is docked at (null in flight). */
  stationId: StationId | null;
  stationName: string | null;
  /** Stands at the station the player is docked at now. */
  here: boolean;
  /** Class / tier label from the cockpit ("T2 fighter" style, finished text). */
  tierLabel: string;
  /** Hull points used / the cockpit's budget (TRUP b). */
  hull: { used: number; budget: number };
  /** Total HP of the mounted parts as a share of their max (0..1). */
  hpPct: number;
  cargo: { used: number; cap: number };
  /** Fuel / tank capacity (0..1). */
  fuelPct: number;
  log: ShipLog;
  /** The ship's grid and HP (e.g. for a 3D preview); `silhouette` is the ready 2D drawing. */
  grid: ShipGrid;
  hp: HpMap;
  silhouette: Silhouette;
  /** The ship's paint (M4c; the paint chip on the card). */
  paint?: PaintId;
  /** "Switch" disabled: why (stands elsewhere, not docked at a shipyard, Training, …). Absent on the active card. */
  switchReason?: string;
  /** "Dismantle" (stored ships only): the repair fee, scrap value and why it is disabled. */
  dismantle?: { fee: number; scrap: number; reason?: string };
  /**
   * Leaving this (active) ship returns its Guild loan parts (`returned`), or dissolves it because
   * everything is on loan (`dissolved`) – the UI says so before confirming a switch / new ship.
   */
  loanNote?: 'returned' | 'dissolved';
}

export interface HangarView {
  /** The station the player is docked at (null in flight – the modal is not opened then). */
  stationId: StationId | null;
  /** The hangar cannot be used here at all (no shipyard, Training, destroyed): why. */
  reason?: string;
  slots: {
    /** Slots bought at this station. */
    here: number;
    /** Stored ships standing here. */
    usedHere: number;
    /** Slots bought in the whole game. */
    total: number;
    /** Most slots allowed (2, or 4 with "Hangar +2"). */
    cap: number;
    /** Price of the next slot (null at the cap). */
    nextPrice: number | null;
    /** "Buy a slot" disabled: why (cap, credits, …). */
    buyReason?: string;
  };
  ships: ShipCardView[];
  newShip: {
    cockpits: CockpitOption[];
    /** "New ship" disabled as a whole: why (no free slot here, …). */
    reason?: string;
  };
}

/** The Shipyard tab header (T5): the active ship's name, log line and the two modal buttons. */
export interface ShipHeaderView {
  id: ShipId;
  name: string;
  generated: boolean;
  log: ShipLog;
  /** Finished log line ("1,284 u · 3 kills · 920 u mined"). */
  logLine: string;
  /** "Hangar" button disabled: why (station without a shipyard, …). */
  hangarReason?: string;
  /** "Templates" button disabled: why ("Archive: Ship templates"). */
  templatesReason?: string;
}

export interface HangarHandlers {
  open(): void;
  close(): void;
  /** `hangarSwitch` (the UI confirms a `loanNote` first). */
  switch(shipId: ShipId): void;
  /** `hangarNewShip`. */
  newShip(cockpit: PartKey, acquire?: AcquireMode): void;
  /** `hangarBuySlot`. */
  buySlot(): void;
  /** `hangarRename`; null = back to the generated name. */
  rename(shipId: ShipId, name: string | null): void;
  /** `hangarDismantle` (the UI confirms the fee first). */
  dismantle(shipId: ShipId): void;
}

// --- Templates -----------------------------------------------------------------------------------

export interface TemplateItemView {
  /** Position in `state.templates` (the id of the template actions). */
  index: number;
  name: string;
  /** Number of parts. */
  parts: number;
  hullPoints: number;
  cockpitTier: Tier;
  /** Parts the player cannot buy or craft now (Archive / plan locks) – `Lamp warn` when > 0. */
  locked: number;
  /** "Build" disabled: why (not docked at a shipyard, …). */
  applyReason?: string;
  /** The template's design as a 2D drawing (all parts whole). */
  silhouette?: Silhouette;
}

export interface TemplatesView {
  /** Template slots (0 / 5 / 20 by the Archive). */
  cap: number;
  items: TemplateItemView[];
  /** "Save the current design" disabled: why (slots full, invalid draft, …). */
  saveReason?: string;
  /** Templates are locked by the Archive: why ("Archive: Ship templates"); the modal shows only this. */
  lockReason?: string;
}

/** Template source for "Save": the active ship's grid or the current shipyard draft. */
export type TemplateSource = 'ship' | 'draft';

export interface TemplateHandlers {
  open(): void;
  close(): void;
  /** `templateSave` of the normalised ship / draft under `name`. */
  save(name: string, source: TemplateSource): void;
  /** "Build from a template": loads the template as the shipyard draft (editor-side, no action) and closes the modal. */
  apply(index: number): void;
  /** `templateRename`. */
  rename(index: number, name: string): void;
  /** `templateDelete` (the UI confirms first). */
  delete(index: number): void;
  /** The export code of template `index` ("CB2.…"). */
  exportCode(index: number): string;
  /** Decodes and saves an imported code: null = sent as `templateSave`, otherwise the decode error. */
  importCode(code: string): TemplateDecodeError | null;
}

/** The death card's "Rebuild from a template" (T6): null = hide the action (no template). */
export type DeathTemplateView = { reason?: string } | null;

// --- Storages overview (I) -----------------------------------------------------------------------

/** A ship row in the Storages overview (T7 draws, T4 fills `StoragesData`). */
export interface StorageShipRow {
  id: ShipId;
  name: string;
  generated: boolean;
  active: boolean;
  stationId: StationId | null;
  stationName: string | null;
  /** Stands at the station the player is docked at. */
  here: boolean;
  tierLabel: string;
  hullPoints: number;
}

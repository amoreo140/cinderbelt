// View models of the M4b world sites and space events for the UI (M4b,
// §3, T0). T7 builds them from `SimState` (+ the
// director's `activeEvents`) in src/game/sites/*View.ts; T9 / T10 draw them. Every text is final here
// (already through `tx()`), the UI only lays it out.
import type { DerelictModel } from '../../data/sites';
import type { DirectorEventKind, EventTone } from '../../data/events';
import type { PartKey } from '../../data/parts';
import type { Cargo } from '../../data/resources';
import type { Vec2 } from '../../sim/math/vec2';
import type { DerelictService, SiteKind } from '../../sim/sites/types';

/** One HUD event chip (a small plate under the sector badge area; at most 2 shown: storm + one more). */
export interface EventChipItem {
  /** Stable key of the event (`ActiveEvent.key`) – the UI keys its plates by it. */
  key: string;
  kind: DirectorEventKind;
  /** "Micrometeor shower", "Ambush", "Comet K-3 in 2 min"… */
  title: string;
  /** Seconds until the event ends (or starts, during the warning lead); null = no timer. */
  secondsLeft: number | null;
  /** Direction arrow relative to the ship's bow (degrees, 0 = ahead, clockwise); null = no arrow. */
  dirDeg: number | null;
  tone: EventTone;
  /** The warning lead before the start (the chip blinks / says "o N s"). */
  pending: boolean;
}

/** The chips to show, most severe first (T7 orders them). */
export type EventChipData = readonly EventChipItem[];

/** A terminal item row. */
export interface TerminalItem {
  /** `derelictTake.item`. */
  index: number;
  /** "Reactor T2", "2 fragments of the Quickburn blueprint", "Free crafting"… */
  label: string;
  /** The part (stash) or none (plan fragments, fabricator). */
  key?: PartKey;
  taken: boolean;
  /** Why it cannot be taken now (hold full, taken…) – shown in warn; missing = it can be taken. */
  reason?: string;
}

/** A part the fabricator can make (≤ T2, craftable at a station), with its materials from the cargo. */
export interface FabOption {
  key: PartKey;
  /** Part name. */
  label: string;
  materials: Partial<Cargo>;
  /** Why it cannot be made (missing materials in the cargo…) – missing = it can. */
  reason?: string;
}

/** The derelict terminal modal (open exactly while berthed – Esc / "Unlink" leave the berth). */
export interface DerelictTerminalData {
  /** Derelict id. */
  id: string;
  /** Display name of the station ("Derelict station Rusty Sill"…). */
  name: string;
  model: DerelictModel;
  /** The station's one-time service (`TerminalOffer.service`) – the heading of the item rows (T9). */
  service?: DerelictService;
  /**
   * The journal log text of its model on the first visit; null when already read. The sim hands the
   * Data and the log out at the berth itself (`terminalOffer` then says null), so the game layer takes
   * both from that berth's `derelictVisited { id, data, journal }` event for the open terminal.
   */
  log: string | null;
  /** Data gained on this (first) visit; null = none. */
  data: number | null;
  items: TerminalItem[];
  /** The fabricator's choices when the service is the fabricator and not used yet; else null. */
  fabricator: FabOption[] | null;
  /** Free part-hold capacity (cargo units). */
  holdFree: number;
}

export interface TerminalHandlers {
  take(index: number): void;
  fabricate(key: PartKey): void;
  /** "Unlink" / Esc: leave the berth and close the terminal. */
  leave(): void;
}

/** A comet on the map: its pass arc once known, the nucleus now, the next pass near the player. */
export interface CometMapData {
  id: string;
  /** "Comet K-3". */
  name: string;
  /** Seen within radar or reached as a signal – the arc is drawn only then. */
  known: boolean;
  /** Pass arc in world space (empty when unknown). */
  arc: Vec2[];
  /** The nucleus now (null when away). */
  now: Vec2 | null;
  /** "Next pass near you: N min" (null = none within the search window). */
  nextPassMin: number | null;
}

/** A derelict or graveyard on the map / radar (known sites only). */
export interface SiteMapData {
  id: string;
  kind: SiteKind;
  pos: Vec2;
  /** Derelicts: relays powered (0–3). */
  relaysLit?: number;
}

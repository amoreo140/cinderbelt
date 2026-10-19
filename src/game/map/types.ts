// View models of the M4d map: the Guild layer (published convoys, Guild
// relays, live Watch ships), the route planner (S1), map notes and stale marks (S6). The game layer fills
// them (T9 `mapGuildView.ts`; T12 `routePlan.ts`, `noteView.ts`, `lastSeen.ts`), the map draws them (T12).
// The route and the stale marks are game-layer state (not saved); the notes come from the sim.
import type { NoteIcon } from '../../data/navigation';
import type { WatchKind } from '../../data/guild';
import type { Vec2 } from '../../sim/math/vec2';
import type { RelayStage } from '../../sim/guild/types';
import type { LaneId } from '../../sim/regions/lanes';
import type { RouteRisk } from '../../ui/sectors/sectorCardData';

export interface MapConvoy {
  pass: string;
  pos: Vec2;
  /** Heading (rad, world). */
  heading: number;
  lane: LaneId;
  /** Trade still open for the player this pass. */
  open: boolean;
  /** Seconds until it is nearest the ship (when it comes near), else absent. */
  eta?: number;
}

export interface MapRelay {
  pos: Vec2;
  lane: LaneId;
  stage: 'broken' | RelayStage;
  /** Known: the contract was offered or the sector is charted (else not drawn). */
  known: boolean;
}

export interface MapWatch {
  pos: Vec2;
  kind: WatchKind;
}

/** The Guild layer of the map (layer `convoys`). */
export interface MapGuildData {
  convoys: MapConvoy[];
  relays: MapRelay[];
  watch: MapWatch[];
}

/** The planned route from the ship to `to` (straight line). */
export interface RoutePlanData {
  to: Vec2;
  label: string;
  /** Straight-line distance (u). */
  distance: number;
  /** ETA for the current ship (s). */
  seconds: number;
  /** Fuel the trip needs and the fuel left on arrival. */
  fuel: number;
  fuelLeft: number;
  /** Missing fuel (units), or null when the tank reaches. */
  short: number | null;
  /** Dangerous / unknown sectors crossed (like the sector card's route home). */
  risks: Record<RouteRisk, number>;
  /** Range circles around the ship (u): one way (dashed) and round trip (solid). */
  rangeOneWay: number;
  rangeRound: number;
  /** The local condition fuel multiplier of the ship's sector when it is not 1 (T12 `routePlan`). */
  fuelMult?: number;
}

/** A map note as drawn (player text – plain text, never markup, never translated). */
export interface MapNoteView {
  id: number;
  pos: Vec2;
  icon: NoteIcon;
  text: string;
}

/** A faded mark where pirates / a comet nucleus were last seen. */
export interface StaleMark {
  pos: Vec2;
  kind: 'pirates' | 'comet';
  ageSeconds: number;
  /** 1 → STALE.minAlpha over STALE.fadeSeconds. */
  alpha: number;
}

/** The map's M4d data (the map fields of the HUD data). */
export interface MapPlanData {
  guild: MapGuildData | null;
  route: RoutePlanData | null;
  notes: MapNoteView[];
  stale: StaleMark[];
  /** The Archive node `mapNotes` is not bought: the note tool shows locked with the Archive hint (T12). */
  notesLocked?: boolean;
}

export interface MapPlanHandlers {
  /** Plan a route to `to` (right-click, "Trasa sem"). */
  route(to: Vec2, label: string): void;
  clearRoute(): void;
  /** A new note (no id) or an edit. */
  noteSet(note: { id?: number; pos: Vec2; icon: NoteIcon; text: string }): void;
  noteDelete(id: number): void;
}

// Events director contract (M4b plan §2.2, §3; DH §5.5). The director lists every space event for the
// radio and the HUD event chip: legacy (distress signals, ion storms – their old generators), rolled
// (micrometeor showers, ambushes – per seed, the player's sector and a 60 s bucket) and derived (comet
// flybys from the comet passes). Saved (T11): `director.last` and the one-shot keys `director.fired`.
import type { DirectorEventKind } from '../../data/events';
import type { EnemyKind } from '../combat/types';
import type { Vec2 } from '../math/vec2';

export type { DirectorEventKind, DirectorEventMode, EventTone, RolledEventKind } from '../../data/events';

/** An event the director lists now (warning lead included: `start` may lie in the future). */
export interface ActiveEvent {
  /**
   * Stable key: rolled `ev:<kind>:<sector>@<bucket>`, comet flyby `ev:comet:<id>@<pass>`, legacy
   * `ds:<cx>,<cy>@<bucket>` (distress id) / `ev:ionStorm:<ax>,<ay>@<bucket>`; a derelict's local storm
   * `ev:ionStorm:<derelict id>@<start tick>`.
   */
  key: string;
  kind: DirectorEventKind;
  /** Ticks [start, end). */
  start: number;
  end: number;
  /** Direction (rad, world): the micrometeor stream comes FROM this direction; the ambush bearing. */
  dir?: number;
  /** Sector id of a rolled event. */
  sector?: string;
  /** Where (distress signal, ambush party, comet nucleus at the closest approach). */
  pos?: Vec2;
  /**
   * Open-ended once started: the event lasts until something happens, not until `end` (an ambush while
   * its party lives – `end` = `start`). The chip shows no countdown then.
   */
  open?: boolean;
}

export interface DirectorState {
  /**
   * Tick the last director event ended (quiet window; -1e9 = never). Set to the planned end when a
   * rolled event fires, so it may lie in the future while the event runs (an ambush: its start, then the
   * tick its party was gone).
   */
  last: number;
  /**
   * One-shot keys → tick fired; a reload never fires them again and the running rolled events are
   * re-derived from them. Rolled (T1): `ev:micrometeors:<sector>@<bucket>`, `ev:ambush:<sector>@<bucket>`
   * plus the ambush markers `…#hail` (the toll hail was decided) and `…#end` (the party is gone); value =
   * the trigger tick (the warning; the event starts `leadSeconds` later). The director prunes its own keys
   * `DIRECTOR.pruneBuckets` buckets after their event is over, other owners' keys (comet flyby
   * `ev:comet:<id>@<pass>`, value = the tick its pass ends) `pruneBuckets` buckets after their value.
   */
  fired: Map<string, number>;
}

/** Sim events of the director (part of SimEvent). */
export type DirectorEvent =
  /** Radio / chip lead before an event (micrometeors 8 s with the direction, ambush 6 s, comet flyby ETA). */
  | { type: 'eventWarning'; key: string; kind: DirectorEventKind; inSeconds: number; dir?: number }
  | { type: 'eventStarted'; key: string; kind: DirectorEventKind; end: number; dir?: number; pos?: Vec2 }
  | { type: 'eventEnded'; key: string; kind: DirectorEventKind }
  /** A micrometeor hit the first part along its ray; `shielded` = the shield absorbed it (no part damage). */
  | { type: 'micrometeorHit'; pos: Vec2; partId: number; damage: number; shielded: boolean }
  /** An ambush party spawned (ids `ab:<sector>@<bucket>:<i>`). */
  | { type: 'ambushSpawned'; key: string; count: number; pos: Vec2; leader: EnemyKind };

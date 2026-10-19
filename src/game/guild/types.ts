// View models of the Guild status in flight (M4d): the escort chip (convoy hull
// bars, state, distance) and the relay contract stage hint. Built by T9 (src/game/guild/guildView.ts),
// drawn by T11 (src/ui/guild/GuildStatus.tsx). Every text is ready to show (i18n done).
//
// User decision 2026-10-16: no friendly fire – no hostility countdown, no warning, no fine.
import type { RelayStage } from '../../sim/guild/types';
import type { EscortState } from '../../sim/convoys/types';
import type { LaneId } from '../../sim/regions/lanes';

export interface GuildEscortStatus {
  /** Hull share 0..1 of each convoy ship (trader first). */
  hull: number[];
  state: EscortState['state'];
  /** Distance from the player to the trader (u). */
  distance: number;
  /** The next step ("Waiting at the rendezvous point", "Fly with the convoy"). */
  next: string;
}

export interface GuildRelayStatus {
  lane: LaneId;
  /** broken = not repaired yet. */
  stage: 'broken' | RelayStage;
  /** "Repair the relay: 60 Fe, 40 Cu, 10 Ti from the cargo", "Power it with the laser", "Defend the relay". */
  hint: string;
}

/** The Guild chips of the flight HUD; null fields = nothing to show. */
export interface GuildStatusData {
  escort: GuildEscortStatus | null;
  relay: GuildRelayStatus | null;
}

/**
 * Dev helpers of the Guild and convoys (`window.__cinder.guild`, dev builds only). Each sends the dev-only
 * `debugGuild` command and returns its reqId; the sim answers "unavailable" until T2 / T3 / T5 fill it
 * (T9 may add read helpers).
 */
export interface GuildDevHooks {
  /** Secure lane `lane`'s relay sector now (T2). */
  secure(lane: LaneId): number;
  /** Materialise the nearest scheduled Watch ship (T3). */
  watchNear(): number;
  /** Move the ship beside the nearest convoy pass (T5). */
  convoyNear(): number;
}

// The map's Guild layer (M4d T9, `MapGuildData`): the published convoy passes in flight, the
// Guild relay sites with their stage (drawn once known – offered, active or the sector Charted) and the
// Watch ships within the radar range. Built from the state by the game layer, drawn by T12 (mapGuild.ts).
import type { SimState } from '../../sim/Simulation';
import { mapConvoys } from '../convoys/convoyView';
import { mapRelays, watchNear } from '../guild/guildView';
import type { MapGuildData } from './types';

export function mapGuildData(state: SimState, radarRange: number): MapGuildData {
  return {
    convoys: mapConvoys(state),
    relays: mapRelays(state),
    watch: watchNear(state, state.player.body.pos, radarRange).map((w) => ({ pos: { x: w.pos.x, y: w.pos.y }, kind: w.kind })),
  };
}

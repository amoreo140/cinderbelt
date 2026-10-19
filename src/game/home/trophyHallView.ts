// Trophy hall view model (M4c T2): a card per trophy (defeated named captains, destroyed
// fortresses) and the six pedestals in `trophyShelf` order. Pure; `trophiesOf` builds new objects on
// every call, so the Development memo (developmentView.ts) decides when to rebuild these.
import { tx } from '../../i18n';
import { captainDef } from '../../sim/captains/captains';
import { trophiesOf, trophyShelf, type TrophyId, type TrophyItem } from '../../sim/home';
import { fortressById } from '../../sim/pirates/sites';
import { sectorInfoAt } from '../../sim/regions/sectors';
import type { SimState } from '../../sim/Simulation';
import { sectorName } from '../../ui/sectors/sectorText';
import { captainName, fortressLabel, partLabel } from '../board/names';
import type { TrophyCard, TrophyHallData } from './types';

function card(state: SimState, item: TrophyItem, pinned: boolean): TrophyCard {
  if (item.kind === 'captain' && item.captain !== null) {
    const def = captainDef(state.seed, item.captain);
    const replicas = item.replicas.map(partLabel);
    const clan = def ? tx().goals.factions[def.clan] : '';
    return { id: item.id, title: captainName(state.seed, item.captain), subtitle: tx().home.trophy.captain(clan, replicas), replicas, pinned };
  }
  const site = item.fortress !== null ? fortressById(state.seed, item.fortress) : null;
  const sector = site ? sectorName(sectorInfoAt(state.seed, site.pos.x, site.pos.y).name) : '';
  return { id: item.id, title: fortressLabel(item.id), subtitle: sector ? tx().home.trophy.fortress(sector) : '', replicas: [], pinned };
}

/** Every trophy as a card, in `trophiesOf` order (captains by defeat, then fortresses). */
export function trophyCards(state: SimState): TrophyCard[] {
  const pins = new Set<TrophyId>(state.home.trophyPins);
  return trophiesOf(state).map((t) => card(state, t, pins.has(t.id)));
}

/** The hall's pedestals and list (null until the trophy hall is built). */
export function trophyHallView(state: SimState): TrophyHallData | null {
  if (!state.home.modules.has('trophyHall')) return null;
  const all = trophyCards(state);
  const byId = new Map(all.map((c) => [c.id, c]));
  return { shelf: trophyShelf(state).map((id) => (id !== null ? (byId.get(id) ?? null) : null)), all };
}

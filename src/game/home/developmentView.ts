// Development tab view model of the home station (M4c T2): the module rows
// with their state and the reason they cannot be built, the Forge Index, the paint shop and the trophy
// hall. Pure functions of `SimState` + the tab's UI state; `createDevelopmentMemo` keeps the same object
// while nothing it shows changed (the trophy helpers build new objects on every call).
import { FORGE_INDEX_MAX, HOME_MODULE_IDS, HOME_MODULES, homeModuleIconPath, isBuildableModule, type HomeModuleId } from '../../data/home';
import { RESOURCE_IDS, type Cargo } from '../../data/resources';
import { getLocale, tx } from '../../i18n';
import { forgeIndex } from '../../sim/home';
import { dockedAtHome } from '../../sim/home/modules';
import type { SimState } from '../../sim/Simulation';
import { availableResources, isEmptyResources, missingResources } from '../../sim/station/storage';
import { HOME_STATION_ID } from '../../sim/world/stations';
import { formatCredits } from '../../ui/format';
import { amountText, resourceName } from '../board/names';
import { paintShopView, type PaintShopUi } from './paintShopView';
import { trophyCards, trophyHallView } from './trophyHallView';
import type { DevelopmentData, ModuleRow } from './types';

/** The Development tab's UI state (Game keeps it; never saved). */
export interface HomeUiState extends PaintShopUi {
  selected: HomeModuleId;
}

/** "200 Titanium" – the resources still missing, or null. */
function missingText(missing: Partial<Cargo>): string | null {
  if (isEmptyResources(missing)) return null;
  const list = RESOURCE_IDS.flatMap((r) => ((missing[r] ?? 0) > 0 ? [`${amountText(Math.ceil(missing[r]!))} ${resourceName(r)}`] : []));
  return list.join(', ');
}

/** Why a buyable module cannot be built now (undefined = it can). */
function buildReason(state: SimState, id: HomeModuleId): string | undefined {
  const def = HOME_MODULES[id];
  if (!dockedAtHome(state)) return tx().actionErrors.notHome;
  if (state.credits < def.credits) return tx().home.status.missingCredits(formatCredits(def.credits - state.credits));
  if (def.resources) {
    const list = missingText(missingResources(def.resources, availableResources(state, HOME_STATION_ID)));
    if (list) return tx().home.status.missingResources(list);
  }
  return undefined;
}

/** One row per home module, in the Rozvoj order. */
export function moduleRows(state: SimState): ModuleRow[] {
  return HOME_MODULE_IDS.map((id) => {
    const def = HOME_MODULES[id];
    const texts = tx().home.modules[id];
    const row: ModuleRow = { id, name: texts.name, effect: texts.effect, credits: def.credits, state: 'buyable', icon: homeModuleIconPath(id) };
    if (def.resources) row.resources = { ...def.resources };
    if (!isBuildableModule(id)) {
      row.state = 'future';
      if (def.since) {
        row.since = def.since;
        row.reason = tx().home.status.comesWith(def.since);
      }
    } else if (state.home.modules.has(id)) row.state = 'owned';
    else {
      const reason = buildReason(state, id);
      if (reason) row.reason = reason;
    }
    return row;
  });
}

/** The whole Development tab. */
export function developmentView(state: SimState, ui: HomeUiState): DevelopmentData {
  const hall = trophyHallView(state);
  return {
    forgeIndex: forgeIndex(state),
    forgeMax: FORGE_INDEX_MAX,
    modules: moduleRows(state),
    selected: ui.selected,
    paintShop: paintShopView(state, ui),
    trophyHall: hall,
    trophiesWithoutHall: hall ? [] : trophyCards(state),
  };
}

/** Everything the Development view model reads, as one comparable string. */
function inputsKey(state: SimState, ui: HomeUiState): string {
  const { home, fleet, player, career, pirates } = state;
  const dock = player.dock;
  const parts: (string | number | null)[] = [
    getLocale(),
    state.credits,
    dock.mode,
    dock.mode === 'docked' ? dock.stationId : '',
    [...home.modules].sort().join(','),
    home.trophyPins.join(','),
    ui.selected,
    ui.selectedShip,
    ui.preview,
  ];
  const ship = (r: { id: number; name: string | null; nameIdx: number; paint?: string }) => `${r.id}:${r.name ?? ''}:${r.nameIdx}:${r.paint ?? ''}`;
  parts.push(ship(fleet.active));
  for (const s of fleet.stored) parts.push(`${ship(s.record)}@${s.stationId}`);
  for (const t of career.trophies) parts.push(`c${t.captain}:${t.parts.join('+')}`);
  for (const [id, f] of pirates.fortresses) if (f.kills >= 1) parts.push(`f${id}`);
  // resources only matter for a buildable module that costs them (none in M4c)
  for (const id of HOME_MODULE_IDS) {
    const need = HOME_MODULES[id].resources;
    if (!need || !isBuildableModule(id) || home.modules.has(id)) continue;
    const have = availableResources(state, HOME_STATION_ID);
    parts.push(RESOURCE_IDS.map((r) => have[r]).join('/'));
    break;
  }
  return parts.join('|');
}

/**
 * A memoised `developmentView`: the same object back while the inputs (credits, modules, ships and
 * paints, trophies and pins, the UI state, the language) are unchanged.
 */
export function createDevelopmentMemo(): (state: SimState, ui: HomeUiState) => DevelopmentData {
  let last: { key: string; data: DevelopmentData } | null = null;
  return (state, ui) => {
    const key = inputsKey(state, ui);
    if (last?.key !== key) last = { key, data: developmentView(state, ui) };
    return last.data;
  };
}

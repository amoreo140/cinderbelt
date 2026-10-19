// Cartography actions (sectors stage 2): sell / buy a sector chart, docked at any station (every
// station has a Board). Atomic like every station action: a refused action changes nothing.
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import { buyChart, sellChart } from './charts';

const CHART_ACTIONS = new Set<GameAction['type']>(['chartSell', 'chartBuy']);
export const isChartAction = (a: GameAction): boolean => CHART_ACTIONS.has(a.type);

export function chartAction(state: SimState, action: GameAction): SimEvent[] {
  const { reqId } = action;
  if (action.type !== 'chartSell' && action.type !== 'chartBuy') return [{ type: 'actionResult', reqId, ok: false, reason: 'serviceUnavailable' }];
  if (state.player.dock.mode !== 'docked') return [{ type: 'actionResult', reqId, ok: false, reason: 'notDocked' }];
  const events: SimEvent[] = [];
  const error = action.type === 'chartSell' ? sellChart(state, action.sector, events) : buyChart(state, action.sector, events);
  if (error) return [{ type: 'actionResult', reqId, ok: false, reason: error }];
  return [{ type: 'actionResult', reqId, ok: true }, ...events];
}

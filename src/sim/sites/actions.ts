// Site actions (M4b plan §2.4) – OWNED BY T4: `derelictTake { site, item, key? }` and `berthLeave` while
// berthed at a derelict (the ship is not docked at a station, so Simulation routes these before the
// "notDocked" check). Every action answers with one `actionResult`.
//
// derelictTake: berthed at exactly that derelict (else `notBerthed`); a valid item index of its terminal
// offer (else `serviceUnavailable`); not taken yet (`itemTaken` – the bitmask survives save / load);
//   - part (stash): room in the part hold (`holdFull`) → the part to `player.salvage`;
//   - fragments (plan): `awardFragment` × count (no hold use);
//   - fabricate: `key` = the part (`unknownPart` / `partLocked` / `noMaterials` / `holdFull`) → its recipe's
//     materials leave the ship's cargo, no credits, the part to `player.salvage`.
// The item's bit is set, `derelictTaken` is sent. berthLeave: `notBerthed` unless berthed, else undock.
import { RECIPES } from '../../data/economy';
import { RESOURCE_IDS } from '../../data/resources';
import { DERELICT } from '../../data/sites';
import { awardFragment } from '../discovery/plans';
import type { GameAction } from '../commands';
import type { SimEvent, SimState } from '../Simulation';
import type { ActionError } from '../station/actions';
import { leaveBerth } from './berth';
import { derelictState, setDerelictState } from './derelict';
import { fabricateBlocker, partHoldFree, terminalOffer } from './terminal';
import type { TakenWhat } from './types';

const SITE_ACTIONS = new Set<GameAction['type']>(['derelictTake', 'berthLeave']);

export const isSiteAction = (a: GameAction): boolean => SITE_ACTIONS.has(a.type);

const ok = (reqId: number): SimEvent => ({ type: 'actionResult', reqId, ok: true });
const fail = (reqId: number, reason: ActionError): SimEvent[] => [{ type: 'actionResult', reqId, ok: false, reason }];

/** Runs a site action (`isSiteAction`); always answers with an `actionResult`. */
export function siteAction(state: SimState, action: GameAction): SimEvent[] {
  if (action.type === 'berthLeave') {
    const events: SimEvent[] = [];
    if (!leaveBerth(state, events)) return fail(action.reqId, 'notBerthed');
    return [ok(action.reqId), ...events];
  }
  if (action.type === 'derelictTake') return take(state, action);
  return fail(action.reqId, 'serviceUnavailable');
}

function take(state: SimState, action: Extract<GameAction, { type: 'derelictTake' }>): SimEvent[] {
  const { reqId, site: id, item } = action;
  if (state.sites.berth === null || state.sites.berth !== id) return fail(reqId, 'notBerthed');
  const offer = terminalOffer(state, id);
  const entry = Number.isInteger(item) ? offer?.items.find((i) => i.index === item) : undefined;
  if (!offer || !entry) return fail(reqId, 'serviceUnavailable');
  if (entry.taken) return fail(reqId, 'itemTaken');
  const { player } = state;
  const events: SimEvent[] = [];
  let what: TakenWhat;
  switch (entry.what.kind) {
    case 'part': {
      if (partHoldFree(state) + 1e-9 < DERELICT.itemCargo) return fail(reqId, 'holdFull');
      const key = entry.what.key;
      player.salvage[key] = (player.salvage[key] ?? 0) + 1;
      what = { kind: 'part', key };
      break;
    }
    case 'fragments': {
      const { plan, count } = entry.what;
      for (let i = 0; i < count; i++) awardFragment(state, plan, events);
      what = { kind: 'fragments', plan, count };
      break;
    }
    case 'fabricate': {
      const key = action.key;
      const blocker = fabricateBlocker(state, key);
      if (blocker || key === undefined) return fail(reqId, blocker ?? 'unknownPart');
      const need = RECIPES[key].resources;
      for (const r of RESOURCE_IDS) player.cargo[r] = Math.max(0, player.cargo[r] - (need[r] ?? 0));
      player.salvage[key] = (player.salvage[key] ?? 0) + 1;
      state.stats.partsCrafted += 1;
      what = { kind: 'crafted', key };
      break;
    }
  }
  setDerelictState(state, id, { taken: derelictState(state, id).taken | (1 << item) });
  return [ok(reqId), ...events, { type: 'derelictTaken', id, item, what }];
}

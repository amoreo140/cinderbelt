// Pure text and layout helpers of the Hangar modal and the Shipyard header (M4a T5). The view models
// (src/game/fleet/types.ts) carry finished reasons; this formats what the UI composes itself: the
// ship log line, the slot summary, the card order with free / next slots, the cockpit option line.
import type { CockpitOption, HangarHandlers, HangarView, ShipCardView } from '../../game/fleet/types';
import { tx } from '../../i18n';
import { formatCredits, formatInt } from '../format';
import type { ShipLog } from '../../sim/fleet/types';

/**
 * The ship log as one line: "1 284 u flown · 3 kills · 920 u mined · 1 destruction".
 * Distance always (it is the ship's age), the rest only when non-zero; an untouched ship says so.
 */
export function shipLogLine(log: ShipLog): string {
  const t = tx().fleet.log;
  const unit = tx().units.unit;
  const distance = Math.floor(log.distance);
  const mined = Math.floor(log.mined);
  if (distance <= 0 && log.kills <= 0 && mined <= 0 && log.deaths <= 0) return t.empty;
  const parts = [t.distance(`${formatInt(distance)} ${tx().hud.distanceUnit}`)];
  if (log.kills > 0) parts.push(t.kills(log.kills));
  if (mined > 0) parts.push(t.mined(`${formatInt(mined)} ${unit}`));
  if (log.deaths > 0) parts.push(t.deaths(log.deaths));
  return parts.join(' · ');
}

/** Slot summary of the modal head: "1 / 2 occupied" and "2 of 4 in the whole game". */
export function slotSummary(slots: HangarView['slots']): { here: string; game: string } {
  const t = tx().fleet.hangar;
  return { here: t.slotsHere(slots.usedHere, slots.here), game: t.slotsGame(slots.total, slots.cap) };
}

/** One entry of the hangar's card list. */
export type HangarEntry =
  | { kind: 'ship'; ship: ShipCardView }
  /** A bought slot here without a ship. */
  | { kind: 'free'; index: number }
  /** The slot the player could buy next (price), or the locked one at the cap (reason). */
  | { kind: 'next'; price: number | null; reason?: string };

/**
 * Cards in order: the active ship, the ships standing here, the ships elsewhere (each group by the
 * view model's order), the free slots here, then the next slot (buyable or locked).
 */
export function hangarEntries(view: HangarView): HangarEntry[] {
  const active = view.ships.filter((s) => s.active);
  const here = view.ships.filter((s) => !s.active && s.here);
  const away = view.ships.filter((s) => !s.active && !s.here);
  const out: HangarEntry[] = [...active, ...here, ...away].map((ship) => ({ kind: 'ship', ship }));
  const free = Math.max(0, view.slots.here - view.slots.usedHere);
  for (let i = 0; i < free; i++) out.push({ kind: 'free', index: i });
  const next: HangarEntry = { kind: 'next', price: view.slots.nextPrice };
  if (view.slots.buyReason !== undefined) next.reason = view.slots.buyReason;
  out.push(next);
  return out;
}

/** Ships standing at this station in slots (the active ship not counted). */
export const storedHere = (view: HangarView): number => view.ships.filter((s) => !s.active && s.here).length;

/** The hub overview's hangar line, or null when there is nothing to say (no slot, no ship here). */
export function hubHangarLine(view: HangarView): string | null {
  const t = tx().fleet.hangar.overview;
  const ships = storedHere(view);
  const free = Math.max(0, view.slots.here - view.slots.usedHere);
  if (ships === 0 && view.slots.here === 0) return null;
  const parts: string[] = [];
  if (ships > 0) parts.push(t.ships(ships));
  if (free > 0) parts.push(t.freeSlots(free));
  return parts.length > 0 ? parts.join(' · ') : t.empty;
}

/** Where a ship stands, for its card: here / at another station / in flight (active ship). */
export function shipWhere(ship: ShipCardView): string {
  const t = tx().fleet.hangar;
  if (ship.here) return t.here;
  if (ship.stationName) return t.standsAt(ship.stationName);
  return t.inFlight;
}

/** "from storage · free" / "buy · 1 200 cr" / "build · 300 cr" for a cockpit option. */
export function cockpitSourceLine(option: CockpitOption): { source: string; price: string } {
  const t = tx().fleet.hangar.newShip;
  return { source: t.source[option.source], price: option.price > 0 ? formatCredits(option.price) : t.free };
}

/**
 * The rename field's value as the handler takes it: trimmed, empty = null (back to the generated
 * name). The simulation sanitises again (control characters, length); this only decides "empty".
 */
export function renameValue(raw: string): string | null {
  const v = raw.trim();
  return v.length === 0 ? null : v;
}

/** The handlers plus the hub's click sound. */
export type HangarOn = HangarHandlers & { click?(): void };

/** Binds `h` (an object or a class instance) and the click sound into the modal's handlers. */
export function bindHangar(h: HangarHandlers, click?: () => void): HangarOn {
  return {
    open: () => h.open(),
    close: () => h.close(),
    switch: (id) => h.switch(id),
    newShip: (cockpit, acquire) => h.newShip(cockpit, acquire),
    buySlot: () => h.buySlot(),
    rename: (id, name) => h.rename(id, name),
    dismantle: (id) => h.dismantle(id),
    ...(click ? { click } : {}),
  };
}

// Scan HUD readouts of the M4b world sites (§2.4, §2.5, §2.3; T10): what the scanner tells about
// a derelict station (its relays, the defence, the dock clamp), a relay (powered, charging, how to power
// it), a comet nucleus (composition and what is left in this pass – within the assay reach, ×2 with the
// "Vein analyser") and a graveyard sleeper ("active reactor"). Every text is final (through `tx()`).
import { COMET, RELAY } from '../../data/sites';
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import { cometById, derelictState, relayById, relayCharge, siteById } from '../../sim/sites';
import { cometReadout } from '../../sim/sites/comets';
import type { SimState } from '../../sim/Simulation';
import { cometName } from './cometMapView';

export type ReadoutTone = 'info' | 'ok' | 'warn';

export interface ScanReadoutLine {
  text: string;
  tone: ReadoutTone;
}

/** A readout plate by the scanner widget. */
export interface ScanReadout {
  /** The object it belongs to (the UI keys the plate by it). */
  key: string;
  title: string;
  lines: ScanReadoutLine[];
  /** A relay's charge 0..1 while a beam charges it (a bar under the lines); null = no bar. */
  charge: number | null;
}

const pct = (share: number): number => Math.round(share * 100);

/** Powered relays of a derelict. */
function litRelays(state: SimState, derelictId: string): number {
  const site = siteById(state.seed, derelictId);
  return site?.kind === 'derelict' ? site.relays.filter((r) => state.sites.powered.has(r.id)).length : 0;
}

function derelictReadout(state: SimState, id: string): ScanReadout | null {
  const site = siteById(state.seed, id);
  if (site?.kind !== 'derelict') return null;
  const m = tx().world.map;
  const lit = litRelays(state, id);
  const woke = derelictState(state, id).woke !== null;
  const armed = site.defence !== 'none';
  return {
    key: id,
    title: m.derelict,
    lines: [
      { text: m.relays(lit, RELAY.count), tone: lit >= RELAY.count ? 'ok' : 'info' },
      { text: m.scan.defence(tx().world.derelict.defence[site.defence]) + (armed && woke ? ` · ${m.scan.awake}` : ''), tone: armed ? 'warn' : 'info' },
      lit >= RELAY.count ? { text: m.scan.clampReady, tone: 'ok' } : { text: m.scan.clampDark, tone: 'info' },
    ],
    charge: null,
  };
}

function relayReadout(state: SimState, id: string): ScanReadout | null {
  const relay = relayById(state.seed, id);
  if (!relay) return null;
  const m = tx().world.map;
  const lit = litRelays(state, relay.group);
  const title = m.relay;
  if (state.sites.powered.has(id)) return { key: id, title, lines: [{ text: m.scan.relayPowered(lit, RELAY.count), tone: 'ok' }], charge: null };
  const charge = relayCharge(state, id);
  if (charge > 0) return { key: id, title, lines: [{ text: tx().world.derelict.relayState(lit, RELAY.count, pct(charge)), tone: 'info' }], charge };
  return {
    key: id,
    title,
    lines: [
      { text: m.relays(lit, RELAY.count), tone: 'info' },
      { text: m.scan.relayIdle, tone: 'info' },
    ],
    charge: null,
  };
}

function cometPlate(state: SimState, id: string): ScanReadout | null {
  const r = cometReadout(state, id);
  if (!r) return null;
  const c = tx().world.comet;
  const n = Number(id.slice(3));
  return {
    key: id,
    title: cometName(Number.isFinite(n) ? n : 0),
    lines: [
      { text: c.composition(pct(r.mix.ice ?? 0), pct(r.mix.titanium ?? 0), String(Math.floor(r.core))), tone: r.core > 0 ? 'ok' : 'info' },
      { text: c.shards(r.shardsLeft, COMET.tail.shards), tone: 'info' },
      // match its speed to mine on the move
      { text: c.speed(String(Math.round(cometById(state.seed, id)?.speed ?? 0))), tone: 'info' },
    ],
    charge: null,
  };
}

/** A sleeper of a graveyard (`gs:…`) that the scanner analysed: still dormant = "active reactor". */
function sleeperReadout(state: SimState, id: string): ScanReadout | null {
  const enemy = state.combat.enemies.find((e) => e.id === id);
  if (!enemy || !state.discovery.scanned.has(id)) return null;
  const g = tx().world.graveyard;
  return {
    key: id,
    title: tx().discovery.scanKinds.wreck,
    lines: [
      { text: g.activeReactor, tone: 'warn' },
      { text: g.sleeperHint, tone: 'warn' },
    ],
    charge: null,
  };
}

/** The readout of a site object by its key (null = not a site object, gone or out of reach). */
export function siteReadout(state: SimState, key: string): ScanReadout | null {
  if (/^dl:-?\d+,-?\d+$/.test(key)) return derelictReadout(state, key);
  if (key.startsWith('dl:')) return relayReadout(state, key);
  if (key.startsWith('cm:')) return cometPlate(state, key);
  if (key.startsWith('gs:')) return sleeperReadout(state, key);
  return null;
}

/** Where a site object of a readout is now (null = gone); a comet's reach is checked by `cometReadout`. */
function objectPos(state: SimState, key: string): Vec2 | null {
  if (key.startsWith('dl:')) return (/^dl:-?\d+,-?\d+$/.test(key) ? siteById(state.seed, key)?.pos : relayById(state.seed, key)?.pos) ?? null;
  if (key.startsWith('gs:')) return state.combat.enemies.find((e) => e.id === key)?.body.pos ?? null;
  return key.startsWith('cm:') ? state.player.body.pos : null;
}

/** The pinned readout's object is still within `reach` of the ship (else the plate goes). */
export function readoutInReach(state: SimState, key: string, reach: number): boolean {
  const p = objectPos(state, key);
  const s = state.player.body.pos;
  return p !== null && Math.hypot(p.x - s.x, p.y - s.y) <= reach;
}

/** Keys whose analysis leaves a readout plate (the scanner's `analysisDone` target). */
export const isSiteReadoutKey = (key: string): boolean => key.startsWith('dl:') || key.startsWith('cm:') || key.startsWith('gs:');

/**
 * The plate to show now: a relay a beam is charging (live), else the last analysed site object while it
 * is in reach (the caller drops `pinned` once the object leaves the analysis reach), else a known comet
 * whose composition the scanner can read.
 */
export function currentReadout(state: SimState, pinned: string | null): ScanReadout | null {
  const charging = state.sites.charge;
  if (charging) {
    const r = siteReadout(state, charging.id);
    if (r) return r;
  }
  if (pinned) {
    const r = siteReadout(state, pinned);
    if (r) return r;
  }
  // two comets in reach at once are rare – the first known one
  for (const id of state.discovery.known) {
    if (!id.startsWith('cm:')) continue;
    const r = cometPlate(state, id);
    if (r) return r;
  }
  return null;
}

// Validation of the Guild in save V20 (M4d "Guild and Trade") – the same style as validate.ts: a clean
// copy, errors with paths. Two passes:
//
// - shape (with the rest of the save): relay records (known lanes, one per lane, known stages), the hold,
//   the live Watch ships (ids `gw:<route>|<slot>` that match their route and slot, known kinds and modes,
//   finite numbers, no duplicates), the lost Watch ids and the radio tick – a malformed value rejects the
//   save. Ship numbers above the (tunable) ship data – hull, shield, shield delay, gun cooldowns – are
//   clamped (`capacityClamped`), a cooldown list of another length follows the kind's guns.
// - repair (`repairGuild`, after the sites): checked against this seed. The relay sites are tunable, so a
//   record of a lane without a site, or of a sector that does not exist or is not statically Contested, is
//   dropped; a powered / secured lane lights its mast in `sites.powered`, a lit mast without a record
//   becomes `powered` (the hold runs again – a V19 game could light it but not save the stage); a hold
//   of a lane that is not powered ends; ticks in the future are cut to the save tick; a relay slip of a
//   lane without a site leaves the board. Nothing here rejects the save (warning `sitesRepaired`).
import { WATCH, WATCH_KINDS, type WatchKind } from '../../data/guild';
import { guildRelayId, guildRelaySite } from '../guild/relaySites';
import { RELAY_STAGES, WATCH_MODES, type RelayStage, type WatchMode } from '../guild/types';
import { parseWatchId, watchId } from '../guild/watchRoutes';
import type { LaneId } from '../regions/lanes';
import { sectorInfo } from '../regions/sectors';
import type { SavedGuildV20, SavedRelayHoldV20, SavedRelayRecordV20, SavedWatchShipV20, SaveGame } from './types';
import type { Checker } from './validate';

const LANES: readonly LaneId[] = ['A', 'B'];
const HOLD_PHASES: readonly SavedRelayHoldV20['phase'][] = ['warning', 'fight', 'idle'];
/** A schedule route of a live Watch ship: a lane loop, a sector patrol or a relay hold's reinforcement. */
const ROUTE_ID = /^(lane:[AB]:\d+|sector:-?\d+,-?\d+|relay:[AB])$/;
/** More live Watch ships than this is nonsense (`WATCH.maxLive` + a relay reinforcement, with a margin). */
const MAX_WATCH = 16;
/** "Never" of the radio tick (sim/guild/state). */
const NEVER = -1e9;

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function watchShip(c: Checker, v: unknown, path: string): SavedWatchShipV20 {
  const o = c.obj(v, path) ?? {};
  const id = c.str(o.id, `${path}.id`, true);
  const kind = c.oneOf<WatchKind>(o.kind, WATCH_KINDS, `${path}.kind`);
  const route = c.str(o.route, `${path}.route`, true);
  if (route && !ROUTE_ID.test(route)) c.err(`${path}.route`, 'expected a Watch route id');
  const slot = c.int(o.slot, `${path}.slot`, 0, 63);
  if (id && (parseWatchId(id) === null || id !== watchId(route, slot))) c.err(`${path}.id`, 'expected gw:<route>|<slot> of the ship');
  const def = WATCH.ships[kind];
  // the guns are tunable: a list of another length follows the kind's guns (missing ones ready to fire)
  const raw = c.arr(o.cooldowns, `${path}.cooldowns`) ?? [];
  if (raw.length !== def.guns.length) c.clamped.push(`${path}.cooldowns`);
  const cooldowns = def.guns.map((gun, i) => (i < raw.length ? c.capped(raw[i], `${path}.cooldowns[${i}]`, 0, 1 / gun.rate) : 0));
  const target = o.target === null ? null : c.str(o.target, `${path}.target`, true);
  return {
    id,
    kind,
    body: c.body(o.body, `${path}.body`),
    hull: c.capped(o.hull, `${path}.hull`, 0, def.hull),
    shield: c.capped(o.shield, `${path}.shield`, 0, def.shield),
    shieldDelay: c.capped(o.shieldDelay, `${path}.shieldDelay`, 0, def.shieldDelay),
    cooldowns,
    mode: c.oneOf<WatchMode>(o.mode, WATCH_MODES, `${path}.mode`),
    target,
    route,
    slot,
    modeTick: c.tick(o.modeTick, `${path}.modeTick`),
    lastHitBy: c.int(o.lastHitBy, `${path}.lastHitBy`, -1),
  };
}

/** Structure of `guild` (V20). */
export function validateGuildShape(c: Checker, raw: unknown, path: string): SavedGuildV20 {
  const o = c.obj(raw, path) ?? {};
  const relays: [LaneId, SavedRelayRecordV20][] = [];
  (c.arr(o.relays, `${path}.relays`) ?? []).forEach((entry, i) => {
    const p = `${path}.relays[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [lane, record]');
    const lane = c.oneOf<LaneId>(entry[0], LANES, `${p}[0]`);
    if (relays.some(([l]) => l === lane)) return c.err(p, 'duplicate lane');
    const r = c.obj(entry[1], `${p}[1]`) ?? {};
    relays.push([
      lane,
      { stage: c.oneOf<RelayStage>(r.stage, RELAY_STAGES, `${p}[1].stage`), sector: c.str(r.sector, `${p}[1].sector`, true), tick: c.tick(r.tick, `${p}[1].tick`) },
    ]);
  });
  let hold: SavedRelayHoldV20 | null = null;
  if (o.hold !== null) {
    const h = c.obj(o.hold, `${path}.hold`) ?? {};
    hold = {
      lane: c.oneOf<LaneId>(h.lane, LANES, `${path}.hold.lane`),
      start: c.tick(h.start, `${path}.hold.start`),
      phase: c.oneOf(h.phase, HOLD_PHASES, `${path}.hold.phase`),
      reinforced: c.bool(h.reinforced, `${path}.hold.reinforced`),
    };
  }
  const list = c.arr(o.watch, `${path}.watch`) ?? [];
  if (list.length > MAX_WATCH) c.err(`${path}.watch`, 'too many live Watch ships');
  const watch = list.map((x, i) => watchShip(c, x, `${path}.watch[${i}]`));
  if (new Set(watch.map((w) => w.id)).size !== watch.length) c.err(`${path}.watch`, 'duplicate ship ids');
  const lost: [string, number][] = [];
  (c.arr(o.lost, `${path}.lost`) ?? []).forEach((entry, i) => {
    const p = `${path}.lost[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [id, tick]');
    const id = c.str(entry[0], `${p}[0]`, true);
    if (id && parseWatchId(id) === null) c.err(`${p}[0]`, 'expected a Watch ship id');
    lost.push([id, c.tick(entry[1], `${p}[1]`)]);
  });
  if (new Set(lost.map(([id]) => id)).size !== lost.length) c.err(`${path}.lost`, 'duplicate ids');
  return {
    relays: relays.sort((a, b) => byString(a[0], b[0])),
    hold,
    watch,
    lost: lost.sort((a, b) => byString(a[0], b[0])),
    lastRadio: c.tick(o.lastRadio, `${path}.lastRadio`, NEVER),
  };
}

/**
 * Checks the shape-valid Guild of a save against its seed and repairs it in place (see the header).
 * Runs after `repairSites` (it may light Guild masts in `sites.powered`). Returns the repaired paths.
 */
export function repairGuild(save: SaveGame): string[] {
  const { seed, tick } = save;
  const g = save.guild;
  const repaired: string[] = [];

  g.relays = g.relays.filter(([lane, r], i) => {
    const site = guildRelaySite(seed, lane);
    const info = sectorInfo(seed, r.sector);
    const ok = site !== null && info !== null && info.security === 'contested';
    if (!ok) repaired.push(`guild.relays[${i}]`);
    return ok;
  });
  g.relays.forEach(([, r], i) => {
    if (r.tick > tick) {
      r.tick = tick;
      repaired.push(`guild.relays[${i}].tick`);
    }
  });
  const powered = new Set(save.sites.powered);
  let lit = false;
  for (const lane of LANES) {
    const site = guildRelaySite(seed, lane);
    if (!site) continue;
    const id = guildRelayId(lane);
    const rec = g.relays.find(([l]) => l === lane)?.[1];
    if ((rec?.stage === 'powered' || rec?.stage === 'secured') && !powered.has(id)) {
      powered.add(id);
      lit = true;
    } else if (!rec && powered.has(id)) {
      g.relays.push([lane, { stage: 'powered', sector: site.sector, tick }]);
      repaired.push(`guild.relays.${lane}`);
    }
  }
  if (lit) {
    save.sites.powered = [...powered].sort();
    repaired.push('sites.powered');
  }
  g.relays.sort((a, b) => byString(a[0], b[0]));

  if (g.hold && g.relays.find(([l]) => l === g.hold!.lane)?.[1].stage !== 'powered') {
    g.hold = null;
    repaired.push('guild.hold');
  }

  // ticks of the past: a Watch ship's mode and last hit, the lost ids, the radio
  g.watch.forEach((w, i) => {
    if (w.modeTick > tick || w.lastHitBy > tick) {
      w.modeTick = Math.min(w.modeTick, tick);
      w.lastHitBy = Math.min(w.lastHitBy, tick);
      repaired.push(`guild.watch[${i}]`);
    }
  });
  g.lost.forEach((entry, i) => {
    if (entry[1] > tick) {
      entry[1] = tick;
      repaired.push(`guild.lost[${i}]`);
    }
  });
  if (g.lastRadio > tick) {
    g.lastRadio = tick;
    repaired.push('guild.lastRadio');
  }

  // a relay slip of a lane this seed has no relay site for
  save.career.boards.forEach(([, board], b) => {
    const before = board.offers.length;
    board.offers = board.offers.filter((offer) => offer.target.kind !== 'relay' || guildRelaySite(seed, offer.target.lane) !== null);
    if (board.offers.length !== before) repaired.push(`career.boards[${b}].offers`);
  });
  return repaired;
}

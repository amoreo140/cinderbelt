// Validation of the world sites and the events director in save V17 (M4b "World Comes Alive") – same style as
// validate.ts: a clean copy, errors with paths.
//
// Two passes. The shape pass (`validateSitesShape`, `validateDirectorShape`) rejects malformed data. The
// repair pass (`repairSites`) checks every id against this seed's generator: site placement and its
// numbers are tunable (T15 retunes the densities), so a derelict, graveyard, comet, relay or mine the
// generator no longer has is dropped, bitmasks are cut to the site's size and counters clamped – the save
// loads with a `sitesRepaired` warning instead of being rejected. The Guild relay masts `gr:<lane>` (M4d,
// V20) are relays of this seed's `guildRelaySites` like any other (`relayById`). The same goes for the
// enemies of the sites (sentries `dd:`, sleepers `gs:`, ambush parties `ab:`) and of the M4d contracts
// (the relay counterattack `rc:<lane>:<i>`, the escort ambushes `ea:<serial>:<k>:<i>`).
import { RELAY_CHAIN } from '../../data/guild';
import { COMET, GRAVEYARD, RELAY } from '../../data/sites';
import type { SavedEnemyV9 } from './types';
import { cometById } from '../sites/comets';
import { sentryPosts } from '../sites/derelict';
import { parseMineId, parseSleeperId } from '../sites/graveyardKeys';
import { MINE_FUSE_TICKS } from '../sites/mines';
import { guildRelaySite } from '../guild/relaySites';
import type { LaneId } from '../regions/lanes';
import { relayById, siteById } from '../sites/placement';
import { stashParts } from '../sites/terminal';
import type { DerelictSite, GraveyardSite } from '../sites/types';
import type { SavedDerelictV17, SavedDirectorV17, SavedGraveyardV17, SavedPartyV17, SavedSitesV17, SaveGame } from './types';
import { SAVE_MAX_TICK, SAVE_MAX_TICK_AHEAD, type Checker } from './validate';

/** Sentry of a derelict `dd:<cx>,<cy>:<i>`. */
const SENTRY_ID = /^dd:(-?\d+),(-?\d+):(\d+)$/;
/** Ship of an ambush party `ab:<sector>@<bucket>:<i>`. */
const AMBUSH_ID = /^ab:.+@\d+:\d+$/;
/** Ship of a Guild relay counterattack `rc:<lane>:<i>` (M4d). */
const COUNTERATTACK_ID = /^rc:([AB]):(\d+)$/;
/** Ship of an escort ambush `ea:<serial>:<k>:<i>` (M4d). */
const ESCORT_AMBUSH_ID = /^ea:\d+:\d+:\d+$/;
/** The largest relay counterattack party (data/guild `RELAY_CHAIN.party`). */
const RELAY_PARTY_MAX = Math.max(...Object.values(RELAY_CHAIN.party).map((p) => p.length));
/** A director one-shot key `ev:<kind>:<…>` (a marker `…#hail` / `…#end` included). */
const DIRECTOR_KEY = /^ev:[A-Za-z]+:.+$/;
/** Largest bitmask a save holds (31 bits keep the JS bit operators positive). */
const MAX_MASK = 0x7fff_ffff;

const bits = (n: number): number => (n >= 31 ? MAX_MASK : (1 << n) - 1);

function keyed<T>(c: Checker, v: unknown, path: string, value: (x: unknown, p: string) => T): [string, T][] {
  const out: [string, T][] = [];
  (c.arr(v, path) ?? []).forEach((entry, i) => {
    const p = `${path}[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [id, value]');
    out.push([c.str(entry[0], p, true), value(entry[1], p)]);
  });
  if (new Set(out.map(([k]) => k)).size !== out.length) c.err(path, 'duplicate keys');
  return out;
}

const sortedByKey = <T>(list: [string, T][]): [string, T][] => [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const relayId = (c: Checker, v: unknown, path: string): string => c.str(v, path, true);

export function validateSitesShape(c: Checker, raw: unknown, path: string): SavedSitesV17 {
  const o = c.obj(raw, path) ?? {};
  const powered = (c.arr(o.powered, `${path}.powered`) ?? []).map((x, i) => relayId(c, x, `${path}.powered[${i}]`));
  let charge: SavedSitesV17['charge'] = null;
  if (o.charge !== null) {
    const x = c.obj(o.charge, `${path}.charge`) ?? {};
    // the charge time is tunable: more than a full charge is clamped (M1)
    charge = { id: relayId(c, x.id, `${path}.charge.id`), progress: c.capped(x.progress, `${path}.charge.progress`, 0, RELAY.powerSeconds) };
  }
  const derelicts = keyed(c, o.derelicts, `${path}.derelicts`, (x, p): SavedDerelictV17 => {
    const d = c.obj(x, p) ?? {};
    return {
      woke: d.woke === null ? null : c.tick(d.woke, `${p}.woke`),
      taken: c.int(d.taken, `${p}.taken`, 0, MAX_MASK),
      visited: c.bool(d.visited, `${p}.visited`),
    };
  });
  const graveyards = keyed(c, o.graveyards, `${path}.graveyards`, (x, p): SavedGraveyardV17 => {
    const g = c.obj(x, p) ?? {};
    return {
      mines: c.int(g.mines, `${p}.mines`, 0, MAX_MASK),
      party: c.oneOf<SavedPartyV17>(g.party, [0, 1, 2], `${p}.party`),
      data: c.bool(g.data, `${p}.data`),
      rolls: c.int(g.rolls, `${p}.rolls`, 0),
    };
  });
  const comets = keyed(c, o.comets, `${path}.comets`, (x, p) => {
    const m = c.obj(x, p) ?? {};
    return { pass: c.int(m.pass, `${p}.pass`, 0, SAVE_MAX_TICK), core: c.num(m.core, `${p}.core`, 0), tail: c.int(m.tail, `${p}.tail`, 0, MAX_MASK) };
  });
  const armed = keyed(c, o.armed, `${path}.armed`, (x, p) => c.until(x, p));
  return {
    powered: [...new Set(powered)].sort(),
    charge,
    berth: o.berth === null ? null : c.str(o.berth, `${path}.berth`, true),
    derelicts: sortedByKey(derelicts),
    graveyards: sortedByKey(graveyards),
    comets: sortedByKey(comets),
    armed: sortedByKey(armed),
  };
}

export function validateDirectorShape(c: Checker, raw: unknown, path: string): SavedDirectorV17 {
  const o = c.obj(raw, path) ?? {};
  // `last` may lie in the future (the planned end of a running event); -1e9 = never
  return { last: c.until(o.last, `${path}.last`, -SAVE_MAX_TICK_AHEAD), fired: sortedByKey(keyed(c, o.fired, `${path}.fired`, (x, p) => c.tick(x, p))) };
}

const derelictOf = (seed: number, id: string): DerelictSite | null => {
  const s = siteById(seed, id);
  return s?.kind === 'derelict' ? s : null;
};

const graveyardOf = (seed: number, id: string): GraveyardSite | null => {
  const s = siteById(seed, id);
  return s?.kind === 'graveyard' ? s : null;
};

/** Items of a derelict's terminal (bits of `taken`): the stash parts, else one service item. */
const terminalItems = (seed: number, site: DerelictSite): number => (site.service === 'stash' ? stashParts(seed, site).length : 1);

/** Whether an enemy of the sites still belongs to this seed's generator (other enemies always do). */
function enemyKnown(seed: number, e: SavedEnemyV9): boolean {
  const sentry = SENTRY_ID.exec(e.id);
  if (sentry) {
    const site = derelictOf(seed, `dl:${sentry[1]},${sentry[2]}`);
    return e.kind === 'sentry' && !!site && Number(sentry[3]) < sentryPosts(site).length;
  }
  if (e.kind === 'sentry') return false;
  if (e.id.startsWith('gs:')) {
    const m = parseSleeperId(e.id);
    const site = m ? graveyardOf(seed, m.site) : null;
    return !!m && !!site && m.index < site.sleepers.length;
  }
  if (e.id.startsWith('ab:')) return AMBUSH_ID.test(e.id);
  if (e.id.startsWith('rc:')) {
    const m = COUNTERATTACK_ID.exec(e.id);
    return !!m && Number(m[2]) < RELAY_PARTY_MAX && guildRelaySite(seed, m[1] as LaneId) !== null;
  }
  if (e.id.startsWith('ea:')) return ESCORT_AMBUSH_ID.test(e.id);
  return true;
}

/**
 * Checks the shape-valid sites, director and site enemies of a save against its seed and repairs them in
 * place (see the header). Returns the paths that were repaired (warning `sitesRepaired`).
 */
export function repairSites(save: SaveGame): string[] {
  const { seed, tick } = save;
  const sites = save.sites;
  const repaired: string[] = [];

  const powered = sites.powered.filter((id) => relayById(seed, id) !== null);
  if (powered.length !== sites.powered.length) repaired.push('sites.powered');
  sites.powered = powered;
  const lit = new Set(powered);

  if (sites.charge && (relayById(seed, sites.charge.id) === null || lit.has(sites.charge.id))) {
    sites.charge = null;
    repaired.push('sites.charge');
  }

  if (sites.berth !== null) {
    const site = derelictOf(seed, sites.berth);
    // berthed only in flight at a derelict whose clamp has power
    const ok = !!site && site.relays.every((r) => lit.has(r.id)) && save.player.dockedAt === null && !save.player.destroyed;
    if (!ok) {
      sites.berth = null;
      repaired.push('sites.berth');
    }
  }

  sites.derelicts = sites.derelicts.filter(([id, d], i) => {
    const site = derelictOf(seed, id);
    if (!site) {
      repaired.push(`sites.derelicts[${i}]`);
      return false;
    }
    const taken = d.taken & bits(terminalItems(seed, site));
    if (taken !== d.taken) {
      d.taken = taken;
      repaired.push(`sites.derelicts[${i}].taken`);
    }
    return true;
  });

  sites.graveyards = sites.graveyards.filter(([id, g], i) => {
    const site = graveyardOf(seed, id);
    if (!site) {
      repaired.push(`sites.graveyards[${i}]`);
      return false;
    }
    const mines = g.mines & bits(site.mines.length);
    if (mines !== g.mines) {
      g.mines = mines;
      repaired.push(`sites.graveyards[${i}].mines`);
    }
    if (g.rolls > GRAVEYARD.fragmentRolls) {
      g.rolls = GRAVEYARD.fragmentRolls;
      repaired.push(`sites.graveyards[${i}].rolls`);
    }
    return true;
  });

  sites.comets = sites.comets.filter(([id, m], i) => {
    if (!cometById(seed, id)) {
      repaired.push(`sites.comets[${i}]`);
      return false;
    }
    const tail = m.tail & bits(COMET.tail.shards);
    if (tail !== m.tail || m.core > COMET.budget) {
      m.tail = tail;
      m.core = Math.min(m.core, COMET.budget);
      repaired.push(`sites.comets[${i}]`);
    }
    return true;
  });

  const gone = new Map(sites.graveyards.map(([id, g]) => [id, g.mines]));
  sites.armed = sites.armed.filter(([id, at], i) => {
    const m = parseMineId(id);
    const site = m ? graveyardOf(seed, m.site) : null;
    // a live mine of a known graveyard, armed within its fuse before the save
    const ok = !!m && !!site && m.index < site.mines.length && ((gone.get(m.site) ?? 0) & (1 << m.index)) === 0 && at <= tick && tick - at <= MINE_FUSE_TICKS;
    if (!ok) repaired.push(`sites.armed[${i}]`);
    return ok;
  });

  const fired = save.director.fired.filter(([key]) => DIRECTOR_KEY.test(key));
  if (fired.length !== save.director.fired.length) repaired.push('director.fired');
  save.director.fired = fired;

  const enemies = save.combat.enemies.filter((e, i) => {
    const ok = enemyKnown(seed, e);
    if (!ok) repaired.push(`combat.enemies[${i}]`);
    return ok;
  });
  save.combat.enemies = enemies;
  // only a graveyard sleeper sleeps (a dormant enemy elsewhere would never wake)
  enemies.forEach((e, i) => {
    if (e.ai.mode === 'dormant' && !e.id.startsWith('gs:')) {
      e.ai.mode = 'patrol';
      repaired.push(`combat.enemies[${i}].ai.mode`);
    }
  });
  return repaired;
}

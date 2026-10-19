// Validation of the convoys in save V20 (M4d "Guild and Trade") – the same style as validate.ts: a clean
// copy, errors with paths. Two passes:
//
// - shape (with the rest of the save): trades keyed by pass ids `cv:<lane>@<n>`, the link, the escort
//   convoys (known states, finite numbers, 1–2 hulls) – a malformed value rejects the save. Amounts above
//   the (tunable) pass limits – cargo sold, fuel bought – are clamped (`capacityClamped`).
// - repair (`repairConvoys`, after the ships, the sites and the career are checked): against this seed
//   and the save tick. A trade of a pass this seed's schedule does not have, that is over or has not
//   departed yet is dropped,
//   its bought-items mask cut to the pass's slots; the link stays only for a pass in flight at the save
//   tick while the ship flies (not destroyed, not berthed – a replaced ship is docked); an escort convoy
//   stays only for an active escort contract, its hulls follow the contract's ships and the hull data,
//   its progress the stretch, its ambush mask the stretch's ambush points, its deposit the contract's
//   (`escortDepositOf(reward)`, 0 once arrived). Nothing here rejects the save
//   (warning `sitesRepaired`).
import { CONVOY, ESCORT } from '../../data/convoys';
import { escortDepositOf, escortHasTanker } from '../convoys/escort';
import { convoyAt, convoyPassWindow, parseConvoyPass } from '../convoys/schedule';
import type { SavedConvoysV20, SavedConvoyTradeV20, SavedEscortV20, SaveGame } from './types';
import type { Checker } from './validate';

const ESCORT_STATES: readonly SavedEscortV20['state'][] = ['waiting', 'moving', 'stopped', 'done'];
/** Largest bitmask a save holds (31 bits keep the JS bit operators positive). */
const MAX_MASK = 0x7fff_ffff;
/** How far a done convoy flies on past the stretch's end before it leaves (u, convoys/escort.ts). */
const FLY_ON = ESCORT.speed * ESCORT.flyOnSeconds;

const bits = (n: number): number => (n >= 31 ? MAX_MASK : (1 << n) - 1);

function passId(c: Checker, v: unknown, path: string): string {
  const pass = c.str(v, path, true);
  if (pass && parseConvoyPass(pass) === null) c.err(path, 'expected a convoy pass id cv:<lane>@<n>');
  return pass;
}

function trade(c: Checker, v: unknown, path: string): SavedConvoyTradeV20 {
  const o = c.obj(v, path) ?? {};
  return {
    bought: c.int(o.bought, `${path}.bought`, 0, MAX_MASK),
    sold: c.capped(o.sold, `${path}.sold`, 0, CONVOY.buyCap),
    fuel: c.capped(o.fuel, `${path}.fuel`, 0, CONVOY.fuelCap),
  };
}

function escort(c: Checker, v: unknown, path: string): SavedEscortV20 {
  const o = c.obj(v, path) ?? {};
  const hulls = (c.arr(o.hulls, `${path}.hulls`) ?? []).map((x, i) => c.num(x, `${path}.hulls[${i}]`, 0));
  if (hulls.length < 1 || hulls.length > 2) c.err(`${path}.hulls`, 'expected the trader and at most a tanker');
  return {
    progress: c.num(o.progress, `${path}.progress`, 0),
    state: c.oneOf(o.state, ESCORT_STATES, `${path}.state`),
    departed: o.departed === null ? null : c.int(o.departed, `${path}.departed`, 0),
    away: c.num(o.away, `${path}.away`, 0),
    stopUntil: c.int(o.stopUntil, `${path}.stopUntil`, 0),
    fired: c.int(o.fired, `${path}.fired`, 0, MAX_MASK),
    hulls,
    deposit: c.num(o.deposit, `${path}.deposit`, 0),
  };
}

/** Structure of `convoys` (V20). */
export function validateConvoysShape(c: Checker, raw: unknown, path: string): SavedConvoysV20 {
  const o = c.obj(raw, path) ?? {};
  const trades: [string, SavedConvoyTradeV20][] = [];
  (c.arr(o.trades, `${path}.trades`) ?? []).forEach((entry, i) => {
    const p = `${path}.trades[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [pass, trade]');
    trades.push([passId(c, entry[0], `${p}[0]`), trade(c, entry[1], `${p}[1]`)]);
  });
  if (new Set(trades.map(([k]) => k)).size !== trades.length) c.err(`${path}.trades`, 'duplicate passes');
  let link: SavedConvoysV20['link'] = null;
  if (o.link !== null) {
    const l = c.obj(o.link, `${path}.link`) ?? {};
    link = { pass: passId(c, l.pass, `${path}.link.pass`), since: c.int(l.since, `${path}.link.since`, 0) };
  }
  const escorts: [number, SavedEscortV20][] = [];
  (c.arr(o.escorts, `${path}.escorts`) ?? []).forEach((entry, i) => {
    const p = `${path}.escorts[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [serial, convoy]');
    escorts.push([c.int(entry[0], `${p}[0]`, 0), escort(c, entry[1], `${p}[1]`)]);
  });
  if (new Set(escorts.map(([k]) => k)).size !== escorts.length) c.err(`${path}.escorts`, 'duplicate serials');
  return {
    trades: trades.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    link,
    escorts: escorts.sort((a, b) => a[0] - b[0]),
  };
}

/** Checks the shape-valid convoys of a save against its seed and tick and repairs them in place (see the header). */
export function repairConvoys(save: SaveGame): string[] {
  const { seed, tick } = save;
  const cv = save.convoys;
  const repaired: string[] = [];

  cv.trades = cv.trades.filter(([pass, t], i) => {
    const w = convoyPassWindow(seed, pass);
    // a pass that is over is pruned by the simulation before any save could hold it; one that has not
    // departed yet was never linked
    if (!w || tick >= w.end || tick < w.depart) {
      repaired.push(`convoys.trades[${i}]`);
      return false;
    }
    const bought = t.bought & bits(CONVOY.slots);
    if (bought !== t.bought) {
      t.bought = bought;
      repaired.push(`convoys.trades[${i}].bought`);
    }
    return true;
  });

  if (cv.link) {
    const p = save.player;
    const flying = p.dockedAt === null && !p.destroyed && save.sites.berth === null;
    if (!flying || cv.link.since > tick || convoyAt(seed, cv.link.pass, tick) === null) {
      cv.link = null;
      repaired.push('convoys.link');
    }
  }

  cv.escorts = cv.escorts.filter(([serial, e], i) => {
    const contract = save.career.contracts.find((x) => x.serial === serial && x.target.kind === 'escort');
    if (!contract || contract.target.kind !== 'escort') {
      repaired.push(`convoys.escorts[${i}]`);
      return false;
    }
    const t = contract.target;
    const max = escortHasTanker(seed, contract.id) ? [ESCORT.traderHull, ESCORT.tankerHull] : [ESCORT.traderHull];
    // the hulls follow the contract's ships (a missing tanker comes whole) and the tunable hull data
    const hulls = max.map((m, k) => Math.min(m, e.hulls[k] ?? m));
    const progress = Math.max(t.from, Math.min(t.to + FLY_ON, e.progress));
    const fired = e.fired & bits(t.ambushes.length);
    const departed = e.departed === null ? null : Math.min(e.departed, tick);
    if (hulls.length !== e.hulls.length || hulls.some((h, k) => h !== e.hulls[k]) || progress !== e.progress || fired !== e.fired || departed !== e.departed) {
      Object.assign(e, { hulls, progress, fired, departed });
      repaired.push(`convoys.escorts[${i}]`);
    }
    // the deposit is at most the contract's (a crafted one is never paid out – saboteur G3), none once the
    // convoy arrived (paid back then) or the contract is ready
    const deposit = e.state === 'done' || contract.ready ? 0 : Math.min(e.deposit, escortDepositOf(contract.reward));
    if (deposit !== e.deposit) {
      e.deposit = deposit;
      repaired.push(`convoys.escorts[${i}].deposit`);
    }
    return true;
  });
  return repaired;
}

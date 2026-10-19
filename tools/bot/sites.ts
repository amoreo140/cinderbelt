// Opportunistic visits of the M4b world sites by the balance bot (task T15). Between two
// rocks in ring 2 the pilot may take a cheap detour to a site it knows (seen on the radar or as a signal):
//
// - graveyard: hover ~35 u outside one wreck – away from the sleepers (they wake within 60 u) and the
//   mines – and hold Tab on it until the analysis pays the graveyard's Data (`GRAVEYARD.data`, once). The
//   bot never cuts or tows graveyard wrecks (the scrap is in the econ model, not in the bot).
// - derelict without sentries: hold a mining beam on each relay's receiver until it is powered, berth at
//   the clamp with the station docking manoeuvre, take every terminal item (stash parts while the part
//   hold has room, plan fragments, one fabrication of the most valuable part the cargo can pay for) and
//   leave. Sentry derelicts are skipped (a miner does not pick that fight).
// - comets are never chased: matching a 30–55 u/s nucleus is not a cheap detour for a hover miner.
//
// The visitor only reads the state and answers with PlayerCommands, like the pilot.
import { partValue } from '../../src/data/economy';
import { DERELICT, GRAVEYARD, MINE } from '../../src/data/sites';
import { IDLE_COMMAND, type GameActionInput, type PlayerCommand } from '../../src/sim/commands';
import { ANALYZE_TICKS } from '../../src/sim/discovery/scanner';
import type { Vec2 } from '../../src/sim/math/vec2';
import type { SimState } from '../../src/sim/Simulation';
import { derelictDockTarget, nearestBerth } from '../../src/sim/sites/berth';
import { derelictState } from '../../src/sim/sites/derelict';
import { graveyardLayout } from '../../src/sim/sites/graveyard';
import { graveyardState } from '../../src/sim/sites/graveyardState';
import { liveMines } from '../../src/sim/sites/mines';
import { sitesNear } from '../../src/sim/sites/placement';
import { receiverPos } from '../../src/sim/sites/relays';
import { fabricateBlocker, fabricatorKeys, partHoldFree, terminalOffer } from '../../src/sim/sites/terminal';
import type { DerelictSite, GraveyardSite, RelaySite } from '../../src/sim/sites/types';
import { approachNav, clearance, dist, norm, type NavGoal } from './flight';
import type { BotLog } from './pilot';

/** What the visitor needs from the pilot. */
export interface SiteHost {
  readonly state: SimState;
  readonly log: BotLog;
  fly(nav: NavGoal, ignoreId?: string): PlayerCommand;
  navProgress(target: Vec2): void;
  /** Unsafe for the pilot (pirates, places it was attacked) – `ignoreSite` = the graveyard being visited. */
  unsafe(p: Vec2, ignoreSite?: string): boolean;
  send(actions: GameActionInput[]): PlayerCommand;
}

const TPS = 60;
/** Sites farther than this from the ship are not a cheap detour (u). */
export const VISIT_RANGE = 900;
/** A site visit that failed is not tried again for this long (ticks). */
const SKIP_TICKS = 30 * 60 * TPS;
/** Re-check for a site at most this often (ticks). */
const PICK_EVERY = 10 * TPS;
/** Hover distance outside a graveyard wreck's bounding circle while analysing it (u). */
const WRECK_STANDOFF = 35;
/** Keep the hover point this far from any sleeper (its wake range + margin) and live mine (u). */
const SLEEPER_CLEAR = GRAVEYARD.wakeRange + 25;
const MINE_CLEAR = MINE.armRange + 15;
/** Time limits (s). */
const LIMIT = { graveyard: 150, relay: 60, berth: 90, terminal: 5 } as const;

type Visit =
  | { kind: 'graveyard'; site: GraveyardSite; wreck: string; wreckPos: Vec2; stand: Vec2; since: number; hold: number; tries: number }
  | { kind: 'derelict'; site: DerelictSite; step: 'relay' | 'berth' | 'terminal' | 'leave'; relay: RelaySite | null; since: number; stepSince: number };

export class SiteVisitor {
  visit: Visit | null = null;
  private nextPick = 0;
  private skip = new Map<string, number>();
  private dockPressTick = -999;

  /** Starts a visit to a cheap known site near the ship; false = none (the pilot mines on). */
  pick(host: SiteHost): boolean {
    const s = host.state;
    if (s.tick < this.nextPick) return false;
    this.nextPick = s.tick + PICK_EVERY;
    const pos = s.player.body.pos;
    let best: Visit | null = null;
    let bestD = Infinity;
    const signals = new Set(s.discovery.signals.map((x) => x.id));
    for (const site of sitesNear(s.seed, pos, VISIT_RANGE)) {
      if (!(s.discovery.known.has(site.id) || signals.has(site.id)) || (this.skip.get(site.id) ?? -1) > s.tick) continue;
      const d = dist(site.pos, pos);
      if (d >= bestD) continue;
      const v = site.kind === 'derelict' ? this.derelictVisit(host, site) : this.graveyardVisit(host, site);
      if (v) {
        best = v;
        bestD = d;
      }
    }
    if (!best) return false;
    this.visit = best;
    host.log.count(`siteVisit:${best.kind}`);
    return true;
  }

  private derelictVisit(host: SiteHost, site: DerelictSite): Visit | null {
    const s = host.state;
    if (site.defence === 'sentries' || derelictState(s, site.id).visited) return null;
    if (host.unsafe(site.pos)) return null;
    // a stash needs room in the part hold
    if (site.service === 'stash' && partHoldFree(s) < 2 * DERELICT.itemCargo) return null;
    return { kind: 'derelict', site, step: 'relay', relay: null, since: s.tick, stepSince: s.tick };
  }

  private graveyardVisit(host: SiteHost, site: GraveyardSite): Visit | null {
    const s = host.state;
    const g = graveyardState(s, site.id);
    if (g.data || g.party === 'awake') return null;
    const pos = s.player.body.pos;
    const layout = graveyardLayout(s.seed, site);
    const sleepers = g.party === 'asleep' ? layout.sleepers.map((x) => x.pos) : [];
    const mines = liveMines(s, site.pos, GRAVEYARD.radius + 50).map((m) => m.pos);
    const wrecks = [...layout.wrecks].sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos));
    for (const w of wrecks.slice(0, 6)) {
      const out = norm({ x: pos.x - w.pos.x, y: pos.y - w.pos.y });
      for (const turn of [0, 0.5, -0.5, 1, -1]) {
        const dir = { x: out.x * Math.cos(turn) - out.y * Math.sin(turn), y: out.x * Math.sin(turn) + out.y * Math.cos(turn) };
        const stand = { x: w.pos.x + dir.x * (w.radius + WRECK_STANDOFF), y: w.pos.y + dir.y * (w.radius + WRECK_STANDOFF) };
        if (sleepers.some((p) => dist(p, stand) < SLEEPER_CLEAR) || mines.some((p) => dist(p, stand) < MINE_CLEAR)) continue;
        if (layout.wrecks.some((o) => o !== w && dist(o.pos, stand) < o.radius + 10)) continue;
        if (host.unsafe(stand, site.id)) continue;
        return { kind: 'graveyard', site, wreck: w.id, wreckPos: w.pos, stand, since: s.tick, hold: 0, tries: 0 };
      }
    }
    return null;
  }

  /** Ends the visit (done, interrupted or failed); a failed site is skipped for a while. */
  end(host: SiteHost, failed: string | null): void {
    const v = this.visit;
    if (!v) return;
    if (failed) {
      this.skip.set(v.site.id, host.state.tick + SKIP_TICKS);
      host.log.note(host.state.tick, 'siteVisitFailed', `${v.site.id} ${v.kind === 'derelict' ? v.step : 'analysis'}: ${failed}`);
    }
    this.visit = null;
  }

  /** The command of the visit this tick; null = the visit is over (the pilot goes back to mining). */
  command(host: SiteHost): PlayerCommand | null {
    const v = this.visit;
    if (!v) return null;
    return v.kind === 'graveyard' ? this.graveyardCommand(host, v) : this.derelictCommand(host, v);
  }

  // ---------------------------------------------------------------- graveyard: analyse one wreck

  private graveyardCommand(host: SiteHost, v: Extract<Visit, { kind: 'graveyard' }>): PlayerCommand | null {
    const s = host.state;
    const g = graveyardState(s, v.site.id);
    if (g.data) {
      host.log.count('graveyardAnalysed');
      this.end(host, null);
      return null;
    }
    if (g.party === 'awake') return this.fail(host, 'the sleepers woke');
    if (s.tick - v.since > LIMIT.graveyard * TPS) return this.fail(host, 'timeout');
    const p = s.player;
    const d = dist(p.body.pos, v.stand);
    const face = Math.atan2(v.wreckPos.y - p.body.pos.y, v.wreckPos.x - p.body.pos.x);
    host.navProgress(v.stand);
    const cmd = host.fly(d < 25 ? { target: v.stand, arriveSpeed: 0, maxSpeed: 8, face, precise: true } : { target: v.stand, arriveSpeed: 4, maxSpeed: 50, precise: false });
    if (d > 6 || Math.hypot(p.body.vel.x, p.body.vel.y) > 3) {
      v.hold = 0;
      return cmd;
    }
    const wreck = s.combat.wrecks.find((w) => w.poi === v.wreck);
    if (!wreck) return cmd;
    // start the hold only with the scanner ready (a cancelled hold starts over)
    if (v.hold === 0 && (s.discovery.scanner.cooldown > 0 || p.energy < 40)) return cmd;
    v.hold++;
    if (v.hold > ANALYZE_TICKS + 30) {
      v.hold = 0;
      v.tries++;
      if (v.tries >= 3) return this.fail(host, 'analysis did not pay');
      return cmd;
    }
    return { ...cmd, scan: true, aim: { ...wreck.body.pos } };
  }

  // ---------------------------------------------------------------- derelict: relays, berth, terminal

  private derelictCommand(host: SiteHost, v: Extract<Visit, { kind: 'derelict' }>): PlayerCommand | null {
    const s = host.state;
    const site = v.site;
    if (v.step === 'relay') {
      const left = site.relays.filter((r) => !s.sites.powered.has(r.id));
      if (left.length === 0) return this.next(host, v, 'berth');
      if (!v.relay || s.sites.powered.has(v.relay.id)) {
        const pos = s.player.body.pos;
        v.relay = [...left].sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0]!;
        v.stepSince = s.tick;
      }
      if (s.tick - v.stepSince > LIMIT.relay * TPS) return this.fail(host, `relay ${v.relay.id} not powered`);
      return this.relayCommand(host, v.relay);
    }
    if (v.step === 'berth') {
      if (s.sites.berth === site.id) return this.next(host, v, 'terminal');
      if (s.tick - v.stepSince > LIMIT.berth * TPS) return this.fail(host, 'berth');
      const target = derelictDockTarget(site);
      const near = nearestBerth(s);
      const ready = near !== null && near.site.id === site.id && near.powered && near.check.status === 'ok';
      const dock = approachNav(s, target, 40, ready);
      host.navProgress(dock.nav.target);
      const cmd = host.fly(dock.nav);
      if (dock.ready && s.tick - this.dockPressTick > 20) {
        this.dockPressTick = s.tick;
        return { ...cmd, dock: true };
      }
      return cmd;
    }
    if (v.step === 'terminal') {
      if (s.sites.berth !== site.id) return this.fail(host, 'not berthed');
      // wait for the latch, then take everything at once
      if (s.tick - v.stepSince < LIMIT.terminal * TPS) return IDLE_COMMAND;
      const actions = this.takeActions(s, site);
      host.log.count('derelictBerthed');
      v.step = 'leave';
      v.stepSince = s.tick;
      return actions.length ? host.send(actions) : IDLE_COMMAND;
    }
    // leave
    if (s.sites.berth !== site.id) {
      this.end(host, null);
      return null;
    }
    if (s.tick - v.stepSince > 2 * TPS) return this.fail(host, 'cannot leave the berth');
    return s.tick === v.stepSince + 1 ? host.send([{ type: 'berthLeave' }]) : IDLE_COMMAND;
  }

  /** Hover next to the relay mast with the bow at it and hold the mining beams on the receiver. */
  private relayCommand(host: SiteHost, relay: RelaySite): PlayerCommand {
    const s = host.state;
    const p = s.player;
    const lens = receiverPos(relay);
    const front = p.props.lasers.length ? Math.max(...p.props.lasers.map((l) => l.offset.x)) : 1;
    const standDist = 1.5 + Math.max(1, front) + 3;
    const out = norm({ x: p.body.pos.x - relay.pos.x, y: p.body.pos.y - relay.pos.y });
    let stand = { x: relay.pos.x + out.x * standDist, y: relay.pos.y + out.y * standDist };
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2, -2, Math.PI]) {
      const dir = { x: out.x * Math.cos(turn) - out.y * Math.sin(turn), y: out.x * Math.sin(turn) + out.y * Math.cos(turn) };
      const cand = { x: relay.pos.x + dir.x * standDist, y: relay.pos.y + dir.y * standDist };
      if (clearance(s, cand, 30) > 0.5) {
        stand = cand;
        break;
      }
    }
    const d = dist(p.body.pos, stand);
    const face = Math.atan2(lens.y - p.body.pos.y, lens.x - p.body.pos.x);
    host.navProgress(stand);
    const cmd = host.fly(
      d < 15 ? { target: stand, arriveSpeed: 0, maxSpeed: 6, face, precise: true, noAvoid: d < 6 } : { target: stand, arriveSpeed: 4, maxSpeed: 50, precise: false },
    );
    return d < 8 ? { ...cmd, mining: true, aim: lens } : cmd;
  }

  /** Every terminal item the ship can take now (stash parts while the hold has room). */
  private takeActions(s: SimState, site: DerelictSite): GameActionInput[] {
    const offer = terminalOffer(s, site.id);
    if (!offer) return [];
    const out: GameActionInput[] = [];
    let room = partHoldFree(s);
    for (const item of offer.items) {
      if (item.taken) continue;
      if (item.what.kind === 'part') {
        if (room + 1e-9 < DERELICT.itemCargo) continue;
        room -= DERELICT.itemCargo;
        out.push({ type: 'derelictTake', site: site.id, item: item.index });
      } else if (item.what.kind === 'fragments') {
        out.push({ type: 'derelictTake', site: site.id, item: item.index });
      } else {
        const keys = fabricatorKeys(s).filter((k) => fabricateBlocker(s, k) === null);
        keys.sort((a, b) => partValue(b) - partValue(a));
        const key = keys[0];
        if (key) out.push({ type: 'derelictTake', site: site.id, item: item.index, key });
      }
    }
    return out;
  }

  private next(host: SiteHost, v: Extract<Visit, { kind: 'derelict' }>, step: 'berth' | 'terminal'): PlayerCommand | null {
    v.step = step;
    v.stepSince = host.state.tick;
    return this.derelictCommand(host, v);
  }

  private fail(host: SiteHost, why: string): null {
    this.end(host, why);
    return null;
  }
}

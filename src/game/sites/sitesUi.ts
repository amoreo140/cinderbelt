// Game layer of the M4b world sites and space events (T7): the HUD event chips, the derelict
// terminal (open exactly while berthed) and its handlers, the berth approach readout (the docking readout
// against the derelict clamp when it is nearer than any station's), the toasts of the new events and the
// dev hooks for e2e. Reads the simulation state only; actions go through the host.
import type { DirectorEventKind } from '../../data/events';
import type { PartKey } from '../../data/parts';
import { RELAY } from '../../data/sites';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { activeEvents } from '../../sim/events/director';
import type { ActiveEvent } from '../../sim/events/types';
import { sectorInfoAt } from '../../sim/regions/sectors';
import { derelictState, siteById, sitesNear } from '../../sim/sites';
import { derelictDockTarget, nearestBerth, type BerthCandidate } from '../../sim/sites/berth';
import type { DerelictState, SiteKind } from '../../sim/sites/types';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { dockPose } from '../../sim/station/dock';
import { playerDockRules } from '../../sim/station/dockRules';
import type { ToastKind } from '../../ui/GameUi';
import { sectorName } from '../../ui/sectors/sectorText';
import { formatClock } from '../../ui/sites/chipFormat';
import { DockReadoutGate, dockPrompt, dockRejectedText, type DockPrompt } from '../../ui/stationHud';
import { partName } from '../shipyardView';
import { cometTitle, eventChips, flybyCometId } from './eventChipView';
import { fabricatorItem, terminalData, type TerminalVisit } from './terminalView';
import type { DerelictTerminalData, EventChipItem, TerminalHandlers } from './types';

export interface SitesUiHost {
  state(): SimState;
  /** Queues an action for the next step; returns its reqId. */
  send(action: GameActionInput): number;
  render(): void;
}

export interface SitesToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

/** Dev hooks for e2e (`window.__cinder.sites` / `.events` / `.berth`). */
export interface SitesDevHooks {
  sites: {
    /** Sites within `range` (u) of the ship, nearest first. */
    near(range?: number): { id: string; kind: SiteKind; pos: { x: number; y: number }; distance: number }[];
    /** A derelict: its relays (lit or not) and saved state; null when the id is not a derelict. */
    derelict(id: string): { id: string; pos: { x: number; y: number }; relays: { id: string; pos: { x: number; y: number }; lit: boolean }[]; state: DerelictState } | null;
    /** Lights the first `count` relays of a derelict (dev shortcut: no relayPowered event, the defence stays asleep). */
    powerRelays(id: string, count?: number): void;
    /** Puts the ship at the derelict's dock clamp, stopped, bow to the station: F berths (when powered). */
    toClamp(id: string): boolean;
    /** The open terminal's view model (null when not berthed). */
    terminal(): DerelictTerminalData | null;
    terminalHandlers: TerminalHandlers;
  };
  events: {
    /** What the director lists now. */
    active(): ActiveEvent[];
    /** The HUD chips (all of them, most severe first). */
    chips(): EventChipItem[];
    /** Forces a rolled event in the player's sector now (`debugEvent`); returns the reqId. */
    force(kind: DirectorEventKind): number;
  };
  berth: {
    /** The derelict the ship is berthed at. */
    id(): string | null;
    /** The derelict clamp F would berth at now (null = the station dock runs). */
    candidate(): { id: string; status: string; powered: boolean; distance: number } | null;
    /** The approach readout / prompt the HUD would show for the berth. */
    prompt(): DockPrompt | null;
    leave(): number;
  };
}

/** Toast priority within a step: the direct answer to F first. */
const PRIO = { rejected: 9, woke: 8, taken: 7, relay: 6, warning: 5, sighted: 3 } as const;

export class SitesUi {
  /** The current berth's handout (Data + log) from its `derelictVisited` event. */
  private visit: TerminalVisit | null = null;
  /** The berth readout hides while the ship leaves the clamp (same rules as a station's). */
  private readonly gate = new DockReadoutGate();
  private candidate: BerthCandidate | null = null;
  private readoutShown = false;
  readonly handlers: TerminalHandlers;

  constructor(private readonly host: SitesUiHost) {
    this.handlers = {
      take: (index) => {
        const site = this.host.state().sites.berth;
        if (site !== null) this.host.send({ type: 'derelictTake', site, item: index });
      },
      fabricate: (key: PartKey) => {
        const state = this.host.state();
        const site = state.sites.berth;
        if (site === null) return;
        this.host.send({ type: 'derelictTake', site, item: fabricatorItem(state, site) ?? 0, key });
      },
      leave: () => this.leave(),
    };
  }

  /** Berthed at a derelict: the terminal is open, Esc / F leave. */
  berthed(state: SimState): boolean {
    return state.sites.berth !== null;
  }

  /** Leaves the berth (Esc, F, "Unlink"). */
  leave(): number {
    return this.host.send({ type: 'berthLeave' });
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'derelictVisited') this.visit = { id: e.id, data: e.data, journal: e.journal };
      else if (e.type === 'berthed' && this.visit?.id !== e.id) this.visit = null;
      else if (e.type === 'berthLeft') this.visit = null;
    }
  }

  // ---------------------------------------------------------------------------
  // berth approach readout

  /**
   * Once per frame: the derelict clamp in play (nearer than every station's docking point) and whether
   * its readout shows. Returns true when a clamp is in play – the station readout then stays hidden.
   */
  updateReadout(state: SimState): boolean {
    const { player } = state;
    const flying = player.dock.mode === 'flying' && !player.destroyed;
    this.candidate = flying ? nearestBerth(state) : null;
    // a berthed ship counts as docked for the gate: leaving the clamp starts a departure
    const mode = state.sites.berth !== null ? 'docked' : player.dock.mode;
    const check = this.candidate?.check ?? { status: 'noStation' as const, station: null, point: null, distance: Infinity, speed: 0, angle: 0, rules: playerDockRules(state) };
    this.readoutShown = this.gate.update(mode, player.body, check);
    return this.candidate !== null;
  }

  /** The F prompt with the approach readout at a derelict clamp (null = none, the station's runs). */
  prompt(state: SimState): DockPrompt | null {
    const near = this.candidate;
    if (!near || !this.readoutShown || state.sites.berth !== null) return null;
    const base = dockPrompt(near.check, '');
    if (!base) return null;
    if (!near.powered) return { ...base, text: tx().world.map.scan.clampDark, kind: 'warn' };
    return near.check.status === 'ok' ? { ...base, text: tx().world.derelict.berthPrompt } : base;
  }

  // ---------------------------------------------------------------------------
  // view models

  chips(state: SimState): EventChipItem[] {
    const { pos, angle } = state.player.body;
    return eventChips(activeEvents(state), state.tick, { pos, angle });
  }

  terminal(state: SimState): DerelictTerminalData | null {
    const id = state.sites.berth;
    return id === null ? null : terminalData(state, id, this.visit);
  }

  // ---------------------------------------------------------------------------
  // toasts

  /** The most important toast of a step's events (null = none). */
  toast(state: SimState, events: readonly SimEvent[]): SitesToast | null {
    let best: (SitesToast & { prio: number }) | null = null;
    for (const e of events) {
      const t = this.toastOf(state, e);
      if (t && (!best || t.prio > best.prio)) best = t;
    }
    if (!best) return null;
    const { prio: _p, ...t } = best;
    return t;
  }

  private toastOf(state: SimState, e: SimEvent): (SitesToast & { prio: number }) | null {
    const s = tx().world;
    switch (e.type) {
      case 'berthRejected': {
        const { reason, distance, speed, angle } = e;
        const text = reason === 'relaysUnpowered' ? tx().actionErrors.relaysUnpowered : dockRejectedText({ reason, distance, speed, angle }, playerDockRules(state));
        return { text, kind: 'error', seconds: 3, prio: PRIO.rejected };
      }
      case 'relayPowered':
        // derelict relays only (a Guild relay of M4d counts alone)
        if (!e.site.startsWith('dl:')) return null;
        return e.lit >= RELAY.count
          ? { text: s.toasts.clampPowered, kind: 'ok', seconds: 4, prio: PRIO.relay }
          : { text: s.toasts.relayPowered(e.lit, RELAY.count), kind: 'ok', seconds: 3, prio: PRIO.relay };
      case 'derelictWoke':
        return { text: s.toasts.woke[e.defence], kind: e.defence === 'none' ? 'info' : 'error', seconds: 5, prio: PRIO.woke };
      case 'sleepersWoke':
        return { text: s.toasts.sleepersWoke, kind: 'error', seconds: 5, prio: PRIO.woke };
      case 'cometSighted':
        return { text: s.toasts.cometSighted(cometTitle(e.id)), kind: 'info', seconds: 4, prio: PRIO.sighted };
      case 'derelictTaken':
        // plan fragments toast through discovery (fragmentFound)
        if (e.what.kind === 'part') return { text: s.toasts.partTaken(partName(e.what.key)), kind: 'ok', seconds: 3, prio: PRIO.taken };
        if (e.what.kind === 'crafted') return { text: tx().crafting.crafted(partName(e.what.key), 1), kind: 'ok', seconds: 3, prio: PRIO.taken };
        return null;
      case 'eventWarning': {
        const when = s.hud.in(formatClock(e.inSeconds));
        if (e.kind === 'cometFlyby') {
          const id = flybyCometId(e.key);
          const p = state.player.body.pos;
          const sector = sectorName(sectorInfoAt(state.seed, p.x, p.y).name);
          return { text: s.events.cometFlyby(id ? cometTitle(id) : s.events.names.cometFlyby, sector, formatClock(e.inSeconds)), kind: 'info', seconds: 5, prio: PRIO.warning };
        }
        if (e.kind !== 'micrometeors' && e.kind !== 'ambush') return null;
        return { text: s.toasts.warning(s.events.names[e.kind], when), kind: e.kind === 'ambush' ? 'error' : 'info', seconds: 4, prio: PRIO.warning };
      }
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // dev hooks (e2e)

  devHooks(): SitesDevHooks {
    const state = () => this.host.state();
    return {
      sites: {
        near: (range = 3000) => {
          const st = state();
          const p = st.player.body.pos;
          return sitesNear(st.seed, p, range)
            .map((s) => ({ id: s.id, kind: s.kind, pos: { ...s.pos }, distance: Math.hypot(s.pos.x - p.x, s.pos.y - p.y) }))
            .filter((s) => s.distance <= range)
            .sort((a, b) => a.distance - b.distance);
        },
        derelict: (id) => {
          const st = state();
          const site = siteById(st.seed, id);
          if (!site || site.kind !== 'derelict') return null;
          return {
            id,
            pos: { ...site.pos },
            relays: site.relays.map((r) => ({ id: r.id, pos: { ...r.pos }, lit: st.sites.powered.has(r.id) })),
            state: { ...derelictState(st, id) },
          };
        },
        powerRelays: (id, count = RELAY.count) => {
          const st = state();
          const site = siteById(st.seed, id);
          if (!site || site.kind !== 'derelict') return;
          for (const r of site.relays.slice(0, count)) st.sites.powered.add(r.id);
        },
        toClamp: (id) => {
          const st = state();
          const site = siteById(st.seed, id);
          if (!site || site.kind !== 'derelict' || st.player.dock.mode !== 'flying') return false;
          const pose = dockPose(derelictDockTarget(site), st.player.props.boundingRadius);
          st.player.body = { ...pose, vel: { x: 0, y: 0 }, angVel: 0 };
          st.player.prevBody = st.player.body;
          return true;
        },
        terminal: () => this.terminal(state()),
        terminalHandlers: this.handlers,
      },
      events: {
        active: () => activeEvents(state()),
        chips: () => this.chips(state()),
        force: (kind) => this.host.send({ type: 'debugEvent', kind }),
      },
      berth: {
        id: () => state().sites.berth,
        candidate: () => {
          const near = nearestBerth(state());
          return near ? { id: near.site.id, status: near.check.status, powered: near.powered, distance: near.check.distance } : null;
        },
        prompt: () => this.prompt(state()),
        leave: () => this.leave(),
      },
    };
  }
}

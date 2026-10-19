// M4d Guild and convoys in the game (T9): the convoy trade window while linked (view model +
// handlers → `convoy*` commands), the Guild status chips, the radar's Guild contacts, the map's Guild
// layer, the F prompt at a trader's trade port, the flight marks of the nearest open convoy and the known
// Guild relays near the ship, and the toasts of the link, the escort and the relay chain. The view models
// are memoised (the same object while their inputs are the same – the UI redraws at 10 Hz).
import { CONVOY } from '../../data/convoys';
import { NOTES } from '../../data/navigation';
import { getLocale, tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { nearestTradePort } from '../../sim/convoys/link';
import { tradeOf } from '../../sim/convoys/trade';
import { guildRelaySites } from '../../sim/guild';
import { relayStage } from '../../sim/guild/relayChain';
import type { Vec2 } from '../../sim/math/vec2';
import { TICKS_PER_SECOND } from '../../sim/save/meta';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { partHoldFree } from '../../sim/sites/terminal';
import type { NavMark } from '../../ui/edgeArrows';
import { formatAmount } from '../../ui/format';
import { buildGuildContacts, type GuildContact } from '../../ui/radar';
import type { DockPrompt } from '../../ui/stationHud';
import type { ToastKind } from '../../ui/GameUi';
import { sectorLabel } from '../board/names';
import { convoyRadarInput, linkPrompt, nearestOpenConvoy } from '../convoys/convoyView';
import { convoyTradeHandlers, convoyTradeView } from '../convoys/tradeView';
import type { ConvoyTradeData, ConvoyTradeHandlers } from '../convoys/types';
import { mapGuildData } from '../map/mapGuildView';
import type { MapGuildData } from '../map/types';
import { guildStatus, relayContractLane, relayKnown, watchNear } from './guildView';
import type { GuildStatusData } from './types';

export interface GuildUiHost {
  state(): SimState;
  send(action: GameActionInput): number;
}

export interface GuildToast {
  text: string;
  kind: ToastKind;
  seconds: number;
}

/** A navigation mark at a world point (the game projects it for `navArrows`). */
export interface WorldNavMark {
  pos: Vec2;
  mark: NavMark;
}

/** Toast priority within a step: the direct answer to F first. */
const PRIO = { rejected: 9, failed: 8, ambush: 7, secured: 6, unlinked: 5, relay: 4, escort: 3 } as const;

/**
 * After an unlink the link prompt stays quiet (the ship drifts on with the convoy's velocity, still
 * beside the port) until the ship leaves the port's approach range or for this long (s).
 */
const DEPART_QUIET_S = 6;

/** A convoy nearer than this (u) gets no flight mark – it is on screen beside the ship. */
const NEAR_CONVOY = 150;

/** One cached value per key. */
class Memo<T> {
  private key: string | null = null;
  private value: T | undefined;
  get(key: string, build: () => T): T {
    if (key !== this.key) {
      this.key = key;
      this.value = build();
    }
    return this.value as T;
  }
}

export class GuildUi {
  readonly handlers: ConvoyTradeHandlers;
  private readonly statusMemo = new Memo<GuildStatusData | null>();
  private readonly tradeMemo = new Memo<ConvoyTradeData | null>();
  private readonly radarMemo = new Memo<GuildContact[]>();
  private readonly mapMemo = new Memo<MapGuildData>();
  private readonly promptMemo = new Memo<DockPrompt | null>();
  private readonly marksMemo = new Memo<WorldNavMark[]>();
  /** A trade port within the approach range at the last prompt (the station readout stays hidden then). */
  private portNear = false;
  /** Just unlinked: no link prompt until the ship leaves the port's approach range (or `DEPART_QUIET_S`). */
  private departing = false;
  /** The tick the quiet after an unlink started (set by the first prompt after the event). */
  private departSince: number | null = null;

  constructor(private readonly host: GuildUiHost) {
    this.handlers = convoyTradeHandlers((a) => host.send(a), () => host.state());
  }

  /** The ship is linked to a convoy trader (the trade window is open). */
  linked(state: SimState): boolean {
    return state.convoys.link !== null;
  }

  /** "Unlink" (Esc that reached the game while linked). */
  unlink(): number {
    return this.host.send({ type: 'convoyUnlink' });
  }

  /** A trader's trade port was in play at the last UI redraw (its F prompt wins over a station's readout). */
  get portInPlay(): boolean {
    return this.portNear;
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== 'convoyUnlinked') continue;
      this.departing = true;
      this.departSince = null;
    }
  }

  // ---------------------------------------------------------------------------
  // view models

  /** The Guild chips of the flight HUD (null = none). */
  status(state: SimState): GuildStatusData | null {
    if (state.career.contracts.every((c) => c.target.kind !== 'escort' && c.target.kind !== 'relay')) return this.statusMemo.get('none', () => null);
    return this.statusMemo.get(`${state.tick}|${getLocale()}`, () => guildStatus(state));
  }

  /** The convoy trade window – open exactly while linked. */
  trade(state: SimState): ConvoyTradeData | null {
    const link = state.convoys.link;
    if (!link) return this.tradeMemo.get('none', () => null);
    const p = state.player;
    const t = tradeOf(state, link.pass);
    const key = `${link.pass}|${link.since}|${state.credits}|${t.bought},${t.sold},${t.fuel}|${Object.values(p.cargo).join(',')}|${Object.values(p.refined).join(',')}|${p.fuel}|${partHoldFree(state)}|${state.discovery.fragments.size}|${getLocale()}`;
    return this.tradeMemo.get(key, () => convoyTradeView(state));
  }

  /** Guild Watch ships and convoy ships within the radar range. */
  radar(state: SimState, range: number): GuildContact[] {
    return this.radarMemo.get(`${state.tick}|${range}`, () => {
      const pos = state.player.body.pos;
      const convoys = convoyRadarInput(state, pos, range);
      const watch = [...watchNear(state, pos, range), ...convoys.watch];
      return buildGuildContacts({ watch, convoys: convoys.convoys }, pos, range);
    });
  }

  /** The map's Guild layer. */
  map(state: SimState, radarRange: number): MapGuildData {
    return this.mapMemo.get(`${state.tick}|${radarRange}|${state.guild.relays.size}|${state.career.contracts.length}`, () => mapGuildData(state, radarRange));
  }

  /** The F prompt at a trader's trade port with the approach readout (null = none in play, or linked). */
  prompt(state: SimState): DockPrompt | null {
    const { player } = state;
    if (player.dock.mode !== 'flying' || player.destroyed || state.convoys.link || state.sites.berth !== null) {
      this.portNear = false;
      return null;
    }
    return this.promptMemo.get(`${state.tick}|${getLocale()}`, () => {
      const near = nearestTradePort(state);
      this.portNear = near !== null;
      // after an unlink: quiet until the ship leaves the approach range or a few seconds pass
      if (this.departing) {
        this.departSince ??= state.tick;
        if (!near || state.tick - this.departSince >= DEPART_QUIET_S * TICKS_PER_SECOND) this.departing = false;
        else return null;
      }
      return linkPrompt(state, near);
    });
  }

  /**
   * Flight marks (edge arrows / pins): the nearest open convoy pass within its flyby radius and the known
   * Guild relays within the notes' flight range (not the relay of an active contract – the objective
   * arrow points there already).
   */
  navMarks(state: SimState): WorldNavMark[] {
    return this.marksMemo.get(`${state.tick}|${getLocale()}`, () => {
      const out: WorldNavMark[] = [];
      if (state.player.dock.mode !== 'flying' || state.player.destroyed) return out;
      // beside the trader (its port in play) the F prompt says it all – no pin over the ships
      const convoy = this.portNear ? null : nearestOpenConvoy(state);
      if (convoy && convoy.distance >= NEAR_CONVOY) out.push({ pos: convoy.pos, mark: { key: `convoy:${convoy.pass}`, kind: 'convoy', title: tx().guild.convoy.arrow, distance: convoy.distance } });
      const pos = state.player.body.pos;
      const contractLane = relayContractLane(state);
      for (const s of guildRelaySites(state.seed)) {
        if (s.lane === contractLane) continue;
        const distance = Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y);
        if (distance > NOTES.flightRange || !relayKnown(state, s)) continue;
        const stage = relayStage(state, s.lane);
        out.push({ pos: s.pos, mark: { key: `relay:${s.lane}`, kind: 'relay', title: tx().guild.relay.name, lit: stage === 'powered' || stage === 'secured', distance } });
      }
      return out;
    });
  }

  // ---------------------------------------------------------------------------
  // toasts

  /** The most important toast of these events (the radio's factual note when a person says one). */
  toast(state: SimState, events: readonly SimEvent[]): GuildToast | null {
    let best: (GuildToast & { prio: number }) | null = null;
    for (const e of events) {
      const t = this.toastOf(state, e);
      if (t && (!best || t.prio > best.prio)) best = t;
    }
    if (!best) return null;
    const { prio: _p, ...t } = best;
    return t;
  }

  private toastOf(state: SimState, e: SimEvent): (GuildToast & { prio: number }) | null {
    const l = tx().guild.link;
    const g = tx().guild.toasts;
    switch (e.type) {
      case 'linkRejected': {
        const text =
          e.reason === 'tooFar' ? l.rejected.tooFar(formatAmount(e.distance), String(CONVOY.linkRange))
          : e.reason === 'tooFast' ? l.rejected.tooFast(formatAmount(e.speed), formatAmount(CONVOY.linkSpeed))
          : l.rejected.pirates;
        return { text, kind: 'error', seconds: 3, prio: PRIO.rejected };
      }
      case 'convoyUnlinked':
        return e.reason === 'player' ? null : { text: l.unlinked[e.reason], kind: 'info', seconds: 3, prio: PRIO.unlinked };
      case 'contractFailed':
        return { text: tx().guild.escort.failed[e.reason], kind: 'error', seconds: 5, prio: PRIO.failed };
      case 'escortDeparted':
        return { text: g.escortDeparted, kind: 'info', seconds: 4, prio: PRIO.escort };
      case 'escortStopped':
        return { text: g.escortStopped, kind: 'info', seconds: 3, prio: PRIO.escort };
      case 'escortAmbush':
        return { text: g.escortAmbush, kind: 'error', seconds: 4, prio: PRIO.ambush };
      case 'relayRepaired':
        return { text: g.relayRepaired, kind: 'ok', seconds: 4, prio: PRIO.relay };
      case 'relayHoldStarted':
        return { text: g.relayHold, kind: 'error', seconds: 4, prio: PRIO.relay };
      case 'sectorSecured':
        return { text: g.sectorSecured(sectorLabel(state.seed, e.sector)), kind: 'ok', seconds: 6, prio: PRIO.secured };
      default:
        return null;
    }
  }
}

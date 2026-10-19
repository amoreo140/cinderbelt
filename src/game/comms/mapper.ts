// Sim events → communicator messages: who says what when a station
// grants or denies docking, pirates demand a toll, a named captain shows up, flees or dies, a clan takes
// a challenge, the fortress raises the alarm, an issuer hands out or pays a contract, the Echo speaks
// and a ship in distress calls. M4b: the Guild Watch warns of a micrometeor shower, an ambush party
// taunts from the dark, the Institute's observatory announces comets, a derelict station's automaton
// answers its relays, its clamp and its terminal, a graveyard's sleepers wake. M4c: home traffic control
// announces a newly built home module. M4d: the Guild Watch engages pirates near the player, guides the
// relay chain (repaired, the Rust counterattack coming, the sector secured) while the Rust party taunts;
// a Free Traders convoy announces its flyby, answers the link at its trade port and the trade; the
// trader of an escort contract departs, stops under fire, sees an ambush ahead, thanks on arrival and
// gives up on a failed escort. No friendly fire (user decision 2026-10-16): no warning / hostility
// lines. Each message lists the
// events whose toast it replaces (the toast's text becomes the message's factual note); when the radio
// filters the message out, those toasts stay. Deterministic: line variants by a hash of tick + event key.
import { CONTRACT_DEFS } from '../../data/contracts';
import type { RingIndex } from '../../data/economy';
import type { RepFactionId } from '../../data/factions';
import { RELAY_CHAIN, WATCH } from '../../data/guild';
import { RELAY } from '../../data/sites';
import type { EnemyKind } from '../../sim/combat/types';
import { captainIndexOf } from '../../sim/captains/captains';
import { ambushGroup, ambushParty } from '../../sim/events/ambush';
import { parseRolledKey } from '../../sim/events/director';
import { nearestTradePort } from '../../sim/convoys/link';
import { securityHere } from '../../sim/pirates/sectors';
import { guildCorridorAt, sectorInfo } from '../../sim/regions/sectors';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { HOME_STATION_ID, stationById, type StationDef } from '../../sim/world/stations';
import { fortressSites } from '../../sim/pirates/sites';
import type { CommsTexts } from '../../i18n/skComms';
import { tx } from '../../i18n';
import { formatCredits } from '../../ui/format';
import { clockHour } from '../../ui/sites/chipFormat';
import { sectorName } from '../../ui/sectors/sectorText';
import { stationLabel } from '../board/names';
import {
  captainSpeaker,
  contractSpeaker,
  derelictSpeaker,
  distressSpeaker,
  echoSpeaker,
  fortressSpeaker,
  guildWatchSpeaker,
  instituteSpeaker,
  pirateSpeaker,
  stationSpeaker,
  strandedSpeaker,
  traderSpeaker,
} from './speakers';
import type { CommsChannel, CommsMessage, CommsText, Speaker } from './types';
import { pickLine, variantIndex } from './variants';

const TICKS = 60;

/** Journal entries of the Echo story (chapter beats the Echo itself "speaks"). */
export const ECHO_STORY_ENTRIES: ReadonlySet<string> = new Set(['echo0Heard', 'echo0', 'decoder', 'echo1', 'ruleResonance', 'echo2', 'shard']);

/** The Echo has a name once the journal knows the Smiths' frequencies. */
export const echoNamed = (state: SimState): boolean => state.discovery.journal.some((e) => e.id === 'decoder');

/** A message and the events whose toasts it replaces. */
export interface CommsSource {
  msg: CommsMessage;
  events: SimEvent[];
}

export interface CommsContext {
  texts: CommsTexts;
  /** The toast an event would show today (its text becomes the message's note). */
  toastOf(event: SimEvent): string | null;
  /** The station whose clamp the player tried (dock rejection), or null. */
  dockStation(): StationDef | null;
}

/** Pirate group of an enemy id (`pr:<x>,<y>:<n>`). */
export function pirateGroup(id: string): string | null {
  const m = /^(pr:-?\d+,-?\d+):\d+$/.exec(id);
  return m ? m[1]! : null;
}

/**
 * Group or party prefix of an enemy id for de-duplication: a pirate group `pr:3,4`, an ambush party
 * `ab:<sector>@<bucket>`, a derelict's sentries `dd:3,4`, a graveyard's sleepers `gs:3,4`, a hunt or a
 * raid `hp:7`, `rd:2`; M4d: a relay counterattack `rc:A`, an escort ambush `ea:<serial>:<k>`.
 */
export function partyOf(id: string): string {
  return (
    pirateGroup(id) ??
    /^(ab:.+@\d+):\d+$/.exec(id)?.[1] ??
    /^((?:dd|gs):-?\d+,-?\d+):\d+$/.exec(id)?.[1] ??
    /^(rc:[A-Z]+):\d+$/.exec(id)?.[1] ??
    /^(ea:\d+:\d+):\d+$/.exec(id)?.[1] ??
    /^([a-z]+:\d+):\d+$/.exec(id)?.[1] ??
    id
  );
}

/** Parties that speak as a group (their leader's voice), not ship by ship. */
const GROUPED_PARTIES = ['ab:', 'gs:', 'rc:', 'ea:'];

/** The voice of a pirate group: its captain, else a Hammer, else a Gunner, else a Jackal. */
export function groupSpeaker(state: SimState, members: readonly { id: string; kind: EnemyKind }[], t: CommsTexts): Speaker {
  for (const m of members) {
    const cap = captainIndexOf(m.id);
    if (cap !== null) return captainSpeaker(state.seed, cap, t);
  }
  const kind: EnemyKind = members.some((m) => m.kind === 'hammer') ? 'hammer' : members.some((m) => m.kind === 'gunner') ? 'gunner' : 'jackal';
  return pirateSpeaker(kind, t);
}

/** The members of a group or party present in the combat state. */
export const membersOf = (state: SimState, group: string) => state.combat.enemies.filter((e) => partyOf(e.id) === group);

/** The ambush party of a director key (`ev:ambush:<sector>@<bucket>`): its group and its leader's kind. */
export function ambushLeader(state: SimState, key: string): { group: string; kind: EnemyKind } | null {
  const k = parseRolledKey(key);
  if (!k || k.kind !== 'ambush') return null;
  const depth = (sectorInfo(state.seed, k.sector)?.depth ?? 2) as RingIndex;
  return { group: ambushGroup(k.sector, k.bucket), kind: ambushParty(state.seed, k.sector, k.bucket, depth).kinds[0] ?? 'hammer' };
}

/** The Guild Watch hears the ship: Quiet and Guarded sectors and the Guild Lane corridors. */
export function watchCovers(state: SimState): boolean {
  const pos = state.player.body.pos;
  const security = securityHere(state, pos);
  return security === 'quiet' || security === 'guarded' || guildCorridorAt(state.seed, pos.x, pos.y);
}

/** A world direction (rad) as a clock bearing from the ship's bow (12 = ahead, 3 = right). */
export function clockOf(state: SimState, dir: number | undefined): number {
  if (dir === undefined) return 12;
  return clockHour((-(dir - state.player.body.angle) * 180) / Math.PI);
}

/** Display name of a comet `cm:<n>` ("Comet K-3"), in the current language. */
export function cometLabel(id: string): string {
  const n = Number(id.slice(id.indexOf(':') + 1));
  return tx().world.comet.name((Number.isFinite(n) ? n : 0) + 1);
}

/** The comet of a flyby key `ev:comet:<id>@<pass>`. */
export const flybyComet = (key: string): string => key.slice('ev:comet:'.length, key.lastIndexOf('@'));

/** The Guild Watch voice (its name and tag live with the sector radio texts). */
export const watchSpeaker = (): Speaker => guildWatchSpeaker(tx().sectors.radio.watch, tx().sectors.radio.watchRole);

/** The convoy pass of a flyby key `ev:convoy:<pass>`. */
export const flybyPass = (key: string): string => key.slice('ev:convoy:'.length);

/** Does the pirate the Watch engages go for the player (fighting within the Watch's defence range of the player)? */
function huntsPlayer(state: SimState, id: string): boolean {
  const e = state.combat.enemies.find((x) => x.id === id);
  if (!e || (e.ai.mode !== 'attack' && e.ai.mode !== 'evade' && e.ai.mode !== 'hail')) return false;
  const p = state.player.body.pos;
  return Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y) <= WATCH.defendRange;
}

/** The world direction from the player's ship to a point (rad). */
const dirTo = (state: SimState, at: { x: number; y: number }): number => Math.atan2(at.y - state.player.body.pos.y, at.x - state.player.body.pos.x);

/** Seconds on screen after typing, by how much there is to read. */
const ttlFor = (base: number, note?: string): number => base + (note ? Math.min(3, note.length / 40) : 0);

export function commsFromEvents(state: SimState, events: readonly SimEvent[], ctx: CommsContext): CommsSource[] {
  const t = ctx.texts;
  const tick = state.tick;
  const out: CommsSource[] = [];
  const station = (id: string): StationDef | null => state.world.stations().find((s) => s.id === id) ?? stationById(state.seed, id);
  // `text` builds who speaks and what in a language: now in `t`, again on a live language switch
  // (`retext`); what it needs from the state is read before, so a later rebuild says the same.
  // `noteOf`: the event whose toast becomes the factual note.
  const say = (
    key: string,
    text: (t: CommsTexts) => Omit<CommsText, 'note'>,
    channel: CommsChannel,
    replaces: SimEvent[],
    extra: Partial<Pick<CommsMessage, 'ttl' | 'reply' | 'pinned' | 'journal' | 'cooldown' | 'boost'>> & {
      noteOf?: SimEvent;
      /** The factual note when the event has no toast of its own ("Contacts at 5 o'clock – ambush."). */
      fact?: (t: CommsTexts) => string;
    } = {},
  ): CommsSource => {
    const { noteOf, fact, ...rest } = extra;
    const first = text(t);
    const toastNote = (): string | undefined => (noteOf ? (ctx.toastOf(noteOf) ?? undefined) : undefined);
    const note = toastNote() ?? fact?.(t);
    const msg: CommsMessage = { id: `${key}@${tick}`, key, speaker: first.speaker, lines: first.lines, channel, ttl: 3.5, tick };
    if (note) msg.note = note;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (msg as unknown as Record<string, unknown>)[k] = v;
    if (extra.ttl === undefined) msg.ttl = ttlFor(3.5, msg.note);
    msg.retext = () => {
      const tt = tx().comms;
      const again = text(tt);
      const n = toastNote() ?? fact?.(tt) ?? note;
      return n ? { ...again, note: n } : again;
    };
    const src = { msg, events: replaces };
    out.push(src);
    return src;
  };

  // parties that wake or speak in this step through their own event (not a plain alert)
  const woken = new Set(events.flatMap((x) => (x.type === 'sleepersWoke' ? [`gs:${x.id.slice(3)}`] : [])));

  for (const e of events) {
    switch (e.type) {
      // --- M4d: the Guild Watch and the relay chain ----------------------------------------------
      case 'watchEngaged': {
        // the sim throttles it (≤ 1 / WATCH.radioSeconds, near the flying player)
        const defend = huntsPlayer(state, e.target);
        say('watch:engage', (t) => ({ speaker: watchSpeaker(), lines: [pickLine(defend ? t.lines.watch.defend : t.lines.watch.engaged, tick, `engage:${e.id}`)] }), 'danger', [e], { noteOf: e, cooldown: 30 });
        break;
      }
      case 'watchRetreated': {
        const ship = state.guild.watch.find((w) => w.id === e.id);
        const p = state.player.body.pos;
        if (!ship || state.player.dock.mode !== 'flying' || Math.hypot(ship.body.pos.x - p.x, ship.body.pos.y - p.y) > WATCH.liveRadius) break;
        say('watch:retreat', (t) => ({ speaker: watchSpeaker(), lines: [pickLine(t.lines.watch.retreat, tick, `retreat:${e.id}`)] }), 'flavour', [e], { noteOf: e, cooldown: 60, ttl: 2.5 });
        break;
      }
      case 'relayRepaired':
        // the answer to the player's F at the mast goes on the air at once
        say(`relay:${e.lane}`, (t) => ({ speaker: watchSpeaker(), lines: [pickLine(t.lines.watch.relayRepaired, tick, `repaired:${e.lane}`)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      case 'relayHoldStarted': {
        const hour = clockOf(state, dirTo(state, e.at));
        const when = RELAY_CHAIN.counterattackDelay;
        const line = (t: CommsTexts) => pickLine(t.lines.watch.relayHold, tick, `hold:${e.lane}`)(t.bearing.clock(hour), t.bearing.inTime(when));
        say(`relay:${e.lane}`, (t) => ({ speaker: watchSpeaker(), lines: [line(t)] }), 'danger', [e], { noteOf: e });
        // the Rust party's leader taunts after the warning (its ships' alerts share the key and stay quiet)
        say(`alert:rc:${e.lane}`, (t) => ({ speaker: pirateSpeaker('hammer', t), lines: [pickLine(t.lines.pirate.relayCounter, tick, `counter:${e.lane}`)] }), 'danger', [], { cooldown: 120 });
        break;
      }
      case 'sectorSecured': {
        const name = (): string => {
          const info = sectorInfo(state.seed, e.sector);
          return info ? sectorName(info.name) : e.sector;
        };
        say(`relay:${e.lane}`, (t) => ({ speaker: watchSpeaker(), lines: [pickLine(t.lines.watch.secured, tick, `secured:${e.lane}`)(name())] }), 'story', [e], { noteOf: e });
        break;
      }

      // --- M4d: convoys of the Free Traders and the escort ----------------------------------------
      case 'convoyLinked':
        // the answer to the player's F at the trade port
        say(`convoy:${e.pass}`, (t) => ({ speaker: traderSpeaker(e.pass, false, t), lines: [pickLine(t.lines.convoy.linked, tick, `link:${e.pass}`)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      case 'convoyUnlinked': {
        const reason = e.reason;
        say(`convoy:${e.pass}`, (t) => ({ speaker: traderSpeaker(e.pass, false, t), lines: [pickLine(t.lines.convoyUnlinked[reason], tick, `unlink:${e.pass}`)] }), reason === 'pirates' ? 'danger' : 'station', [e], {
          noteOf: e,
          ttl: 2.5,
          boost: reason === 'player' ? 3 : undefined,
        });
        break;
      }
      case 'linkRejected': {
        // the trader whose port the player tried (none in reach: the toast stays)
        const pass = nearestTradePort(state)?.pose.pass;
        if (!pass) break;
        const reason = e.reason;
        say(`convoy:${pass}`, (t) => ({ speaker: traderSpeaker(pass, false, t), lines: [pickLine(t.lines.convoyRejected[reason], tick, `reject:${reason}`)] }), 'station', [e], { noteOf: e, ttl: 4.5, boost: 3 });
        break;
      }
      case 'convoyTraded':
        // one thanks for a shopping spree, not one per click (the trade window shows the amounts)
        say(`convoy:${e.pass}:trade`, (t) => ({ speaker: traderSpeaker(e.pass, false, t), lines: [pickLine(t.lines.convoy.traded, tick, `trade:${e.pass}`)] }), 'flavour', [], { cooldown: 45, ttl: 2.5 });
        break;
      case 'escortDeparted':
        say(`escort:${e.serial}`, (t) => ({ speaker: traderSpeaker(`es:${e.serial}`, true, t), lines: [pickLine(t.lines.escort.departed, tick, `depart:${e.serial}`)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      case 'escortStopped':
        say(`escort:${e.serial}:stop`, (t) => ({ speaker: traderSpeaker(`es:${e.serial}`, true, t), lines: [pickLine(t.lines.escort.stopped, tick, `stop:${e.serial}`)] }), 'danger', [e], { noteOf: e, cooldown: 20 });
        break;
      case 'escortAmbush': {
        const hour = clockOf(state, dirTo(state, e.pos));
        const line = (t: CommsTexts) => pickLine(t.lines.escort.ambush, tick, `ambush:${e.serial}`)(t.bearing.clock(hour));
        say(`escort:${e.serial}:ambush`, (t) => ({ speaker: traderSpeaker(`es:${e.serial}`, true, t), lines: [line(t)] }), 'danger', [e], { noteOf: e });
        break;
      }
      case 'contractFailed': {
        // the contract is gone; its log entry of this step tells the type and the issuer
        const entry = [...state.career.log].reverse().find((l) => l.kind === 'contractFailed' && l.tick === tick);
        const where = entry && 'station' in entry ? station(entry.station) : null;
        const faction: RepFactionId = entry && entry.kind === 'contractFailed' ? CONTRACT_DEFS[entry.type].faction : 'guild';
        const reason = e.reason;
        // the trader gives up on a missed or abandoned escort; a lost trader or ship – the contract desk
        const trader = entry?.kind === 'contractFailed' && entry.type === 'escort' && (reason === 'missed' || reason === 'abandoned');
        const id = e.contractId;
        const speaker = (t: CommsTexts): Speaker => (trader ? traderSpeaker(`es:${id}`, true, t) : contractSpeaker(where, faction, t));
        say(`contract:${id}`, (t) => ({ speaker: speaker(t), lines: [pickLine(t.lines.escortFailed[reason], tick, `failed:${id}`)] }), 'danger', [e], { noteOf: e });
        break;
      }

      // --- station traffic control -------------------------------------------------------------
      case 'dockingStarted': {
        const s = station(e.stationId);
        if (s) say(`dock:${s.id}`, (t) => ({ speaker: stationSpeaker(s, t), lines: [pickLine(t.lines.station.granted, tick, `dock:${s.id}`)] }), 'station', [], { boost: 3 });
        break;
      }
      case 'dockRejected': {
        const s = e.reason === 'noStation' ? null : ctx.dockStation();
        // the answer to the player's F goes on the air at once
        if (s) say(`dock:${s.id}`, (t) => ({ speaker: stationSpeaker(s, t), lines: [pickLine(t.lines.station.rejected, tick, `reject:${e.reason}`)] }), 'station', [e], { noteOf: e, ttl: 4.5, boost: 3 });
        break;
      }
      case 'undocked': {
        const s = station(e.stationId);
        if (s) say(`undock:${s.id}`, (t) => ({ speaker: stationSpeaker(s, t), lines: [pickLine(t.lines.station.undocked, tick, `undock:${s.id}`)] }), 'flavour', [], { ttl: 2.5 });
        break;
      }

      // --- contracts by the issuer -------------------------------------------------------------
      case 'contractAccepted':
      case 'contractReady': {
        const c = state.career.contracts.find((x) => x.serial === e.contractId);
        if (!c) break;
        const where = station(c.station);
        const faction = c.faction;
        // an escort's trader thanks on arrival itself (M4d)
        const escort = e.type === 'contractReady' && c.type === 'escort';
        const lines = (t: CommsTexts) => (escort ? t.lines.escort.arrived : e.type === 'contractAccepted' ? t.lines.contract.accepted : t.lines.contract.ready);
        const speaker = (t: CommsTexts): Speaker => (escort ? traderSpeaker(`es:${c.serial}`, true, t) : contractSpeaker(where, faction, t));
        // the answer to the player's click in the hub or the last buoy / delivery: the issuer speaks at once
        say(`contract:${c.serial}`, (t) => ({ speaker: speaker(t), lines: [pickLine(lines(t), tick, `${e.type}:${c.serial}`)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      }
      case 'contractCompleted': {
        const entry = [...state.career.log].reverse().find((l) => l.kind === 'contractCompleted' && l.tick === tick);
        const where = entry && 'station' in entry ? station(entry.station) : null;
        const faction: RepFactionId = entry && entry.kind === 'contractCompleted' ? CONTRACT_DEFS[entry.type].faction : 'guild';
        say(`contract:${e.contractId}`, (t) => ({ speaker: contractSpeaker(where, faction, t), lines: [pickLine(t.lines.contract.completed, tick, `done:${e.contractId}`)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      }
      case 'rescueFueled':
        say(`rescue:${e.contractId}`, (t) => ({ speaker: strandedSpeaker(t), lines: [pickLine(t.lines.contract.rescued, tick, `rescue:${e.contractId}`)] }), 'station', [e], { noteOf: e });
        break;

      // --- pirates: toll, alerts, hunts, raids ------------------------------------------------------
      case 'tollDemanded': {
        const members = membersOf(state, e.group);
        const line = (t: CommsTexts) => pickLine(t.lines.pirate.tollDemand, tick, `toll:${e.group}`)(formatCredits(e.amount));
        say(`toll:${e.group}`, (t) => ({ speaker: groupSpeaker(state, members, t), lines: [line(t)] }), 'danger', [e], { reply: 'toll', pinned: true, ttl: 0 });
        break;
      }
      case 'tollPaid':
      case 'tollRefused':
      case 'tollEscaped': {
        const members = membersOf(state, e.group);
        const lines = (P: CommsTexts['lines']['pirate']) => (e.type === 'tollPaid' ? P.tollPaid : e.type === 'tollEscaped' ? P.tollEscaped : e.timeout ? P.tollTimeout : P.tollRefused);
        say(`toll:${e.group}`, (t) => ({ speaker: groupSpeaker(state, members, t), lines: [pickLine(lines(t.lines.pirate), tick, `${e.type}:${e.group}`)] }), 'danger', [e], { noteOf: e, pinned: false });
        break;
      }
      case 'enemyAlert': {
        const cap = captainIndexOf(e.ref);
        if (cap !== null) {
          say(`cap:${cap}:hail`, (t) => ({ speaker: captainSpeaker(state.seed, cap, t), lines: [pickLine(t.lines.captain.appear, tick, `cap:${cap}`)] }), 'danger', [], { cooldown: 120 });
          break;
        }
        const enemy = state.combat.enemies.find((x) => x.id === e.ref);
        // sentry drones do not talk (their station's automaton does)
        if (!enemy || enemy.kind === 'scavenger' || enemy.kind === 'sentry') break;
        const party = partyOf(e.ref);
        // a group asking for a toll talks through the toll; a calm (paid) group says nothing; a woken
        // graveyard party speaks through its wake
        if (state.pirates.toll?.group === party || enemy.calm || woken.has(party)) break;
        const grouped = pirateGroup(e.ref) !== null || GROUPED_PARTIES.some((p) => party.startsWith(p));
        const members = grouped ? membersOf(state, party) : null;
        const kind = enemy.kind;
        const speaker = (t: CommsTexts) => (members ? groupSpeaker(state, members, t) : pirateSpeaker(kind, t));
        // a Gunner speaks its own taunts from range
        const lines = (t: CommsTexts) => (speaker(t).id === 'pirate:gunner' ? t.lines.gunner.alert : t.lines.pirate.alert);
        say(`alert:${party}`, (t) => ({ speaker: speaker(t), lines: [pickLine(lines(t), tick, `alert:${party}`)] }), 'flavour', [], { cooldown: 120, ttl: 2.5 });
        break;
      }
      case 'huntingParty': {
        const speaker = (t: CommsTexts) => (e.captain !== null ? captainSpeaker(state.seed, e.captain, t) : pirateSpeaker('hammer', t));
        say(`hunt:${e.captain ?? 'party'}`, (t) => ({ speaker: speaker(t), lines: [pickLine(t.lines.pirate.hunt, tick, 'hunt')] }), 'danger', [e], { noteOf: e });
        break;
      }
      case 'raidAnnounced': {
        const speaker = (t: CommsTexts) => (e.captain !== null ? captainSpeaker(state.seed, e.captain, t) : pirateSpeaker('hammer', t));
        const min = Math.ceil((e.arrive - tick) / (60 * TICKS));
        const line = (t: CommsTexts) =>
          e.kind === 'challenge'
            ? pickLine(t.lines.pirate.challenge, tick, `raid:${e.serial}`)(min)
            : pickLine(t.lines.pirate.raid, tick, `raid:${e.serial}`)(e.station ? stationLabel(state.seed, e.station) : tx().pirates.attention.nearYou);
        say(`raid:${e.serial}`, (t) => ({ speaker: speaker(t), lines: [line(t)] }), 'danger', [e], { noteOf: e });
        break;
      }
      case 'raidArrived': {
        const captain = state.pirates.raid?.captain ?? null;
        const speaker = (t: CommsTexts) => (captain !== null ? captainSpeaker(state.seed, captain, t) : pirateSpeaker('hammer', t));
        say(`raid:${e.serial}`, (t) => ({ speaker: speaker(t), lines: [pickLine(t.lines.pirate.raidArrived, tick, `arrive:${e.serial}`)] }), 'danger', [e], { noteOf: e });
        break;
      }
      case 'distressAmbush':
        say(`distress:${e.id}`, (t) => ({ speaker: pirateSpeaker('jackal', t), lines: [pickLine(t.lines.pirate.ambush, tick, `ambush:${e.id}`)] }), 'danger', [e], { noteOf: e });
        break;

      // --- named captains ---------------------------------------------------------------------------
      case 'captainPromoted': {
        const gloat = e.trophies.length > 0;
        say(`cap:${e.captain}`, (t) => ({ speaker: captainSpeaker(state.seed, e.captain, t), lines: [pickLine(gloat ? t.lines.captain.gloat : t.lines.captain.fled, tick, `cap:${e.captain}:up`)] }), 'danger', [e], { noteOf: e });
        break;
      }
      case 'captainDefeated':
        say(`cap:${e.captain}`, (t) => ({ speaker: captainSpeaker(state.seed, e.captain, t), lines: [pickLine(t.lines.captain.defeated, tick, `cap:${e.captain}:down`)] }), 'danger', [e], { noteOf: e });
        break;

      // --- the fortress -----------------------------------------------------------------------------
      case 'fortressReinforcements': {
        const site = fortressSites(state.seed).find((s) => s.id === e.fortress);
        const name = (): string => (site ? tx().pirates.fortressName(site.index) : e.fortress);
        say(`fortress:${e.fortress}:hangar`, (t) => ({ speaker: fortressSpeaker(name(), e.fortress, t), lines: [pickLine(t.lines.fortress.reinforcements, tick, e.fortress)] }), 'danger', [e], { noteOf: e, cooldown: 30 });
        break;
      }

      // --- distress calls ---------------------------------------------------------------------------
      case 'distressHeard': {
        // a trap sounds like a real call: fuel or repair by a hash of the signal
        const kind = e.kind === 'trap' ? (variantIndex(2, 0, e.id) === 0 ? 'fuel' : 'repair') : e.kind;
        // one call at a time: more signals in range at once (or soon after) do not flood the radio
        if (out.some((s) => s.msg.key === 'distress:heard')) {
          out.find((s) => s.msg.key === 'distress:heard')!.events.push(e);
          break;
        }
        say('distress:heard', (t) => ({ speaker: distressSpeaker(t), lines: [pickLine(t.lines.distress[kind], tick, `distress:${e.id}`)] }), 'danger', [e], { noteOf: e, cooldown: 60 });
        break;
      }
      case 'distressResolved':
        say(`distress:${e.id}`, (t) => ({ speaker: distressSpeaker(t), lines: [pickLine(t.lines.distress.resolved, tick, `saved:${e.id}`)] }), 'station', [e], { noteOf: e });
        break;

      // --- M4b space events (the director) -----------------------------------------------------------
      case 'eventWarning': {
        const hour = clockOf(state, e.dir);
        const when = e.inSeconds;
        if (e.kind === 'micrometeors') {
          // the Guild Watch covers Quiet / Guarded sectors and the Guild Lane; elsewhere the chip and a toast
          if (!watchCovers(state)) break;
          const line = (t: CommsTexts) => pickLine(t.lines.watch.micrometeors, tick, e.key)(t.bearing.clock(hour), t.bearing.inTime(when));
          say('watch:micrometeors', (t) => ({ speaker: watchSpeaker(), lines: [line(t)] }), 'danger', [e], { noteOf: e, cooldown: 30 });
        } else if (e.kind === 'ambush') {
          // the party taunts from the dark before it comes out (its alerts and the toll follow under the same key)
          const party = ambushLeader(state, e.key);
          if (!party) break;
          const leader = party.kind;
          const lines = (t: CommsTexts) => (leader === 'gunner' ? t.lines.gunner.ambush : t.lines.pirate.ambushWarn);
          say(`alert:${party.group}`, (t) => ({ speaker: pirateSpeaker(leader, t), lines: [pickLine(lines(t), tick, e.key)] }), 'danger', [e], {
            noteOf: e,
            fact: (t) => t.bearing.contacts(t.bearing.clock(hour)),
            cooldown: 120,
          });
        } else if (e.kind === 'cometFlyby') {
          const id = flybyComet(e.key);
          const line = (t: CommsTexts) => pickLine(t.lines.comet.flyby, tick, e.key)(cometLabel(id), t.bearing.inTime(when), t.bearing.clock(hour));
          say(`comet:${id}`, (t) => ({ speaker: instituteSpeaker(t), lines: [line(t)] }), 'station', [e], { noteOf: e });
        } else if (e.kind === 'convoyFlyby') {
          // the convoy announces itself (M4d): when, where, the trade open
          const pass = flybyPass(e.key);
          const line = (t: CommsTexts) => pickLine(t.lines.convoy.flyby, tick, e.key)(t.bearing.inTime(when), t.bearing.clock(hour));
          say(`convoy:${pass}`, (t) => ({ speaker: traderSpeaker(pass, false, t), lines: [line(t)] }), 'station', [e], { noteOf: e });
        }
        break;
      }

      // --- M4b world sites ---------------------------------------------------------------------------
      case 'cometSighted': {
        const id = e.id;
        say(`comet:${id}`, (t) => ({ speaker: instituteSpeaker(t), lines: [pickLine(t.lines.comet.sighted, tick, `sighted:${id}`)(cometLabel(id))] }), 'station', [e], { noteOf: e });
        break;
      }
      case 'relayPowered': {
        // only a derelict's relays have a voice (M4d Guild relays get their own)
        if (!e.site.startsWith('dl:')) break;
        const total = RELAY.count;
        const lit = e.lit;
        // the defence waking in the same step speaks for the relay too
        if (lit < total && events.some((x) => x.type === 'derelictWoke' && x.id === e.site)) break;
        const site = e.site;
        const line = (t: CommsTexts) => (lit >= total ? pickLine(t.lines.derelict.ready, tick, `ready:${site}`) : pickLine(t.lines.derelict.relay, tick, e.id)(lit, total));
        say(`derelict:${site}`, (t) => ({ speaker: derelictSpeaker(site, t), lines: [line(t)] }), 'station', [e], { noteOf: e });
        break;
      }
      case 'derelictWoke': {
        const relays = events.filter((x) => x.type === 'relayPowered' && x.site === e.id);
        const defence = e.defence;
        say(`derelict:${e.id}`, (t) => ({ speaker: derelictSpeaker(e.id, t), lines: [pickLine(t.lines.derelictWake[defence], tick, `wake:${e.id}`)] }), defence === 'none' ? 'station' : 'danger', [e, ...relays], {
          noteOf: e,
        });
        break;
      }
      case 'berthRejected': {
        const lit = [...state.sites.powered].filter((r) => r.startsWith(`${e.id}:r`)).length;
        const line = (t: CommsTexts) =>
          e.reason === 'relaysUnpowered' ? pickLine(t.lines.derelict.unpowered, tick, `unpowered:${e.id}`)(lit, RELAY.count) : pickLine(t.lines.derelict.rejected, tick, `reject:${e.reason}`);
        // the answer to the player's F goes on the air at once
        say(`derelict:${e.id}`, (t) => ({ speaker: derelictSpeaker(e.id, t), lines: [line(t)] }), 'station', [e], { noteOf: e, ttl: 4.5, boost: 3 });
        break;
      }
      case 'berthed': {
        const visit = events.find((x): x is Extract<SimEvent, { type: 'derelictVisited' }> => x.type === 'derelictVisited' && x.id === e.id);
        const entry = visit?.journal ? events.find((x) => x.type === 'journalEntry' && x.id === visit.journal) : undefined;
        const lines = (t: CommsTexts) => (visit ? t.lines.derelict.greeting : t.lines.derelict.welcomeBack);
        const replaces = [e, ...(visit ? [visit] : []), ...(entry ? [entry] : [])];
        say(`derelict:${e.id}`, (t) => ({ speaker: derelictSpeaker(e.id, t), lines: [pickLine(lines(t), tick, `berth:${e.id}`)] }), 'station', replaces, {
          noteOf: visit,
          boost: 3,
          journal: entry ? true : undefined,
        });
        break;
      }
      case 'berthLeft':
        say(`derelict:${e.id}`, (t) => ({ speaker: derelictSpeaker(e.id, t), lines: [pickLine(t.lines.derelict.farewell, tick, `leave:${e.id}`)] }), 'flavour', [], { ttl: 2.5 });
        break;
      case 'sleepersWoke': {
        const party = `gs:${e.id.slice(3)}`;
        const members = membersOf(state, party);
        say(`alert:${party}`, (t) => ({ speaker: groupSpeaker(state, members, t), lines: [pickLine(t.lines.graveyard.sleepersWoke, tick, e.id)] }), 'danger', [e], { noteOf: e, cooldown: 120 });
        break;
      }

      // --- M4c home station ---------------------------------------------------------------------------
      case 'homeModuleBuilt': {
        const home = station(HOME_STATION_ID);
        if (!home) break;
        const module = e.module;
        const line = (t: CommsTexts): string =>
          module === 'paintShop' || module === 'trophyHall'
            ? pickLine(t.lines.home[module], tick, `home:${module}`)
            : pickLine(t.lines.home.module, tick, `home:${module}`)(tx().home.modules[module].name);
        // the answer to the player's click in the Development tab goes on the air at once
        say(`home:${module}`, (t) => ({ speaker: stationSpeaker(home, t), lines: [line(t)] }), 'station', [e], { noteOf: e, boost: 3 });
        break;
      }

      // --- the Echo and the story -------------------------------------------------------------------
      case 'echoHeard': {
        const named = echoNamed(state);
        say(`echo:${e.echo}`, (t) => ({ speaker: echoSpeaker(named, t), lines: [pickLine(e.located ? t.lines.echo.located : t.lines.echo.heard, tick, `echo:${e.echo}`)] }), 'story', [e], { noteOf: e });
        break;
      }
      case 'keyItemFound': {
        const named = echoNamed(state);
        say(`key:${e.item}`, (t) => ({ speaker: echoSpeaker(named, t), lines: [pickLine(e.item === 'shard' ? t.lines.echo.shard : t.lines.echo.resonator, tick, e.item)] }), 'story', [e], { noteOf: e });
        break;
      }
      default:
        break;
    }
  }

  // story beats of the journal: a message of the Echo in the same step carries the link; otherwise the
  // Echo speaks the beat itself
  for (const e of events) {
    if (e.type !== 'journalEntry' || !ECHO_STORY_ENTRIES.has(e.id)) continue;
    const echo = out.find((s) => s.msg.speaker.id === 'echo');
    if (echo) {
      echo.msg.journal = true;
      echo.events.push(e);
      continue;
    }
    const named = echoNamed(state);
    say(`journal:${e.id}`, (t) => ({ speaker: echoSpeaker(named, t), lines: [pickLine(t.lines.echo.journal, tick, e.id)] }), 'story', [e], { noteOf: e, journal: true });
  }
  return out;
}

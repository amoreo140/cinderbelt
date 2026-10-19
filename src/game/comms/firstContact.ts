// Scripted first contacts: short exchanges of 2–3 radio lines, queued
// one after another, the first time something new speaks to the player.
// - The first pirate group that notices the player: the pirate taunts, the Guild instructor (during
//   the training) or home traffic control warns, the pirate answers. When the group demands a toll
//   right away, the toll is its line and the warning follows once the toll is answered.
// - The first Echo signal: the glitched "Unknown signal", a puzzled human voice, the signal again.
// - M4b: the first ambush (the leader's taunt from the dark, the warning, the leader again), the first
//   comet seen (the Institute's observatory, the warner, the Institute's tip) and the first derelict
//   relay lit (the station's automaton wakes, the warner, the automaton again).
// - M4d: the first live Guild Watch fight near the player (the Watch, the warner, the Watch again) and
//   the first convoy flyby (the trader, the warner, the trader again).
// Presentation memory only (not saved): "first" is read from the sim – the Echo's first journal entry
// is written in the same step, pirates count as new while the player has never beaten or paid them,
// the first comet is the only one known, the first relay the only derelict relay powered, the first
// ambush the only one in the director's one-shot keys, the first convoy flyby the only `ev:convoy:` key,
// the first Watch fight the first Watch radio line ever (`guild.lastRadio` was "never" in the step
// before). So a loaded game does not replay them.
import type { SimEvent, SimState } from '../../sim/Simulation';
import { captainIndexOf } from '../../sim/captains/captains';
import { homeStation } from '../../sim/world/stations';
import { tx } from '../../i18n';
import type { CommsTexts } from '../../i18n/skComms';
import { ambushLeader, echoNamed, groupSpeaker, pirateGroup, type CommsSource } from './mapper';
import { flybyPass, watchSpeaker } from './mapper';
import { derelictSpeaker, echoSpeaker, instituteSpeaker, instructorSpeaker, pirateSpeaker, stationSpeaker, traderSpeaker } from './speakers';
import type { CommsChannel, CommsMessage, CommsText, Speaker } from './types';
import { pickLine } from './variants';

/** The journal entry the first Echo signal writes. */
export const FIRST_ECHO_ENTRY = 'echo0Heard';

/** Pirates are new to the player: none beaten, no toll paid. */
export const piratesNew = (state: SimState): boolean => state.stats.kills === 0 && state.pirates.paid.size === 0;

/** No ambush before this one: the director keeps no other ambush key (markers `#hail` / `#end` aside). */
export const firstAmbush = (state: SimState, key: string): boolean => ![...state.director.fired.keys()].some((k) => k !== key && k.startsWith('ev:ambush:') && !k.includes('#'));

/** Every known comet was sighted in this step (`now`): it is the first comet of the game. */
export const firstComet = (state: SimState, now: ReadonlySet<string>): boolean => [...state.discovery.known].every((id) => !id.startsWith('cm:') || now.has(id));

/** Every powered derelict relay was lit in this step (`now`): it is the first of the game. */
export const firstRelay = (state: SimState, now: ReadonlySet<string>): boolean => [...state.sites.powered].every((id) => !id.startsWith('dl:') || now.has(id));

/** The first convoy flyby of the game: no other pass's flyby in the director's one-shot keys. */
export const firstConvoy = (state: SimState, key: string): boolean => ![...state.director.fired.keys()].some((k) => k !== key && k.startsWith('ev:convoy:'));

/** `guild.lastRadio` before the Watch ever spoke (GuildState default -1e9). */
const NEVER_RADIO = -1e8;

/** A scripted line: who says what, built in a language (again on a live language switch). */
interface Line {
  key: string;
  say: (t: CommsTexts) => { speaker: Speaker; text: string };
  channel: CommsChannel;
}

/** A message's lines replaced by a scripted one: now, and in its rebuilt text too. */
function rewrite(msg: CommsMessage, line: (t: CommsTexts) => string, t: CommsTexts): void {
  msg.lines = [line(t)];
  const base = msg.retext;
  msg.retext = (): CommsText => {
    const lines = [line(tx().comms)];
    return base ? { ...base(), lines } : { speaker: msg.speaker, lines };
  };
}

export class FirstContacts {
  private pirateDone = false;
  private echoDone = false;
  private ambushDone = false;
  private cometDone = false;
  private derelictDone = false;
  private watchDone = false;
  private convoyDone = false;
  /** `guild.lastRadio` after the previous step (null = no step seen yet: no first contact can be told). */
  private lastRadio: number | null = null;
  /** Lines waiting for the open toll to be answered. */
  private held: Line[] = [];

  /**
   * One simulation step: adjusts the mapper's messages of a first contact (in place) and returns the
   * follow-up messages to queue after them, in order.
   */
  update(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts): CommsMessage[] {
    const out: Line[] = [];
    this.echo(state, events, sources, t, out);
    this.ambush(state, events, sources, t, out);
    this.pirate(state, events, sources, t, out);
    this.comet(state, events, sources, t, out);
    this.derelict(state, events, sources, t, out);
    this.watch(state, events, sources, t, out);
    this.convoy(state, events, sources, t, out);
    this.lastRadio = state.guild.lastRadio;
    if (this.held.length > 0 && !state.pirates.toll) {
      out.push(...this.held);
      this.held = [];
    }
    return out.map((l) => {
      const first = l.say(t);
      const retext = (): CommsText => {
        const again = l.say(tx().comms);
        return { speaker: again.speaker, lines: [again.text] };
      };
      return { id: `${l.key}@${state.tick}`, key: l.key, speaker: first.speaker, lines: [first.text], channel: l.channel, ttl: 3.5 + Math.min(3, first.text.length / 40), tick: state.tick, retext };
    });
  }

  /** Who warns the player: the instructor during the training, else home traffic control. */
  private warner(state: SimState): { speaker: (t: CommsTexts) => Speaker; training: boolean } {
    const training = state.career.training.status === 'active';
    return { speaker: (t) => (training ? instructorSpeaker(t) : stationSpeaker(homeStation(), t)), training };
  }

  private echo(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.echoDone) return;
    const first = events.some((e) => e.type === 'journalEntry' && e.id === FIRST_ECHO_ENTRY) && events.some((e) => e.type === 'echoHeard');
    if (!first) return;
    this.echoDone = true;
    const tick = state.tick;
    // the mapper's Echo message (it carries the journal link) speaks the scripted first line
    const signal = sources.find((s) => s.msg.speaker.id === 'echo');
    if (signal) rewrite(signal.msg, (tt) => pickLine(tt.firstContact.echo, tick, 'first:echo'), t);
    const named = echoNamed(state);
    const warner = this.warner(state);
    out.push(
      { key: 'first:echo:reaction', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.echoReaction, tick, 'first:echo:reaction') }), channel: 'story' },
      { key: 'first:echo:again', say: (tt) => ({ speaker: echoSpeaker(named, tt), text: pickLine(tt.firstContact.echoAgain, tick, 'first:echo:again') }), channel: 'story' },
    );
  }

  /** The mapper's message of an event speaks a scripted first line (else the line is queued as `fallback`). */
  private opener(sources: CommsSource[], event: SimEvent, line: (t: CommsTexts) => string, t: CommsTexts, fallback: Line, channel: CommsMessage['channel']): Line[] {
    const src = sources.find((s) => s.events.includes(event));
    if (!src) return [fallback];
    rewrite(src.msg, line, t);
    src.msg.channel = channel;
    src.msg.ttl = 3.5 + Math.min(3, line(t).length / 40);
    return [];
  }

  private ambush(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.ambushDone) return;
    const warn = events.find((e): e is Extract<SimEvent, { type: 'eventWarning' }> => e.type === 'eventWarning' && e.kind === 'ambush');
    if (!warn) return;
    const party = ambushLeader(state, warn.key);
    if (!party) return;
    this.ambushDone = true;
    if (!firstAmbush(state, warn.key)) return;
    // the exchange is the player's first word with pirates too
    this.pirateDone = true;
    const tick = state.tick;
    const leader = party.kind;
    const pirate = (tt: CommsTexts): Speaker => pirateSpeaker(leader, tt);
    const taunt = (tt: CommsTexts): string => pickLine(tt.firstContact.ambush, tick, 'first:ambush');
    const warner = this.warner(state);
    out.push(
      ...this.opener(sources, warn, taunt, t, { key: `alert:${party.group}`, say: (tt) => ({ speaker: pirate(tt), text: taunt(tt) }), channel: 'danger' }, 'danger'),
      { key: 'first:ambush:warn', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.ambushWarn, tick, 'first:ambush:warn') }), channel: 'danger' },
      { key: 'first:ambush:retort', say: (tt) => ({ speaker: pirate(tt), text: pickLine(tt.firstContact.ambushRetort, tick, 'first:ambush:retort') }), channel: 'danger' },
    );
  }

  private comet(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.cometDone) return;
    const seen = events.filter((e): e is Extract<SimEvent, { type: 'cometSighted' }> => e.type === 'cometSighted');
    if (seen.length === 0) return;
    this.cometDone = true;
    if (!firstComet(state, new Set(seen.map((e) => e.id)))) return;
    const tick = state.tick;
    const first = seen[0]!;
    const line = (tt: CommsTexts): string => pickLine(tt.firstContact.comet, tick, 'first:comet');
    const warner = this.warner(state);
    out.push(
      ...this.opener(sources, first, line, t, { key: `comet:${first.id}`, say: (tt) => ({ speaker: instituteSpeaker(tt), text: line(tt) }), channel: 'story' }, 'story'),
      { key: 'first:comet:reaction', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.cometReaction, tick, 'first:comet:reaction') }), channel: 'story' },
      { key: 'first:comet:again', say: (tt) => ({ speaker: instituteSpeaker(tt), text: pickLine(tt.firstContact.cometAgain, tick, 'first:comet:again') }), channel: 'story' },
    );
  }

  private derelict(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.derelictDone) return;
    const lit = events.filter((e): e is Extract<SimEvent, { type: 'relayPowered' }> => e.type === 'relayPowered' && e.site.startsWith('dl:'));
    if (lit.length === 0) return;
    this.derelictDone = true;
    if (!firstRelay(state, new Set(lit.map((e) => e.id)))) return;
    const tick = state.tick;
    const first = lit[0]!;
    const site = first.site;
    const line = (tt: CommsTexts): string => pickLine(tt.firstContact.derelict, tick, 'first:derelict');
    const warner = this.warner(state);
    out.push(
      ...this.opener(sources, first, line, t, { key: `derelict:${site}`, say: (tt) => ({ speaker: derelictSpeaker(site, tt), text: line(tt) }), channel: 'story' }, 'story'),
      { key: 'first:derelict:reaction', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.derelictReaction, tick, 'first:derelict:reaction') }), channel: 'story' },
      { key: 'first:derelict:again', say: (tt) => ({ speaker: derelictSpeaker(site, tt), text: pickLine(tt.firstContact.derelictAgain, tick, 'first:derelict:again') }), channel: 'story' },
    );
  }

  private watch(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.watchDone) return;
    const engaged = events.find((e) => e.type === 'watchEngaged');
    if (!engaged) return;
    this.watchDone = true;
    // the Watch spoke before (an earlier step or a loaded game): not the first fight
    if (this.lastRadio === null || this.lastRadio > NEVER_RADIO) return;
    const tick = state.tick;
    const line = (tt: CommsTexts): string => pickLine(tt.firstContact.watch, tick, 'first:watch');
    const warner = this.warner(state);
    out.push(
      ...this.opener(sources, engaged, line, t, { key: 'watch:engage', say: (tt) => ({ speaker: watchSpeaker(), text: line(tt) }), channel: 'danger' }, 'danger'),
      { key: 'first:watch:reaction', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.watchReaction, tick, 'first:watch:reaction') }), channel: 'danger' },
      { key: 'first:watch:again', say: (tt) => ({ speaker: watchSpeaker(), text: pickLine(tt.firstContact.watchAgain, tick, 'first:watch:again') }), channel: 'danger' },
    );
  }

  private convoy(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.convoyDone) return;
    const flyby = events.find((e): e is Extract<SimEvent, { type: 'eventWarning' }> => e.type === 'eventWarning' && e.kind === 'convoyFlyby');
    if (!flyby) return;
    this.convoyDone = true;
    if (!firstConvoy(state, flyby.key)) return;
    const tick = state.tick;
    const pass = flybyPass(flyby.key);
    const trader = (tt: CommsTexts): Speaker => traderSpeaker(pass, false, tt);
    const line = (tt: CommsTexts): string => pickLine(tt.firstContact.convoy, tick, 'first:convoy');
    const warner = this.warner(state);
    out.push(
      ...this.opener(sources, flyby, line, t, { key: `convoy:${pass}`, say: (tt) => ({ speaker: trader(tt), text: line(tt) }), channel: 'story' }, 'story'),
      { key: 'first:convoy:reaction', say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(tt.firstContact.convoyReaction, tick, 'first:convoy:reaction') }), channel: 'story' },
      { key: 'first:convoy:again', say: (tt) => ({ speaker: trader(tt), text: pickLine(tt.firstContact.convoyAgain, tick, 'first:convoy:again') }), channel: 'story' },
    );
  }

  private pirate(state: SimState, events: readonly SimEvent[], sources: CommsSource[], t: CommsTexts, out: Line[]): void {
    if (this.pirateDone || !piratesNew(state)) return;
    const tick = state.tick;
    const toll = events.find((e): e is Extract<SimEvent, { type: 'tollDemanded' }> => e.type === 'tollDemanded');
    const alert = events.find((e): e is Extract<SimEvent, { type: 'enemyAlert' }> => {
      if (e.type !== 'enemyAlert' || !pirateGroup(e.ref) || captainIndexOf(e.ref) !== null) return false;
      const enemy = state.combat.enemies.find((x) => x.id === e.ref);
      return !!enemy && enemy.kind !== 'scavenger' && !enemy.calm;
    });
    if (!toll && !alert) return;
    this.pirateDone = true;
    const warner = this.warner(state);
    const warn: Line = {
      key: 'first:pirate:warn',
      say: (tt) => ({ speaker: warner.speaker(tt), text: pickLine(warner.training ? tt.firstContact.warnInstructor : tt.firstContact.warnTraffic, tick, 'first:pirate:warn') }),
      channel: 'danger',
    };
    if (toll) {
      // the toll demand is the pirate's line; the warning waits until it is answered
      this.held.push(warn);
      return;
    }
    const group = pirateGroup(alert!.ref)!;
    const members = state.combat.enemies.filter((e) => pirateGroup(e.id) === group);
    const pirate = (tt: CommsTexts): Speaker => groupSpeaker(state, members, tt);
    const taunt = (tt: CommsTexts): string => pickLine(tt.firstContact.pirate, tick, `first:pirate:${group}`);
    // the group's alert becomes the scripted taunt (danger: the exchange is not chatter)
    const src = sources.find((s) => s.msg.key === `alert:${group}`);
    if (src) {
      rewrite(src.msg, taunt, t);
      src.msg.channel = 'danger';
      src.msg.ttl = 3.5;
    } else out.push({ key: `alert:${group}`, say: (tt) => ({ speaker: pirate(tt), text: taunt(tt) }), channel: 'danger' });
    out.push(warn, { key: 'first:pirate:retort', say: (tt) => ({ speaker: pirate(tt), text: pickLine(tt.firstContact.pirateRetort, tick, 'first:pirate:retort') }), channel: 'danger' });
  }
}

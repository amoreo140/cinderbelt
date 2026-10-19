// Speakers resolved for display: names in the current language, the portrait and the voice colour
// (src/data/speakers.ts) of fixed voices, station traffic control, contract desks and named captains.
import { captainPortrait, isCaptainClan, PORTRAITS, SPEAKERS, trafficPortrait, trafficRole, type PortraitId, type SpeakerDef } from '../../data/speakers';
import type { RepFactionId } from '../../data/factions';
import type { EnemyKind } from '../../sim/combat/types';
import { captainDef } from '../../sim/captains/captains';
import type { StationDef } from '../../sim/world/stations';
import type { CommsTexts } from '../../i18n/skComms';
import { formatStationName } from '../../ui/stationName';
import { tx } from '../../i18n';
import { captainName } from '../board/names';
import type { Speaker } from './types';
import { hashText } from './variants';

function fromPortrait(id: string, portrait: PortraitId, name: string, role: string): Speaker {
  const p = PORTRAITS[portrait];
  return { id, name, role, portrait, faction: p.faction, kind: p.role, accent: p.accent };
}

/** A fixed voice (instructor, pirate kinds, Echo, distress). */
export function fixedSpeaker(def: SpeakerDef, t: CommsTexts, role: string): Speaker {
  const name = t.speakers[def.name];
  return fromPortrait(def.id, def.portrait, typeof name === 'string' ? name : def.id, role);
}

export const instructorSpeaker = (t: CommsTexts): Speaker => fixedSpeaker(SPEAKERS.instructor, t, t.roles.instructor);

/** Traffic control of a station (portrait by the station's role). */
export function stationSpeaker(station: StationDef, t: CommsTexts): Speaker {
  const portrait = trafficPortrait(trafficRole(station.kind, station.model));
  return fromPortrait(`traffic:${station.id}`, portrait, t.speakers.traffic(formatStationName(station)), t.roles.traffic);
}

/** The contract desk of the issuing station; Institute contracts speak with the research voice. */
export function contractSpeaker(station: StationDef | null, faction: RepFactionId, t: CommsTexts): Speaker {
  const portrait: PortraitId = faction === 'institute' ? 'traffic_research' : station ? trafficPortrait(trafficRole(station.kind, station.model)) : 'traffic_home';
  const name = station ? t.speakers.contracts(formatStationName(station)) : t.factions[faction];
  return fromPortrait(`contracts:${station?.id ?? faction}`, portrait, name, t.roles.contracts(t.factions[faction]));
}

/**
 * The Guild Watch (sectors §3.1): the Guild's patrol voice in Guarded sectors, with its own
 * `guild_watch` portrait (strobe-blue voice).
 */
export const guildWatchSpeaker = (name: string, role: string): Speaker => fromPortrait('guildWatch', 'guild_watch', name, role);

/** A named captain: the clan's bust (a / b by the captain id), the name and the clan tag. */
export function captainSpeaker(seed: number, index: number, t: CommsTexts): Speaker {
  const def = captainDef(seed, index);
  const clan = def?.clan ?? 'rust';
  const clanName = isCaptainClan(clan) ? t.clans[clan] : t.clans.rust;
  return fromPortrait(`cap:${index}`, captainPortrait(clan, index), captainName(seed, index), t.roles.captain(clanName));
}

/** The Gunner (M4b): the long-range pirate, with its own rangefinder-helmet portrait. */
export const gunnerSpeaker = (t: CommsTexts): Speaker => fromPortrait('pirate:gunner', 'pirate_gunner', t.speakers.gunner, t.roles.pirate);

/** A generic pirate voice by ship kind (a scavenger speaks like a jackal). */
export function pirateSpeaker(kind: EnemyKind, t: CommsTexts): Speaker {
  if (kind === 'gunner') return gunnerSpeaker(t);
  return fixedSpeaker(kind === 'hammer' ? SPEAKERS.hammer : SPEAKERS.jackal, t, t.roles.pirate);
}

/** The Institute's observatory (comet flybys and sightings): the research traffic voice. */
export const instituteSpeaker = (t: CommsTexts): Speaker => fromPortrait('institute', 'traffic_research', t.speakers.institute, t.roles.research);

/**
 * The automaton of a derelict station (an old Guild AI): relays, its defence, the clamp and the
 * terminal, with the cracked-terminal `derelict_ai` portrait.
 */
export const derelictSpeaker = (id: string, t: CommsTexts): Speaker => fromPortrait(`derelict:${id}`, 'derelict_ai', t.speakers.derelictAi, t.roles.derelict);

/** The Rust fortress itself (its commander on the loudspeaker). */
export function fortressSpeaker(name: string, id: string, t: CommsTexts): Speaker {
  return fromPortrait(`fortress:${id}`, 'pirate_hammer', name, t.roles.fortress);
}

/** The Echo signal – unnamed until the story names the Smiths. */
export function echoSpeaker(named: boolean, t: CommsTexts): Speaker {
  return fromPortrait('echo', 'echo', named ? t.speakers.echoNamed : t.speakers.echoUnknown, t.roles.echo);
}

export const distressSpeaker = (t: CommsTexts): Speaker => fixedSpeaker(SPEAKERS.distress, t, t.roles.distress);

export const strandedSpeaker = (t: CommsTexts): Speaker => fromPortrait('stranded', 'unknown', t.speakers.stranded, t.roles.distress);

/**
 * The name of a Free Traders ship (`tx().guild.convoy.traders`), stable for a convoy pass (`cv:A@3`) or an
 * escort convoy (`es:<serial>`) – the radio, the trade window and the slips can share it.
 */
export function traderName(id: string, names: readonly string[] = tx().guild.convoy.traders): string {
  return names.length > 0 ? names[hashText(id) % names.length]! : id;
}

/** The trader of a convoy pass or of an escort contract (`escort`) – the Free Traders' voice. */
export function traderSpeaker(id: string, escort: boolean, t: CommsTexts): Speaker {
  const c = tx().guild.convoy;
  return fromPortrait(`trader:${id}`, 'traffic_trade', c.trader(traderName(id, c.traders)), escort ? t.roles.escort : t.roles.convoy);
}

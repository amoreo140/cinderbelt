// Communicator speakers (plan 2026-10-17-komunikator §1, §3): who can talk on the radio – portrait,
// faction, role and voice colour (the UI accent). Portrait ids and accents mirror the art manifest
// public/assets/ui/portraits/portraits.json (speakers.test.ts keeps them in sync). Names are i18n
// (src/i18n/skComms.ts); dynamic speakers (a station's traffic control, a named captain) are
// resolved by the comms layer from these definitions.
import type { StationKind, StationModel } from './stations';
import type { FactionId } from './factions';
import { hash3 } from '../sim/world/hash';

/** Portraits shipped in public/assets/ui/portraits (128 px `<id>.webp` + 256 px `<id>@2x.webp`). */
export type PortraitId =
  | 'guild_instructor'
  | 'traffic_home'
  | 'traffic_trade'
  | 'traffic_mining'
  | 'traffic_research'
  | 'traffic_outpost'
  | 'guild_watch'
  | 'derelict_ai'
  | 'pirate_gunner'
  | 'pirate_jackal'
  | 'pirate_hammer'
  | 'captain_rust_a'
  | 'captain_rust_b'
  | 'captain_cauldron_a'
  | 'captain_cauldron_b'
  | 'captain_slantedStar_a'
  | 'captain_slantedStar_b'
  | 'echo'
  | 'unknown';

/** Faction of a portrait as in the manifest (`pirate` = clan-less pirate ships, `unknown` = fallback). */
export type PortraitFaction = FactionId | 'pirate' | 'unknown';

export type SpeakerRole = 'instructor' | 'traffic' | 'watch' | 'automaton' | 'pirate' | 'captain' | 'echo' | 'unknown';

export interface PortraitDef {
  id: PortraitId;
  faction: PortraitFaction;
  role: SpeakerRole;
  /** Voice colour – the channel stripe and the role tag in the comm panel. */
  accent: string;
}

export const PORTRAITS: Record<PortraitId, PortraitDef> = {
  guild_instructor: { id: 'guild_instructor', faction: 'guild', role: 'instructor', accent: '#f27a2c' },
  traffic_home: { id: 'traffic_home', faction: 'guild', role: 'traffic', accent: '#f27a2c' },
  traffic_trade: { id: 'traffic_trade', faction: 'freeTraders', role: 'traffic', accent: '#6be38a' },
  traffic_mining: { id: 'traffic_mining', faction: 'guild', role: 'traffic', accent: '#f4c64e' },
  traffic_research: { id: 'traffic_research', faction: 'institute', role: 'traffic', accent: '#62d9f4' },
  traffic_outpost: { id: 'traffic_outpost', faction: 'guild', role: 'traffic', accent: '#4aa8ea' },
  guild_watch: { id: 'guild_watch', faction: 'guild', role: 'watch', accent: '#86a8ff' },
  derelict_ai: { id: 'derelict_ai', faction: 'guild', role: 'automaton', accent: '#c39a5a' },
  pirate_jackal: { id: 'pirate_jackal', faction: 'pirate', role: 'pirate', accent: '#ff5a4a' },
  pirate_hammer: { id: 'pirate_hammer', faction: 'pirate', role: 'pirate', accent: '#ffb547' },
  pirate_gunner: { id: 'pirate_gunner', faction: 'pirate', role: 'pirate', accent: '#ff6a2a' },
  captain_rust_a: { id: 'captain_rust_a', faction: 'rust', role: 'captain', accent: '#ff5a4a' },
  captain_rust_b: { id: 'captain_rust_b', faction: 'rust', role: 'captain', accent: '#ff5a4a' },
  captain_cauldron_a: { id: 'captain_cauldron_a', faction: 'cauldron', role: 'captain', accent: '#ff8a3a' },
  captain_cauldron_b: { id: 'captain_cauldron_b', faction: 'cauldron', role: 'captain', accent: '#ff8a3a' },
  captain_slantedStar_a: { id: 'captain_slantedStar_a', faction: 'slantedStar', role: 'captain', accent: '#ffd36b' },
  captain_slantedStar_b: { id: 'captain_slantedStar_b', faction: 'slantedStar', role: 'captain', accent: '#ffd36b' },
  echo: { id: 'echo', faction: 'wardens', role: 'echo', accent: '#8f7dff' },
  unknown: { id: 'unknown', faction: 'unknown', role: 'unknown', accent: '#93a0b3' },
};

export const PORTRAIT_IDS = Object.keys(PORTRAITS) as PortraitId[];

/** Where the portrait files are served from (relative to the base URL). */
export const portraitPath = (id: PortraitId, retina = false): string => `assets/ui/portraits/${id}${retina ? '@2x' : ''}.webp`;

/** Traffic control voices by station role. */
export type TrafficRole = 'home' | 'trade' | 'mining' | 'research' | 'outpost';

/**
 * The station's traffic control portrait. `StationKind` is only home / station / outpost, so a regular
 * station takes its role from its model variant (the same building always has the same voice).
 */
export function trafficRole(kind: StationKind, model: StationModel): TrafficRole {
  if (kind === 'home') return 'home';
  if (kind === 'outpost') return 'outpost';
  if (model === 'station_a' || model === 'station_e') return 'trade';
  return model === 'station_b' ? 'mining' : 'research';
}

export const trafficPortrait = (role: TrafficRole): PortraitId => `traffic_${role}`;

/** Clans with captain portraits. */
export type CaptainClan = 'rust' | 'cauldron' | 'slantedStar';
const CLAN_PORTRAITS: Record<CaptainClan, readonly [PortraitId, PortraitId]> = {
  rust: ['captain_rust_a', 'captain_rust_b'],
  cauldron: ['captain_cauldron_a', 'captain_cauldron_b'],
  slantedStar: ['captain_slantedStar_a', 'captain_slantedStar_b'],
};

export const isCaptainClan = (f: FactionId): f is CaptainClan => f === 'rust' || f === 'cauldron' || f === 'slantedStar';

/** A captain's portrait: the clan's bust, a or b by a hash of the captain id (stable for the seed). */
export function captainPortrait(clan: FactionId, captain: number): PortraitId {
  if (!isCaptainClan(clan)) return 'pirate_hammer';
  return CLAN_PORTRAITS[clan][hash3(captain, 0xc0, 0x5eed) & 1]!;
}

/** Key of a speaker's name in `CommsTexts.speakers` (i18n). */
export type SpeakerNameKey = 'instructor' | 'traffic' | 'contracts' | 'jackal' | 'hammer' | 'echoUnknown' | 'echoNamed' | 'distress' | 'stranded' | 'unknown';

/** A fixed voice of the world. Captains and station traffic are filled in per captain / station. */
export interface SpeakerDef {
  id: string;
  portrait: PortraitId;
  faction: PortraitFaction;
  role: SpeakerRole;
  accent: string;
  name: SpeakerNameKey;
}

const speaker = (id: string, portrait: PortraitId, name: SpeakerNameKey): SpeakerDef => ({
  id,
  portrait,
  faction: PORTRAITS[portrait].faction,
  role: PORTRAITS[portrait].role,
  accent: PORTRAITS[portrait].accent,
  name,
});

export const SPEAKERS = {
  instructor: speaker('instructor', 'guild_instructor', 'instructor'),
  trafficHome: speaker('traffic:home', 'traffic_home', 'traffic'),
  trafficTrade: speaker('traffic:trade', 'traffic_trade', 'traffic'),
  trafficMining: speaker('traffic:mining', 'traffic_mining', 'traffic'),
  trafficResearch: speaker('traffic:research', 'traffic_research', 'traffic'),
  trafficOutpost: speaker('traffic:outpost', 'traffic_outpost', 'traffic'),
  jackal: speaker('pirate:jackal', 'pirate_jackal', 'jackal'),
  hammer: speaker('pirate:hammer', 'pirate_hammer', 'hammer'),
  echo: speaker('echo', 'echo', 'echoUnknown'),
  distress: speaker('distress', 'unknown', 'distress'),
  unknown: speaker('unknown', 'unknown', 'unknown'),
} as const satisfies Record<string, SpeakerDef>;

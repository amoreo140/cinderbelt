import { RESOURCES, type ResourceId } from '../data/resources';
import { COMET, MINE } from '../data/sites';
import type { Vec2 } from '../sim/math/vec2';
import { SITE_COLORS } from './canvasDraw';
import { PALETTE } from './theme/tokens';

/**
 * Radar grammar (readability pass R7): the shape says what it is – filled = a ship, hollow (an outline,
 * at most a faint fill) = an object; the colour says how it stands – red attacks me, amber is hostile
 * but calm, blue is a neutral ship. Stations and rocks keep their own colours (kind, ore).
 */
export type RadarGlyph =
  | 'shipAttacking'
  | 'shipHostile'
  | 'shipNeutral'
  | 'station'
  | 'rock'
  | 'richRock'
  | 'signal'
  | 'place'
  | 'wreck'
  | 'pirateBase'
  | 'survey'
  // M4b world sites (T10): a derelict station with its relays, a ship graveyard with its live mines, a comet
  | 'derelict'
  | 'graveyard'
  | 'comet'
  // M4d (T11): a live Guild Watch ship (a friend, green), a Free Traders convoy (neutral blue), a Guild relay
  | 'guildWatch'
  | 'convoy'
  | 'guildRelay';

export const hexColor = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export interface RadarStyle {
  /** Ships are filled, objects hollow. */
  filled: boolean;
  /** null = the contact's own colour (station kind, ore). */
  color: string | null;
}

export const RADAR_STYLES: Readonly<Record<RadarGlyph, RadarStyle>> = {
  shipAttacking: { filled: true, color: PALETTE.bad },
  shipHostile: { filled: true, color: PALETTE.warn },
  shipNeutral: { filled: true, color: PALETTE.shield },
  station: { filled: false, color: null },
  rock: { filled: false, color: null },
  richRock: { filled: false, color: PALETTE.oreRich },
  signal: { filled: false, color: PALETTE.warn },
  place: { filled: false, color: PALETTE.glow },
  wreck: { filled: false, color: PALETTE.warn },
  pirateBase: { filled: false, color: PALETTE.bad },
  survey: { filled: false, color: PALETTE.hullHi },
  // M4b sites (canvasDraw SITE_COLORS): dead station grey, graveyard amber (its live mines red), comet ice
  derelict: { filled: false, color: SITE_COLORS.derelict },
  graveyard: { filled: false, color: SITE_COLORS.graveyard },
  comet: { filled: false, color: SITE_COLORS.comet },
  // M4d: green = on my side (never a target – no friendly fire), blue = neutral, the relay in Guild orange
  guildWatch: { filled: true, color: PALETTE.ok },
  convoy: { filled: true, color: PALETTE.shield },
  guildRelay: { filled: false, color: PALETTE.trim },
};

/** Legend order (help K and the radar's hover card): ships first, then objects. */
export const RADAR_LEGEND: readonly RadarGlyph[] = [
  'shipAttacking',
  'shipHostile',
  'shipNeutral',
  'guildWatch',
  'convoy',
  'station',
  'rock',
  'richRock',
  'signal',
  'place',
  'wreck',
  'pirateBase',
  'survey',
  'derelict',
  'graveyard',
  'comet',
  'guildRelay',
];

/** A pirate attacking me is red, a pirate that has not engaged (patrol, hail, retreat…) amber. */
export const pirateGlyph = (attacking: boolean): RadarGlyph => (attacking ? 'shipAttacking' : 'shipHostile');

export interface RadarContact {
  /** Position relative to the player (sim coordinates). */
  x: number;
  y: number;
  radius: number;
  color: string;
  /** Assayed rich ore (Mining 2.0) – a gold ring on the radar. */
  rich?: boolean;
}

export interface RadarSource {
  pos: Vec2;
  radius: number;
  resource: ResourceId;
  rich?: boolean;
}

export function buildRadarContacts(sources: readonly RadarSource[], center: Vec2, range: number): RadarContact[] {
  const contacts: RadarContact[] = [];
  for (const s of sources) {
    const x = s.pos.x - center.x;
    const y = s.pos.y - center.y;
    if (x * x + y * y > range * range) continue;
    contacts.push({ x, y, radius: s.radius, color: hexColor(RESOURCES[s.resource].color), ...(s.rich ? { rich: true } : {}) });
  }
  return contacts;
}

/** A pirate or a wreck with loot on the radar (position relative to the player, sim coordinates). */
export interface ThreatContact {
  kind: 'pirate' | 'wreck';
  x: number;
  y: number;
  /** Heading of the pirate ship (sim angle). */
  angle: number;
  attacking: boolean;
  /** Out of range – pinned to the radar's rim. */
  edge: boolean;
  /** How the radar draws it (grammar R7). */
  glyph: RadarGlyph;
}

/**
 * Pirates (out of range pinned to the rim) and wrecks with loot within the radar range. A dormant
 * graveyard sleeper (M4b) plays dead: a wreck within the range, nothing beyond it.
 */
export function buildThreatContacts(
  pirates: readonly { pos: Vec2; angle: number; attacking: boolean; dormant?: boolean }[],
  wrecks: readonly { pos: Vec2; loot: boolean }[],
  center: Vec2,
  range: number,
): ThreatContact[] {
  const out: ThreatContact[] = [];
  if (range <= 0) return out;
  for (const w of wrecks) {
    const x = w.pos.x - center.x;
    const y = w.pos.y - center.y;
    if (w.loot && x * x + y * y <= range * range) out.push({ kind: 'wreck', x, y, angle: 0, attacking: false, edge: false, glyph: 'wreck' });
  }
  for (const p of pirates) {
    let x = p.pos.x - center.x;
    let y = p.pos.y - center.y;
    const d = Math.hypot(x, y);
    if (p.dormant) {
      if (d <= range) out.push({ kind: 'wreck', x, y, angle: 0, attacking: false, edge: false, glyph: 'wreck' });
      continue;
    }
    const edge = d > range;
    if (edge) {
      x = (x / d) * range;
      y = (y / d) * range;
    }
    out.push({ kind: 'pirate', x, y, angle: p.angle, attacking: p.attacking, edge, glyph: pirateGlyph(p.attacking) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// M4b world sites (T10)

export type SiteContactKind = 'derelict' | 'relay' | 'graveyard' | 'mine' | 'comet' | 'guildRelay';

/** A world site on the radar, relative to the player (sim coordinates). */
export interface SiteContact {
  kind: SiteContactKind;
  x: number;
  y: number;
  /** Relay, Guild relay: powered. Mine: armed (about to blow). */
  on: boolean;
  /** Comet: direction of its tail (sim angle, away from home); 0 otherwise. */
  angle: number;
  /** Size in the world (u): the derelict's layout radius, the graveyard's field, the nucleus, the mine; 0 = a fixed glyph. */
  radius: number;
}

/** What the game knows about the sites near the ship (world positions). */
export interface SiteRadarInput {
  derelicts: readonly { pos: Vec2; radius: number; relays: readonly { pos: Vec2; lit: boolean }[] }[];
  graveyards: readonly { pos: Vec2; radius: number }[];
  /** Live mines (gone ones are left out by the caller). */
  mines: readonly { pos: Vec2; armed?: boolean }[];
  /** Comet nuclei in their pass. */
  comets: readonly { pos: Vec2 }[];
  /** M4d Guild relay masts of the known relay sites (lit = powered or secured). */
  guildRelays?: readonly { pos: Vec2; lit: boolean }[];
}

/**
 * Site contacts within the radar range, drawn in this order (big objects under small ones): graveyards,
 * derelicts, relays, Guild relays (M4d), live mines (only within `MINE.radarRange` – they are small and
 * dark), comets.
 */
export function buildSiteContacts(input: SiteRadarInput, center: Vec2, range: number): SiteContact[] {
  const out: SiteContact[] = [];
  if (range <= 0) return out;
  const push = (kind: SiteContactKind, pos: Vec2, radius: number, reach: number, on = false, angle = 0) => {
    const x = pos.x - center.x;
    const y = pos.y - center.y;
    if (x * x + y * y <= reach * reach) out.push({ kind, x, y, on, angle, radius });
  };
  // a graveyard shows while any part of its field is within the range
  for (const g of input.graveyards) push('graveyard', g.pos, g.radius, range + g.radius);
  for (const d of input.derelicts) push('derelict', d.pos, d.radius, range + d.radius);
  for (const d of input.derelicts) for (const r of d.relays) push('relay', r.pos, 0, range, r.lit);
  for (const r of input.guildRelays ?? []) push('guildRelay', r.pos, 0, range, r.lit);
  for (const m of input.mines) push('mine', m.pos, MINE.radius, Math.min(range, MINE.radarRange), m.armed ?? false);
  for (const c of input.comets) push('comet', c.pos, COMET.nucleusRadius, range + COMET.nucleusRadius, false, Math.atan2(c.pos.y, c.pos.x));
  return out;
}

// ---------------------------------------------------------------------------
// M4d Guild Watch ships and convoys (T11)

/** A live Guild Watch ship or a convoy ship on the radar, relative to the player (sim coordinates). */
export interface GuildContact {
  kind: 'watch' | 'convoy';
  x: number;
  y: number;
  /** Heading (sim angle). */
  angle: number;
  /** Convoy: a tanker (drawn smaller) – the trader leads. */
  tanker?: boolean;
  glyph: RadarGlyph;
}

/** What the game knows about the Guild ships near the ship (world positions; T9 fills it). */
export interface GuildRadarInput {
  /** Live Guild Watch ships (the simulated ones near the player). */
  watch: readonly { pos: Vec2; angle: number }[];
  /** Convoy ships (scheduled passes and escort convoys), the trader of each convoy first. */
  convoys: readonly { pos: Vec2; angle: number; tanker?: boolean }[];
}

/**
 * Guild contacts within the radar range (no rim pins – they are friends, not threats): convoys first,
 * the Watch over them. A friendly Watch ship is never drawn red (no friendly fire, user decision).
 */
export function buildGuildContacts(input: GuildRadarInput, center: Vec2, range: number): GuildContact[] {
  const out: GuildContact[] = [];
  if (range <= 0) return out;
  const r2 = range * range;
  for (const c of input.convoys) {
    const x = c.pos.x - center.x;
    const y = c.pos.y - center.y;
    if (x * x + y * y <= r2) out.push({ kind: 'convoy', x, y, angle: c.angle, ...(c.tanker ? { tanker: true } : {}), glyph: 'convoy' });
  }
  for (const w of input.watch) {
    const x = w.pos.x - center.x;
    const y = w.pos.y - center.y;
    if (x * x + y * y <= r2) out.push({ kind: 'watch', x, y, angle: w.angle, glyph: 'guildWatch' });
  }
  return out;
}

// Sectors in the flight HUD and on the map (sectors design §5,
// stage 1a): the game layer follows the ship's sector (with hysteresis), decides the entry notice and
// tone (entryNotice.ts), and hands the HUD badge, the radar arc and the map layer their data. Nothing
// here is saved; on a new or loaded game the current sector is set silently and the sectors of the
// explored chunks count as visited. Game.ts only calls these methods.
// Stage 1b: the knowledge and the flown coverage come from the simulation (src/sim/regions/knowledge.ts),
// the first entry into a sector says something on the radio (sectorRadio.ts, §3.1) and the map gets
// what its sector card needs.
import { getLocale, tx } from '../../i18n';
import { newlyCharted, sectorCoverage, sectorKnowledge } from '../../sim/regions/knowledge';
import { homeStation } from '../../sim/world/stations';
import type { CommsMessage } from '../comms/types';
import { guildWatchSpeaker, instructorSpeaker, pirateSpeaker, stationSpeaker } from '../comms/speakers';
import { SectorRadio, type SectorRadioVoices } from './sectorRadio';
import type { Vec2 } from '../../sim/math/vec2';
import type { Knowledge, Security } from '../../sim/regions/constants';
import { sectorInfo, sectorSecurity, sectorThreat, type SectorInfo } from '../../sim/regions/sectors';
import { regionWorld, type SecurityOverrides } from '../../sim/regions/world';
import { securityOverrides } from '../../sim/pirates/sectors';
import type { SimState } from '../../sim/Simulation';
import { RINGS } from '../../sim/world/rings';
import { parseChunkKey } from '../../ui/map';
import { radarBorderGrid, radarBorders, type RadarBorders } from '../../ui/sectors/radarBorders';
import { sectorName } from '../../ui/sectors/sectorText';
import type { EntryNoticeData, RadarSectorData, SectorBadgeData } from '../../ui/sectors/SectorHud';
import type { MapSectorsData } from '../../ui/discovery/mapSectors';
import { EntryMemory, followSector, NOTICE_SECONDS, TELEPORT_DISTANCE } from './entryNotice';
import { chartStatus } from '../../sim/charts/charts';
import { badgeDots, sectorSurveyMarks } from './surveyUi';
import { ViewMemo } from '../viewMemo';

const TICKS = 60;
/** The radar arc is recomputed every this many steps (§6.8) … */
export const RADAR_REFRESH_TICKS = 30;
/** Remembered radar samples at most (a long flight starts the lattice over). */
const RADAR_SAMPLES_MAX = 40_000;

export interface SectorsUiHost {
  /** A sector was entered: the full notice or only the short tone (not when the radio spoke instead). */
  sound(security: Security, notice: boolean): void;
  /** Radio lines of a first entry (§3.1); true when the communicator took at least one. */
  radio?(messages: CommsMessage[]): boolean;
}

/** The voices of the entry radio in the current language. */
function radioVoices(): SectorRadioVoices {
  const k = tx().comms;
  const r = tx().sectors.radio;
  return {
    watch: guildWatchSpeaker(r.watch, r.watchRole),
    traffic: stationSpeaker(homeStation(), k),
    instructor: instructorSpeaker(k),
    jackal: pirateSpeaker('jackal', k),
    hammer: pirateSpeaker('hammer', k),
  };
}

export class SectorsUi {
  private seed: number | null = null;
  private current: string | null = null;
  private lastPos: Vec2 | null = null;
  private memory = new EntryMemory();
  private notice: { data: EntryNoticeData; until: number } | null = null;
  private seq = 0;
  private radarCache: { tick: number; sector: string; range: number; borders: RadarBorders } | null = null;
  /** The radar's sector groups with their security (kept while the borders and the overrides stay). */
  private radarGroups: { borders: RadarBorders; dead: string; groups: RadarSectorData['groups'] } | null = null;
  /** Sector ids of the radar lattice's samples (see radar()). */
  private radarSamples: { seed: number; step: number; ids: Map<number, string> } | null = null;
  private destroyed: { overrides: SecurityOverrides; key: string } | null = null;
  /** Sector security by id under one set of overrides (the radar and the badge ask at every redraw). */
  private security: { seed: number; overrides: SecurityOverrides; of: Map<string, Security> } | null = null;
  private readonly badgeMemo = new ViewMemo<SectorBadgeData | null>();
  private readonly entryRadio = new SectorRadio();
  /** Sectors charted by flight so far – counted from the chunks added since the last look (map version). */
  private charting: { explored: ReadonlySet<string> | null; seen: number; charted: number } = { explored: null, seen: 0, charted: 0 };

  constructor(private readonly host: SectorsUiHost) {}

  /** Forget everything (a new game or a loaded save): the next update starts silently. */
  reset(): void {
    this.seed = null;
    this.current = null;
    this.lastPos = null;
    this.memory = new EntryMemory();
    this.notice = null;
    this.radarCache = null;
    this.radarGroups = null;
    this.security = null;
    this.badgeMemo.clear();
    this.radarSamples = null;
    this.destroyed = null;
    this.entryRadio.reset();
    this.charting = { explored: null, seen: 0, charted: 0 };
  }

  /** The sector the ship counts as being in (null before the first update). */
  get currentId(): string | null {
    return this.current;
  }

  /** The security overrides and their key – `securityOverrides` keeps its object while they stay. */
  private dead(state: SimState): { overrides: SecurityOverrides; key: string } {
    const overrides = securityOverrides(state);
    if (!this.destroyed || this.destroyed.overrides !== overrides) {
      this.destroyed = { overrides, key: `${[...overrides.destroyedFortresses].sort().join(',')}+${[...overrides.secured].sort().join(',')}` };
    }
    return this.destroyed;
  }

  private securityOf(state: SimState, id: string): Security {
    const overrides = this.dead(state).overrides;
    let c = this.security;
    if (!c || c.seed !== state.seed || c.overrides !== overrides) {
      c = { seed: state.seed, overrides, of: new Map() };
      this.security = c;
    }
    let security = c.of.get(id);
    if (security === undefined) {
      security = sectorSecurity(state.seed, id, overrides);
      c.of.set(id, security);
    }
    return security;
  }

  /** Knowledge of a sector (§3.3): the start knowledge, Charted at 70 % flown (derived from `explored`). */
  knowledge(state: SimState, id: string): Knowledge {
    return sectorKnowledge(state, id);
  }

  /** Flown share of a sector (0..1, §4.1). */
  coverage(state: SimState, id: string): number {
    return sectorCoverage(state.seed, state.world.explored, id).share;
  }

  /** How many sectors are Charted by flight – changes exactly when a sector becomes Charted. */
  private chartedCount(state: SimState): number {
    const explored = state.world.explored;
    const c = this.charting;
    if (c.explored !== explored || c.seen > explored.size) {
      c.explored = explored;
      c.seen = 0;
      c.charted = 0;
    }
    if (c.seen === explored.size) return c.charted;
    // `explored` only grows (insertion order): the chunks after `seen` are the new ones
    const fresh: string[] = [];
    let i = 0;
    for (const key of explored) if (i++ >= c.seen) fresh.push(key);
    c.seen = explored.size;
    c.charted += newlyCharted(state.seed, explored, fresh).length;
    return c.charted;
  }

  /** The entry radio of a first visit; true when the communicator took a line. */
  private sayOnEntry(state: SimState, id: string, security: Security): boolean {
    if (!this.host.radio) return false;
    const info = sectorInfo(state.seed, id);
    if (!info) return false;
    const messages = this.entryRadio.enter(
      {
        seed: state.seed,
        id,
        name: sectorName(info.name),
        security,
        hammer: info.fixed === 'fortress',
        training: state.career.training.status === 'active',
        tick: state.tick,
      },
      radioVoices(),
      tx().sectors.radio,
      () => ({ voices: radioVoices(), t: tx().sectors.radio, name: sectorName(info.name) }),
    );
    return messages.length > 0 && this.host.radio(messages);
  }

  /** Follows the ship (call it with the HUD, ~10×/s, while flying). */
  update(state: SimState): void {
    if (state.seed !== this.seed) {
      this.reset();
      this.seed = state.seed;
    }
    const field = regionWorld(state.seed).field;
    const at = (x: number, y: number) => field.regionAt(x, y).id;
    const pos = state.player.body.pos;
    if (this.current === null) {
      // first look: the sectors of the explored chunks were visited before (no notice there)
      const visited = new Set<string>();
      for (const key of state.world.explored) {
        const { cx, cy } = parseChunkKey(key);
        visited.add(field.regionOfChunk(cx, cy).id);
      }
      this.memory.prime([...visited].map((id) => [id, this.securityOf(state, id)] as [string, Security]));
      this.current = at(pos.x, pos.y);
      this.memory.arrive(this.current, this.securityOf(state, this.current));
      this.lastPos = { ...pos };
      return;
    }
    const jumped = this.lastPos !== null && Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y) > TELEPORT_DISTANCE;
    this.lastPos = { ...pos };
    if (jumped) {
      // a tow, a respawn: no notice for being carried
      this.current = at(pos.x, pos.y);
      this.memory.arrive(this.current, this.securityOf(state, this.current));
      this.notice = null;
      return;
    }
    if (state.player.destroyed) return;
    const next = followSector(at, this.current, pos);
    if (next === this.current) return;
    this.current = next;
    const security = this.securityOf(state, next);
    const now = state.tick / TICKS;
    const reaction = this.memory.enter(next, security, now);
    if (reaction === 'notice') {
      const info = sectorInfo(state.seed, next);
      this.notice = {
        until: now + NOTICE_SECONDS,
        data: {
          seq: ++this.seq,
          name: info ? sectorName(info.name) : '',
          security,
          securityWord: tx().sectors.security[security],
          glyph: tx().sectors.glyph[this.knowledge(state, next)],
          entry: tx().sectors.entry,
        },
      };
    }
    const spoke = reaction === 'notice' && this.sayOnEntry(state, next, security);
    if (reaction !== 'none' && !spoke) this.host.sound(security, reaction === 'notice');
  }

  /** The HUD badge (top left) of the current sector. */
  badge(state: SimState): SectorBadgeData | null {
    if (this.current === null || state.seed !== this.seed) return null;
    const id = this.current;
    const security = this.securityOf(state, id);
    const knowledge = this.knowledge(state, id);
    // the same object while the sector, its security, knowledge and survey marks and the language stay
    return this.badgeMemo.get([state, id, security, knowledge, state.regions.points.get(id) ?? 0, getLocale()], () => {
      const info = sectorInfo(state.seed, id);
      if (!info) return null;
      const dots = badgeDots(state, info.id);
      return { ...badgeData(info, security, knowledge), ...(dots ? { survey: dots } : {}) };
    });
  }

  /** Depth of the ship's sector, capped at the deepest ring look (the HUD accent follows it, not the ring circle). */
  depth(state: SimState): number | null {
    if (this.current === null || state.seed !== this.seed) return null;
    const info = sectorInfo(state.seed, this.current);
    return info ? Math.min(RINGS.length, info.depth) : null;
  }

  /** The entry notice while it shows (2.5 s of game time). */
  noticeData(state: SimState): EntryNoticeData | null {
    const n = this.notice;
    if (!n) return null;
    if (state.tick / TICKS >= n.until) {
      this.notice = null;
      return null;
    }
    return n.data;
  }

  /**
   * Sector borders within the radar range (recomputed every 30 steps, shifted to the ship meanwhile).
   * The sample grid is anchored on a world lattice of its step, so a refresh reads the sector ids of the
   * samples it had already (`radarSamples`) and samples only what the ship flew into; a refresh at the
   * same lattice point keeps the borders. The groups are the same array while the borders and the
   * sectors' security stay (perf audit 2026-10-17, O12).
   */
  radar(state: SimState, range: number): RadarSectorData | null {
    if (this.current === null || range <= 0) return null;
    const pos = state.player.body.pos;
    let c = this.radarCache;
    const moved = c ? Math.hypot(pos.x - c.borders.origin.x, pos.y - c.borders.origin.y) : Infinity;
    if (!c || state.tick - c.tick >= RADAR_REFRESH_TICKS || state.tick < c.tick || c.sector !== this.current || c.range !== range || moved > range / 3) {
      // a margin beyond the range so the arc reaches the rim while the ship moves between refreshes
      const span = range * 1.15;
      const { step } = radarBorderGrid(span);
      const origin = { x: Math.round(pos.x / step) * step, y: Math.round(pos.y / step) * step };
      const same = c !== null && c.sector === this.current && c.range === range && c.borders.origin.x === origin.x && c.borders.origin.y === origin.y;
      const borders = same ? c!.borders : radarBorders(this.radarSampler(state.seed, step), origin, span, this.current);
      c = { tick: state.tick, sector: this.current, range, borders };
      this.radarCache = c;
    }
    const b = c.borders;
    const dead = this.dead(state).key;
    let g = this.radarGroups;
    if (!g || g.borders !== b || g.dead !== dead) {
      g = { borders: b, dead, groups: b.groups.map((x) => ({ security: this.securityOf(state, x.other), adjacent: x.adjacent, lines: x.lines })) };
      this.radarGroups = g;
    }
    return { offset: { x: b.origin.x - pos.x, y: b.origin.y - pos.y }, groups: g.groups };
  }

  /** `regionAt(x, y).id` on the radar lattice of `step`, remembered per lattice point. */
  private radarSampler(seed: number, step: number): (x: number, y: number) => string {
    let s = this.radarSamples;
    if (!s || s.seed !== seed || s.step !== step || s.ids.size > RADAR_SAMPLES_MAX) {
      s = { seed, step, ids: new Map() };
      this.radarSamples = s;
    }
    const field = regionWorld(seed).field;
    const ids = s.ids;
    return (x, y) => {
      // lattice indices stay well inside ±2^15 for any reachable position and step
      const key = (Math.round(x / step) + 32768) * 65536 + Math.round(y / step) + 32768;
      let id = ids.get(key);
      if (id === undefined) {
        id = field.regionAt(x, y).id;
        ids.set(key, id);
      }
      return id;
    };
  }

  /** The Sectors layer of the map. */
  map(state: SimState): MapSectorsData {
    const dead = this.dead(state);
    return {
      seed: state.seed,
      overrides: dead.overrides,
      knowledge: (id) => this.knowledge(state, id),
      coverage: (id) => this.coverage(state, id),
      chart: (id) => chartStatus(state, id),
      survey: (id) => sectorSurveyMarks(state, id),
      // the layer changes when a fortress falls or is rebuilt, a Guild relay secures a sector, or when a
      // sector becomes Charted (flown, surveyed, bought, the training's chart) or its chart is sold
      version: `${state.seed}|${dead.key}|${this.chartedCount(state)}|${chartsKey(state)}`,
      explored: state.world.explored,
      current: this.current,
    };
  }
}

/** What changes a sector's chart: survey marks, bought and sold charts, chart contracts, the training. */
export function chartsKey(state: SimState): string {
  const r = state.regions;
  let marks = 0;
  for (const m of r.points.values()) marks += m;
  const contracts = state.career.contracts.flatMap((c) => (c.target.kind === 'chart' ? [c.target.sector] : [])).join(',');
  return `${r.points.size}:${marks}|${r.bought.size}|${r.sold.size}|${contracts}|${state.career.training.status}:${state.career.training.step}`;
}

/** Badge data of a sector (pure; the words in the current language). */
export function badgeData(info: SectorInfo, security: Security, knowledge: Knowledge): SectorBadgeData {
  const t = tx().sectors;
  const ring = tx().rings[Math.min(RINGS.length, info.depth) - 1] ?? '';
  return {
    id: info.id,
    name: sectorName(info.name),
    security,
    securityWord: t.security[security],
    threat: t.threatLine(t.threat[sectorThreat(info, security)]),
    knowledge,
    glyph: t.glyph[knowledge],
    depth: t.depth(info.depth, ring),
  };
}

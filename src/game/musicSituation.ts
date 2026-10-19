// What the music director needs to know about the game: docked, the sector depth and whether it is
// the frontier, how far from home, speed, how threatening the pirates around are and whether a Kovaci
// Echo is near. Pure – reads SimState (and the sector zone the caller tracks with hysteresis).
// M4b: a Gunner and a derelict's sentry drones are hostile, a graveyard sleeper only once awake; space
// events add tension (a micrometeor shower from its warning to its end, an ambush during its radio
// lead) and a discovery (a comet sighted, a derelict's first berth) brings the mystery mood for a while,
// as does being berthed at a derelict's terminal – `EventMoments` remembers the events.
// M4d: live Guild Watch ships fighting pirates near the player bring the combat mood (the player need
// not be the target), a powered Guild relay's warning is tense until the Rust counterattack spawns, and
// a secured sector is Guarded – not the frontier (`musicZoneAt` / SectorZoneTracker read the current
// security).
import type { MusicScreen, MusicSituation } from '../audio/music/musicDirector';
import { LEASH_RANGE } from '../sim/combat/ai';
import { PLAYER_REF, type EnemyKind } from '../sim/combat/types';
import { RELAY_CHAIN } from '../data/guild';
import { echoSites } from '../sim/discovery/poi';
import { length, sub, type Vec2 } from '../sim/math/vec2';
import { fortressAlive, fortressStatus } from '../sim/pirates/fortress';
import { fortressesNear } from '../sim/pirates/sites';
import type { SimEvent, SimState } from '../sim/Simulation';
import { sectorInfoAt, sectorSecurity } from '../sim/regions/sectors';
import { securityOverrides } from '../sim/pirates/sectors';
import type { AppState } from './app/appState';

export const MUSIC_THREAT = {
  /** A pirate attacking within its leash range; a Hammer weighs more than a Jackal. */
  jackal: 0.28,
  hammer: 0.42,
  /** M4b: the long-range Gunner and a derelict's sentry drone. */
  gunner: 0.36,
  sentry: 0.24,
  /** Closer than this the attacker counts in full, farther 70 %. */
  closeRange: 200,
  /** A toll demand: tension, not a fight yet. */
  hail: 0.12,
  hailRange: 300,
  /** The raid fleet's target point near the player. */
  raid: 0.2,
  raidRange: 900,
  /** A standing fortress within reach of its turrets. */
  fortress: 0.35,
  fortressRange: 220,
  /** Hit in the last seconds. */
  recentHit: 0.2,
  recentHitSeconds: 5,
  /** M4b events: a micrometeor shower (warning to end) and an ambush's radio lead (until it spawns). */
  micrometeors: 0.16,
  ambushLead: 0.2,
  /** Longest an event keeps its tension without its end event (s) – a missed end never sticks. */
  eventCapSeconds: 60,
  /** M4d: a live Guild Watch ship fighting a pirate this near the player (once, however many fight). */
  watchFight: 0.12,
  watchFightRange: 400,
  /** M4d: a powered Guild relay's warning until the Rust counterattack spawns (then the pirates count). */
  relayHoldLead: 0.2,
} as const;

/** Seconds the mystery mood plays after a discovery (a comet sighted, a derelict's first berth). */
export const DISCOVERY_SECONDS = 24;

/** How near a heard Echo the mystery mood plays (units; the beacon itself is ~9 units). */
export const MYSTERY_RADIUS = 260;

const TICKS = 60;
const dist = (a: Vec2, b: Vec2): number => length(sub(a, b));

/** Threat weight of an attacking enemy by kind (a scavenger never attacks the player). */
const enemyWeight = (kind: EnemyKind): number => {
  const T = MUSIC_THREAT;
  return kind === 'hammer' ? T.hammer : kind === 'gunner' ? T.gunner : kind === 'sentry' ? T.sentry : T.jackal;
};

/**
 * 0..1 – how threatening the situation around the player is (0 when docked). `tension` = the space
 * events' share (EventMoments). A dormant sleeper is not in 'attack' – it counts only once awake; a
 * Gunner breaking away ('evade') is still in the fight.
 */
export function combatThreat(state: SimState, recentHit = false, tension = 0): number {
  const player = state.player;
  if (player.dock.mode !== 'flying') return 0;
  const pos = player.body.pos;
  const T = MUSIC_THREAT;
  let threat = (recentHit ? T.recentHit : 0) + tension;
  for (const e of state.combat.enemies) {
    if (e.kind === 'scavenger' || e.calm) continue;
    const d = dist(e.body.pos, pos);
    if ((e.ai.mode === 'attack' || e.ai.mode === 'evade') && d <= LEASH_RANGE) threat += enemyWeight(e.kind) * (d <= T.closeRange ? 1 : 0.7);
    else if (e.ai.mode === 'hail' && d <= T.hailRange) threat += T.hail;
  }
  const raid = state.pirates.raid;
  if (raid && dist(raid.pos, pos) <= T.raidRange) threat += T.raid;
  if (state.guild.watch.some((w) => w.mode === 'engage' && w.target !== null && dist(w.body.pos, pos) <= T.watchFightRange)) threat += T.watchFight;
  for (const site of fortressesNear(state.seed, pos, T.fortressRange)) {
    if (dist(site.pos, pos) <= T.fortressRange && fortressAlive(fortressStatus(state, site.id))) threat += T.fortress;
  }
  return Math.min(1, threat);
}

/** Near a Kovaci Echo the player has already heard or found (no music spoilers for gated ones). */
export function nearMystery(state: SimState): boolean {
  const d = state.discovery;
  const pos = state.player.body.pos;
  return echoSites(state.seed).some((site) => (d.known.has(site.id) || d.fixes.has(site.id)) && dist(site.pos, pos) <= MYSTERY_RADIUS);
}

/** The sector zone for the music: its depth and whether it is the frontier (unguarded, depth ≥ 2). */
export interface MusicZone {
  depth: number;
  frontier: boolean;
}

/** The music zone straight at the player's position (no hysteresis – tests, one-off reads). */
export function musicZoneAt(state: SimState): MusicZone {
  const { x, y } = state.player.body.pos;
  const info = sectorInfoAt(state.seed, x, y);
  return { depth: info.depth, frontier: info.depth >= 2 && sectorSecurity(state.seed, info.id, securityOverrides(state)) !== 'guarded' };
}

/** What the space events add to the music now (EventMoments). */
export interface MusicMoments {
  /** Extra threat (0..). */
  tension: number;
  /** A fresh discovery – the mystery mood. */
  discovery: boolean;
}

export const NO_MOMENTS: MusicMoments = { tension: 0, discovery: false };

/**
 * The game part of the music situation (the screen comes from the app). `zone` = the player's sector
 * as the caller tracks it (SectorZoneTracker, with hysteresis); default: the sector at the position.
 * `moments` = the space events now (EventMoments). Berthed at a derelict's terminal = the mystery mood.
 */
export function gameMusicSituation(state: SimState, recentHit = false, zone: MusicZone = musicZoneAt(state), moments: MusicMoments = NO_MOMENTS): Omit<MusicSituation, 'screen'> {
  const p = state.player;
  const distanceFromHome = length(p.body.pos);
  return {
    docked: p.dock.mode !== 'flying',
    ring: zone.depth,
    frontier: zone.frontier,
    distanceFromHome,
    speed: length(p.body.vel),
    combatThreat: combatThreat(state, recentHit, moments.tension),
    nearMystery: moments.discovery || state.sites.berth !== null || nearMystery(state),
  };
}

/**
 * Remembers the space events for the music (M4b): a micrometeor shower is tense from its warning to its
 * end, an ambush from its warning until its party spawns (then the pirates themselves count); a comet
 * sighted or a derelict's first berth (`derelictVisited` comes once per derelict) plays the mystery mood
 * for `DISCOVERY_SECONDS`. Presentation memory, like HitMemory: a new game or a loaded save forgets it.
 */
export class EventMoments {
  private readonly tense = new Map<string, { kind: 'micrometeors' | 'ambush' | 'relayHold'; until: number }>();
  private discoveryUntil = Number.NEGATIVE_INFINITY;
  private lastTick = Number.NEGATIVE_INFINITY;

  note(event: SimEvent, tick: number): void {
    this.rewind(tick);
    switch (event.type) {
      case 'eventWarning':
        if (event.kind === 'micrometeors' || event.kind === 'ambush') this.tense.set(event.key, { kind: event.kind, until: tick + MUSIC_THREAT.eventCapSeconds * TICKS });
        break;
      case 'relayHoldStarted':
        // the warning runs `counterattackDelay` s; then the spawned party itself counts
        this.tense.set(`relay:${event.lane}`, { kind: 'relayHold', until: tick + (RELAY_CHAIN.counterattackDelay + 1) * TICKS });
        break;
      case 'eventStarted':
        // an ambush that started without a party (the ship docked meanwhile) ends its lead here
        if (event.kind === 'ambush') this.tense.delete(event.key);
        break;
      case 'eventEnded':
      case 'ambushSpawned':
        this.tense.delete(event.key);
        break;
      case 'cometSighted':
      case 'derelictVisited':
        this.discoveryUntil = tick + DISCOVERY_SECONDS * TICKS;
        break;
      default:
        break;
    }
  }

  /** The events' share of the threat now. */
  tension(tick: number): number {
    this.rewind(tick);
    let micrometeors = false;
    let ambush = false;
    let relay = false;
    for (const [key, m] of this.tense) {
      if (tick > m.until) {
        this.tense.delete(key);
        continue;
      }
      if (m.kind === 'micrometeors') micrometeors = true;
      else if (m.kind === 'relayHold') relay = true;
      else ambush = true;
    }
    return (micrometeors ? MUSIC_THREAT.micrometeors : 0) + (ambush ? MUSIC_THREAT.ambushLead : 0) + (relay ? MUSIC_THREAT.relayHoldLead : 0);
  }

  discovery(tick: number): boolean {
    this.rewind(tick);
    return tick <= this.discoveryUntil;
  }

  moments(tick: number): MusicMoments {
    return { tension: this.tension(tick), discovery: this.discovery(tick) };
  }

  reset(): void {
    this.tense.clear();
    this.discoveryUntil = Number.NEGATIVE_INFINITY;
    this.lastTick = Number.NEGATIVE_INFINITY;
  }

  /** The clock went backwards (a new game or a loaded save): the remembered events belong to another game. */
  private rewind(tick: number): void {
    if (tick < this.lastTick) this.reset();
    this.lastTick = tick;
  }
}

/** Remembers when the player's ship was last hit (for a short boost of the combat music). */
export class HitMemory {
  private lastHitTick = Number.NEGATIVE_INFINITY;

  note(event: SimEvent, tick: number): void {
    if (event.type === 'projectileHit' && event.ref === PLAYER_REF && (event.target === 'ship' || event.target === 'shield')) {
      this.lastHitTick = tick;
    }
  }

  recent(tick: number): boolean {
    // the clock went backwards (a new game or a loaded save) – the remembered hit belongs to another game
    if (tick < this.lastHitTick) this.reset();
    return tick - this.lastHitTick <= MUSIC_THREAT.recentHitSeconds * TICKS;
  }

  /** Forget the last hit (a new game or a loaded save). */
  reset(): void {
    this.lastHitTick = Number.NEGATIVE_INFINITY;
  }
}

/** Which screen the music plays under: the main menu, the live game, a pause sheet or the death card. */
export function musicScreenFor(app: AppState): MusicScreen {
  if (app.kind !== 'game') return 'menu';
  if (app.overlay === null) return 'game';
  return app.overlay === 'death' ? 'overlay' : 'paused';
}

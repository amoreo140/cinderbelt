// Derelict station state and defence (M4b plan §2.4) – OWNED BY T4.
//
// Rules:
// - The defence rolled per derelict (`DerelictSite.defence`) wakes ONCE, in the step the `RELAY.wakeAt`-th
//   (2nd) relay of its group lights (`relayPowered.lit`): `woke = tick` is stored in `sites.derelicts`
//   and `derelictWoke` is sent – for every defence, 'none' included (the record says "it happened").
// - Sentries: `DERELICT.sentries[depth]` drones (EnemyKind 'sentry', ids `dd:<cx>,<cy>:<i>`, T1 at depth
//   2, T2 from `DERELICT.sentryT2FromDepth`) spawn on posts around the derelict (`sentryPosts`) with
//   `home` = the derelict centre – the guard AI (combat/ai.ts, T6) attacks within the guard radius of
//   `home` and keeps its leash. They spawn only at the wake: a destroyed sentry never comes back and one
//   that despawned (the player flew > DESPAWN_RADIUS away) is gone for good – "never respawn".
// - Storm: a local ion storm `DERELICT.storm.seconds` long within `DERELICT.storm.radius` of the
//   derelict from the wake tick (`siteStorms`, consumed by `stormAt` – events/storms.ts, T1).
// - The berth is cleared when the ship is destroyed or is no longer flying (respawn, docking, a ship
//   swap) – a destroyed ship never stays berthed. An unknown berth id is left alone (save validation, T11).
import { DERELICT, DERELICT_LAYOUTS, RELAY } from '../../data/sites';
import type { Tier } from '../../data/parts';
import { TICKS_PER_SECOND } from '../combat/damage';
import { createEnemy, type SpawnSlot } from '../combat/enemies';
import { TAU } from '../math/angle';
import type { Vec2 } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import { siteById } from './placement';
import type { DerelictSite, DerelictState, SiteStorm } from './types';

const FRESH: DerelictState = { woke: null, taken: 0, visited: false };

/** The saved state of a derelict (a fresh one for an untouched derelict – not stored until changed). */
export function derelictState(state: SimState, id: string): DerelictState {
  return state.sites.derelicts.get(id) ?? FRESH;
}

/** Stores a changed derelict state (the map holds only touched derelicts). */
export function setDerelictState(state: SimState, id: string, patch: Partial<DerelictState>): DerelictState {
  const next = { ...derelictState(state, id), ...patch };
  state.sites.derelicts.set(id, next);
  return next;
}

/** The derelict with this id of the seed, or null (unknown id, a graveyard). */
export function derelictById(state: SimState, id: string): DerelictSite | null {
  const site = siteById(state.seed, id);
  return site?.kind === 'derelict' ? site : null;
}

/** Sentry posts sit this far beyond the derelict's clear circle (inside its rock-free margin). */
const POST_GAP = 8;

/** Id of sentry `i` of a derelict (`dd:<cx>,<cy>:<i>`). */
export const sentryId = (site: Pick<DerelictSite, 'cx' | 'cy'>, i: number): string => `dd:${site.cx},${site.cy}:${i}`;

export interface SentryPost {
  id: string;
  pos: Vec2;
  /** Facing (outward). */
  angle: number;
}

/**
 * Where the sentries of a derelict wait: evenly around it at its clear radius + `POST_GAP`, starting half
 * a step off the dock direction (the clamp approach stays free). Pure.
 */
export function sentryPosts(site: DerelictSite): SentryPost[] {
  const n = DERELICT.sentries[site.depth];
  const r = DERELICT_LAYOUTS[site.model].clearRadius + POST_GAP;
  return Array.from({ length: n }, (_, i) => {
    const angle = site.angle + TAU / (2 * n) + (i * TAU) / n;
    return { id: sentryId(site, i), pos: { x: site.pos.x + Math.cos(angle) * r, y: site.pos.y + Math.sin(angle) * r }, angle };
  });
}

/** Tier of a derelict's sentries. */
export const sentryTier = (site: Pick<DerelictSite, 'depth'>): Tier => (site.depth >= DERELICT.sentryT2FromDepth ? 2 : 1);

/** Spawns the sentries of a derelict (those not alive and not destroyed). */
function spawnSentries(state: SimState, site: DerelictSite): void {
  const { combat } = state;
  const tier = sentryTier(site);
  sentryPosts(site).forEach((post, i) => {
    if (combat.defeated.has(post.id) || combat.enemies.some((e) => e.id === post.id)) return;
    const slot: SpawnSlot = { id: post.id, kind: 'sentry', tier, pos: post.pos, angle: post.angle, home: { ...site.pos }, orbit: i % 2 === 0 ? 1 : -1 };
    combat.enemies.push(createEnemy(slot));
  });
}

/** Wakes the defence of derelict `id` (once). */
function wake(state: SimState, id: string, events: SimEvent[]): void {
  const site = derelictById(state, id);
  if (!site || derelictState(state, id).woke !== null) return;
  setDerelictState(state, id, { woke: state.tick });
  events.push({ type: 'derelictWoke', id, defence: site.defence });
  if (site.defence === 'sentries') spawnSentries(state, site);
}

/** One step: clear the berth of a ship that no longer flies; wake defences of derelicts whose 2nd relay lit. */
export function stepDerelicts(state: SimState, events: SimEvent[], _dt: number): void {
  const { player, sites } = state;
  if (sites.berth !== null && (player.destroyed || player.dock.mode !== 'flying')) sites.berth = null;
  let woken: string[] | null = null;
  for (const e of events) if (e.type === 'relayPowered' && e.lit >= RELAY.wakeAt) (woken ??= []).push(e.site);
  if (woken) for (const id of woken) wake(state, id, events);
}

/** Length of a derelict's storm (ticks). */
export const STORM_TICKS = Math.round(DERELICT.storm.seconds * TICKS_PER_SECOND);

const NO_STORMS: readonly SiteStorm[] = [];

/**
 * Local ion storms of derelict defences that have not ended yet at the current tick (`DERELICT.storm`:
 * 75 s, 400 u, from the tick the 2nd relay lit). `stormAt` checks the window and the radius itself.
 */
export function siteStorms(state: SimState): readonly SiteStorm[] {
  let out: SiteStorm[] | null = null;
  for (const [id, ds] of state.sites.derelicts) {
    if (ds.woke === null || state.tick >= ds.woke + STORM_TICKS) continue;
    const site = derelictById(state, id);
    if (site?.defence !== 'storm') continue;
    (out ??= []).push({ id, pos: site.pos, radius: DERELICT.storm.radius, start: ds.woke, end: ds.woke + STORM_TICKS });
  }
  return out ?? NO_STORMS;
}

// Comet flyby – the derived director event (M4b plan §2.2, §2.3) – OWNED BY T2. When a comet pass will
// come within `COMET_FLYBY.range` of the player in the next `COMET_FLYBY.leadSeconds`: radio + event
// chip with the ETA, once per comet pass (`director.fired` key `ev:comet:<id>@<pass>`); the comet
// becomes a scanner signal (not yet known).
//
// Announced in the step a flyby becomes listed (edge-triggered, see `stepCometFlyby`).
// The one-shot key stores the tick the flyby ENDS (not the tick it fired): the director prunes keys
// whose tick lies `DIRECTOR.pruneBuckets` buckets in the past, and a flyby must not be announced twice
// while its pass is still coming.
import { COMET_FLYBY } from '../../data/events';
import { COMET } from '../../data/sites';
import { SCANNER } from '../../data/scanner';
import { sectorIdAt } from '../regions/sectors';
import { cometApproach, cometDefs } from '../sites/comets';
import type { CometDef } from '../sites/types';
import { clearList } from '../scratch';
import type { Vec2 } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import type { ActiveEvent } from './types';

const TICKS = 60;

/** One-shot / chip key of a comet pass. */
export const cometFlybyKey = (id: string, pass: number): string => `ev:comet:${id}@${pass}`;

/** Flybys are announced to a pilot in flight, outside the Guild Training. */
const canAnnounce = (state: SimState): boolean =>
  state.player.dock.mode === 'flying' && !state.player.destroyed && state.career.training.status !== 'active';

/** Flybys of the passes that come within range of `pos` within the lead window after `tick`. */
function flybysAt(seed: number, pos: Vec2, tick: number): ActiveEvent[] {
  const out: ActiveEvent[] = [];
  const lead = COMET_FLYBY.leadSeconds * TICKS;
  const defs = cometDefs(seed);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    const a = cometApproach(seed, def.id, pos, COMET_FLYBY.range, tick, lead);
    if (!a) continue;
    out.push({
      key: cometFlybyKey(def.id, a.pass),
      kind: 'cometFlyby',
      start: a.enter,
      end: a.exit + 1,
      dir: Math.atan2(a.closest.y - pos.y, a.closest.x - pos.x),
      sector: sectorIdAt(seed, a.closest.x, a.closest.y),
      pos: a.closest,
    });
  }
  return out;
}

/** Comet flybys to list now (provider of `activeEvents`): passes within range of the player soon or now. */
export function cometFlybyEvents(state: SimState): ActiveEvent[] {
  return flybysAt(state.seed, state.player.body.pos, state.tick);
}

/**
 * One step: announce a new flyby (eventWarning / signal), once per pass. Called by `stepDirector`.
 *
 * Edge-triggered: a flyby is announced in the step it becomes listed (it was not listed for the ship's
 * pose before this step, `prevBody` at `tick - 1`), so a reloaded game – whose `prevBody` is its `body` –
 * announces exactly what the original does; `director.fired` (saved from V17, T11) keeps a flyby that
 * leaves and re-enters the list from being announced twice.
 */
export function stepCometFlyby(state: SimState, events: SimEvent[]): void {
  if (!canAnnounce(state)) return;
  const { seed, tick } = state;
  const pos = state.player.body.pos;
  const lead = COMET_FLYBY.leadSeconds * TICKS;
  const fired = state.director.fired;
  // the keys listed now (remembered: the next step asks for them as its "a tick earlier"), and the
  // approaches of those not fired yet – no event objects per step (perf audit 2026-10-17, P4)
  const now = listedSlot(seed, pos, tick);
  let fresh: { def: CometDef; a: NonNullable<ReturnType<typeof cometApproach>>; key: string }[] | null = null;
  const defs = cometDefs(seed);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    const a = cometApproach(seed, def.id, pos, COMET_FLYBY.range, tick, lead);
    if (!a) continue;
    const key = flybyKey(def.id, a.pass);
    now.keys.push(key);
    if (!fired.has(key)) (fresh ??= []).push({ def, a, key });
  }
  now.done = true;
  if (!fresh) return;
  // edge-triggered: listed for the ship's pose a tick earlier already → not announced now
  const before = listedKeys(seed, state.player.prevBody.pos, tick - 1);
  for (const { def, a, key } of fresh) {
    if (before.includes(key)) continue;
    fired.set(key, a.exit + 1);
    events.push({ type: 'eventWarning', key, kind: 'cometFlyby', inSeconds: Math.max(0, (a.enter - tick) / TICKS), dir: Math.atan2(a.closest.y - pos.y, a.closest.x - pos.x) });
    // the comet becomes a scanner signal (a question mark at the closest approach) until it is known
    const id = def.id;
    const d = state.discovery;
    if (!d.known.has(id) && !d.signals.some((s) => s.id === id)) {
      d.signals.push({ id, kind: 'comet', pos: { ...a.closest }, radius: Math.max(SCANNER.signalRadiusMin, COMET.nucleusRadius * 20), tick });
    }
  }
}

/** The flyby keys listed at a point and tick (`flybysAt(…).map((e) => e.key)`), the last two remembered. */
interface Listed {
  seed: number;
  x: number;
  y: number;
  tick: number;
  /** All keys added (an interrupted fill is never read). */
  done: boolean;
  keys: string[];
}

const listed: Listed[] = [0, 1].map(() => ({ seed: NaN, x: NaN, y: NaN, tick: NaN, done: false, keys: [] }));
let listedNext = 0;

/** A slot for the keys at (pos, tick), emptied (the older of the two). */
function listedSlot(seed: number, pos: Vec2, tick: number): Listed {
  const l = listed[listedNext]!;
  listedNext = 1 - listedNext;
  l.seed = seed;
  l.x = pos.x;
  l.y = pos.y;
  l.tick = tick;
  l.done = false;
  clearList(l.keys);
  return l;
}

/** The keys of the flybys listed at (pos, tick) – remembered from the step that listed them, else computed. */
function listedKeys(seed: number, pos: Vec2, tick: number): readonly string[] {
  for (const l of listed) if (l.done && l.seed === seed && l.tick === tick && l.x === pos.x && l.y === pos.y) return l.keys;
  return flybysAt(seed, pos, tick).map((e) => e.key);
}

/** `cometFlybyKey` of each comet's last pass (the same string every step of the pass). */
const lastKeys = new Map<string, { pass: number; key: string }>();

function flybyKey(id: string, pass: number): string {
  const known = lastKeys.get(id);
  if (known && known.pass === pass) return known.key;
  const key = cometFlybyKey(id, pass);
  if (lastKeys.size >= 256) lastKeys.clear();
  lastKeys.set(id, { pass, key });
  return key;
}

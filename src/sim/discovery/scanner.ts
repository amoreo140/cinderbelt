// Scanner (5.4): a Tab tap = pulse (signals within 3× radar range, uncertainty circles, triangulation
// of caches and Echoes), holding Tab on an object within radar range = analysis (Data, a journal entry,
// a wreck's contents). The command only carries "Tab held"; telling a tap from a hold happens here
// (deterministically, by steps).
//
// M4b (T3): derelict stations, ship graveyards and comets are pulse signals and places discovered within
// radar range like POIs; derelicts, relays and comet nuclei can be analysed (the HUD shows the defence
// hint, the relay charge, the comet composition – no Data: a derelict pays at its terminal); a dormant
// graveyard sleeper is analysed as a 'wreck' under its enemy id (T5 reads `scanned` for "active reactor").
import { DATA_REWARDS, CACHE } from '../../data/poi';
import { ECHOES, ECHO_BASELINE, ECHO_FIRST_RADIUS, ECHO_FIXES, ECHO_RADIUS, type EchoIndex } from '../../data/echoes';
import { BUFFS, type BuffKind } from '../../data/poi';
import { SCANNER } from '../../data/scanner';
import { COMET, DERELICT_LAYOUTS, GRAVEYARD, RELAY_LAYOUT } from '../../data/sites';
import type { Wreck } from '../combat/types';
import { recordScan, promote } from '../factions/reputation';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { length, sub, type Vec2 } from '../math/vec2';
import { sectorAt, sectorEffects } from '../sector/sector';
import type { SimEvent, SimState } from '../Simulation';
import { cometById, cometSignals, cometsNear } from '../sites/comets';
import { graveyardWreckData } from '../sites/graveyard';
import { DERELICT_EXTENT, forSitesNear, siteById } from '../sites/placement';
import type { Site } from '../sites/types';
import { hash3 } from '../world/hash';
import { hasFeature } from './archive';
import { distressNear, type Distress } from './events';
import { stormAt } from '../events/storms';
import { addAtlas } from './atlas';
import { surveyPulse } from './charting';
import { fireJournal } from './journal';
import { echoIndexOf, echoSites, poiById, poiRadius, poisNear, type Poi } from './poi';
import { gainData, logDiscovery } from './state';
import type { Fix, ScanKind, Signal, SignalKind } from './types';
import { onWreckAnalyzed, wreckKey } from './wrecks';
import { ION_STORM } from '../../data/events';
import { DISTRESS } from '../../data/events';

const TICKS = 60;
export const TAP_TICKS = Math.round(SCANNER.tapSeconds * TICKS);
export const ANALYZE_TICKS = Math.round(SCANNER.analyzeSeconds * TICKS);

export const hasBuff = (state: SimState, kind: BuffKind): boolean =>
  state.discovery.buffs.some((b) => b.kind === kind && b.until > state.tick);

/** Radar range with the sector's state (Eclipse) and an ion storm. */
export function radarRangeOf(state: SimState): number {
  const pos = state.player.body.pos;
  const storm = stormAt(state, pos, state.tick) ? ION_STORM.radarMult : 1;
  return state.player.props.radarRange * sectorEffects(sectorAt(state.seed, pos, state.tick)).radarMult * storm;
}

/** Pulse range: 3× radar (irradiated ×1.5). */
export const pulseRange = (state: SimState): number =>
  radarRangeOf(state) * SCANNER.pulseRangeMult * (hasBuff(state, 'irradiated') ? BUFFS.irradiated.pulseRangeMult : 1);

/** Pulse cooldown in steps (survey cockpit, time echo). */
export const pulseCooldownTicks = (state: SimState): number =>
  Math.round(SCANNER.pulseCooldown * TICKS * state.player.props.pulseCooldownMult * (hasBuff(state, 'echo') ? BUFFS.echo.pulseCooldownMult : 1));

/** Can the scanner hear an Echo? (Echo-1 only with the decoder, Echo-2 only with the Smiths' shard.) */
export function echoAudible(state: SimState, index: EchoIndex): boolean {
  const gate = ECHOES[index].gate;
  if (gate === 'decoder') return hasFeature(state, 'echoDecoder');
  if (gate === 'shard') return state.discovery.keyItems.has('shard');
  return true;
}

const unit = (h: number): number => h / 4294967296;

/** Position estimate: the true position + an offset up to half the radius (deterministic by id and count). */
function estimate(state: SimState, id: string, pos: Vec2, radius: number, n: number): Vec2 {
  const h = hash3(state.seed, fnv1a32(id), n);
  const a = unit(h) * TAU;
  const r = radius * 0.5 * unit(hash3(h, 1, 2));
  return { x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r };
}

function putSignal(state: SimState, s: Signal): void {
  const list = state.discovery.signals;
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s;
  else list.push(s);
}

const signalRadius = (d: number): number => Math.min(SCANNER.signalRadiusMax, Math.max(SCANNER.signalRadiusMin, d * SCANNER.signalRadiusFactor));

/** A plain signal (an uncertainty circle growing with the distance) for a place not known yet. */
function pointSignal(state: SimState, id: string, kind: SignalKind, pos: Vec2, at: Vec2): void {
  const radius = signalRadius(length(sub(pos, at)));
  const n = state.discovery.signals.find((s) => s.id === id) ? 1 : 0;
  putSignal(state, { id, kind, pos: estimate(state, id, pos, radius, n), radius, tick: state.tick });
}

/** Adds a pulse position to a triangulation; true when it is a new position. */
function addFix(fix: Fix, at: Vec2, baseline: number): boolean {
  if (fix.pulses.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < baseline)) return false;
  fix.pulses.push({ x: at.x, y: at.y });
  return true;
}

function pulseCache(state: SimState, poi: Poi, at: Vec2, events: SimEvent[]): void {
  const d = state.discovery;
  let fix = d.fixes.get(poi.id);
  if (!fix) {
    fix = { pulses: [], radius: CACHE.firstRadius };
    d.fixes.set(poi.id, fix);
    fireJournal(state, { on: 'cacheSignal' }, events);
  }
  if (addFix(fix, at, CACHE.baseline) && fix.pulses.length > 1) fix.radius *= CACHE.shrink;
  if (fix.radius <= CACHE.revealRadius) {
    d.signals = d.signals.filter((s) => s.id !== poi.id);
    d.known.add(poi.id);
    events.push({ type: 'cacheLocated', id: poi.id, pos: { ...poi.pos } });
    gainData(state, DATA_REWARDS.cache, 'cache', events);
    return;
  }
  putSignal(state, { id: poi.id, kind: 'cache', pos: estimate(state, poi.id, poi.pos, fix.radius, fix.pulses.length), radius: fix.radius, tick: state.tick });
}

function pulseEcho(state: SimState, index: EchoIndex, pos: Vec2, at: Vec2, events: SimEvent[]): void {
  const d = state.discovery;
  const id = `echo:${index}`;
  let fix = d.fixes.get(id);
  if (!fix) {
    fix = { pulses: [], radius: ECHO_FIRST_RADIUS };
    d.fixes.set(id, fix);
  }
  const fresh = addFix(fix, at, ECHO_BASELINE);
  if (fresh && fix.pulses.length > 1) fix.radius *= 0.35;
  const located = d.known.has(id) || fix.pulses.length >= ECHO_FIXES;
  if (located && !d.known.has(id)) {
    d.known.add(id);
    logDiscovery(state, { tick: state.tick, kind: 'echo', echo: index });
  }
  events.push({ type: 'echoHeard', echo: index, fixes: fix.pulses.length, located });
  fireJournal(state, { on: 'echoHeard', echo: index }, events);
  if (located) d.signals = d.signals.filter((s) => s.id !== id);
  else putSignal(state, { id, kind: 'echo', pos: estimate(state, id, pos, fix.radius, fix.pulses.length), radius: fix.radius, tick: state.tick });
}

/** A scanner pulse from the ship's position. */
export function pulse(state: SimState, events: SimEvent[]): void {
  const d = state.discovery;
  const player = state.player;
  if (d.scanner.cooldown > 0) {
    events.push({ type: 'scanFailed', reason: 'cooldown' });
    return;
  }
  if (player.energy < SCANNER.pulseEnergy) {
    events.push({ type: 'scanFailed', reason: 'energy' });
    return;
  }
  player.energy -= SCANNER.pulseEnergy;
  d.scanner.cooldown = pulseCooldownTicks(state);
  const at = player.body.pos;
  const range = pulseRange(state);
  let found = 0;
  for (const poi of poisNear(state.seed, at, range)) {
    if (poi.kind === 'cache') {
      if (d.opened.has(poi.id) || d.known.has(poi.id)) continue;
      pulseCache(state, poi, at, events);
      found++;
      continue;
    }
    if (d.known.has(poi.id)) continue;
    pointSignal(state, poi.id, poi.kind, poi.pos, at);
    found++;
  }
  // M4b world sites and comets: plain signals like POIs (never pre-marked on the map – a site in an
  // explored chunk of an old save shows up this way or when seen)
  forSitesNear(state.seed, at, range, (site) => {
    if (d.known.has(site.id)) return;
    pointSignal(state, site.id, site.kind, site.pos, at);
    found++;
  });
  for (const comet of cometSignals(state.seed, at, range, state.tick)) {
    if (d.known.has(comet.id)) continue;
    pointSignal(state, comet.id, 'comet', comet.pos, at);
    found++;
  }
  for (const site of echoSites(state.seed)) {
    if (!echoAudible(state, site.index) || d.scanned.has(site.id)) continue;
    const dist = length(sub(site.pos, at));
    if (dist > Math.max(range, ECHOES[site.index].hearRange)) continue;
    pulseEcho(state, site.index, site.pos, at, events);
    found++;
  }
  for (const ds of distressNear(state.seed, at, range, state.tick)) {
    if (d.opened.has(ds.id)) continue;
    const dist = length(sub(ds.pos, at));
    const radius = signalRadius(dist) * 0.5;
    putSignal(state, { id: ds.id, kind: 'distress', pos: estimate(state, ds.id, ds.pos, radius, 0), radius, tick: state.tick });
    found++;
  }
  // survey points of uncharted sectors (sectors stage 2): within 150 u, whatever the pulse range
  found += surveyPulse(state, at, events);
  events.push({ type: 'scanPulse', pos: { ...at }, range, found });
  fireJournal(state, { on: 'firstPulse' }, events);
}

// ---------------------------------------------------------------------------
// analysis

export interface ScanTarget {
  key: string;
  kind: ScanKind;
  pos: Vec2;
  radius: number;
  wreck?: Wreck;
  poi?: Poi;
  echo?: EchoIndex;
  distress?: Distress;
  /** The derelict of a 'derelict' or 'relay' target (M4b). */
  site?: Site;
}

/** Analysis radius of a relay mast (its collision circle plus a little aim slack). */
const RELAY_SCAN_RADIUS = Math.max(...RELAY_LAYOUT.circles.map((c) => Math.hypot(c.x, c.y) + c.r)) + 0.5;

/** Objects that can be analysed (within the ship's radar range); asteroids only under the cursor. */
export function scanTargets(state: SimState, aim: Vec2 | null): ScanTarget[] {
  const pos = state.player.body.pos;
  const range = radarRangeOf(state);
  const out: ScanTarget[] = [];
  const inRange = (p: Vec2, r: number) => length(sub(p, pos)) <= range + r;
  for (const w of state.combat.wrecks) {
    if (inRange(w.body.pos, w.props.boundingRadius)) out.push({ key: wreckKey(w), kind: 'wreck', pos: w.body.pos, radius: w.props.boundingRadius, wreck: w });
  }
  // a dormant graveyard sleeper looks like a wreck until analysed ("active reactor", T5) or awake
  for (const e of state.combat.enemies) {
    if (e.ai.mode === 'dormant' && inRange(e.body.pos, e.props.boundingRadius)) out.push({ key: e.id, kind: 'wreck', pos: e.body.pos, radius: e.props.boundingRadius });
  }
  for (const poi of poisNear(state.seed, pos, range + 20)) {
    if (poi.kind === 'wreck') continue;
    if (poi.kind === 'cache' && !state.discovery.known.has(poi.id)) continue;
    if (poi.kind === 'cache' && state.discovery.opened.has(poi.id)) continue;
    out.push({ key: poi.id, kind: poi.kind, pos: poi.pos, radius: poiRadius(poi), poi });
  }
  // M4b: derelicts (defence hint) and their relays (charge); graveyards are analysed through their wrecks
  forSitesNear(state.seed, pos, range + DERELICT_EXTENT, (site) => {
    if (site.kind !== 'derelict') return;
    const r = DERELICT_LAYOUTS[site.model].radius;
    if (inRange(site.pos, r)) out.push({ key: site.id, kind: 'derelict', pos: site.pos, radius: r, site });
    for (const relay of site.relays) {
      if (inRange(relay.pos, RELAY_SCAN_RADIUS)) out.push({ key: relay.id, kind: 'relay', pos: relay.pos, radius: RELAY_SCAN_RADIUS, site });
    }
  });
  // comet nuclei in their pass (composition and budget)
  for (const c of cometsNear(state.seed, pos, range + COMET.nucleusRadius, state.tick)) {
    out.push({ key: c.id, kind: 'comet', pos: c.pos, radius: COMET.nucleusRadius });
  }
  for (const site of echoSites(state.seed)) {
    if (inRange(site.pos, ECHO_RADIUS)) out.push({ key: site.id, kind: 'echo', pos: site.pos, radius: ECHO_RADIUS, echo: site.index });
  }
  for (const ds of distressNear(state.seed, pos, range, state.tick)) {
    if (!state.discovery.opened.has(ds.id)) out.push({ key: ds.id, kind: 'distress', pos: ds.pos, radius: DISTRESS.shipRadius, distress: ds });
  }
  if (aim && length(sub(aim, pos)) <= range) {
    for (const { asteroid, circle } of state.world.circlesNear(aim, SCANNER.aimSlack)) {
      if (length(sub(circle.pos, aim)) <= circle.radius + SCANNER.aimSlack / 3) {
        out.push({ key: `ast:${asteroid.resource}`, kind: 'asteroid', pos: circle.pos, radius: circle.radius });
      }
    }
  }
  return out;
}

/** Analysis target: the object under the cursor, else the nearest object not analysed yet. */
export function chooseTarget(state: SimState, aim: Vec2): ScanTarget | null {
  const all = scanTargets(state, aim);
  let best: ScanTarget | null = null;
  let bestD = Infinity;
  for (const t of all) {
    const d = length(sub(t.pos, aim)) - t.radius;
    if (d <= SCANNER.aimSlack && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (best) return best;
  const pos = state.player.body.pos;
  const objects = all.filter((t) => t.kind !== 'asteroid');
  const fresh = objects.filter((t) => !state.discovery.scanned.has(t.key));
  const pool = fresh.length > 0 ? fresh : objects;
  for (const t of pool) {
    const d = length(sub(t.pos, pos));
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** The target by its key (during an analysis – the object may have moved or gone). */
export function findTarget(state: SimState, key: string): ScanTarget | null {
  return scanTargets(state, null).find((t) => t.key === key) ?? (key.startsWith('ast:') ? { key, kind: 'asteroid', pos: state.player.body.pos, radius: 0 } : null);
}

function firstData(state: SimState, t: ScanTarget): number {
  switch (t.kind) {
    case 'wreck': {
      // a graveyard wreck (M4b T5): the graveyard's Data once, through its first analysed wreck
      const graveyard = t.wreck ? graveyardWreckData(state, t.wreck) : null;
      if (graveyard !== null) return graveyard;
      // only a real wreck pays: a POI / contract wreck or the loot wreck of a pirate (cls) – not a piece
      // cut from a wreck (M3.6, it was scanned whole) nor any debris of a ship, the player's own included (I13)
      return t.wreck && !t.wreck.from && (t.wreck.cls || t.wreck.poi) ? DATA_REWARDS.wreck : 0;
    }
    case 'anomaly':
      return DATA_REWARDS.anomaly[t.poi!.ring];
    case 'giant':
      return DATA_REWARDS.giant;
    case 'echo':
      return DATA_REWARDS.echo;
    case 'asteroid':
      return DATA_REWARDS.asteroidType;
    default:
      // M4b: a derelict pays at its terminal, a graveyard through its wrecks (T4, T5); relays and comets nothing
      return 0;
  }
}

/** A finished analysis: Data the first time, the journal, a wreck's contents, a trap, an Echo. */
export function completeAnalysis(state: SimState, t: ScanTarget, events: SimEvent[]): void {
  const d = state.discovery;
  const first = !d.scanned.has(t.key);
  let data = 0;
  if (first) {
    d.scanned.add(t.key);
    data = firstData(state, t);
    gainData(state, data, t.kind === 'echo' ? 'echo' : 'scan', events);
  }
  switch (t.kind) {
    case 'wreck':
      if (first && t.wreck) {
        onWreckAnalyzed(state, t.wreck, events);
        const cls = t.wreck.cls ?? (t.wreck.livery === 'pirate' ? 'pirate' : null);
        if (cls) addAtlas(state, 'wrecks', cls);
      }
      break;
    case 'asteroid':
      addAtlas(state, 'asteroids', t.key.slice(4));
      break;
    case 'anomaly':
      if (first) {
        if (t.poi?.kind === 'anomaly') addAtlas(state, 'anomalies', t.poi.type);
        fireJournal(state, { on: 'anomalyScanned' }, events);
        scanAssignment(state, 'anomaly', events);
        logDiscovery(state, { tick: state.tick, kind: 'poi', poi: 'anomaly' });
      }
      break;
    case 'giant':
      if (first) fireJournal(state, { on: 'giantDiscovered' }, events);
      if (t.poi?.kind === 'giant') addAtlas(state, 'giants', t.poi.resource);
      break;
    case 'echo':
      if (first) {
        d.known.add(t.key);
        addAtlas(state, 'echoes', String(t.echo));
        fireJournal(state, { on: 'echoAnalyzed', echo: t.echo! }, events);
        scanAssignment(state, 'echo', events);
      }
      break;
    case 'distress': {
      const n = (d.distressScans.get(t.key) ?? 0) + 1;
      d.distressScans.set(t.key, n);
      if (t.distress?.kind === 'trap' && n >= DISTRESS.trapRevealScans) fireJournal(state, { on: 'distressTrap' }, events);
      break;
    }
    case 'derelict':
    case 'comet':
      // analysed = seen (it is within radar range anyway)
      markKnown(state, t.key, t.kind, events);
      break;
    case 'relay':
      if (t.site) markKnown(state, t.site.id, 'derelict', events);
      break;
    default:
      break;
  }
  events.push({ type: 'analysisDone', target: t.key, kind: t.kind, data, first });
}

/** Progress of the Institute's assignments (anomaly scans, caches, Echoes). */
export function scanAssignment(state: SimState, what: 'anomaly' | 'cache' | 'echo', events: SimEvent[]): void {
  recordScan(state.career.rep, what);
  for (const level of promote(state.career.rep, 'institute')) events.push({ type: 'repLevelUp', faction: 'institute', level });
}

/** Is the trap revealed (2nd analysis)? */
export const trapRevealed = (state: SimState, id: string): boolean => (state.discovery.distressScans.get(id) ?? 0) >= DISTRESS.trapRevealScans;

/** A scanner step by whether Tab is held. */
export function stepScanner(state: SimState, held: boolean, aim: Vec2, events: SimEvent[]): void {
  const s = state.discovery.scanner;
  if (s.cooldown > 0) s.cooldown--;
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed) {
    s.held = 0;
    s.target = null;
    return;
  }
  if (held) {
    s.held++;
    if (s.held === TAP_TICKS) {
      const t = chooseTarget(state, aim);
      if (!t) {
        events.push({ type: 'scanFailed', reason: 'noTarget' });
      } else if (player.energy < SCANNER.analyzeEnergy) {
        events.push({ type: 'scanFailed', reason: 'energy' });
      } else {
        player.energy -= SCANNER.analyzeEnergy;
        s.target = t.key;
        events.push({ type: 'analysisStarted', target: t.key, kind: t.kind, pos: { ...t.pos } });
      }
    } else if (s.target && s.held > TAP_TICKS) {
      const t = findTarget(state, s.target);
      if (!t) {
        s.target = null;
        events.push({ type: 'analysisCancelled' });
      } else if (s.held >= ANALYZE_TICKS) {
        s.target = null;
        completeAnalysis(state, t, events);
      }
    }
    return;
  }
  if (s.held > 0 && s.held < TAP_TICKS) pulse(state, events);
  else if (s.target) events.push({ type: 'analysisCancelled' });
  s.held = 0;
  s.target = null;
}

/** A place became known (on the map): its signal goes, `poiDiscovered` once. */
function markKnown(state: SimState, id: string, kind: SignalKind, events: SimEvent[]): void {
  const d = state.discovery;
  if (d.known.has(id)) return;
  d.known.add(id);
  d.signals = d.signals.filter((s) => s.id !== id);
  events.push({ type: 'poiDiscovered', id, kind });
}

/** Signals fade after a while; places discovered within radar range are written to the map. */
export function discoverNearby(state: SimState, events: SimEvent[]): void {
  const d = state.discovery;
  d.signals = d.signals.filter((s) => state.tick - s.tick <= SCANNER.signalSeconds * TICKS && !d.known.has(s.id) && !d.opened.has(s.id));
  const pos = state.player.body.pos;
  const range = radarRangeOf(state);
  for (const poi of poisNear(state.seed, pos, range + 12)) {
    if (poi.kind === 'cache' || d.known.has(poi.id)) continue;
    if (length(sub(poi.pos, pos)) > range + poiRadius(poi)) continue;
    d.known.add(poi.id);
    d.signals = d.signals.filter((s) => s.id !== poi.id);
    events.push({ type: 'poiDiscovered', id: poi.id, kind: poi.kind });
    if (poi.kind === 'giant') fireJournal(state, { on: 'giantDiscovered' }, events);
  }
  // M4b: a derelict when its structure is within radar range, a graveyard when its field is
  forSitesNear(state.seed, pos, range + GRAVEYARD.radius, (site) => {
    const reach = site.kind === 'graveyard' ? GRAVEYARD.radius : DERELICT_LAYOUTS[site.model].radius;
    if (length(sub(site.pos, pos)) <= range + reach) markKnown(state, site.id, site.kind, events);
  });
  for (const c of cometsNear(state.seed, pos, range + COMET.nucleusRadius, state.tick)) markKnown(state, c.id, 'comet', events);
  for (const site of echoSites(state.seed)) {
    if (d.known.has(site.id) || length(sub(site.pos, pos)) > range + ECHO_RADIUS) continue;
    d.known.add(site.id);
    d.signals = d.signals.filter((s) => s.id !== site.id);
    events.push({ type: 'poiDiscovered', id: site.id, kind: 'echo' });
  }
}

/** The kind of a place by its id (UI and map). */
export function placeKind(state: SimState, id: string): SignalKind | null {
  if (echoIndexOf(id) !== null) return 'echo';
  if (id.startsWith('ds:')) return 'distress';
  if (id.startsWith('dl:') || id.startsWith('gy:')) return siteById(state.seed, id)?.kind ?? null;
  if (id.startsWith('cm:')) return cometById(state.seed, id) ? 'comet' : null;
  return poiById(state.seed, id)?.kind ?? null;
}

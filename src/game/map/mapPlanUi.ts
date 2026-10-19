// The map planner in the game layer (M4d T9): the planned route (game-layer state, never
// saved – a load starts a new Game, so it is cleared then), the map notes (sim state, commands
// `mapNoteSet` / `mapNoteDelete`), the stale marks (a `LastSeen` session memory fed with what the radar
// shows) and the flight marks of the route and the notes near the ship. The map gets `MapPlanData`
// fields and `MapPlanHandlers`; the flight HUD gets the marks for `navArrows`.
import { NOTES } from '../../data/navigation';
import { cargoMass } from '../../data/resources';
import type { GameActionInput } from '../../sim/commands';
import type { Vec2 } from '../../sim/math/vec2';
import { sectorAt, sectorEffects } from '../../sim/sector/sector';
import { cometsNear } from '../../sim/sites';
import type { SimState } from '../../sim/Simulation';
import type { MapSectorsData } from '../../ui/discovery/mapSectors';
import { summarizeShip, type ShipSummary } from '../partEffect';
import { LastSeen, pirateSightings, type Sighting } from './lastSeen';
import { noteViews, notesLocked, notesNear } from './noteView';
import { routeEstimate, routePlan } from './routePlan';
import type { MapNoteView, MapPlanData, MapPlanHandlers, RoutePlanData, StaleMark } from './types';

export interface MapPlanHost {
  state(): SimState;
  send(action: GameActionInput): unknown;
  render(): void;
}

/** The planned route's flight mark: where it ends, how far and how long for the current ship. */
export interface RouteMark {
  pos: Vec2;
  label: string;
  distance: number;
  seconds: number | null;
}

const NO_NOTES: MapNoteView[] = [];
/** The route data is computed again once the ship moves this far (u); the readout lags at most half of it. */
const ROUTE_POS_STEP = 5;
const NO_MARKS: StaleMark[] = [];

export class MapPlanUi {
  private target: { to: Vec2; label: string } | null = null;
  private readonly lastSeen = new LastSeen();
  private seenTick = -1;
  private ship: { grid: unknown; version: number; summary: ShipSummary } | null = null;
  private notesMemo: { key: string; views: MapNoteView[] } | null = null;
  /** The last route data and what it was computed from (the map asks 10× a second). */
  private routeMemo: { key: string; ship: ShipSummary; data: RoutePlanData } | null = null;
  readonly handlers: MapPlanHandlers;

  constructor(private readonly host: MapPlanHost) {
    this.handlers = {
      route: (to, label) => {
        this.target = { to: { x: to.x, y: to.y }, label };
        this.host.render();
      },
      clearRoute: () => {
        if (!this.target) return;
        this.target = null;
        this.host.render();
      },
      noteSet: (note) => void this.host.send({ type: 'mapNoteSet', ...(note.id !== undefined ? { id: note.id } : {}), pos: { x: note.pos.x, y: note.pos.y }, icon: note.icon, text: note.text }),
      noteDelete: (id) => void this.host.send({ type: 'mapNoteDelete', id }),
    };
  }

  /** The planned route's end (null = none). */
  get route(): { to: Vec2; label: string } | null {
    return this.target;
  }

  /** Forget the route and the stale marks (a new session; a load creates a new Game anyway). */
  clear(): void {
    this.target = null;
    this.lastSeen.clear();
    this.seenTick = -1;
  }

  /**
   * What the radar shows this step (once per tick, in flight): the pirate groups in range and the comet
   * nuclei in their pass – they are live; what dropped out of sight leaves a fading mark.
   */
  observe(state: SimState, radarRange: number): void {
    if (state.tick === this.seenTick) return;
    this.seenTick = state.tick;
    const { player } = state;
    if (player.dock.mode !== 'flying' || player.destroyed) {
      this.lastSeen.update([], state.tick);
      return;
    }
    const pos = player.body.pos;
    const enemies = state.combat.enemies;
    const seen: Sighting[] = enemies.length > 0 ? pirateSightings(enemies.map((e) => ({ id: e.id, pos: e.body.pos })), pos, radarRange) : [];
    for (const c of cometsNear(state.seed, pos, radarRange, state.tick)) seen.push({ key: `comet:${c.id}`, kind: 'comet', pos: c.pos });
    this.lastSeen.update(seen, state.tick);
  }

  /** The ship's sums for the route estimate (recomputed when the hull changes). */
  private summary(state: SimState): ShipSummary {
    const { grid, gridVersion } = state.player;
    if (!this.ship || this.ship.grid !== grid || this.ship.version !== gridVersion) this.ship = { grid, version: gridVersion, summary: summarizeShip(grid) };
    return this.ship.summary;
  }

  private options(state: SimState): { cargoMass: number; fuelMult: number } {
    return { cargoMass: cargoMass(state.player.cargo), fuelMult: sectorEffects(sectorAt(state.seed, state.player.body.pos, state.tick)).fuelUseMult };
  }

  /** The notes as map views (the same array while the notes do not change). */
  notes(state: SimState): MapNoteView[] {
    const notes = state.navigation.notes;
    if (notes.length === 0) return NO_NOTES;
    let key = String(state.navigation.nextNote);
    for (const n of notes) key += `|${n.id},${n.icon},${n.pos.x},${n.pos.y},${n.text}`;
    if (this.notesMemo?.key !== key) this.notesMemo = { key, views: noteViews(state) };
    return this.notesMemo.views;
  }

  /**
   * The planned route for the map (readout, range circles, risks with the current security). The same
   * object while the target, the ship's position (to ROUTE_POS_STEP), fuel, hull, cargo, the local fuel
   * factor and the sector knowledge stay – the risks walk the sectors along the line (audit P1).
   */
  routeData(state: SimState, sectors: MapSectorsData | null): RoutePlanData | null {
    const t = this.target;
    if (!t) return null;
    const pos = state.player.body.pos;
    const ship = this.summary(state);
    const options = this.options(state);
    const fuel = state.player.fuel;
    const key = `${t.to.x},${t.to.y}|${t.label}|${Math.round(pos.x / ROUTE_POS_STEP)},${Math.round(pos.y / ROUTE_POS_STEP)}|${fuel}|${options.cargoMass}|${options.fuelMult}|${
      sectors ? `${sectors.seed}|${sectors.version}|${sectors.current}|${sectors.explored.size}` : '-'
    }`;
    const memo = this.routeMemo;
    if (memo && memo.key === key && memo.ship === ship) return memo.data;
    const coverage = sectors?.coverage;
    const data = routePlan({
      from: pos,
      to: t.to,
      label: t.label,
      ship,
      fuel,
      options,
      sectors: sectors ? { seed: sectors.seed, overrides: sectors.overrides, knowledge: sectors.knowledge, coverage: (id) => coverage?.(id) ?? null, current: sectors.current } : null,
    });
    this.routeMemo = { key, ship, data };
    return data;
  }

  /** The map's M4d planner fields. */
  mapData(state: SimState, sectors: MapSectorsData | null): Pick<MapPlanData, 'route' | 'notes' | 'stale' | 'notesLocked'> {
    const marks = this.lastSeen.size > 0 ? this.lastSeen.marks(state.tick) : NO_MARKS;
    return { route: this.routeData(state, sectors), notes: this.notes(state), stale: marks.length > 0 ? marks : NO_MARKS, notesLocked: notesLocked(state) };
  }

  /** The route's flight mark (null = no route). */
  routeMark(state: SimState): RouteMark | null {
    const t = this.target;
    if (!t) return null;
    const p = state.player.body.pos;
    const distance = Math.hypot(t.to.x - p.x, t.to.y - p.y);
    const est = routeEstimate(this.summary(state), distance, this.options(state));
    return { pos: t.to, label: t.label, distance, seconds: est && Number.isFinite(est.seconds) ? est.seconds : null };
  }

  /** Notes within `NOTES.flightRange` of the ship, nearest first – only with the setting on and the Archive node bought. */
  noteMarks(state: SimState, enabled: boolean): MapNoteView[] {
    if (!enabled || state.navigation.notes.length === 0 || notesLocked(state)) return NO_NOTES;
    return notesNear(this.notes(state), state.player.body.pos, NOTES.flightRange);
  }
}

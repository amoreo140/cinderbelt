// Mining 2.0 in the game layer: callouts at the mined rock (its grade or
// "?"), at assayed rich rocks and at drifting nuggets; the radar tint of rich rocks; the best grade
// of remembered fields on the map; toasts and the "+12,5 Fe" pop at the cargo gauge. Game.ts only
// calls these methods. Texts come from i18n/skMining.ts.
import { NUGGET } from '../../data/ore';
import { tx } from '../../i18n';
import { chunkOfAsteroid, isPoor, isRich, oreGrade } from '../../sim/mining/grade';
import { length, sub, type Vec2 } from '../../sim/math/vec2';
import type { SimEvent, SimState } from '../../sim/Simulation';
import type { Asteroid } from '../../sim/world/generate';
import { formatAmount, formatGrade } from '../../ui/format';
import type { ToastKind } from '../../ui/GameUi';
import type { CalloutData } from '../discovery/exploreUi';

const t = () => tx().mining;
const TICKS = 60;
/** How long the pickup pop stays (s). */
export const POP_SECONDS = 1.6;
/** Rich rocks get a callout this close to the ship (u). */
const RICH_CALLOUT_RANGE = 120;
/** Nuggets get a callout this close to the ship (u). */
const NUGGET_CALLOUT_RANGE = 70;
/** The nugget toast is shown only for the first few nuggets of a session (then the callout says it). */
const NUGGET_TOASTS = 3;

export interface MiningPop {
  seq: number;
  text: string;
}

export interface MiningToast {
  text: string;
  kind: ToastKind;
  seconds: number;
  /** Wins over the scanner's own pulse toast (rich ore found). */
  urgent: boolean;
}

type Callout = CalloutData & { dist: number };

/** Point on the rim of a rock towards the ship (the label of a big rock stays on screen). */
function rim(a: { pos: Vec2 }, radius: number, ship: Vec2): Vec2 {
  const d = sub(ship, a.pos);
  const len = length(d);
  return len > radius ? { x: a.pos.x + (d.x / len) * radius * 0.75, y: a.pos.y + (d.y / len) * radius * 0.75 } : a.pos;
}

/** Callout title of a rock by its grade class. */
export function gradeTitle(a: Pick<Asteroid, 'resource'>, grade: number | null): string {
  const name = tx().resources[a.resource];
  if (grade === null) return t().grade.plain(name);
  if (isRich(grade)) return t().grade.rich(name);
  if (isPoor(grade)) return t().grade.poor(name);
  return t().grade.plain(name);
}

export class MiningUi {
  private pops: (MiningPop & { at: number })[] = [];
  private seq = 0;
  private nuggetToasts = 0;
  /**
   * A rock's assay chunk and grade (pure functions of the seed and the rock): the radar asks for every
   * rock in range at each 10 Hz redraw, the id parsing and the hash cost more than the lookup (O12).
   */
  private rocks = new WeakMap<Asteroid, { seed: number; chunk: string; grade: number }>();

  private rock(state: SimState, a: Asteroid): { chunk: string; grade: number } {
    let r = this.rocks.get(a);
    if (!r || r.seed !== state.seed) {
      r = { seed: state.seed, chunk: chunkOfAsteroid(a), grade: oreGrade(state.seed, a) };
      this.rocks.set(a, r);
    }
    return r;
  }

  /** The rock's grade when its chunk was assayed (`gradeKnown`), else null. */
  private knownGrade(state: SimState, a: Asteroid): number | null {
    const r = this.rock(state, a);
    return state.mining.assayed.has(r.chunk) ? r.grade : null;
  }

  /** Pickup pops (call with every step's events). */
  onEvents(events: readonly SimEvent[], clock: number): void {
    for (const e of events) {
      if (e.type === 'nuggetCollected' && e.amount > 0) {
        this.pops.push({ seq: ++this.seq, text: t().nugget.pop(formatAmount(e.amount), t().symbols[e.resource]), at: clock });
      }
    }
    this.pops = this.pops.filter((p) => clock - p.at < POP_SECONDS).slice(-3);
  }

  /** Pops still on screen. */
  activePops(clock: number): MiningPop[] {
    return this.pops.filter((p) => clock - p.at < POP_SECONDS).map(({ seq, text }) => ({ seq, text }));
  }

  /** The most important mining toast of a step, or null. */
  toast(state: SimState, events: readonly SimEvent[]): MiningToast | null {
    let best: MiningToast | null = null;
    for (const e of events) {
      if (e.type === 'oreAssayed' && e.rocks > 0) {
        best = e.rich > 0
          ? { text: t().assay.rich(e.rich, formatGrade(e.best)), kind: 'ok', seconds: 4, urgent: true }
          : { text: t().assay.plain(formatGrade(e.best)), kind: 'info', seconds: 3, urgent: false };
      } else if (e.type === 'nuggetCollected' && e.amount > 0) {
        best = { text: t().nugget.collected(formatAmount(e.amount), tx().resources[e.resource]), kind: 'ok', seconds: 2.5, urgent: false };
      } else if (e.type === 'nuggetSpawned' && !best && this.nuggetToasts < NUGGET_TOASTS && state.player.dock.mode === 'flying') {
        this.nuggetToasts++;
        best = { text: t().nugget.broke(tx().resources[e.resource], formatGrade(e.grade)), kind: 'info', seconds: 3.5, urgent: false };
      }
    }
    return best;
  }

  /** Callouts: drifting nuggets, the rock under the beam (grade or "?") and assayed rich rocks. */
  callouts(state: SimState): Callout[] {
    const player = state.player;
    if (player.dock.mode !== 'flying' || player.destroyed) return [];
    const pos = player.body.pos;
    const out: Callout[] = [];
    for (const n of state.mining.nuggets) {
      const dist = length(sub(n.body.pos, pos));
      if (dist > NUGGET_CALLOUT_RANGE) continue;
      const left = n.ttl / TICKS;
      const fading = left <= NUGGET.fadeSeconds;
      const tr = player.tractor?.target;
      const pulled = tr?.kind === 'nugget' && tr.id === n.id;
      const tractor = player.props.tractors.length > 0 && !pulled;
      out.push({
        id: `nugget:${n.id}`,
        world: n.body.pos,
        title: t().nugget.title(formatAmount(n.amount), t().symbols[n.resource]),
        detail: pulled ? t().nugget.pulled : fading ? t().nugget.fading(Math.ceil(left)) : t().nugget.how,
        keys: tractor ? 'T' : null,
        action: tractor ? t().nugget.tractor : null,
        tone: fading ? 'warn' : 'ok',
        // a nugget is short-lived – it goes before rocks at the same distance
        dist: dist * 0.5,
      });
    }
    const world = state.world;
    const mined = new Set<string>();
    for (const b of player.beams) {
      if (!b.asteroidId || mined.has(b.asteroidId)) continue;
      mined.add(b.asteroidId);
      const a = world.findAsteroid(b.asteroidId);
      const r = a ? world.radiusOf(a) : 0;
      if (!a || r <= 0) continue;
      const grade = this.knownGrade(state, a);
      out.push({
        id: `ore:${a.id}`,
        world: rim(a, r, pos),
        title: gradeTitle(a, grade),
        detail: grade === null ? t().grade.unknown : t().grade.value(formatGrade(grade)),
        keys: grade === null ? 'Tab' : null,
        action: grade === null ? t().grade.pulse : null,
        tone: grade !== null && isRich(grade) ? 'ok' : grade !== null && isPoor(grade) ? 'warn' : 'info',
        dist: 0,
      });
    }
    for (const { asteroid: a, circle } of world.circlesNear(pos, RICH_CALLOUT_RANGE)) {
      if (mined.has(a.id)) continue;
      const grade = this.knownGrade(state, a);
      if (grade === null || !isRich(grade)) continue;
      const dist = length(sub(a.pos, pos));
      if (dist > RICH_CALLOUT_RANGE) continue;
      out.push({ id: `ore:${a.id}`, world: rim(a, circle.radius, pos), title: gradeTitle(a, grade), detail: t().grade.value(formatGrade(grade)), keys: null, action: null, tone: 'ok', dist });
    }
    return out.sort((x, y) => x.dist - y.dist);
  }

  /** Is the rock marked rich on the radar (assayed and rich)? */
  radarRich(state: SimState, a: Asteroid): boolean {
    const grade = this.knownGrade(state, a);
    return grade !== null && isRich(grade);
  }
}

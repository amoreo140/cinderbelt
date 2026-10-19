// Micrometeor shower FX (M4b plan T14). While a shower runs, streaks cross the play area along the
// stream (from the direction the director gave it), so the player sees where to turn the armour;
// during the radio lead a faint shimmer of dust drifts in from that side and the first grains show
// up. A `micrometeorHit` shows the grain arriving, sparks thrown back out of the hull and a hot pit
// that cools on the part (the hull decals by part HP keep the scar); a hit the shield took flashes
// blue (CombatLayer lights the bubble). Streaks are ONE instanced batch (one draw call); quality and
// reduced motion thin them out. Looks only – nothing here feeds back into the simulation.
import { Color, Group, Vector3, type InstancedBufferGeometry } from 'three';
import { MICROMETEORS } from '../../data/events';
import { activeEvents } from '../../sim/events/director';
import type { ActiveEvent } from '../../sim/events/types';
import { lerpAngle } from '../../sim/math/angle';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { simToWorld } from '../coords';
import type { WarmUpZoo } from '../warmup';
import { FX_HEIGHT } from './Effects';
import type { FxModels } from './fxModels';
import { Particles, SpriteBatch } from './Particles';
import { vfxTexture } from './textures';

const TICKS = 60;
/** Streaks at quality High (particles 1); the floor keeps a shower readable on the lowest setting. */
export const MAX_STREAKS = 100;
export const MIN_STREAKS = 14;
/** Reduced motion: this share of the streaks, slower. */
const REDUCED_SHARE = 0.4;
const REDUCED_SPEED = 0.45;
/** Grain speed across the screen (u/s) – a look, not the simulation's ray. */
const GRAIN_SPEED = 72;
/** Fade in after the start and out before the end (s). */
const FADE_IN = 1.5;
const FADE_OUT = 2;
/** The listed events are re-read this often (s) – the director listing is not free every frame. */
const REFRESH = 0.25;
/** Cooling pits on the hull at once. */
const MAX_PITS = 16;
const PIT_LIFE = 1.6;

const hdr = (r: number, g: number, b: number): Color => new Color(r, g, b);
const COLORS = {
  tail: hdr(1.05, 0.92, 0.78),
  core: hdr(2.6, 2.2, 1.7),
  mote: hdr(1.5, 1.4, 1.25),
  spark: hdr(3.0, 1.7, 0.75),
  flash: hdr(2.6, 1.9, 1.2),
  shield: hdr(0.6, 1.9, 2.8),
  pitHot: hdr(3.2, 1.5, 0.45),
  pitCold: hdr(0.5, 0.12, 0.04),
} as const;

/** `x` wrapped into [−half, half) – a streak leaving the band on one side comes back on the other. */
export function wrapCentered(x: number, half: number): number {
  const w = 2 * half;
  return x - w * Math.floor((x + half) / w);
}

/** Streaks for a quality's particle share and the reduced-motion setting. */
export function streakBudget(particles: number, reducedMotion: boolean): number {
  const n = Math.round(MAX_STREAKS * Math.max(0, Math.min(1, particles)) * (reducedMotion ? REDUCED_SHARE : 1));
  return Math.max(MIN_STREAKS, n);
}

/** The running or announced micrometeor shower among the listed events, or null. */
export function showerOf(events: readonly ActiveEvent[]): { start: number; end: number; dir: number } | null {
  for (const e of events) if (e.kind === 'micrometeors' && e.dir !== undefined) return { start: e.start, end: e.end, dir: e.dir };
  return null;
}

/**
 * The shower's envelope at `tick` (fractional): `warn` 0..1 builds up over the radio lead before the
 * start; `strength` 0..1 fades in after the start, holds and fades out before the end.
 */
export function showerEnvelope(tick: number, start: number, end: number): { warn: number; strength: number } {
  const lead = MICROMETEORS.leadSeconds * TICKS;
  if (tick >= end || tick < start - lead) return { warn: 0, strength: 0 };
  if (tick < start) return { warn: Math.min(1, (tick - (start - lead)) / lead), strength: 0 };
  const strength = Math.min(1, (tick - start) / (FADE_IN * TICKS), (end - tick) / (FADE_OUT * TICKS));
  return { warn: 0, strength: Math.max(0, strength) };
}

/** One streak's fixed traits (positions are a function of time, the ship and these). */
interface Streak {
  /** Along-stream phase and cross-stream position (0..1). */
  along: number;
  across: number;
  speed: number;
  length: number;
  bright: number;
  flicker: number;
}

interface Pit {
  /** Ship frame (sim units, from the centre of the body). */
  lx: number;
  ly: number;
  age: number;
  size: number;
}

interface PendingHit {
  x: number;
  y: number;
  damage: number;
  shielded: boolean;
}

export interface MicrometeorView {
  cameraDistance: number;
  reducedMotion: boolean;
}

const DEFAULT_VIEW: MicrometeorView = { cameraDistance: 70, reducedMotion: false };

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class Micrometeors {
  readonly object = new Group();
  /** Streaks and the lead shimmer: one batch, two sprites per streak (faint tail, bright core). */
  private readonly streaks = new SpriteBatch({ texture: vfxTexture('spark'), additive: true, max: MAX_STREAKS * 2, renderOrder: 13 });
  private readonly sparks = new Particles({ texture: vfxTexture('spark'), additive: true, max: 160, renderOrder: 13 });
  private readonly glow = new Particles({ texture: vfxTexture('glow_soft'), additive: true, max: 48, renderOrder: 12 });
  private readonly pitBatch = new SpriteBatch({ texture: vfxTexture('ember'), additive: true, max: MAX_PITS, renderOrder: 13 });
  private readonly traits: Streak[] = [];
  private readonly pits: Pit[] = [];
  private readonly pending: PendingHit[] = [];
  private shower: { start: number; end: number; dir: number } | null = null;
  private refreshIn = 0;
  private particles = 1;
  private time = 0;
  private readonly v = new Vector3();
  private readonly axis = new Vector3();
  private readonly color = new Color();
  private readonly tmp = new Vector3();
  /** Time scale of the effects (1 = normal; e2e screenshots slow it down). */
  timeScale = 1;

  constructor(private readonly models: FxModels) {
    this.object.name = 'micrometeors';
    for (let i = 0; i < MAX_STREAKS; i++) {
      this.traits.push({ along: Math.random(), across: Math.random(), speed: rand(0.8, 1.25), length: rand(0.7, 1.3), bright: rand(0.45, 1), flicker: Math.random() * 20 });
    }
    this.streaks.mesh.name = 'micrometeor-streaks';
    this.object.add(this.streaks.mesh, this.pitBatch.mesh, this.glow.mesh, this.sparks.mesh);
  }

  /** Particle share of the graphics quality (render/quality.ts `particles`). */
  setQuality(particles: number): void {
    this.particles = particles;
  }

  /** Per frame: streaks of an active shower around the ship, hits of the last steps, cooling pits. */
  update(state: SimState, alpha: number, frameDt: number, view: MicrometeorView = DEFAULT_VIEW): void {
    void this.models;
    frameDt *= this.timeScale;
    this.time += frameDt;
    this.refreshIn -= frameDt;
    if (this.refreshIn <= 0) {
      this.refreshIn = REFRESH;
      this.shower = showerOf(activeEvents(state));
    }
    const player = state.player;
    const px = player.prevBody.pos.x + (player.body.pos.x - player.prevBody.pos.x) * alpha;
    const py = player.prevBody.pos.y + (player.body.pos.y - player.prevBody.pos.y) * alpha;
    const angle = lerpAngle(player.prevBody.angle, player.body.angle, alpha);
    const flying = player.dock.mode === 'flying' && !player.destroyed;

    for (const hit of this.pending) this.spawnHit(hit, state, flying);
    this.pending.length = 0;

    this.drawStreaks(state.tick - 1 + alpha, px, py, flying, view);
    this.drawPits(px, py, angle, frameDt, flying);
    this.sparks.update(frameDt);
    this.glow.update(frameDt);
  }

  /** Impact sparks and shield flashes (`micrometeorHit`); a shower event refreshes the listing at once. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'micrometeorHit') this.pending.push({ x: e.pos.x, y: e.pos.y, damage: e.damage, shielded: e.shielded });
      else if ((e.type === 'eventWarning' || e.type === 'eventStarted' || e.type === 'eventEnded') && e.kind === 'micrometeors') this.refreshIn = 0;
    }
  }

  private drawStreaks(tick: number, px: number, py: number, flying: boolean, view: MicrometeorView): void {
    const b = this.streaks;
    b.begin();
    const s = this.shower;
    if (s && flying) {
      const { warn, strength } = showerEnvelope(tick, s.start, s.end);
      // the stream comes FROM `dir`: grains move along −u; n = across the stream
      const ux = Math.cos(s.dir);
      const uy = Math.sin(s.dir);
      const nx = -uy;
      const ny = ux;
      const d = Math.max(20, view.cameraDistance);
      const half = Math.min(220, Math.max(30, d * 1.05));
      const halfAlong = half * 1.15;
      const shipAlong = px * ux + py * uy;
      const shipAcross = px * nx + py * ny;
      const reduced = view.reducedMotion;
      const budget = streakBudget(this.particles, reduced);
      const speedK = reduced ? REDUCED_SPEED : 1;
      const zoom = Math.min(1.6, Math.max(0.7, d / 70));
      const width = 0.12 + d * 0.005;
      // the first grains arrive during the last seconds of the lead
      const level = Math.max(strength, 0.16 * warn * warn * warn);
      const shown = Math.ceil(budget * level);
      this.axis.set(-ux, 0, uy);
      for (let i = 0; i < shown; i++) {
        const t = this.traits[i]!;
        const speed = GRAIN_SPEED * t.speed * speedK;
        const along = wrapCentered(t.along * 2 * halfAlong - this.time * speed - shipAlong, halfAlong);
        const across = wrapCentered(t.across * 2 * half - shipAcross, half);
        const len = (reduced ? 2.6 : 6.5) * t.length * zoom;
        const x = px + ux * along + nx * across;
        const y = py + uy * along + ny * across;
        const a = (0.4 + 0.6 * level) * t.bright;
        simToWorld({ x, y }, FX_HEIGHT + 0.6, this.v);
        b.add(this.v, this.axis, len, width, 0, COLORS.tail, 0.45 * a);
        // the core sits at the head (the leading end of the tail)
        this.tmp.copy(this.v).addScaledVector(this.axis, len * 0.38);
        b.add(this.tmp, this.axis, len * 0.28, width * 1.35, 0, COLORS.core, a);
      }
      // the lead shimmer: faint dust drifting in from the stream's side, twinkling (steady with reduced motion)
      if (warn > 0) {
        const motes = Math.min(MAX_STREAKS - shown, Math.round(budget * 0.8));
        for (let i = 0; i < motes; i++) {
          const t = this.traits[MAX_STREAKS - 1 - i]!;
          const along = wrapCentered(t.along * 2 * halfAlong - this.time * 9 * t.speed - shipAlong, halfAlong);
          const across = wrapCentered(t.across * 2 * half - shipAcross, half);
          const tw = reduced ? 0.7 : 0.5 + 0.5 * Math.sin(this.time * 6 + t.flicker);
          simToWorld({ x: px + ux * along + nx * across, y: py + uy * along + ny * across }, FX_HEIGHT + 0.6, this.v);
          b.add(this.v, this.axis, 2.2 * zoom, width * 1.8, 0, COLORS.mote, (0.25 + 0.75 * warn) * tw * t.bright);
        }
      }
    }
    b.end();
  }

  private spawnHit(hit: PendingHit, state: SimState, flying: boolean): void {
    const pos = simToWorld(hit, FX_HEIGHT + 0.15, new Vector3());
    const dir = this.shower?.dir ?? state.player.body.angle;
    // the grain travels along −u (world: x = −cos, z = +sin)
    const inc = new Vector3(-Math.cos(dir), 0, Math.sin(dir));
    // the grain arriving: a short hot streak ending at the hull
    this.sparks.spawn({ pos: this.tmp.copy(pos).addScaledVector(inc, -1.6), axis: inc, life: 0.1, size: 3.6, aspect: 0.08, color: COLORS.core, alpha: 1, fadePower: 0.6 });
    const n = 4 + 2 * hit.damage;
    if (hit.shielded) {
      this.glow.spawn({ pos, life: 0.24, size: 1.9, sizeEnd: 0.9, color: COLORS.shield, alpha: 0.9 });
      for (let i = 0; i < n; i++) {
        const v = new Vector3(rand(-1, 1), rand(-0.2, 0.3), rand(-1, 1)).normalize().addScaledVector(inc, -0.9).normalize();
        this.sparks.spawn({ pos, vel: v.multiplyScalar(rand(4, 9)), drag: 4, life: rand(0.15, 0.3), size: 0.5, aspect: 0.14, stretch: true, color: COLORS.shield });
      }
      return;
    }
    this.glow.spawn({ pos, life: 0.18, size: 1.1 + 0.25 * hit.damage, sizeEnd: 0.4, color: COLORS.flash, alpha: 0.9 });
    for (let i = 0; i < n; i++) {
      // thrown back out of the hull, against the grain, fanned out
      const v = new Vector3(rand(-1, 1), rand(0, 0.6), rand(-1, 1)).normalize().addScaledVector(inc, -1.3).normalize();
      this.sparks.spawn({ pos, vel: v.multiplyScalar(rand(6, 16)), drag: 3, life: rand(0.18, 0.4), size: rand(0.45, 0.8), aspect: 0.15, stretch: true, color: COLORS.spark });
    }
    if (!flying) return;
    // a hot pit on the part, carried by the ship (ship frame from the post-step pose of the event)
    const body = state.player.body;
    const dx = hit.x - body.pos.x;
    const dy = hit.y - body.pos.y;
    const c = Math.cos(-body.angle);
    const s = Math.sin(-body.angle);
    if (this.pits.length >= MAX_PITS) this.pits.shift();
    this.pits.push({ lx: dx * c - dy * s, ly: dx * s + dy * c, age: 0, size: 0.38 + 0.08 * hit.damage });
  }

  private drawPits(px: number, py: number, angle: number, dt: number, flying: boolean): void {
    if (!flying) this.pits.length = 0;
    const b = this.pitBatch;
    b.begin();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let n = 0;
    for (const p of this.pits) {
      p.age += dt;
      if (p.age >= PIT_LIFE) continue;
      this.pits[n++] = p;
      const t = p.age / PIT_LIFE;
      this.color.copy(COLORS.pitHot).lerp(COLORS.pitCold, Math.min(1, t * 1.4));
      simToWorld({ x: px + p.lx * c - p.ly * s, y: py + p.lx * s + p.ly * c }, FX_HEIGHT + 0.25, this.v);
      b.add(this.v, null, p.size, p.size, 0, this.color, 1 - t * t);
    }
    this.pits.length = n;
    b.end();
  }

  /** Shader warm-up: one drawn streak (the sprite program the layer's batches share). */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    const sample = new SpriteBatch({ texture: vfxTexture('spark'), additive: true, max: 1, renderOrder: 13 });
    sample.begin();
    sample.add(new Vector3(), new Vector3(1, 0, 0), 4, 0.3, 0, COLORS.core, 1);
    sample.end();
    zoo.geometry(sample.mesh.geometry);
    zoo.add(sample.mesh);
  }

  /** Counts for tests and debugging. */
  stats(): { shower: boolean; streaks: number; pits: number; effects: number } {
    return { shower: this.shower !== null, streaks: (this.streaks.mesh.geometry as InstancedBufferGeometry).instanceCount, pits: this.pits.length, effects: this.sparks.count + this.glow.count };
  }

  dispose(): void {
    this.streaks.dispose();
    this.pitBatch.dispose();
    this.sparks.dispose();
    this.glow.dispose();
    this.object.clear();
  }
}

// Looks of the world sites (M4b plan T13) – pure helpers of SiteLayer, tested on their own.
//
// - Relay looks are parameterised by the relay's `owner`: the derelict look and the Guild relay mast of
//   M4d (Guild orange charging, strobe blue lit, an amber standby blink once repaired).
// - Relay lamp: dark → charging (a pulse that quickens and brightens with the charge) → lit (steady).
// - Guild relay mast (M4d plan T13): broken = dark, the torn cable crackling; repaired = an amber standby
//   blink; then charging and lit like any relay. The hold of a powered mast against the Rust
//   counterattack shows its circle (the hold boundary, or the re-arm circle once interrupted) as dots on
//   the plane near the ship.
// - Derelict lights: dead until all relays are powered; one or two powered relays make the windows
//   flicker faintly (power trickling in); with all of them the windows partly come back and the dock
//   lamps blink.
// - Live mines: a slow red pulse; armed = a fast blink for the fuse.
// - The local ion storm of a derelict fades in and out at the ends of its window.
// Reduced motion: no pulses or flicker – steady levels that still read the same states.
import { RELAY_CHAIN } from '../../data/guild';
import type { RelayHold, RelayStage } from '../../sim/guild/types';
import type { Vec2 } from '../../sim/math/vec2';
import type { RelayOwner } from '../../sim/sites/types';

/** Linear RGB, HDR (> 1 blooms). */
export type Rgb = readonly [number, number, number];

export interface RelayLook {
  /** The lamp and the receiver glow of a powered relay, and the conduit beam to its station. */
  lit: Rgb;
  /** The lamp and the receiver while the beam charges it; the filled part of the charge ring. */
  charge: Rgb;
  /** The standby blink of a repaired Guild mast waiting for power (a derelict relay never idles). */
  idle: Rgb;
  /** Hex colours of the charge ring (filled / still empty / the flash when lit) – UI tokens, read on the plane. */
  ringFill: number;
  ringEmpty: number;
  ringLit: number;
}

export const RELAY_LOOKS: Readonly<Record<RelayOwner, RelayLook>> = {
  // the derelict relays: amber while charging (PALETTE.warn), a cool teal-green once powered (PALETTE.ok)
  derelict: { lit: [0.9, 3.2, 1.9], charge: [3.4, 2.0, 0.55], idle: [3.4, 2.0, 0.55], ringFill: 0xffb547, ringEmpty: 0x62d9f4, ringLit: 0x6be38a },
  // M4d Guild relay mast: Guild orange charging, strobe blue lit, amber (PALETTE.warn) standby. The lit blue
  // stays a saturated, moderate HDR: with every channel far above 1 the bloom turned the lamp into a white
  // blob over the whole mast at the flight camera (render polish).
  guild: { lit: [0.55, 1.05, 2.1], charge: [3.6, 1.6, 0.4], idle: [3.2, 2.1, 0.6], ringFill: 0xff8a3d, ringEmpty: 0x9ccbff, ringLit: 0x9ccbff },
};

export const relayLook = (owner: RelayOwner): RelayLook => RELAY_LOOKS[owner] ?? RELAY_LOOKS.derelict;

/** idle = a repaired Guild mast waiting for power (the standby blink). */
export type RelayLampState = 'dark' | 'idle' | 'charging' | 'lit';

export interface RelayLamp {
  state: RelayLampState;
  /** 0..1 – brightness of the lamp glow this frame. */
  intensity: number;
}

/**
 * The relay lamp for a charge share (0 = none, 0..1 = charging, 1 = powered) at time `t` (s).
 * Charging pulses from ~1.2 Hz to ~5 Hz and from dim to bright as the charge grows.
 */
export function relayLamp(charge: number, t: number, reducedMotion: boolean): RelayLamp {
  if (charge >= 1) return { state: 'lit', intensity: 1 };
  if (charge <= 0) return { state: 'dark', intensity: 0 };
  const level = 0.3 + 0.7 * charge;
  if (reducedMotion) return { state: 'charging', intensity: level };
  const hz = 1.2 + 3.8 * charge;
  const wave = 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2);
  return { state: 'charging', intensity: level * (0.45 + 0.55 * wave) };
}

/** A lane's Guild relay stage as the render reads it (no record in `guild.relays` = broken). */
export type GuildRelayStage = 'broken' | RelayStage;

/**
 * The lamp of a Guild relay mast: broken = dark; repaired = a short amber standby flash every 2 s over a dim
 * glow (charging = `relayLamp`); powered and secured = lit.
 */
export function guildRelayLamp(stage: GuildRelayStage, charge: number, t: number, reducedMotion: boolean): RelayLamp {
  if (stage === 'broken') return { state: 'dark', intensity: 0 };
  if (stage !== 'repaired' || charge >= 1) return { state: 'lit', intensity: 1 };
  if (charge > 0) return relayLamp(charge, t, reducedMotion);
  if (reducedMotion) return { state: 'idle', intensity: 0.45 };
  const phase = (((t * 0.5) % 1) + 1) % 1;
  return { state: 'idle', intensity: phase < 0.1 ? 1 : 0.16 };
}

/**
 * Sparks 0..1 of the broken mast's torn cable at time `t` (s): crackling bursts (about half of the
 * 0.6 s windows), quiet between them; `seed` varies the rhythm per mast. Reduced motion: a steady ember.
 */
export function brokenSpark(t: number, seed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.35;
  const slot = Math.floor(t * 14);
  if (noise2(seed, Math.floor(t * 1.6)) >= 0.5) return noise2(slot, seed) < 0.04 ? 0.45 : 0;
  return noise2(slot, seed + 1) < 0.55 ? 0.35 + 0.65 * noise2(seed, slot) : 0;
}

/** Linear RGB of the hold circle: alarm amber before the counterattack, red while it is on, Guild blue when re-arming. */
const HOLD_WARNING: Rgb = [3.4, 1.9, 0.45];
const HOLD_FIGHT: Rgb = [3.6, 0.55, 0.35];
const HOLD_IDLE: Rgb = [1.0, 1.6, 3.0];

/**
 * The circle of a relay hold: warning / fight = the hold boundary (`RELAY_CHAIN.holdRadius` – farther
 * interrupts the hold), pulsing; idle (interrupted) = the re-arm circle (`rearmRadius` – come back inside),
 * steady and dim.
 */
export function holdRing(phase: RelayHold['phase'], t: number, reducedMotion: boolean): { radius: number; color: Rgb; alpha: number } {
  if (phase === 'idle') return { radius: RELAY_CHAIN.rearmRadius, color: HOLD_IDLE, alpha: 0.45 };
  const hz = phase === 'warning' ? 2 : 1;
  const pulse = reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(t * hz * Math.PI * 2);
  return { radius: RELAY_CHAIN.holdRadius, color: phase === 'warning' ? HOLD_WARNING : HOLD_FIGHT, alpha: pulse };
}

/** The hold circle shows only near the ship: 1 on the circle, 0 from 260 u off it (`distance` = ship to centre). */
export function holdEdgeFade(distance: number, radius: number): number {
  const off = Math.abs(distance - radius);
  if (off <= 40) return 1;
  if (off >= 260) return 0;
  const x = (260 - off) / 220;
  return x * x * (3 - 2 * x);
}

/**
 * Dots every `spacing` u along a circle (`centre`, `radius`) within `span` u of arc on both sides of the
 * point nearest `near`; `fade` 1 in the middle → 0 at the ends.
 */
export function arcDots(centre: Vec2, radius: number, near: Vec2, span: number, spacing: number): { pos: Vec2; fade: number }[] {
  const a0 = Math.atan2(near.y - centre.y, near.x - centre.x);
  const n = Math.floor(span / spacing);
  const out: { pos: Vec2; fade: number }[] = [];
  for (let k = -n; k <= n; k++) {
    const a = a0 + (k * spacing) / radius;
    const f = 1 - Math.abs(k) / n;
    out.push({ pos: { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius }, fade: k === 0 ? 1 : f * f * (3 - 2 * f) });
  }
  return out;
}

/** Deterministic 0..1 noise of an integer pair (flicker patterns without Math.random). */
export function noise2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Window light level when all relays are powered ("the station lights partly return"). */
export const WINDOWS_POWERED = 1;
/** Brownout flicker peak while only some relays are powered. */
export const WINDOWS_TRICKLE = 0.22;

/**
 * Window light level 0..1 of a derelict with `lit` of `count` relays powered, at time `t` (s); `seed`
 * varies the flicker per station. 0 relays: dead. Some: a faint flicker now and then. All: on, with a
 * rare short dip.
 */
export function windowLevel(lit: number, count: number, t: number, seed: number, reducedMotion: boolean): number {
  if (lit <= 0) return 0;
  const slot = Math.floor(t * 8);
  if (lit >= count) {
    if (reducedMotion) return WINDOWS_POWERED;
    return noise2(seed, slot) < 0.04 ? WINDOWS_POWERED * 0.55 : WINDOWS_POWERED;
  }
  const share = lit / count;
  if (reducedMotion) return WINDOWS_TRICKLE * share;
  // short flickers: about a third of the slots, brighter with more relays powered
  return noise2(seed, slot) < 0.2 + 0.25 * share ? WINDOWS_TRICKLE * (0.5 + 0.5 * noise2(slot, seed)) : 0;
}

/** Dock lamp blink of a powered derelict clamp (on/off, ~1 Hz, red and green alternating by `phase`). */
export function dockLamp(t: number, phase: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return Math.sin((t * 1.1 + phase * 0.5) * Math.PI * 2) > -0.2 ? 1 : 0.08;
}

/** Lamp 0..1 of a live mine; `armed` = share of the fuse run (0..1) of an armed mine, null = not armed. */
export function mineLamp(t: number, phase: number, armed: number | null, reducedMotion: boolean): number {
  if (armed !== null) {
    if (reducedMotion) return 1;
    // 6 Hz rising to 12 Hz over the fuse
    const hz = 6 + 6 * Math.min(1, Math.max(0, armed));
    return Math.sin(t * hz * Math.PI * 2) > 0 ? 1 : 0.15;
  }
  if (reducedMotion) return 0.55;
  // a slow red pulse, mines out of step
  const s = Math.sin((t * 0.7 + phase) * Math.PI * 2);
  return 0.25 + 0.75 * Math.max(0, s) ** 2;
}

/** Fade 0..1 of a storm window [start, end) at `tick` (ticks): `fade` ticks in and out. */
export function stormFade(tick: number, start: number, end: number, fade = 120): number {
  if (tick < start || tick >= end) return 0;
  return Math.min(1, (tick - start) / fade, (end - tick) / fade);
}

/**
 * Proximity warning of a live mine: 0 beyond `far`, 1 at `near` and closer (smoothstep between) –
 * distances from the ship's hull to the mine centre.
 */
export function mineWarning(hullDistance: number, near: number, far: number): number {
  if (hullDistance >= far) return 0;
  if (hullDistance <= near) return 1;
  const x = (far - hullDistance) / (far - near);
  return x * x * (3 - 2 * x);
}

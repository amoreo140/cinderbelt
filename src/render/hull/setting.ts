// The "Hull shell" / "Hull shell" graphics setting on the render side (SL2 E1, spec §3.10).
// userSettings.hullShell (src/game/settings/userSettings.ts) is the stored value; the game applies it
// here on load and on every change (plan T7). Render code reads it only through these functions:
// a ShipView remembers `hullShellVersion()` at build time and rebuilds itself in `update()` when the
// version moved (plan T4) – no layer has to be edited for the toggle.
//
// The graphics quality the shell is built for (lean profile on Low, grooves and clan decorations on
// High) lives here too: GameRenderer applies its level, and a change bumps the same version.
//
// Module state on purpose (like SHIP_TRAILS): one setting for every view of the page.
import type { GraphicsQuality } from '../quality';
import { TERRACE_ENABLED } from './shellConstants';

let enabled = true;
let quality: GraphicsQuality = 'high';
let version = 0;
/** Dev override of `TERRACE_ENABLED` (perfHook.ts `__cinder.perf.shell.terrace`); null = the constant. */
let terraceOverride: boolean | null = null;

/** Is the hull shell on (the global setting)? ShipViewOptions.shell overrides it per view. */
export function hullShellEnabled(): boolean {
  return enabled;
}

/** Applies the setting; bumps the version only when the value changes. */
export function setHullShellEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  version++;
}

/** The graphics level the shells are built for (default High – tools, tests). */
export function hullShellQuality(): GraphicsQuality {
  return quality;
}

/** Applies the graphics level (GameRenderer); bumps the version only when it changes. */
export function setHullShellQuality(level: GraphicsQuality): void {
  if (level === quality) return;
  quality = level;
  version++;
}

/** Changes every time the setting or the shell quality changes – views compare it with the one they were built with. */
export function hullShellVersion(): number {
  return version;
}

/** Are terraces (v2, the low inner spine) built? `TERRACE_ENABLED` unless a dev override is set. */
export function hullTerraceEnabled(): boolean {
  return terraceOverride ?? TERRACE_ENABLED;
}

/**
 * Dev override of the terrace switch (screenshots and comparisons; terrace v2 is on by default): true / false
 * force it, null returns to `TERRACE_ENABLED`. Bumps the version when the effective value changes, so
 * every ship view rebuilds its shell.
 */
export function setHullTerraceOverride(on: boolean | null): void {
  const before = hullTerraceEnabled();
  terraceOverride = on;
  if (hullTerraceEnabled() !== before) version++;
}

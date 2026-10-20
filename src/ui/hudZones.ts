// Where the flight HUD's top corner panels are right now (px from the top-left of the window). Hud's
// ResizeObservers keep them (NavStack: the navigation band with the objectives band; TopRight: the
// credits with the opened controls help K), so the edge arrows of the station, the goal, the scanner finds
// and the pirates step around their real size - the stack grows with the sector badge's survey dots
// and the attention row, the help is tall while open. The defaults are the bands' usual size.
// LEFT_COLUMN holds what hangs below the stack on the left: the M4b event chips and the comm log
// (when open); Hud measures them after each HUD frame, as they come and go with the events and the
// player's key presses.

/** A screen rect (px). */
export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Top left: the navigation band and the objectives band under it. */
export const NAV_ZONE = { width: 470, height: 175 };

/** Top right: the credits and the opened controls help (K); 0 × 0 until measured. */
export const TOP_RIGHT_ZONE = { width: 0, height: 0 };

/**
 * Bottom left: the flight console (px from the window's left and bottom edge, with a margin). Hud measures
 * it, as it grows with the rows `consoleRules` shows and with the ship silhouette; the defaults are the
 * compact console (three bars, 20 rem wide) at the root font size.
 */
export const CONSOLE_ZONE = { width: 352, height: 150 };
/**
 * Bottom right: the radar, the scanner chip left of it and the K chip above that (hud.css `.hud-br`:
 * 200 px + 11.5 rem from the right edge, ≤ 130 px tall); fixed, they do not grow.
 */
export const BOTTOM_RIGHT_ZONE = { width: 430, height: 230 };
/** The defaults of CONSOLE_ZONE (restored when the HUD unmounts). */
export const CONSOLE_ZONE_DEFAULT = { width: CONSOLE_ZONE.width, height: CONSOLE_ZONE.height };

/**
 * Under the top-left stack: the bottom of the event chip column (0 = no chips) and
 * the comm log (null = none on screen).
 */
export const LEFT_COLUMN: { chipsBottom: number; chipsRight?: number; log: ZoneRect | null } = { chipsBottom: 0, log: null };

/**
 * Top centre: the pirate threat band and the radio line (both hang from the top edge, centred; the radio
 * moves right of the training panel on narrow screens). Hud measures their union; null = neither is shown.
 */
export const TOP_CENTRE: { zone: ZoneRect | null } = { zone: null };

/** The measured HUD zones the edge arrows and the world callouts avoid. */
export interface HudZones {
  nav: { width: number; height: number };
  topRight: { width: number; height: number };
  /** The flight console, bottom left (absent = the compact default). */
  console?: { width: number; height: number };
  /** Bottom of the event chip column (0 = none). */
  chipsBottom?: number;
  /** Right edge of the chip column (M4d: the Guild chips beside the event chips reach past the stack). */
  chipsRight?: number;
  /** The comm log (L; null = closed). */
  log?: ZoneRect | null;
  /** The threat band and the radio line at the top centre (null = none on screen). */
  topCentre?: ZoneRect | null;
}

/** The zones as Hud measured them last. */
export function currentHudZones(): HudZones {
  return { nav: NAV_ZONE, topRight: TOP_RIGHT_ZONE, console: CONSOLE_ZONE, chipsBottom: LEFT_COLUMN.chipsBottom, chipsRight: LEFT_COLUMN.chipsRight, log: LEFT_COLUMN.log, topCentre: TOP_CENTRE.zone };
}

/**
 * The top-left block: the navigation stack and the event chips under it (the chips are narrower than
 * the stack, so the block keeps the stack's width and ends where the lower of the two ends).
 */
export function topLeftZone(zones: HudZones = currentHudZones()): { width: number; height: number } {
  const chips = zones.chipsBottom ?? 0;
  return { width: zones.nav.width, height: Math.max(zones.nav.height, chips > 0 ? chips + 8 : 0) };
}

/**
 * The part of the chip column that reaches right of the stack (M4d: the Guild chips folded up beside the
 * event chips) – from the stack's bottom to the chips' bottom; null while the column is narrower.
 */
export function chipsBesideZone(zones: HudZones = currentHudZones()): ZoneRect | null {
  const bottom = zones.chipsBottom ?? 0;
  const right = zones.chipsRight ?? 0;
  if (bottom <= zones.nav.height || right + 8 <= zones.nav.width) return null;
  return { x: 0, y: zones.nav.height - 8, width: right + 8, height: bottom - zones.nav.height + 16 };
}

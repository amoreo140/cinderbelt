// Hull shell constants (SL2 E1, ship-building 2 design §3.6,
// §3.11, §3.12) – the one source of truth for code; art/README.md "Hull shell (SL2 E1)" mirrors it.
// Numbers from the mock-up (art/blender/mockups/ship2_geo.py) where the spec does not override them.
//
// Units: 1 = one grid cell. "Out" distances are measured along the outward normal of an outline edge
// from the cell edge (negative = inward). Heights (`*_Z`) are model-space heights (three.js +Y of the
// part node), the same frame as the part models: the deck plate of every part tops out at `DECK_TOP`.

/** Top of every part's deck plate (art/blender/parts/common.py DECK_TOP = PLATE_Z1). */
export const DECK_TOP = 0.2;

// --- side band (one profile ribbon per outline run) -------------------------------------------------
/** Band outer face: the only surface the shell adds beyond the cells. */
export const BAND_OUT = 0.012;
/** Band inner face (hidden inside the parts). */
export const BAND_IN = -0.03;
/** Dark core layer of the band [z0, z1]. */
export const BAND_CORE_Z: readonly [number, number] = [-0.2, 0.1];
/** Tier stripe: [z0, z1], sticks out a bit further than the band. */
export const STRIPE_Z: readonly [number, number] = [-0.115, -0.055];
export const STRIPE_OUT = 0.018;
/** Stripe inner face (BAND_IN + 0.01 in the mock-up). */
export const STRIPE_IN = BAND_IN + 0.01;
/** Plate-coloured upper layer of the band [z0, z1]. */
export const BAND_PLATE_Z: readonly [number, number] = [0.1, 0.2];
/** Thin glow line of T2+ ships [z0, z1], `GLOW_OUT` out. */
export const GLOW_Z: readonly [number, number] = [0, 0.018];
export const GLOW_OUT = BAND_OUT + 0.004;

// --- trim lip ---------------------------------------------------------------------------------------
/** Lip width inward from the cell edge (spec 0.10–0.12). */
export const LIP_W = 0.11;
export const LIP_W_RANGE: readonly [number, number] = [0.1, 0.12];
/** Lip [z0, z1]. */
export const LIP_Z: readonly [number, number] = [0.2, 0.235];
/** Chamfer of the lip's top edges. */
export const LIP_CHAMFER = 0.006;

// --- corners ----------------------------------------------------------------------------------------
/** Shaved player armour corner: both legs (spec §3.3, clipArmour). */
export const BEVEL = 0.25;
/** Corner guard: L with two arms of `GUARD_ARM`, `GUARD_T` thick (inward), [z0, z1]. */
export const GUARD_ARM = 0.3;
export const GUARD_T = 0.06;
export const GUARD_Z: readonly [number, number] = [-0.15, 0.25];
/** Accent cap on top of a guard (its top 0.03, mock-up). */
export const GUARD_CAP = 0.03;
/**
 * Guard outer face: just proud of the band's tier stripe, so neither the band nor the stripe z-fights
 * with the guard at flight zoom (depth resolution ~0.006 at camera distance 100). The guards are the
 * only shell surface beyond `STRIPE_OUT`.
 */
export const GUARD_OUT = STRIPE_OUT + 0.004;

// --- seams and grooves --------------------------------------------------------------------------------
/** Seam strip between two parts: width (centred on the seam), [z0, z1]. */
export const SEAM_W = 0.05;
export const SEAM_Z: readonly [number, number] = [0.17, 0.206];
/** The Slanted Star's seams are a thin gold line instead of the dark strip (spec §3.4). */
export const SEAM_LINE_W = 0.018;
/** Vertical seams sit this much higher than horizontal ones (no z-fighting where they cross). */
export const SEAM_CROSS_LIFT = 0.002;
/** Panel groove (hangar / shipyard on High only): width, distance inward from the outline. */
export const GROOVE_W = 0.022;
export const GROOVE_IN = 0.16;

// --- torn edges (spec §3.7; readability pass 2026-10-16) ------------------------------------------------
// A torn run reads as damage at camera 48–100 on light and dark hulls: a jagged glowing ember rim right
// at the edge (emissive – bloom picks it up, and it is bright without bloom), ragged ash / soot patches
// behind it (dark char on light hulls, light ash on dark clan hulls – ShellStyle.soot), and a charred
// exposed side with a hot top strip.
/** Soot patches on a torn edge: depth inward (× 0.7…1.3 per patch), top height. */
export const SOOT_IN = 0.17;
export const SOOT_Z = 0.205;
/** Charred face on the exposed side of a torn edge [z0, z1], this far out of the cell edge. */
export const SOOT_SIDE_Z: readonly [number, number] = [-0.16, 0.13];
export const SOOT_SIDE_OUT = 0.004;
/**
 * Ember rim along a torn edge: a jagged strip `EMBER_IN` deep (× 0.6…1.0 per patch) with one tooth per
 * patch reaching `EMBER_TOOTH` (× 0.7…1.3), its top at `EMBER_Z` (clear of the soot's z range), and the
 * exposed side's hot top strip from `SOOT_SIDE_Z[1]` up to `EMBER_Z`.
 */
export const EMBER_IN = 0.05;
export const EMBER_TOOTH = 0.11;
export const EMBER_Z = SOOT_Z + 0.014;

// --- nav lights (spec §3.6) ---------------------------------------------------------------------------
/** Dome radius of a nav light. */
export const LIGHT_R = 0.07;
/** Lights are pulled this far from the outline towards the hull's centroid (onto the lip). */
export const LIGHT_PULL = 0.075;
/** Dome base height: just under the lip top. */
export const LIGHT_Z = LIP_Z[1] - 0.01;
/** Camera distance where the lights start to grow, and the growth exponent: scale = max(1, d / ref)^exp. */
export const LIGHT_SCALE_REF = 48;
export const LIGHT_SCALE_EXP = 0.75;
/** Bow light blink frequency (Hz; steady with reduced motion). */
export const LIGHT_BLINK_HZ = 1;
/** Instances of the global nav light layer (all ships together). */
export const NAV_LIGHTS_CAPACITY = 256;

// --- terrace v2: the low inner spine (plan 2026-10-20 §2.8, art/README §3.2) ---------------------------
/**
 * Terraces v2 are on (E1's slabs hid the armour and glared and were switched off on 2026-10-16; the user
 * approved the v2 spine screenshots). Dev override: `window.__cinder.perf.shell.terrace(false)`
 * (perfHook.ts, setting.ts `setHullTerraceOverride`). The rule (straight one-cell-wide runs of ≥ 3 inner
 * full armour cells, at most 2 per ship) lives in sim/ship/outline.ts.
 */
export const TERRACE_ENABLED = true;
/** Minimum cells of a group that gets a terrace (outline.ts has the same value). */
export const TERRACE_MIN_CELLS = 3;
/** Base outline: this far in from the group's edge, at `TERRACE_BASE_Z` (just under the deck top). */
export const TERRACE_INSET = 0.08;
export const TERRACE_BASE_Z = DECK_TOP - 0.01;
/** Extra inset of the top outline (≈ 45° sloped sides over the 0.08 rise). */
export const TERRACE_SLOPE = 0.06;
/** Top height: just over the armour pads (deck + 0.04…0.06) – low, so nothing around it is hidden. */
export const TERRACE_TOP_Z = DECK_TOP + 0.07;
/** Tier-accent line along the top edge: width (on the top, inside the slope). */
export const TERRACE_LINE_W = 0.03;
/**
 * Per-cell panel grooves on the top, continuing the cell grid: width, and the lift over the top (no
 * z-fighting at flight zoom). Hangar / shipyard always, flight on High only.
 */
export const TERRACE_GROOVE_W = 0.02;
export const TERRACE_GROOVE_LIFT = 0.003;
/**
 * The armour under a terrace is swapped for a deck-clipped variant (clipArmour mode `'deck'`): nothing
 * of it is left above this height (pads, chevrons, bolts), so nothing pokes through the slab.
 */
export const TERRACE_CLIP_Z = DECK_TOP + 0.005;

/**
 * The armour's tier chevron (armor.py CHEVRON prism; x bow, y port, pointing to +x), counter-clockwise.
 * Shared by the shaped plates (shapePlate.ts) and the terrace's one chevron on its bow-most cell.
 */
export const CHEVRON_OUTLINE: readonly { readonly x: number; readonly y: number }[] = [
  { x: -0.04, y: 0.1 },
  { x: 0.05, y: 0 },
  { x: -0.04, y: -0.1 },
  { x: -0.1, y: -0.1 },
  { x: -0.01, y: 0 },
  { x: -0.1, y: 0.1 },
]
  .reverse()
  .map((v) => Object.freeze(v));
/** Centre of the chevron's bounding box (drawn centred on a pad centroid / a cell centre). */
export const CHEVRON_MID: { readonly x: number; readonly y: number } = Object.freeze({ x: -0.025, y: 0 });

// --- shaped plates (SL2 E2, plan R2; shapePlate.ts) ------------------------------------------------------
// The deck profile of art/blender/parts/common.py (core block + deck plate) extruded along a shape's
// render polygon. "In" distances are measured inward from the shape outline (mitred at the vertices).
/** Dark core wall: inset (= common.py MARGIN) and [z0, z1] (the band's core layer). */
export const PLATE_CORE_IN = 0.015;
export const PLATE_CORE_Z: readonly [number, number] = [-0.2, 0.1];
/** Plate-coloured upper side [z0, z1] (the band's plate layer); the plate tops out at `DECK_TOP`. */
export const PLATE_Z: readonly [number, number] = [0.1, DECK_TOP];
/** Inset of the Blender deck plate's side (common.py PLATE_MARGIN) and its top edge chamfer. */
export const PLATE_EDGE_IN = 0.022;
export const PLATE_CHAMFER = 0.012;
/**
 * Inset of the flat plate top: where the Blender plate's chamfer ends. The runtime plate runs one
 * sloped plate-coloured rim face from the core wall's top up to here (side + chamfer in one quad –
 * keeps the 12-segment curves inside the triangle budget).
 */
export const PLATE_TOP_IN = PLATE_EDGE_IN + PLATE_CHAMFER;
/**
 * The calm armour pad (armor.py Pad / PadGroove): a flat dark `panel_line` groove ring from `PAD_GROOVE_IN`
 * to `PAD_IN` (in from the outline) at `PAD_GROOVE_Z`, the pad's walls rising from it to the pad top at
 * `PAD_Z`. The pad follows the outline with fewer chords: one kept vertex every `PAD_CURVE_STEP` render
 * vertices along curves (3 chords per quarter circle and per ogive side – faceted like the octagonal pad);
 * 2×1 plates use `PAD_CURVE_STEP_2X1` (2 chords per ogive side: keeps the 2×1 nose's T2 detail in budget).
 */
export const PAD_GROOVE_IN = 0.14;
export const PAD_IN = 0.16;
export const PAD_GROOVE_Z = DECK_TOP + 0.008;
export const PAD_Z = DECK_TOP + 0.04;
export const PAD_CURVE_STEP = 4;
export const PAD_CURVE_STEP_2X1 = 6;
/** Tier chevron (armor.py CHEVRON prism) on the pad of plates with at least this shape area. */
export const PLATE_CHEVRON_MIN_AREA = 0.75;
export const CHEVRON_Z: readonly [number, number] = [DECK_TOP + 0.035, DECK_TOP + 0.052];
/**
 * The chevrons always point to the bow: on a plate turned by `rot` they are drawn turned by −rot · 90°
 * around the pad centroid. Long plates (shape area above `CHEVRON_LONG_AREA`, the 2×1 nose) scale them
 * by `CHEVRON_LONG_SCALE` so they do not get lost on the big pad.
 */
export const CHEVRON_LONG_AREA = 1.2;
export const CHEVRON_LONG_SCALE = 1.3;
/**
 * T2+ tier detail (armor.py level 2/3): a glowing seam strip in the tier glow swatch runs across the
 * whole pad along the bow axis through the pad centroid (`PLATE_SEAM_HALF_W` each side, a flat strip
 * `PLATE_SEAM_Z` over the pad top – armor.py splits the pad around a recessed PadSeamGlow; the flat
 * strip reads the same from above for 2 triangles instead of ~12). T2 carries a double chevron
 * (`CHEVRON_PAIR_GAP` apart along the bow axis, armor.py Chevron0 / Chevron1), T3 one bold chevron
 * (`CHEVRON_BOLD_SCALE`). A pad that cannot hold them falls back to one plain chevron (or none).
 */
export const PLATE_SEAM_HALF_W = 0.012;
export const PLATE_SEAM_Z = PAD_Z + 0.004;
/** Shortest seam strip (measured along the bow axis); a shorter one is left out. */
export const PLATE_SEAM_MIN_LENGTH = 0.12;
export const CHEVRON_PAIR_GAP = 0.15;
export const CHEVRON_BOLD_SCALE = 1.3;
/** Fallback plate without the swatch table (plain material): one slab, this far in from the outline. */
export const PLATE_PLAIN_IN = 0.03;
/** Triangle budget of one shaped plate (curves included). */
export const PLATE_MAX_TRIANGLES = 200;

// --- budgets (spec §3.8) --------------------------------------------------------------------------------
/** Triangle budget of one ship's shell. */
export const SHELL_MAX_TRIANGLES = 4000;
/** Enemy / wreck shell rebuilds per frame (the player's ship is rebuilt at once). */
export const SHELL_REBUILDS_PER_FRAME = 1;
/** Most clipped-armour variants cached per armour tier (the 15 non-empty corner masks + the deck clip). */
export const CLIP_ARMOUR_MAX_VARIANTS = 16;

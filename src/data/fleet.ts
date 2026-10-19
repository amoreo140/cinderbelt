// Fleet and ship-template constants (M4a "Hangar and fleet", plan 2026-10-19-m4a §2). Slot prices live
// in economy.ts (`HANGAR`); the generated ship names themselves are texts (`tx().fleet.names`).
// Template parts must fit the hangar's build area: `HANGAR_MIN..HANGAR_MAX` in sim/shipyard/editor.ts.

/**
 * Number of generated ship names. Both languages have exactly this many entries in
 * `flotila.names` (same index = the same name in SK and EN). A constant here – not the length of the
 * i18n list – so the simulation and save migrations never read texts.
 */
export const SHIP_NAME_COUNT = 48;

/** Longest custom ship name or template name, in characters (code points) after sanitising. */
export const SHIP_NAME_MAX = 24;

/** Longest template export code ("CB2.…", or the legacy "AF1.…" / "AF2.…"), in characters. */
export const TEMPLATE_CODE_MAX = 6144;

/** Template slots by the Archive: none before the node `templates`, 5 with it, 20 with `templates20`. */
export const TEMPLATE_SLOTS = { none: 0, base: 5, plus: 20 } as const;

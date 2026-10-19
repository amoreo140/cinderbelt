// Colours of the "Hull language" design system (Jazyk trupu) for code that cannot read CSS variables (the radar and map canvases).
// They must match tokens.css – guarded by tokens.test.ts.

/** Base palette derived from the models: hull, orange trims, dark bands, azure lights. */
export const PALETTE = {
  /** Light hull plates. */
  hull: '#d9dee6',
  hullHi: '#eef1f5',
  hullShade: '#aab3c0',
  /** Text on a light plate. */
  ink: '#16202c',
  inkSoft: '#4a5666',
  /** Dark structural bands. */
  band: '#1b222d',
  bandHi: '#283141',
  /** Recessed displays. */
  screen: '#0a1521',
  screenLine: '#1d3a52',
  /** Orange trim (level T1 – iron). */
  trim: '#f27a2c',
  trimDeep: '#c4561a',
  /** Blue trim (level T2 – titanium). */
  titan: '#4aa8ea',
  /** Azure lights and the glow of the displays. */
  glow: '#62d9f4',
  /** Signal lights (docking beacons). */
  ok: '#6be38a',
  warn: '#ffb547',
  bad: '#ff5a4a',
  /** Yellow fuel tanks. */
  fuel: '#f4c64e',
  /** Ship shield (gauge, shield hit). */
  shield: '#7cc8ff',
  /** Tractor beam (M3.6): violet beam, like the emitter of the tractor_beam model. */
  tractor: '#b98cff',
  /** Rich ore (Mining 2.0): radar ring, map mark, nugget pop. */
  oreRich: '#ffcf5c',
  /** Quiet sector (sectors design §5.1): grey-blue border, no fill – the other securities use ok / warn / bad. */
  quiet: '#9db0c8',
  /** Text na tmavom. */
  text: '#e8edf4',
  textDim: '#93a0b3',
} as const;

/** Accent of each ring by nebula colour (a = main, b = secondary). */
export const RING_ACCENTS: readonly { a: string; b: string }[] = [
  { a: '#4fd6c8', b: '#8f7dff' }, // 1 Home Belt – turquoise / violet
  { a: '#ff5fa2', b: '#ff9a4a' }, // 2 Outer Belts – magenta / orange
  { a: '#3fe0a8', b: '#5fd3ff' }, // 3 Crystal Nebulae – azure-green
  { a: '#d0476e', b: '#a05cc8' }, // 4 Dead Zones – plum / crimson
];

/** Station colour by kind (radar, map, arrow). */
export const STATION_COLORS = { home: '#6be38a', station: '#62d9f4', outpost: '#ffb547' } as const;

export const ringAccent = (ring: number): { a: string; b: string } =>
  RING_ACCENTS[Math.min(RING_ACCENTS.length, Math.max(1, Math.round(ring))) - 1]!;

/** Fonts (families from @fontsource-variable). */
export const FONTS = {
  display: "'Archivo Variable', 'Bahnschrift', 'Segoe UI', sans-serif",
  text: "'Atkinson Hyperlegible Next Variable', 'Segoe UI', system-ui, sans-serif",
} as const;

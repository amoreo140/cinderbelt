// Ship paints ("laky", M4c plan §2.2): a paint is a palette livery that overrides only the hull
// swatches (tier accents and role glows stay – art/README.md §3). `factory` = the default palette.
export type PaintId = 'factory' | 'graphite' | 'sand' | 'navy' | 'racing';

/** Paint shop order (the swatch row). */
export const PAINT_IDS: readonly PaintId[] = ['factory', 'graphite', 'sand', 'navy', 'racing'];

/** Livery name of each paint: textures `palette_<livery>_{basecolor,orm,emissive}.png`. */
export const PAINT_LIVERY: Record<Exclude<PaintId, 'factory'>, string> = {
  graphite: 'paint_graphite',
  sand: 'paint_sand',
  navy: 'paint_navy',
  racing: 'paint_racing',
};

/** UI chip colour of each paint: its `hull_light` swatch (art/blender/lib/palette.py, livery.py). */
export const PAINT_SWATCH: Record<PaintId, string> = {
  factory: '#E6E9EE',
  graphite: '#5C626C',
  sand: '#D8C7A4',
  navy: '#3E5C88',
  racing: '#C8352C',
};

export const isPaintId = (v: unknown): v is PaintId => typeof v === 'string' && (PAINT_IDS as readonly string[]).includes(v);

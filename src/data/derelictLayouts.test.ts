import { describe, expect, it } from 'vitest';
import { DERELICT_LAYOUTS, DERELICT_MODELS, RELAY, RELAY_LAYOUT } from './sites';
import layoutsJson from './derelict_layouts.json';

describe('derelict layouts', () => {
  it('has a layout for every model with the dock port at (R, 0)', () => {
    for (const m of DERELICT_MODELS) {
      const layout = DERELICT_LAYOUTS[m];
      expect(layout.radius).toBeGreaterThan(0);
      expect(layout.dockPort).toEqual({ x: layout.radius, y: 0 });
      expect(layout.clearRadius).toBeGreaterThan(layout.radius);
      expect(layout.circles.length).toBeGreaterThan(0);
      for (const c of layout.circles) {
        expect(c.r).toBeGreaterThan(0);
        // the clamp arm may poke slightly past R (derelict_a: 11.2 vs 11) – the clear circle holds everything
        expect(Math.hypot(c.x, c.y) + c.r).toBeLessThanOrEqual(layout.clearRadius);
      }
    }
  });

  it('has a relay with a receiver inside its clear circle', () => {
    expect(RELAY_LAYOUT.circles.length).toBeGreaterThan(0);
    const t = RELAY_LAYOUT.powerTarget;
    expect(Math.hypot(t.x, t.y) + RELAY.targetRadius).toBeLessThanOrEqual(RELAY_LAYOUT.clearRadius);
  });

  it('matches the layout exported by the artist (art/blender/data)', () => {
    // the artist's source may be missing (e.g. a package without art/)
    const sources = import.meta.glob('../../art/blender/data/derelict_layouts.json', { eager: true, import: 'default' });
    const art = Object.values(sources)[0];
    if (!art) return;
    // on a difference: copy art/blender/data/derelict_layouts.json to src/data/
    expect(layoutsJson).toEqual(art);
  });
});

// SL2 E1 T0 contracts: the hull shell setting, the pure helpers around the stubs and the swatch table
// parser. The stubs' real behaviour is tested by their own tasks (T1 outline, T2 geometry, T5 lights,
// T6 queue: rebuildQueue.test.ts).
import { BufferAttribute, BufferGeometry, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createStarterShip } from '../../sim/ship/presets';
import { cellKey, gridCellKeys, hullOutline, outlineSvgPath } from '../../sim/ship/outline';
import { partCells } from '../../sim/ship/grid';
import { computeProperties } from '../../sim/ship/properties';
import { ModelLibrary, parseSwatches } from '../assets/ModelLibrary';
import { ShipView } from '../ShipView';
import { bowLightOn, NAV_LIGHT_SWATCH, navLightScale } from './NavLights';
import { hullShellEnabled, hullShellVersion, setHullShellEnabled } from './setting';
import { BAND_OUT, LIP_W, LIP_W_RANGE, TERRACE_TOP_Z } from './shellConstants';
import { shellLayoutOf, shellStyle } from './shellGeometry';

// flames and decals load their textures through TextureLoader (no DOM in the unit tests)
vi.mock('../fx/textures', () => ({ vfxTexture: () => new Texture() }));

describe('hull shell setting', () => {
  it('is on by default and bumps the version only on a change', () => {
    expect(hullShellEnabled()).toBe(true);
    const v0 = hullShellVersion();
    setHullShellEnabled(true);
    expect(hullShellVersion()).toBe(v0);
    setHullShellEnabled(false);
    expect(hullShellEnabled()).toBe(false);
    expect(hullShellVersion()).toBe(v0 + 1);
    setHullShellEnabled(true);
    expect(hullShellVersion()).toBe(v0 + 2);
  });
});

describe('shell constants', () => {
  it('keep the spec §3.12 numbers consistent', () => {
    expect(BAND_OUT).toBe(0.012);
    expect(LIP_W).toBeGreaterThanOrEqual(LIP_W_RANGE[0]);
    expect(LIP_W).toBeLessThanOrEqual(LIP_W_RANGE[1]);
    // terrace v2 (plan 2026-10-20 §2.8): just over the armour pads
    expect(TERRACE_TOP_Z).toBeCloseTo(0.27, 6);
  });
});

describe('outline contract', () => {
  it('cell keys of a grid use the "x,y" format of grid.ts', () => {
    const grid = createStarterShip();
    const keys = gridCellKeys(grid);
    const cells = grid.parts.flatMap((p) => partCells(p));
    expect(keys.size).toBe(cells.length);
    for (const c of cells) expect(keys.has(cellKey(c.x, c.y))).toBe(true);
  });

  it('outline and silhouette are filled (T1; details in sim/ship/outline.test.ts)', () => {
    const grid = createStarterShip();
    const o = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    expect(o.loops).toHaveLength(1);
    expect(o.nav.length).toBeGreaterThan(0);
    expect(outlineSvgPath(grid)).toMatch(/^M.*Z$/);
  });
});

describe('nav light helpers', () => {
  it('scale is 1 up close and grows sub-linearly beyond 48', () => {
    expect(navLightScale(20)).toBe(1);
    expect(navLightScale(48)).toBe(1);
    expect(navLightScale(96)).toBeCloseTo(2 ** 0.75, 6);
  });

  it('bow light blinks at 1 Hz, steady with reduced motion', () => {
    expect(bowLightOn(0.25, false)).toBe(true);
    expect(bowLightOn(0.75, false)).toBe(false);
    expect(bowLightOn(0.75, true)).toBe(true);
  });

  it('colours are palette light swatches', () => {
    expect(Object.values(NAV_LIGHT_SWATCH).every((k) => k.startsWith('light_'))).toBe(true);
  });
});

describe('shell style and layout', () => {
  it('player lip takes the cockpit tier accent; clans their own swatches', () => {
    expect(shellStyle(1, null).lip).toBe('accent_iron');
    expect(shellStyle(2, null).lip).toBe('accent_titanium');
    expect(shellStyle(1, null).glow).toBeNull();
    expect(shellStyle(2, null).glow).not.toBeNull();
    expect(shellStyle(1, 'slantedStar').deco).toBe('slashes');
    expect(shellStyle(1, 'rust').deco).toBe('welds');
    // a faction without a part set flies player parts → player style
    expect(shellStyle(1, 'guild').lip).toBe('accent_iron');
  });

  it('layout lists the attributes sorted by name with their item sizes', () => {
    const g = new BufferGeometry();
    g.setAttribute('uv', new BufferAttribute(new Float32Array(2), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    expect(shellLayoutOf(g).attributes).toEqual([
      { name: 'position', itemSize: 3 },
      { name: 'uv', itemSize: 2 },
    ]);
  });
});

describe('palette swatch table', () => {
  it('parses the swatches and skips bad entries', () => {
    const t = parseSwatches({ _schema: 'x', swatches: { hull_dark: [0.1, 0.2], bad: [1], worse: 'a', nan: [Number.NaN, 0] } });
    expect(t?.get('hull_dark')).toEqual([0.1, 0.2]);
    expect(t?.size).toBe(1);
    expect(parseSwatches(null)).toBeNull();
    expect(parseSwatches({ swatches: {} })).toBeNull();
    expect(parseSwatches({ swatches: [] })).toBeNull();
  });

  it('the library looks swatches up (bound), null without a table', () => {
    const lib = ModelLibrary.empty(parseSwatches({ swatches: { light_red: [0.5, 0.5] } }));
    const lookup = lib.swatchUv;
    expect(lookup('light_red')).toEqual([0.5, 0.5]);
    expect(lookup('nope')).toBeNull();
    expect(lib.hasSwatches).toBe(true);
    expect(ModelLibrary.empty().swatchUv('light_red')).toBeNull();
    expect(ModelLibrary.empty().hasSwatches).toBe(false);
  });
});

describe('ShipView options (T0: accepted, no behaviour change)', () => {
  it('stores the options and has no nav points yet', () => {
    const grid = createStarterShip();
    const view = new ShipView(grid, computeProperties(grid), ModelLibrary.empty(), null, { shell: false, mode: 'shipyard', tornFrom: 'firstBuild' });
    expect(view.options.mode).toBe('shipyard');
    expect(view.navPoints()).toEqual([]);
    const plain = new ShipView(grid, computeProperties(grid), ModelLibrary.empty());
    expect(plain.options).toEqual({});
    expect(plain.connectorCount).toBe(view.connectorCount);
    view.dispose();
    plain.dispose();
  });
});

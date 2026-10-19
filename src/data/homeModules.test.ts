import { describe, expect, it } from 'vitest';
import { FORGE_INDEX_MAX, HOME_MODULE_IDS, HOME_MODULE_JSON_ID, HOME_MODULES, HOME_SLOTS, homeModuleIconPath, isBuildableModule, TROPHY_FIT, TROPHY_FORTRESS_FILE } from './home';
import { isPaintId, PAINT_IDS, PAINT_LIVERY, PAINT_SWATCH } from './paints';
import homeJson from './home_modules.json';

describe('home modules data', () => {
  it('matches the file exported by the artist (art/blender/data)', () => {
    // the artist's source may be missing (e.g. a package without art/)
    const sources = import.meta.glob('../../art/blender/data/home_modules.json', { eager: true, import: 'default' });
    const art = Object.values(sources)[0];
    if (!art) return;
    // on a difference: copy art/blender/data/home_modules.json to src/data/
    expect(homeJson).toEqual(art);
  });

  it('maps every module to a JSON module, and the JSON has no module the game misses', () => {
    expect(new Set(Object.values(HOME_MODULE_JSON_ID)).size).toBe(HOME_MODULE_IDS.length);
    expect(Object.keys(homeJson.modules).sort()).toEqual([...Object.values(HOME_MODULE_JSON_ID)].sort());
    expect([...HOME_MODULE_IDS].sort()).toEqual(Object.keys(HOME_MODULES).sort());
  });

  it('gives every module a file, a slot on station_home and collision circles', () => {
    const slots = new Set<string>();
    for (const id of HOME_MODULE_IDS) {
      const m = HOME_MODULES[id];
      expect(m.id).toBe(id);
      expect(m.file).toBe(`home_module_${HOME_MODULE_JSON_ID[id]}`);
      expect(HOME_SLOTS[m.slot]).toBeDefined();
      expect(HOME_SLOTS[m.slot].node).toBe(`attach_${m.slot}`);
      expect(m.circles.length).toBeGreaterThan(0);
      for (const c of m.circles) expect(c.r).toBeGreaterThan(0);
      expect(m.credits).toBeGreaterThan(0);
      slots.add(m.slot);
    }
    // every slot has its own module (no slot choice in M4c)
    expect(slots.size).toBe(HOME_MODULE_IDS.length);
  });

  it('places the default-slot circles where the slot puts the module-frame circles', () => {
    for (const id of HOME_MODULE_IDS) {
      const src = homeJson.modules[HOME_MODULE_JSON_ID[id]];
      const slot = HOME_SLOTS[HOME_MODULES[id].slot];
      const yaw = (slot.yawDeg * Math.PI) / 180;
      src.circles.forEach((c, i) => {
        const x = slot.x + c.x * Math.cos(yaw) - c.y * Math.sin(yaw);
        const y = slot.y + c.x * Math.sin(yaw) + c.y * Math.cos(yaw);
        const at = HOME_MODULES[id].circles[i]!;
        expect(at.x).toBeCloseTo(x, 2);
        expect(at.y).toBeCloseTo(y, 2);
        expect(at.r).toBe(c.r);
      });
    }
  });

  it('sells the paint shop and the trophy hall in M4c and keeps the rest for M5', () => {
    expect(HOME_MODULES.paintShop.credits).toBe(8000);
    expect(HOME_MODULES.trophyHall.credits).toBe(5000);
    expect(HOME_MODULE_IDS.filter(isBuildableModule)).toEqual(['paintShop', 'trophyHall']);
    for (const id of ['homeRefinery', 'observatory', 'laboratory', 'droneHub'] as const) expect(HOME_MODULES[id].since).toBeDefined();
  });

  it('gives an Index point exactly to the modules the art marks with an index', () => {
    let points = 0;
    for (const id of HOME_MODULE_IDS) {
      const src = homeJson.modules[HOME_MODULE_JSON_ID[id]];
      expect(HOME_MODULES[id].forgeIndex !== null).toBe(src.index !== null);
      points += HOME_MODULES[id].forgeIndex ?? 0;
    }
    // the modules give 3 points in M5; the Forge and the megaproject phases bring the rest (M6b)
    expect(points).toBeLessThan(FORGE_INDEX_MAX);
  });

  it('has room on a pedestal and a fortress trophy model', () => {
    expect(TROPHY_FIT.maxExtent).toBeGreaterThan(0);
    expect(TROPHY_FIT.maxHeight).toBeGreaterThan(0);
    expect(TROPHY_FORTRESS_FILE).toBe('trophy_fortress');
    expect(homeModuleIconPath('paintShop')).toBe('assets/icons/home/paint_shop.png');
  });
});

describe('paints data', () => {
  it('has a livery for every paint except factory and a UI swatch for all', () => {
    expect(PAINT_IDS[0]).toBe('factory');
    for (const p of PAINT_IDS) {
      expect(PAINT_SWATCH[p]).toMatch(/^#[0-9A-F]{6}$/);
      if (p !== 'factory') expect(PAINT_LIVERY[p]).toBe(`paint_${p}`);
    }
    expect(Object.keys(PAINT_LIVERY)).toHaveLength(PAINT_IDS.length - 1);
    expect(isPaintId('navy')).toBe(true);
    expect(isPaintId('rust')).toBe(false);
  });
});

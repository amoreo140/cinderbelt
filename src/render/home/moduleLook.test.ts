import { describe, expect, it } from 'vitest';
import { HOME_MODULES, HOME_MODULE_JSON_ID, HOME_SLOTS, type HomeSlot } from '../../data/home';
import homeJson from '../../data/home_modules.json';
import { homeStation } from '../../sim/world/stations';
import { nodeFs } from '../../testing/nodeFs';
import { GANTRY_SWING, GANTRY_TIME, gantryOffset, moduleAtSlot, modulePoint, slotCircles, slotPose } from './moduleLook';

const SLOTS = Object.keys(HOME_SLOTS) as HomeSlot[];

/** The JSON chunk of a .glb file. */
function glbJson(path: string): { nodes: { name?: string; translation?: number[]; rotation?: number[] }[] } {
  const b = nodeFs().readFileSync(path);
  const len = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)));
}

describe('slotPose', () => {
  it('places every module circle where home_modules.json puts it at the default slot', () => {
    const home = homeStation();
    for (const def of Object.values(HOME_MODULES)) {
      const raw = homeJson.modules[HOME_MODULE_JSON_ID[def.id]];
      const pose = slotPose(home, def.slot);
      raw.circles.forEach((c, i) => {
        const p = modulePoint(pose, c);
        const want = raw.circlesAtDefaultSlot[i]!;
        expect(p.x).toBeCloseTo(want.x, 2);
        expect(p.y).toBeCloseTo(want.y, 2);
      });
    }
  });

  it('matches the attach_<slot> empties of station_home.glb (glTF: x, z up → three y, -y)', () => {
    const json = glbJson('public/assets/models/stations/station_home.glb');
    const origin = { pos: { x: 0, y: 0 }, portAngle: 0 };
    for (const slot of SLOTS) {
      const node = json.nodes.find((n) => n.name === `attach_${slot}`);
      expect(node, slot).toBeDefined();
      const [tx, ty, tz] = node!.translation!;
      const pose = slotPose(origin, slot);
      expect(tx).toBeCloseTo(pose.pos.x, 2);
      expect(-tz!).toBeCloseTo(pose.pos.y, 2);
      expect(ty).toBeCloseTo(pose.height, 2);
      // rotation about +Y only: q = (0, sin θ/2, 0, cos θ/2)
      const q = node!.rotation!;
      const yaw = 2 * Math.atan2(q[1]!, q[3]!);
      expect(Math.cos(yaw)).toBeCloseTo(Math.cos(pose.yaw), 3);
      expect(Math.sin(yaw)).toBeCloseTo(Math.sin(pose.yaw), 3);
    }
  });

  it('turns with the station and follows its position', () => {
    const station = { pos: { x: 100, y: -40 }, portAngle: Math.PI / 2 };
    const pose = slotPose(station, 'fl');
    // fl = (8.061, 8.061) in the station frame; turned by 90°: (-8.061, 8.061)
    expect(pose.pos.x).toBeCloseTo(100 - 8.061, 3);
    expect(pose.pos.y).toBeCloseTo(-40 + 8.061, 3);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2 + Math.PI / 4, 6);
  });
});

describe('slotCircles', () => {
  it('equals circlesAtDefaultSlot at the home station and turns with a rotated station', () => {
    const home = homeStation();
    for (const def of Object.values(HOME_MODULES)) {
      const got = slotCircles(home, def.slot);
      got.forEach((c, i) => {
        expect(c.x).toBeCloseTo(def.circles[i]!.x, 2);
        expect(c.y).toBeCloseTo(def.circles[i]!.y, 2);
        expect(c.r).toBe(def.circles[i]!.r);
      });
      const turned = slotCircles({ pos: { x: 0, y: 0 }, portAngle: Math.PI }, def.slot);
      turned.forEach((c, i) => {
        expect(c.x).toBeCloseTo(-def.circles[i]!.x, 2);
        expect(c.y).toBeCloseTo(-def.circles[i]!.y, 2);
      });
    }
  });

  it('knows the default module of every slot', () => {
    expect(moduleAtSlot('fl')).toBe('paintShop');
    expect(moduleAtSlot('rl')).toBe('trophyHall');
    for (const slot of SLOTS) expect(moduleAtSlot(slot)).not.toBeNull();
  });
});

describe('gantryOffset', () => {
  it('is parked before and after the painting', () => {
    expect(gantryOffset(0)).toBe(0);
    expect(gantryOffset(-1)).toBe(0);
    expect(gantryOffset(GANTRY_TIME)).toBe(0);
    expect(gantryOffset(GANTRY_TIME + 5)).toBe(0);
    expect(gantryOffset(Infinity)).toBe(0);
  });

  it('slides both ways within ±GANTRY_SWING and starts and ends smoothly', () => {
    const samples = Array.from({ length: 301 }, (_, i) => gantryOffset((i / 300) * GANTRY_TIME));
    expect(Math.max(...samples)).toBeGreaterThan(GANTRY_SWING * 0.95);
    expect(Math.min(...samples)).toBeLessThan(-GANTRY_SWING * 0.95);
    for (const s of samples) expect(Math.abs(s)).toBeLessThanOrEqual(GANTRY_SWING + 1e-9);
    expect(Math.abs(gantryOffset(0.01))).toBeLessThan(0.01);
    expect(Math.abs(gantryOffset(GANTRY_TIME - 0.01))).toBeLessThan(0.01);
  });
});

import { Group, InstancedMesh, MeshBasicMaterial, ShaderLib, Texture, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createStarterShip } from '../../sim/ship/presets';
import { hullOutline, type NavPoint } from '../../sim/ship/outline';
import { computeProperties } from '../../sim/ship/properties';
import type { WarmUpZoo } from '../warmup';
import {
  bowLightOn,
  hullCentroid,
  NAV_CORE_MIN_PX,
  NAV_HALO_MIN_PX,
  NAV_HALO_RATIO,
  NAV_LIGHT_GAIN,
  NAV_LIGHT_OFF_GAIN,
  navLightScale,
  NavLights,
  pullNavPoints,
  shipNavPoints,
  type NavLightShip,
  type NavLightsFrame,
} from './NavLights';
import { LIGHT_PULL, LIGHT_R, LIGHT_Z } from './shellConstants';

const VERTEX = ShaderLib.basic.vertexShader;
const FRAGMENT = ShaderLib.basic.fragmentShader;

// Counts the three.js objects NavLights constructs itself – the per-frame update must create none.
const created = vi.hoisted(() => ({ n: 0 }));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const counted = <T extends new (...args: any[]) => object>(C: T): T =>
    class extends C {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        super(...args);
        created.n++;
      }
    };
  return {
    ...three,
    Vector3: counted(three.Vector3),
    Matrix4: counted(three.Matrix4),
    Quaternion: counted(three.Quaternion),
    Color: counted(three.Color),
    InstancedBufferAttribute: counted(three.InstancedBufferAttribute),
  };
});

const SWATCHES: Record<string, readonly [number, number]> = {
  light_red: [0.6875, 0.921875],
  light_green: [0.8125, 0.921875],
  light_white: [0.9375, 0.921875],
  light_amber: [0.0625, 0.890625],
};
const swatchUv = (key: string) => SWATCHES[key] ?? null;
const atlas = () => Promise.resolve(new Texture());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const FRAME: NavLightsFrame = { cameraDistance: 48, time: 0.25, reducedMotion: false, quality: 'medium' };
const pt = (x: number, y: number, kind: NavPoint['kind'] = 'port'): NavPoint => ({ at: { x, y }, kind, owner: 1 });

function ship(points: readonly NavPoint[], o: Partial<Omit<NavLightShip, 'points' | 'object'>> = {}): NavLightShip & { object: Group } {
  return { object: new Group(), points, pirate: false, visible: true, ...o };
}

async function layer(capacity = 256): Promise<{ lights: NavLights; parent: Group }> {
  const parent = new Group();
  const lights = new NavLights(parent, swatchUv, capacity, atlas);
  await settle();
  return { lights, parent };
}

/** World position of instance i. */
function instancePos(mesh: InstancedMesh, i: number): Vector3 {
  const a = mesh.instanceMatrix.array;
  return new Vector3(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]);
}

describe('nav light points', () => {
  it('pulls each point LIGHT_PULL towards the centroid and moves it into the centre-of-mass frame', () => {
    const [p] = pullNavPoints([pt(3, 0, 'bow')], { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(p!.at.x).toBeCloseTo(3 - LIGHT_PULL, 9);
    expect(p!.at.y).toBeCloseTo(0, 9);
    const [d] = pullNavPoints([pt(1, 1)], { x: 0, y: 0 }, { x: 0.5, y: -0.25 });
    const k = LIGHT_PULL / Math.SQRT2;
    expect(d!.at.x).toBeCloseTo(1 - k - 0.5, 9);
    expect(d!.at.y).toBeCloseTo(1 - k + 0.25, 9);
    expect(d!.kind).toBe('port');
    // a point on the centroid stays
    expect(pullNavPoints([pt(2, 2)], { x: 2, y: 2 }, { x: 0, y: 0 })[0]!.at).toEqual({ x: 2, y: 2 });
  });

  it('starter ship: five lights on the lip, the bow pulled in from (2, 1.5), memoised per outline', () => {
    const grid = createStarterShip();
    const props = computeProperties(grid);
    const outline = hullOutline(grid, { tornFrom: null, bevelArmour: true });
    const points = shipNavPoints(grid, props.centerOfMass);
    expect(points.map((p) => p.kind)).toEqual(['bow', 'port', 'starboard', 'aft', 'aft']);
    const c = hullCentroid(grid);
    const bow = points[0]!;
    const gx = bow.at.x + props.centerOfMass.x;
    const gy = bow.at.y + props.centerOfMass.y;
    expect(Math.hypot(gx - 2, gy - 1.5)).toBeCloseTo(LIGHT_PULL, 9);
    // moved towards the centroid
    expect(Math.hypot(gx - c.x, gy - c.y)).toBeLessThan(Math.hypot(2 - c.x, 1.5 - c.y));
    expect(shipNavPoints(grid, props.centerOfMass, outline)).toBe(points);
    expect(shipNavPoints(grid, props.centerOfMass)).toBe(points);
  });
});

describe('nav light scale and blink', () => {
  it('scale: 1 up close, grows with the camera distance; the radius stays ≥ 0.07', () => {
    expect(navLightScale(30)).toBe(1);
    expect(navLightScale(48)).toBe(1);
    expect(navLightScale(100)).toBeCloseTo((100 / 48) ** 0.75, 9);
    expect(navLightScale(150)).toBeGreaterThan(navLightScale(100));
    expect(LIGHT_R * navLightScale(48)).toBeGreaterThanOrEqual(0.07);
    expect(LIGHT_R * navLightScale(100)).toBeGreaterThan(0.12);
  });

  it('bow light blinks at 1 Hz, steady with reduced motion', () => {
    expect([0.1, 0.4, 0.6, 0.9, 1.1].map((t) => bowLightOn(t, false))).toEqual([true, true, false, false, true]);
    expect([0.1, 0.6, 0.9].map((t) => bowLightOn(t, true))).toEqual([true, true, true]);
  });
});

describe('NavLights layer', () => {
  it('one instanced mesh in the parent; instance count follows the ships', async () => {
    const { lights, parent } = await layer();
    expect(parent.children).toEqual([lights.mesh]);
    const a = ship([pt(1, 0, 'bow'), pt(0, 1, 'port'), pt(0, -1, 'starboard')]);
    const b = ship([pt(1, 0, 'bow'), pt(-1, 1, 'aft')]);
    lights.update([a, b], FRAME);
    expect(lights.count).toBe(5);
    expect(lights.mesh.count).toBe(5);
    expect(lights.mesh.visible).toBe(true);
    lights.update([a], FRAME);
    expect(lights.count).toBe(3);
    lights.update([a, { ...b, visible: false }, ship([])], FRAME);
    expect(lights.count).toBe(3);
    lights.update([], FRAME);
    expect(lights.count).toBe(0);
    expect(lights.mesh.visible).toBe(false);
  });

  it('pirates have no lights on Low', async () => {
    const { lights } = await layer();
    const pirate = ship([pt(1, 0, 'bow'), pt(0, 1)], { pirate: true });
    const player = ship([pt(1, 0, 'bow')]);
    lights.update([player, pirate], FRAME);
    expect(lights.count).toBe(3);
    lights.update([player, pirate], { ...FRAME, quality: 'low' });
    expect(lights.count).toBe(1);
  });

  it('draws nothing without a swatch table or before the atlas has loaded', async () => {
    const empty = new NavLights(new Group(), null, 16, atlas);
    await settle();
    empty.update([ship([pt(1, 0)])], FRAME);
    expect(empty.count).toBe(0);
    let resolve: (t: Texture) => void = () => {};
    const late = new NavLights(new Group(), swatchUv, 16, () => new Promise<Texture>((r) => (resolve = r)));
    late.update([ship([pt(1, 0)])], FRAME);
    expect(late.count).toBe(0);
    resolve(new Texture());
    await settle();
    late.update([ship([pt(1, 0)])], FRAME);
    expect(late.count).toBe(1);
  });

  it('never draws more than its capacity', async () => {
    const { lights } = await layer(8);
    const five = [pt(1, 0, 'bow'), pt(0, 1), pt(0, -1, 'starboard'), pt(-1, 1, 'aft'), pt(-1, -1, 'aft')];
    lights.update([ship(five), ship(five), ship(five)], FRAME);
    expect(lights.count).toBe(8);
    expect(lights.mesh.count).toBe(8);
  });

  it('places the domes from the ship transform, on the lip, scaled with the camera distance', async () => {
    const { lights } = await layer();
    const s = ship([pt(2, 1, 'port')]);
    s.object.position.set(10, 0, 5);
    s.object.rotation.y = Math.PI / 2; // nose (+x) turns to −z
    lights.update([s], { ...FRAME, cameraDistance: 100 });
    // local (2, LIGHT_Z, −1) rotated +90° about y: (x, z) → (z, −x)
    const p = instancePos(lights.mesh, 0);
    expect(p.x).toBeCloseTo(10 - 1, 6);
    expect(p.y).toBeCloseTo(LIGHT_Z, 6);
    expect(p.z).toBeCloseTo(5 - 2, 6);
    const a = lights.mesh.instanceMatrix.array;
    const sx = Math.hypot(a[0]!, a[1]!, a[2]!);
    expect(sx).toBeCloseTo(navLightScale(100), 6);
    // the ship moves: the light follows next frame
    s.object.position.x = 20;
    lights.update([s], FRAME);
    expect(instancePos(lights.mesh, 0).x).toBeCloseTo(19, 6);
    expect(Math.hypot(a[0]!, a[1]!, a[2]!)).toBeCloseTo(1, 6);
  });

  it('swatch UV per light kind; the bow blinks, steady with reduced motion', async () => {
    const { lights } = await layer();
    const s = ship([pt(1, 0, 'bow'), pt(0, 1, 'port'), pt(0, -1, 'starboard'), pt(-1, 1, 'aft')]);
    lights.update([s], { ...FRAME, time: 0.25 });
    const uv = lights.mesh.geometry.getAttribute('navUv').array;
    expect(Array.from(uv.slice(0, 8))).toEqual([...SWATCHES.light_white!, ...SWATCHES.light_red!, ...SWATCHES.light_green!, ...SWATCHES.light_amber!]);
    const gain = () => Array.from(lights.mesh.instanceColor!.array.slice(0, 12)).filter((_, i) => i % 3 === 0);
    expect(gain()).toEqual([NAV_LIGHT_GAIN, NAV_LIGHT_GAIN, NAV_LIGHT_GAIN, NAV_LIGHT_GAIN]);
    lights.update([s], { ...FRAME, time: 0.75 });
    expect(gain()).toEqual([Math.fround(NAV_LIGHT_OFF_GAIN), NAV_LIGHT_GAIN, NAV_LIGHT_GAIN, NAV_LIGHT_GAIN]);
    lights.update([s], { ...FRAME, time: 0.75, reducedMotion: true });
    expect(gain()[0]).toBe(NAV_LIGHT_GAIN);
  });

  it('no allocation per frame: no new three.js objects, the same buffers, upload ranges only', async () => {
    const { lights } = await layer();
    const grid = createStarterShip();
    const points = shipNavPoints(grid, computeProperties(grid).centerOfMass);
    const ships = [ship(points), ship(points, { pirate: true }), ship(points)];
    const matrix = lights.mesh.instanceMatrix.array;
    lights.update(ships, FRAME);
    // the counter sees the layer's own constructions (its instanced attributes)
    expect(created.n).toBeGreaterThan(0);
    created.n = 0;
    for (let i = 0; i < 200; i++) {
      ships[0]!.object.position.x = i;
      lights.update(ships, { ...FRAME, time: i / 60, cameraDistance: 48 + i });
    }
    expect(created.n).toBe(0);
    expect(lights.mesh.instanceMatrix.array).toBe(matrix);
    expect(lights.count).toBe(15);
    expect(lights.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 15 * 16 }]);
    expect(lights.mesh.instanceColor!.updateRanges).toEqual([{ start: 0, count: 15 * 3 }]);
  });

  it('lens + halo quads: one quad per light, blended over the scene without depth writes, sized in the shader', async () => {
    const { lights } = await layer();
    const m = lights.mesh.material as MeshBasicMaterial;
    expect(lights.mesh.geometry.getAttribute('position').count).toBe(4);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.customProgramCacheKey()).toBe('cinder-nav-lights-v2');
    // the shader replaces the projection with the pixel-sized quad (min lens and halo radius)
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: VERTEX, fragmentShader: FRAGMENT };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uNavView).toBeDefined();
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain(`${NAV_CORE_MIN_PX.toFixed(1)} * uNavView.z`);
    expect(shader.fragmentShader).not.toContain('#include <opaque_fragment>');
    // the halo is clearly wider than the lens, the lens never a 1 px dot
    expect(NAV_CORE_MIN_PX).toBeGreaterThanOrEqual(2);
    expect(NAV_HALO_MIN_PX).toBeGreaterThanOrEqual(NAV_CORE_MIN_PX * 2.5);
    expect(NAV_HALO_RATIO).toBeGreaterThanOrEqual(2.5);
  });

  it('warm-up sample: one instance with the layer material; dispose detaches the mesh', async () => {
    const { lights, parent } = await layer();
    const added: unknown[] = [];
    const zoo = { add: (o: unknown) => added.push(o) } as unknown as WarmUpZoo;
    lights.warmUp(zoo);
    expect(added).toHaveLength(1);
    const sample = added[0] as InstancedMesh;
    expect(sample.material).toBe(lights.mesh.material);
    expect(sample.instanceColor).not.toBeNull();
    lights.dispose();
    expect(parent.children).toEqual([]);
  });
});

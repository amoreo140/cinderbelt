import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import {
  HANGAR_FLOOR,
  HANGAR_FOV,
  HangarCamera,
  PAN_LIMIT,
  PITCH_DEFAULT,
  PITCH_MIN,
  PITCH_TOP,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  cellToWorld,
  clampPose,
  dampPose,
  nearestYaw,
  pickCell,
  placeCamera,
  worldToCell,
  type Cell,
  type HangarPose,
} from './hangarCamera';

const ASPECT = 1.6;
const deg = (d: number) => (d * Math.PI) / 180;

function cameraFor(pose: HangarPose): PerspectiveCamera {
  const camera = new PerspectiveCamera(HANGAR_FOV, ASPECT, 0.1, 400);
  placeCamera(camera, pose, ASPECT);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** NDC of a world point seen by the camera. */
function ndcOf(camera: PerspectiveCamera, p: Vector3): Vector2 {
  const v = p.clone().project(camera);
  return new Vector2(v.x, v.y);
}

/** The pointer ray through a world point (what a click on that point's pixel casts). */
function rayThrough(camera: PerspectiveCamera, p: Vector3) {
  const r = new Raycaster();
  r.setFromCamera(ndcOf(camera, p), camera);
  return r.ray;
}

const floorPoint = (x: number, y: number, height = HANGAR_FLOOR): Vector3 => {
  const w = cellToWorld(x, y);
  return new Vector3(w.x, height, w.z);
};

const POSES: [string, HangarPose][] = [
  ['default 3/4', { yaw: 0, pitch: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, panX: 0, panZ: 0 }],
  ['top-down', { yaw: 0, pitch: PITCH_TOP, zoom: 1, panX: 0, panZ: 0 }],
  ['orbited 45°, lowest tilt', { yaw: deg(45), pitch: PITCH_MIN, zoom: 1.4, panX: 1.5, panZ: -2 }],
  ['from the stern, top-down', { yaw: Math.PI, pitch: PITCH_TOP, zoom: 2, panX: -3, panZ: 3 }],
  ['orbited −100°, tilted 40°, zoomed out', { yaw: deg(-100), pitch: deg(40), zoom: ZOOM_MIN, panX: 0, panZ: 4 }],
];

describe('cell ↔ world mapping', () => {
  it('turns the ship grid a quarter: the bow (+x) is world −z, port (+y) is world −x', () => {
    expect(cellToWorld(1, 0)).toEqual({ x: 0, z: -1 });
    expect(cellToWorld(0, 1)).toEqual({ x: -1, z: 0 });
    expect(worldToCell(-1, 0)).toEqual({ x: 0, y: 1 });
    expect(worldToCell(0.49, -2.4)).toEqual({ x: 2, y: 0 });
    for (const [x, y] of [[3, -4], [-7, 7], [0, 0]] as const) {
      const w = cellToWorld(x, y);
      expect(worldToCell(w.x, w.z)).toEqual({ x, y });
    }
  });
});

describe('pickCell (ray onto the hangar floor)', () => {
  for (const [name, pose] of POSES) {
    it(`finds the cell under the pointer – ${name}`, () => {
      const camera = cameraFor(pose);
      for (let x = -7; x <= 7; x += 2) {
        for (let y = -7; y <= 7; y += 3) {
          // the centre and points well inside the cell
          for (const [ox, oy] of [[0, 0], [0.4, 0.4], [-0.4, 0.3], [0.3, -0.4]] as const) {
            const p = floorPoint(x + ox, y + oy);
            expect(pickCell(rayThrough(camera, p)), `${name} ${x + ox},${y + oy}`).toEqual({ x, y });
          }
        }
      }
    });
  }

  it('misses when the ray points away from the floor', () => {
    const camera = cameraFor(POSES[0]![1]);
    const r = new Raycaster();
    r.setFromCamera(new Vector2(0, 0.99), camera);
    r.ray.direction.set(0, 1, 0);
    expect(pickCell(r.ray)).toBeNull();
  });

  it('screen-up is the bow at yaw 0 and turns with the orbit', () => {
    const at = (pose: HangarPose, x: number, y: number) => ndcOf(cameraFor(pose), floorPoint(x, y));
    const base = { pitch: PITCH_TOP, zoom: 1, panX: 0, panZ: 0 };
    // yaw 0: the bow cell is above the centre, port to the left
    expect(at({ ...base, yaw: 0 }, 3, 0).y).toBeGreaterThan(0.1);
    expect(at({ ...base, yaw: 0 }, 0, 3).x).toBeLessThan(-0.1);
    // orbited half a turn: the bow points down
    expect(at({ ...base, yaw: Math.PI }, 3, 0).y).toBeLessThan(-0.1);
    // a quarter turn: the bow points sideways
    expect(Math.abs(at({ ...base, yaw: Math.PI / 2 }, 3, 0).x)).toBeGreaterThan(0.1);
  });

  describe('part bodies', () => {
    const bodies: Cell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];

    for (const [name, pose] of POSES) {
      it(`an empty cell's floor centre next to parts still picks that cell – ${name}`, () => {
        const camera = cameraFor(pose);
        for (const [x, y] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
          expect(pickCell(rayThrough(camera, floorPoint(x, y)), bodies)).toEqual({ x, y });
        }
        // and an occupied cell's floor centre picks the part itself
        for (const c of bodies) expect(pickCell(rayThrough(camera, floorPoint(c.x, c.y)), bodies)).toEqual(c);
      });
    }

    it('a tilted view picks the part the cursor is over, not the floor cell behind it', () => {
      const camera = cameraFor({ yaw: 0, pitch: PITCH_MIN, zoom: 1.4, panX: 0, panZ: 0 });
      // the top of the bow part (cell 1,0) seen from the stern side hits the floor further forward
      const top = floorPoint(1, 0, HANGAR_FLOOR + 0.33);
      expect(pickCell(rayThrough(camera, top))).not.toEqual({ x: 1, y: 0 });
      expect(pickCell(rayThrough(camera, top), bodies)).toEqual({ x: 1, y: 0 });
    });
  });
});

describe('clampPose', () => {
  it('keeps tilt, zoom and pan in range, yaw free', () => {
    const p = clampPose({ yaw: 9, pitch: 3, zoom: 99, panX: -40, panZ: 40 });
    expect(p).toEqual({ yaw: 9, pitch: PITCH_TOP, zoom: ZOOM_MAX, panX: -PAN_LIMIT, panZ: PAN_LIMIT });
    const q = clampPose({ yaw: -2, pitch: 0, zoom: 0.01, panX: 1, panZ: -1 });
    expect(q).toEqual({ yaw: -2, pitch: PITCH_MIN, zoom: ZOOM_MIN, panX: 1, panZ: -1 });
  });
});

describe('HangarCamera', () => {
  const make = () => {
    const c = new HangarCamera();
    c.viewportHeight = 600;
    c.aspect = ASPECT;
    return c;
  };

  it('tilt stops at top-down and at the lowest 3/4 view', () => {
    const c = make();
    c.tilt(10);
    expect(c.goal.pitch).toBe(PITCH_TOP);
    c.keys(100, { orbit: 0, tilt: -1, panX: 0, panY: 0 });
    expect(c.goal.pitch).toBe(PITCH_MIN);
    c.orbitDrag(0, 10_000);
    expect(c.goal.pitch).toBe(PITCH_TOP);
  });

  it('zoom and pan stay in range', () => {
    const c = make();
    for (let i = 0; i < 50; i++) c.zoomBy(-500);
    expect(c.goal.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 50; i++) c.zoomBy(500);
    expect(c.goal.zoom).toBe(ZOOM_MIN);
    c.keys(60, { orbit: 0, tilt: 0, panX: 1, panY: 1 });
    expect(Math.abs(c.goal.panX)).toBeLessThanOrEqual(PAN_LIMIT);
    expect(Math.abs(c.goal.panZ)).toBeLessThanOrEqual(PAN_LIMIT);
  });

  it('Q/E orbit continuously while held', () => {
    const c = make();
    c.keys(0.5, { orbit: 1, tilt: 0, panX: 0, panY: 0 });
    expect(c.goal.yaw).toBeCloseTo(Math.PI / 4);
    c.keys(1, { orbit: -1, tilt: 0, panX: 0, panY: 0 });
    expect(c.goal.yaw).toBeCloseTo(-Math.PI / 4);
  });

  it('a pan drag keeps the grabbed floor point under the pointer', () => {
    for (const yaw of [0, deg(60), Math.PI]) {
      for (const pitch of [PITCH_TOP, PITCH_DEFAULT, PITCH_MIN]) {
        const c = make();
        c.reducedMotion = true;
        c.goal.yaw = yaw;
        c.goal.pitch = pitch;
        c.update(0);
        const before = cameraFor(c.current);
        // the floor point at the screen centre ...
        const grabbed = new Vector3(c.current.panX, HANGAR_FLOOR, c.current.panZ);
        const start = ndcOf(before, grabbed);
        // ... dragged 40 px right and 30 px down stays under the pointer
        c.panBy(40, 30);
        c.update(0);
        const after = ndcOf(cameraFor(c.current), grabbed);
        const px = (n: Vector2) => ({ x: ((n.x + 1) / 2) * 600 * ASPECT, y: ((1 - n.y) / 2) * 600 });
        // within 2 px: the perspective of a tilted view stretches the far side a little
        expect(Math.abs(px(after).x - px(start).x - 40)).toBeLessThan(2);
        expect(Math.abs(px(after).y - px(start).y - 30)).toBeLessThan(2);
      }
    }
  });

  it('eases toward the goal and comes to rest; reduced motion jumps', () => {
    const c = make();
    c.orbit(1);
    expect(c.update(1 / 60)).toBe(true);
    expect(c.current.yaw).toBeGreaterThan(0);
    expect(c.current.yaw).toBeLessThan(1);
    let frames = 0;
    while (c.update(1 / 60) && frames < 1000) frames++;
    expect(c.current.yaw).toBe(1);
    expect(frames).toBeLessThan(200);
    expect(c.update(1 / 60)).toBe(false);

    const r = make();
    r.reducedMotion = true;
    r.tilt(0.3);
    expect(r.update(1 / 60)).toBe(true);
    expect(r.current.pitch).toBe(r.goal.pitch);
  });

  it('top view resets to straight down, bow up, the short way round', () => {
    const c = make();
    c.orbit(2 * Math.PI * 3 + 0.4);
    c.update(10);
    c.topView({ x: 1, z: -2 });
    expect(c.goal.pitch).toBe(PITCH_TOP);
    expect(c.goal.zoom).toBe(ZOOM_DEFAULT);
    expect(c.goal.yaw).toBeCloseTo(2 * Math.PI * 3);
    expect([c.goal.panX, c.goal.panZ]).toEqual([1, -2]);
  });

  it('opening frames the ship in the default 3/4 view at once', () => {
    const c = make();
    c.orbit(2);
    c.tilt(-1);
    c.frame({ x: 0.5, z: 0 });
    expect(c.current).toEqual({ yaw: 0, pitch: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, panX: 0.5, panZ: 0 });
    expect(c.update(1 / 60)).toBe(false);
  });

  it('centre keeps the orbit and tilt', () => {
    const c = make();
    c.orbit(0.7);
    c.tilt(0.2);
    c.centre({ x: 2, z: 2 });
    expect(c.goal.yaw).toBeCloseTo(0.7);
    expect(c.goal.pitch).toBeCloseTo(PITCH_DEFAULT + 0.2);
    expect([c.goal.panX, c.goal.panZ]).toEqual([2, 2]);
  });
});

describe('dampPose / nearestYaw', () => {
  it('nearestYaw picks the equivalent angle closest to the current one', () => {
    expect(nearestYaw(0.2, 0)).toBe(0);
    expect(nearestYaw(6.1, 0)).toBeCloseTo(2 * Math.PI);
    expect(nearestYaw(-3.3, 0)).toBeCloseTo(-2 * Math.PI);
  });

  it('a snap lands exactly on the goal', () => {
    const cur: HangarPose = { yaw: 0, pitch: 1, zoom: 1, panX: 0, panZ: 0 };
    const goal: HangarPose = { yaw: 1, pitch: 1.2, zoom: 2, panX: 3, panZ: -3 };
    expect(dampPose(cur, goal, 0.016, true)).toBe(true);
    expect(cur).toEqual(goal);
    expect(dampPose(cur, goal, 0.016, false)).toBe(false);
  });
});

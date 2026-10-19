import { describe, expect, it } from 'vitest';
import { boundingRadius, echoColumnFade, echoRhythm, parseLandmarkManifest, pulsePeriod, sphereInView } from './landmarkView';

import manifestRaw from '../../../public/assets/models/landmarks/landmarks.json';

const manifestJson = manifestRaw as unknown as {
  camera: { pitchDeg: number; vfovDeg: number; aspect: number; defaultDistance: number; maxDistance: number };
  landmarks: { id: string; depth: number; visibleWithin: Record<'default' | 'max', { dx: [number, number]; dy: [number, number]; centreDy: number }> }[];
};
const cam = manifestJson.camera;
const manifest = parseLandmarkManifest(manifestJson);

/** A camera looking at the origin of the plane from `distance` at the manifest pitch (+z = south). */
function eyeAt(distance: number) {
  const p = (cam.pitchDeg * Math.PI) / 180;
  return { x: 0, y: distance * Math.sin(p), z: distance * Math.cos(p) };
}
const TARGET = { x: 0, y: 0, z: 0 };
/** Sim offset (dx east, dy north) at `depth` below the plane → three.js point. */
const at = (dx: number, dy: number, depth: number) => ({ x: dx, y: -depth, z: -dy });
const FAR = 9000;

describe('parseLandmarkManifest', () => {
  it('reads the four models and the Echo column from the shipped manifest', () => {
    expect(Object.keys(manifest.models).sort()).toEqual(['crystal_spire', 'dead_forge', 'guild_relay', 'rust_ring_shard']);
    const relay = manifest.models.guild_relay!;
    expect(relay.depth).toBe(1100);
    expect(relay.scale).toBeCloseTo(3.4);
    expect(relay.glows[0]!.node).toBe('glow_0');
    expect(manifest.echoColumn).toEqual({ file: 'echo_column.glb', scale: { width: 14, height: 700 }, tiltDeg: { vertical: 0, compass: 35 } });
  });

  it('skips malformed entries instead of failing', () => {
    expect(parseLandmarkManifest(null)).toEqual({ models: {}, echoColumn: null });
    expect(parseLandmarkManifest({ landmarks: [{ id: 'x' }, { id: 'guild_relay', file: 'a.glb', scale: 2, depth: 10, worldSize: [1, 2] }] }).models).toEqual({});
  });
});

describe('sphereInView', () => {
  it('matches the manifest: the model is on screen within visibleWithin and gone well beyond it', () => {
    for (const lm of manifestJson.landmarks) {
      const def = manifest.models[lm.id as keyof typeof manifest.models];
      // the manifest ranges count any part of the model; the gas giant has no model entry (radius 520)
      const r = def ? boundingRadius(def.worldSize) : 520;
      for (const zoom of ['default', 'max'] as const) {
        const v = lm.visibleWithin[zoom];
        const eye = eyeAt(zoom === 'default' ? cam.defaultDistance : cam.maxDistance);
        const inView = (dx: number, dy: number, radius = r) => sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, FAR, at(dx, dy, lm.depth), radius);
        // the view centre is 0.70 x depth north of the target – even the anchor point alone is in view
        expect(inView(0, v.centreDy, 0)).toBe(true);
        expect(inView(0, v.dy[0] + 40)).toBe(true);
        expect(inView(0, v.dy[1] - 40)).toBe(true);
        expect(inView(v.dx[0] + 40, v.centreDy)).toBe(true);
        expect(inView(v.dx[1] - 40, v.centreDy)).toBe(true);
        expect(inView(0, v.dy[0] - 2 * r)).toBe(false);
        expect(inView(0, v.dy[1] + 2 * r)).toBe(false);
        expect(inView(v.dx[1] + 2 * r, v.centreDy)).toBe(false);
        expect(inView(v.dx[0] - 2 * r, v.centreDy)).toBe(false);
      }
    }
  });

  it('keeps a big model in view while any part of its bounding sphere is', () => {
    const relay = manifest.models.guild_relay!;
    const r = boundingRadius(relay.worldSize);
    const eye = eyeAt(cam.defaultDistance);
    // the anchor is just below the bottom edge (point at dy 180), its upper part still shows
    expect(sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, FAR, at(0, 0, relay.depth), 0)).toBe(false);
    expect(sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, FAR, at(0, 0, relay.depth), r)).toBe(true);
    expect(sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, FAR, at(0, -1200, relay.depth), r)).toBe(false);
  });

  it('respects the far plane', () => {
    const eye = eyeAt(cam.defaultDistance);
    expect(sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, 5000, at(0, 3000, 2100), 0)).toBe(true);
    expect(sphereInView(eye, TARGET, cam.vfovDeg, cam.aspect, 3000, at(0, 3000, 2100), 0)).toBe(false);
  });

  it('works for a camera that looks another way (no hidden north assumption)', () => {
    // looking east instead of north: a point ahead-east is in, the same point north is out
    const eye = { x: -30, y: 40, z: 0 };
    expect(sphereInView(eye, TARGET, 50, 16 / 9, FAR, { x: 700, y: -500, z: 0 }, 0)).toBe(true);
    expect(sphereInView(eye, TARGET, 50, 16 / 9, FAR, { x: 0, y: -500, z: -700 }, 0)).toBe(false);
  });
});

describe('Echo column', () => {
  it('fades out near the beacon and is full from ~110 u', () => {
    expect(echoColumnFade(0)).toBe(0);
    expect(echoColumnFade(40)).toBe(0);
    expect(echoColumnFade(60)).toBeGreaterThan(0);
    expect(echoColumnFade(60)).toBeLessThan(0.3);
    expect(echoColumnFade(110)).toBe(1);
    expect(echoColumnFade(5000)).toBe(1);
  });

  it('beats long-short-short within 0.65..1 and is steady with reduced motion', () => {
    const samples = Array.from({ length: 160 }, (_, i) => echoRhythm(i / 100, false));
    expect(Math.min(...samples)).toBeCloseTo(0.65, 2);
    expect(Math.max(...samples)).toBeCloseTo(1, 2);
    // three separate highs in one period
    let rises = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1]! < 0.8 && samples[i]! >= 0.8) rises++;
    expect(rises + (samples[0]! >= 0.8 ? 1 : 0)).toBe(3);
    expect(echoRhythm(0.3, true)).toBe(echoRhythm(1.1, true));
    expect(echoRhythm(1.6 + 0.2, false)).toBeCloseTo(echoRhythm(0.2, false), 6);
  });
});

describe('pulsePeriod', () => {
  it('reads single values and ranges', () => {
    expect(pulsePeriod('2.5 s', 0.3)).toBe(2.5);
    expect(pulsePeriod('4-6 s', 0)).toBe(4);
    expect(pulsePeriod('4-6 s', 1)).toBe(6);
    expect(pulsePeriod(undefined, 0.5)).toBeNull();
  });
});

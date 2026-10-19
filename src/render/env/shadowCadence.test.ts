import { DirectionalLight, type WebGLShadowMap } from 'three';
import { describe, expect, it } from 'vitest';
import { ShadowCadence } from './shadowCadence';

function setup() {
  const map = { autoUpdate: true, needsUpdate: false } as WebGLShadowMap;
  const light = new DirectionalLight();
  light.shadow.camera.right = 40;
  light.position.set(10, 20, 30);
  // a drawn map exists (null = draw at once)
  light.shadow.map = {} as never;
  const cadence = new ShadowCadence();
  /** One frame; true = the map draws this frame (three resets needsUpdate after drawing). */
  const frame = (every: number): boolean => {
    cadence.frame(map, light, every);
    const drawn = map.autoUpdate || map.needsUpdate;
    map.needsUpdate = false;
    return drawn;
  };
  return { map, light, cadence, frame };
}

describe('ShadowCadence', () => {
  it('draws every frame at a cadence of 1 (three autoUpdate)', () => {
    const { map, frame } = setup();
    expect([frame(1), frame(1), frame(1)]).toEqual([true, true, true]);
    expect(map.autoUpdate).toBe(true);
  });

  it('draws every n-th frame while the view stands still', () => {
    const { map, frame } = setup();
    expect(Array.from({ length: 7 }, () => frame(3))).toEqual([true, false, false, true, false, false, true]);
    expect(map.autoUpdate).toBe(false);
  });

  it('draws at once when the fitted frustum moves or resizes, or the map is missing', () => {
    const { light, frame } = setup();
    expect([frame(2), frame(2)]).toEqual([true, false]);
    light.position.x += 0.5;
    expect([frame(2), frame(2)]).toEqual([true, false]);
    light.shadow.camera.right = 48;
    expect(frame(2)).toBe(true);
    light.shadow.map = null;
    expect(frame(2)).toBe(true);
  });

  it('draws the first frame after a reset or after per-frame updates', () => {
    const { cadence, frame } = setup();
    expect([frame(4), frame(4)]).toEqual([true, false]);
    cadence.reset();
    expect(frame(4)).toBe(true);
    frame(1);
    expect([frame(4), frame(4)]).toEqual([true, false]);
  });
});

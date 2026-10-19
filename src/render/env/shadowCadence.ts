// Shadow map cadence (perf audit 2026-10-17, P3). While docked the camera stands still behind the hub,
// yet the sun's shadow map was drawn every frame – every caster of the station, the ship and the traffic
// once more. With a cadence of n the map is drawn every n-th frame, and at once whenever the fitted shadow
// frustum moved or resized (the camera moved, a zoom, the light turned) or the map is missing, so a moving
// view never shows a stale map. What moves inside a still view (traffic, spinning modules, trophies) has
// its shadow at most n − 1 frames behind. A cadence of 1 is three's own per-frame update.
import { Vector3, type DirectionalLight, type WebGLShadowMap } from 'three';

export class ShadowCadence {
  /** Frames until the next drawn shadow map. */
  private wait = 0;
  /** The light position and frustum half-width of the last drawn map (NaN = none: draw the next frame). */
  private readonly at = new Vector3(NaN, NaN, NaN);
  private half = NaN;

  /**
   * Before a drawn frame: sets the renderer's shadow map to draw this frame or keep its last image.
   * `every` = 1 draws every frame (three's autoUpdate).
   */
  frame(shadowMap: WebGLShadowMap, light: DirectionalLight, every: number): void {
    if (every <= 1) {
      shadowMap.autoUpdate = true;
      this.reset();
      return;
    }
    shadowMap.autoUpdate = false;
    const half = light.shadow.camera.right;
    const moved = half !== this.half || !this.at.equals(light.position) || light.shadow.map === null;
    this.wait--;
    if (!moved && this.wait > 0) return;
    shadowMap.needsUpdate = true;
    this.wait = every;
    this.at.copy(light.position);
    this.half = half;
  }

  /** The next cadenced frame draws the map (it was not kept up to date meanwhile, e.g. under the hangar). */
  reset(): void {
    this.wait = 0;
    this.at.set(NaN, NaN, NaN);
    this.half = NaN;
  }
}

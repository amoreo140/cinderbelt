// Camera shake strength by simulation event (M3.8) – pure, tested; the renderer feeds it to CameraRig.
import type { SimEvent } from '../sim/Simulation';

/** Camera shake (M3.8) by event: 0..1. A collision scales with the speed into the rock. */
export function shakeFor(e: SimEvent): number {
  switch (e.type) {
    case 'collision':
      return Math.min(1, Math.max(0, (e.speed - 3) / 24));
    case 'projectileHit':
      if (e.ref !== 'player') return 0;
      return e.target === 'shield' ? 0.14 : 0.32;
    case 'partsLost':
      return 0.6;
    case 'playerDestroyed':
      return 1;
    default:
      return 0;
  }
}

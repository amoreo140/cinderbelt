// Combat sounds: simulation event → sound with volume by distance and stereo position
// (pure functions; GameAudio plays them through AudioEngine.playCombat).
import type { CombatSound } from '../audio';
import type { ResourceId } from '../data/resources';
import type { Vec2 } from '../sim/math/vec2';
import type { SimEvent } from '../sim/Simulation';

export interface CombatCue {
  kind: CombatSound;
  /** 0..1 – quieter with growing distance from the player ship. */
  gain: number;
  /** −1 (left) … 1 (right) by the source position relative to the ship (the camera has north up). */
  pan: number;
  intensity?: number;
  resource?: ResourceId | null;
}

/** Beyond this the sound is barely audible. */
export const HEARING_RANGE = 160;
/** The distance at which the sound is fully left/right. */
const PAN_WIDTH = 45;

export function spatial(source: Vec2, listener: Vec2): { gain: number; pan: number } {
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const d = Math.hypot(dx, dy);
  const gain = Math.max(0, 1 - d / HEARING_RANGE) ** 1.5;
  const pan = Math.max(-1, Math.min(1, dx / PAN_WIDTH)) * 0.8;
  return { gain, pan };
}

/** The sound for an event, or null. `resourceOf` looks up the resource of the mined asteroid. */
export function combatCue(event: SimEvent, listener: Vec2, resourceOf?: (asteroidId: string) => ResourceId | null): CombatCue | null {
  switch (event.type) {
    case 'shotFired':
      return { kind: event.owner === 'player' ? 'shot' : 'pirateShot', ...spatial(event.pos, listener) };
    case 'projectileHit':
      if (event.target === 'shield') return { kind: 'shieldHit', ...spatial(event.pos, listener) };
      if (event.target === 'ship' || event.target === 'wreck') {
        return { kind: 'hit', intensity: event.ref === 'player' ? 1 : 0.5, ...spatial(event.pos, listener) };
      }
      return { kind: 'hit', intensity: 0.2, ...spatial(event.pos, listener) };
    case 'partDestroyed':
      return { kind: 'explosionSmall', ...spatial(event.pos, listener) };
    case 'partsLost':
      return { kind: 'partLost', gain: 1, pan: 0 };
    case 'shipDestroyed':
    case 'playerDestroyed':
      return { kind: 'explosionLarge', ...spatial(event.pos, listener) };
    case 'enemyAlert':
      return { kind: 'alert', gain: 1, pan: 0 };
    case 'salvaged':
      return { kind: 'salvage', gain: 1, pan: 0 };
    case 'asteroidDepleted':
      return { kind: 'breakup', gain: 1, pan: 0, resource: resourceOf?.(event.id) ?? null };
    case 'asteroidCracked':
      return { kind: 'breakup', ...spatial(event.pos, listener), resource: 'ice' };
    // --- salvage and fortress (M3.6) ---
    case 'wreckCut':
      return { kind: event.blast > 0 ? 'explosionLarge' : 'explosionSmall', ...spatial(event.pos, listener) };
    case 'partRipped':
    case 'containerLoaded':
      return { kind: 'salvage', gain: 1, pan: 0 };
    case 'fortressPartDestroyed':
      return { kind: 'explosionLarge', ...spatial(event.pos, listener) };
    case 'fortressDestroyed':
      return { kind: 'explosionLarge', gain: 1, pan: 0 };
    // --- Mining 2.0: a nugget breaks off (a small crack of rock), a nugget lands in the hold ---
    case 'nuggetSpawned':
      return { kind: 'hit', intensity: 0.35, ...spatial(event.pos, listener) };
    case 'nuggetCollected':
      return { kind: 'salvage', gain: 0.8, pan: 0 };
    case 'tollDemanded':
    case 'raidArrived':
    case 'huntingParty':
      return { kind: 'alert', gain: 1, pan: 0 };
    default:
      return null;
  }
}

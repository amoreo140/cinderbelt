// The game runtime (audit 2026-10-17, P10): what a running game needs beyond the menu – three.js, the
// renderer and its layers, the models, the Game and its UI. It is a chunk of its own, loaded with
// `import()` (runtimeLoad.ts) once the menu is up – or at once for a quick start or a test fixture – so
// the menu does not wait for ~1.5 MB of code and the 62 models; a game start waits for it instead.
import { prefetchBootAssets, prefetchZoneAssets } from '../../render/assets/bootAssets';
import { ModelLibrary, type LoadProgress } from '../../render/assets/ModelLibrary';
import { holdPrefetch } from '../../render/assets/prefetch';
import { RenderContext } from '../../render/RenderContext';
import type { RingIndex } from '../../data/economy';
import { convoyRoutes } from '../../sim/convoys/schedule';
import { activeEvents } from '../../sim/events/director';
import type { Vec2 } from '../../sim/math/vec2';
import type { SimState } from '../../sim/Simulation';
import { cometsNear } from '../../sim/sites/comets';
import { COMET_LOOK } from '../../render/sites/cometLook';
import { Game } from '../Game';
import { SectorZoneTracker } from '../sectorZone';

export interface GameRuntime {
  Game: typeof Game;
  /** The one WebGL renderer of the app (made with the runtime: the start zone's sky loads into it early). */
  context: RenderContext;
  /** Every model of the library, loaded (missing ones are placeholders). */
  library: ModelLibrary;
}

let context: RenderContext | null = null;
/** Zones whose sky is to be loaded into the renderer once loadGameRuntime made it. */
const warmDepths = new Set<RingIndex>();

/**
 * Loads the model library; resolves with everything a game start needs. The rest of the start's files
 * (the layers' models, catalogues, effect textures – assets/bootAssets.ts) download alongside, after
 * the library's models in the network's queue (perf O14).
 */
export async function loadGameRuntime(onProgress: LoadProgress): Promise<GameRuntime> {
  const library = ModelLibrary.load(onProgress);
  holdPrefetch(library);
  prefetchBootAssets();
  const ctx = (context ??= new RenderContext());
  for (const depth of warmDepths) void ctx.skyboxes.get(depth);
  warmDepths.clear();
  return { Game, context: ctx, library: await library };
}

/**
 * The world tables the first frame reads – the comet orbits, the convoy routes, the event director's
 * storms and sector states (~0.5 s at 4× CPU, per-seed caches of pure functions) – computed while the
 * models download, a task each (perf O14). Reads `state`, changes nothing.
 */
export function prewarmWorld(state: SimState): void {
  const jobs = [
    () => cometsNear(state.seed, state.player.body.pos, COMET_LOOK.range, state.tick),
    () => convoyRoutes(state.seed),
    () => activeEvents(state),
  ];
  const next = (): void => {
    const job = jobs.shift();
    if (!job) return;
    job();
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
}

/**
 * Starts downloading the sky and planets of the zone a game at `pos` starts in (and its neighbours').
 * `warm`: a game start is on its way – the sky is also decoded and its environment map filtered (once
 * `loadGameRuntime` made the renderer), so the shader warm-up finds it ready; behind the menu only the
 * bytes download.
 */
export function prefetchZone(seed: number, pos: Vec2, warm: boolean): void {
  const zone = new SectorZoneTracker();
  zone.update(seed, pos);
  const depths = zone.depthsNear(pos);
  prefetchZoneAssets(depths);
  if (!warm) return;
  if (context) for (const depth of depths) void context.skyboxes.get(depth);
  else for (const depth of depths) warmDepths.add(depth);
}

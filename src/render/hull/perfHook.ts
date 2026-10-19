// Perf probe of the hull shell (SL2 E1 T6, plan: "shell build timing via the dev hook"): builds a ship
// view of a grid again and again, the way a pirate's rebuild does, and reports the median times of the
// whole build and of its shell part (ShipView.shellInfo). Used by tests/e2e/hullShell.perf.spec.ts
// through GameRenderer.measureShellBuild; nothing in the game calls it.
//
// Also the dev hooks of the shell (`window.__cinder.perf.shell`, dev builds only): `terrace(on)` forces
// terrace v2 on / off regardless of `TERRACE_ENABLED` (on since the user approved it, plan 2026-10-20 R5).
import type { FactionId } from '../../data/factions';
import { gridCellKeys } from '../../sim/ship/outline';
import { computeProperties } from '../../sim/ship/properties';
import type { ShipGrid } from '../../sim/ship/types';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ShipView } from '../ShipView';
import { hullTerraceEnabled, setHullTerraceOverride } from './setting';

export interface ShellBuildTiming {
  runs: number;
  /** Median of the whole ShipView build (parts, connectors, shell), ms. */
  buildMs: number;
  /** Median of the shell part (outline, geometry, armour clip, attach), ms. */
  shellMs: number;
  /** Median of the bake that follows on the view's next update (batch merge, decal probes), ms. */
  bakeMs: number;
  /** Shell size of the last build. */
  pieces: number;
  triangles: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[s.length >> 1]!;
};

/**
 * Builds `grid` `runs` times (after a few warm builds), shell on, flight look, torn-edge memory of the
 * grid itself (a pirate's view) – clan ships use their part set when it has loaded.
 */
export function measureShellBuild(library: ModelLibrary, grid: ShipGrid, clan: FactionId | null = null, runs = 30): ShellBuildTiming {
  const props = computeProperties(grid);
  const view = new ShipView(grid, props, library, clan, { shell: true, mode: 'flight', tornFrom: gridCellKeys(grid) });
  const build: number[] = [];
  const shell: number[] = [];
  const bake: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      view.rebuild(grid, props);
      view.bake();
    }
    for (let i = 0; i < runs; i++) {
      view.rebuild(grid, props);
      build.push(view.shellInfo.buildMs);
      shell.push(view.shellInfo.shellMs);
      const t0 = performance.now();
      view.bake();
      bake.push(performance.now() - t0);
    }
    return { runs, buildMs: median(build), shellMs: median(shell), bakeMs: median(bake), pieces: view.shellInfo.pieces, triangles: view.shellInfo.triangles };
  } finally {
    view.dispose();
  }
}

/** `window.__cinder.perf` (dev builds): hull shell switches for screenshots and probes. */
export interface PerfDevHooks {
  shell: {
    /**
     * Terraces (v2) on / off regardless of `TERRACE_ENABLED`; null = back to the constant. Every ship
     * view rebuilds its shell on its next update. Returns whether terraces are built now.
     */
    terrace(on: boolean | null): boolean;
  };
}

export function perfDevHooks(): PerfDevHooks {
  return {
    shell: {
      terrace: (on) => {
        setHullTerraceOverride(on);
        return hullTerraceEnabled();
      },
    },
  };
}

// Which contextual rows the flight console shows (Stage 4 "calmer HUD"): the console always holds the
// three thin bars (hull, fuel, energy); everything else appears when the situation asks for it. Pure.
//
// Signals (all of them exist in HudData already):
//  - cargo:      mining is active (`HudData.mining.active`) or the hold is not empty – and 'cargo' revealed.
//  - speed:      a dock clamp approach is on (`HudData.prompt.approach`, the dock helper wants the speed) or the
//                goal is a stop-here target within STOP_TARGET_RANGE units (`HudData.goal.distance`: the
//                training's brake buoy, a dock point) or the dampers are OFF (the ship drifts: the
//                speed shows how fast) – and 'speed' revealed.
//  - silhouette: combat data present (pirates around or attacking, the alert band, a wreck to salvage, the
//                ship destroyed) or anything damaged (a part below its max HP, a part missing, hull below max).
//                The shield gauge goes with it. Combat parts are never gated by the reveal.
//  - dampers:    only as a warning row while the dampers are OFF – and 'dampers' revealed.
//  - tractor:    the tractor beam is active.
import type { HudParts } from './hudParts';

export interface ConsoleRulesInput {
  parts: HudParts;
  /** The ship is mining (a laser is firing or warm). */
  mining: boolean;
  /** Units in the hold. */
  cargoUsed: number;
  /** Pirates around, an alert, a wreck in reach or a destroyed ship. */
  combat: boolean;
  /** Any part damaged or missing, or the hull below its maximum. */
  damaged: boolean;
  /** The dock approach readout shows (near a dock clamp). */
  dockApproach: boolean;
  /** The goal is a stop-here target within reach (`stopTargetNear`). */
  stopTarget: boolean;
  dampersOn: boolean;
  tractor: boolean;
}

export interface ConsoleRules {
  readonly cargo: boolean;
  readonly speed: boolean;
  readonly silhouette: boolean;
  readonly dampers: boolean;
  readonly tractor: boolean;
}

/** A goal this near (units) counts as a "stop here" target: the speed readout helps to brake onto it. */
export const STOP_TARGET_RANGE = 60;

/** Is the goal (its distance in units, null = none) a stop target within reach? */
export const stopTargetNear = (goalDistance: number | null): boolean => goalDistance !== null && goalDistance <= STOP_TARGET_RANGE;

/** One shared frozen result per combination of the five flags (32 at most), built on demand. */
const cache: (ConsoleRules | undefined)[] = [];

function shared(cargo: boolean, speed: boolean, silhouette: boolean, dampers: boolean, tractor: boolean): ConsoleRules {
  const key = (cargo ? 1 : 0) | (speed ? 2 : 0) | (silhouette ? 4 : 0) | (dampers ? 8 : 0) | (tractor ? 16 : 0);
  return (cache[key] ??= Object.freeze({ cargo, speed, silhouette, dampers, tractor }));
}

export function consoleRules(i: ConsoleRulesInput): ConsoleRules {
  return shared(
    i.parts.cargo && (i.mining || i.cargoUsed > 0),
    i.parts.speed && (i.dockApproach || i.stopTarget || !i.dampersOn),
    i.combat || i.damaged,
    i.parts.dampers && !i.dampersOn,
    i.tractor,
  );
}

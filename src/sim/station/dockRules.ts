// Which docking rules apply to the player: the manoeuvre, or the Archive's docking computer.
import { hasFeature } from '../discovery/archive';
import type { SimState } from '../Simulation';
import { DOCK_RULES, DOCKING_COMPUTER_RULES, type DockRules } from './dock';

export const playerDockRules = (state: SimState): DockRules =>
  hasFeature(state, 'dockingComputer') ? DOCKING_COMPUTER_RULES : DOCK_RULES;

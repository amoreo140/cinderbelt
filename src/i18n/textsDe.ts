// Every German text in one bundle (`tx()` when the language is German). Loaded on demand by index.ts – a
// Slovak or English game never downloads it.
import { de } from './de';
import { deGuild } from './deGuild';
import { deJournal } from './deJournal';
import { deParts } from './deParts';
import { deDocking } from './deDocking';
import { deHome } from './deHome';
import { deFleet } from './deFleet';
import { deGraphics } from './deGraphics';
import { deComms } from './deComms';
import { deFlight } from './deFlight';
import { deShipyard } from './deShipyard';
import { deDiscovery } from './deDiscovery';
import { deLandmarks } from './deLandmarks';
import { dePirates } from './dePirates';
import { deGoals } from './deGoals';
import { deSectors } from './deSectors';
import { deWorld } from './deWorld';
import { deMining } from './deMining';
import { deTraining } from './deTraining';
import type { Texts } from './texts';

export const deTexts: Texts = {
  ...de,
  guild: deGuild,
  journal: deJournal,
  partInfo: deParts,
  docking: deDocking,
  home: deHome,
  fleet: deFleet,
  graphics: deGraphics,
  comms: deComms,
  flight: deFlight,
  shipyardV2: deShipyard,
  discovery: deDiscovery,
  landmarks: deLandmarks,
  pirates: dePirates,
  goals: deGoals,
  sectors: deSectors,
  world: deWorld,
  mining: deMining,
  training: deTraining,
};

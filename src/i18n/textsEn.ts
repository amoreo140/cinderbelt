// Every English text in one bundle (`tx()` when the language is English). Loaded on demand by index.ts – a
// Slovak game never downloads it.
import { en } from './en';
import { enGuild } from './enGuild';
import { enJournal } from './enJournal';
import { enParts } from './enParts';
import { enDocking } from './enDocking';
import { enHome } from './enHome';
import { enFleet } from './enFleet';
import { enGraphics } from './enGraphics';
import { enComms } from './enComms';
import { enFlight } from './enFlight';
import { enShipyard } from './enShipyard';
import { enDiscovery } from './enDiscovery';
import { enLandmarks } from './enLandmarks';
import { enPirates } from './enPirates';
import { enGoals } from './enGoals';
import { enSectors } from './enSectors';
import { enWorld } from './enWorld';
import { enMining } from './enMining';
import { enTraining } from './enTraining';
import type { Texts } from './texts';

export const enTexts: Texts = {
  ...en,
  guild: enGuild,
  journal: enJournal,
  partInfo: enParts,
  docking: enDocking,
  home: enHome,
  fleet: enFleet,
  graphics: enGraphics,
  comms: enComms,
  flight: enFlight,
  shipyardV2: enShipyard,
  discovery: enDiscovery,
  landmarks: enLandmarks,
  pirates: enPirates,
  goals: enGoals,
  sectors: enSectors,
  world: enWorld,
  mining: enMining,
  training: enTraining,
};

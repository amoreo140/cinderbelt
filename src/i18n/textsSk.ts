// Every Slovak text in one bundle (`tx()` when the language is Slovak). Loaded on demand by index.ts – an
// English game never downloads it.
import { sk } from './sk';
import { skGuild } from './skGuild';
import { skJournal } from './skJournal';
import { skParts } from './skParts';
import { skDocking } from './skDocking';
import { skHome } from './skHome';
import { skFleet } from './skFleet';
import { skGraphics } from './skGraphics';
import { skComms } from './skComms';
import { skFlight } from './skFlight';
import { skShipyard } from './skShipyard';
import { skDiscovery } from './skDiscovery';
import { skLandmarks } from './skLandmarks';
import { skPirates } from './skPirates';
import { skGoals } from './skGoals';
import { skSectors } from './skSectors';
import { skWorld } from './skWorld';
import { skMining } from './skMining';
import { skTraining } from './skTraining';
import type { Texts } from './texts';

export const skTexts: Texts = {
  ...sk,
  guild: skGuild,
  journal: skJournal,
  partInfo: skParts,
  docking: skDocking,
  home: skHome,
  fleet: skFleet,
  graphics: skGraphics,
  comms: skComms,
  flight: skFlight,
  shipyardV2: skShipyard,
  discovery: skDiscovery,
  landmarks: skLandmarks,
  pirates: skPirates,
  goals: skGoals,
  sectors: skSectors,
  world: skWorld,
  mining: skMining,
  training: skTraining,
};

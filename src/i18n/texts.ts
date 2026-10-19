// The shape of one language's texts (`tx()` in index.ts): the core texts (sk.ts) plus one key per area
// module. Types only – the texts themselves are in the language bundles (textsSk.ts, textsEn.ts).
import type { CoreTexts } from './sk';
import type { GuildTexts } from './skGuild';
import type { JournalTexts } from './skJournal';
import type { PartsTexts } from './skParts';
import type { DockingTexts } from './skDocking';
import type { HomeTexts } from './skHome';
import type { FleetTexts } from './skFleet';
import type { GraphicsTexts } from './skGraphics';
import type { CommsTexts } from './skComms';
import type { FlightTexts } from './skFlight';
import type { ShipyardTexts } from './skShipyard';
import type { DiscoveryTexts } from './skDiscovery';
import type { LandmarksTexts } from './skLandmarks';
import type { PiratesTexts } from './skPirates';
import type { GoalsTexts } from './skGoals';
import type { SectorsTexts } from './skSectors';
import type { WorldTexts } from './skWorld';
import type { MiningTexts } from './skMining';
import type { TrainingTexts } from './skTraining';

/** Every text of one language: the core texts plus one key per area module. */
export interface Texts extends CoreTexts {
  /** M4d "Cech a obchod": Guild Watch, Guild relay, convoys and trade, escort, map layer, notes, route (skGuild.ts). */
  guild: GuildTexts;
  /** Journal entries: title and text by entry id (skJournal.ts). */
  journal: JournalTexts;
  /** Part explanations (skParts.ts). */
  partInfo: PartsTexts;
  /** Docking as a manoeuvre (skDocking.ts). */
  docking: DockingTexts;
  /** Home station: the Development tab, modules, paints, trophies, Forge Index (skHome.ts). */
  home: HomeTexts;
  /** Hangar and fleet: ship names, ship log, templates (skFleet.ts). */
  fleet: FleetTexts;
  /** Graphics quality setting (skGraphics.ts). */
  graphics: GraphicsTexts;
  /** The communicator / radio (skComms.ts). */
  comms: CommsTexts;
  /** Flight and damage feedback (skFlight.ts). */
  flight: FlightTexts;
  /** Shipyard 2.0: free placement, groups, hangar camera (skShipyard.ts). */
  shipyardV2: ShipyardTexts;
  /** Discovery: scanner, Archive, journal UI, map (skDiscovery.ts). */
  discovery: DiscoveryTexts;
  /** Far landmarks: names on the map (skLandmarks.ts). */
  landmarks: LandmarksTexts;
  /** Pirates and salvage (skPirates.ts). */
  pirates: PiratesTexts;
  /** Career: contracts, factions, objectives (skGoals.ts). */
  goals: GoalsTexts;
  /** Sectors: names, security, knowledge, entry notice, map layer (skSectors.ts). */
  sectors: SectorsTexts;
  /** M4b "The world comes alive": space events, derelicts and their terminal, graveyards, comets (skWorld.ts). */
  world: WorldTexts;
  /** Mining 2.0 (skMining.ts). */
  mining: MiningTexts;
  /** Guild Training (skTraining.ts). */
  training: TrainingTexts;
}

/** The area modules of `Texts` (everything except the core texts). */
export type TextModule = Exclude<keyof Texts, keyof CoreTexts>;

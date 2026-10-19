// Board tab (10.6): slips, active contracts, faction reputation, sector state and wanted
// captains – a view model built from the simulation state (no DOM).
import { CAPTAIN_COUNT } from '../../data/captains';
import { MAX_ACTIVE_CONTRACTS } from '../../data/contracts';
import { emblemPath, FUTURE_UNLOCKS, REP_FACTION_IDS, REP_LEVELS, type FactionId, type RepFactionId } from '../../data/factions';
import { SECTOR_MODIFIERS, type SectorModifierId, type SectorModifierKind } from '../../data/sector';
import type { ResourceId } from '../../data/resources';
import { tx } from '../../i18n';
import { captainBounty, captainDefs, captainLevel } from '../../sim/captains/captains';
import { currentBoard, nextBoardRefresh } from '../../sim/contracts/board';
import { assignmentProgress, assignmentTarget, nextLevelDef } from '../../sim/factions/reputation';
import { stationDemand } from '../../sim/sector/market';
import { nextSectorChange, sectorAt } from '../../sim/sector/sector';
import type { SimState } from '../../sim/Simulation';
import { availableResources } from '../../sim/station/storage';
import type { StationDef } from '../../sim/world/stations';
import { assignmentText, captainName, partLabel, resourceName } from './names';
import { cartographyView, type CartographyView } from './cartographyView';
import { contractSlip, offerSlip, type SlipData } from './slipView';

export type BoardViewMode = 'contracts' | 'factions' | 'wanted' | 'charts';

export interface AssignmentOptionView {
  id: string;
  text: string;
  value: number;
  max: number;
  done: boolean;
  /** A "deliver X" task: can it be handed in here and now? */
  deliver?: { resource: ResourceId; amount: number; enabled: boolean };
}

export interface FactionView {
  id: RepFactionId;
  name: string;
  emblem: string;
  level: number;
  levelName: string;
  points: number;
  /** Points for the next level (null = maximum). */
  nextPoints: number | null;
  /** The task for the next level (two options), or null. */
  assignment: AssignmentOptionView[] | null;
  unlocks: string[];
  nextUnlocks: { text: string; soon: string | null }[];
}

export interface SectorModifierView {
  id: SectorModifierId;
  name: string;
  kind: SectorModifierKind;
  kindName: string;
  effect: string;
  bonus: number;
}

export interface SectorView {
  modifiers: SectorModifierView[];
  minutesToChange: number;
}

export interface CaptainView {
  index: number;
  name: string;
  clan: FactionId;
  clanName: string;
  emblem: string;
  level: number;
  bounty: number;
  trait: string;
  replicas: string[];
  kills: number;
  defeated: boolean;
}

export interface BoardData {
  active: SlipData[];
  offers: SlipData[];
  full: boolean;
  refreshMinutes: number;
  sector: SectorView;
  factions: FactionView[];
  captains: CaptainView[];
  trophies: { name: string; parts: string[] }[];
  /** Cartography (sectors stage 2): charts to sell to and buy from the Guild. */
  cartography: CartographyView;
}

const minutesUntil = (state: SimState, tick: number): number => Math.max(1, Math.ceil((tick - state.tick) / 3600));

export function sectorView(state: SimState, pos: { x: number; y: number }): SectorView {
  const sector = sectorAt(state.seed, pos, state.tick);
  return {
    modifiers: sector.modifiers.map((m) => {
      const def = SECTOR_MODIFIERS[m.id];
      return {
        id: m.id,
        name: m.id === 'demand' && m.resource ? tx().goals.sector.demandOf(resourceName(m.resource)) : tx().goals.sector.names[m.id],
        kind: def.kind,
        kindName: tx().goals.sector.kinds[def.kind],
        effect: tx().goals.sector.effects[m.id],
        bonus: Math.round(def.bonus * 100),
      };
    }),
    minutesToChange: minutesUntil(state, nextSectorChange(state.tick)),
  };
}

function factionView(state: SimState, f: RepFactionId, station: StationDef | null): FactionView {
  const rep = state.career.rep[f];
  const next = nextLevelDef(rep, f);
  const assignment = next?.assignment?.map((a): AssignmentOptionView => {
    const value = assignmentProgress(rep, a);
    const max = assignmentTarget(a);
    const text = assignmentText(a);
    const view: AssignmentOptionView = { id: a.id, text, value, max, done: value >= max };
    if (a.kind === 'deliver') {
      const have = station ? Math.floor(availableResources(state, station.id)[a.resource] + 1e-9) : 0;
      view.deliver = { resource: a.resource, amount: Math.min(have, max - value), enabled: station !== null && have > 0 && value < max };
    }
    return view;
  });
  return {
    id: f,
    name: tx().goals.factions[f],
    emblem: emblemPath(f),
    level: rep.level,
    levelName: tx().goals.repLevels[rep.level],
    points: rep.points,
    nextPoints: next?.points ?? null,
    assignment: assignment ?? null,
    unlocks: REP_LEVELS[f].filter((l) => l.level <= rep.level).flatMap((l) => l.unlocks.map((u) => tx().goals.unlocks[u])),
    nextUnlocks: (next?.unlocks ?? []).map((u) => ({ text: tx().goals.unlocks[u], soon: FUTURE_UNLOCKS[u] ?? null })),
  };
}

/** Wanted captains: those the player has history with, hunted and offered ones, then the highest levels. */
export function captainsView(state: SimState, offerCaptains: ReadonlySet<number>, limit = 6): CaptainView[] {
  const defs = captainDefs(state.seed);
  const hunted = new Set(state.career.contracts.flatMap((c) => (c.target.kind === 'captain' ? [c.target.captain] : [])));
  const score = (i: number): number => {
    const s = state.career.captains.get(i);
    return (s?.kills ? 1000 : 0) + (hunted.has(i) ? 500 : 0) + (offerCaptains.has(i) ? 300 : 0) + (s?.promotions ? 100 : 0) + captainLevel(defs[i]!, s) * 10 - i * 0.01;
  };
  const list = defs.filter((d) => !state.career.captains.get(d.index)?.defeated).map((d) => d.index);
  list.sort((a, b) => score(b) - score(a));
  return list.slice(0, Math.min(limit, CAPTAIN_COUNT)).map((i) => {
    const def = defs[i]!;
    const s = state.career.captains.get(i);
    const level = captainLevel(def, s);
    return {
      index: i,
      name: captainName(state.seed, i),
      clan: def.clan,
      clanName: tx().goals.factions[def.clan],
      emblem: emblemPath(def.clan),
      level,
      bounty: captainBounty(def, level),
      trait: tx().goals.captains.traits[def.trait],
      replicas: (s?.trophies ?? []).map(partLabel),
      kills: s?.kills ?? 0,
      defeated: s?.defeated ?? false,
    };
  });
}

export function boardData(state: SimState, station: StationDef): BoardData {
  const board = currentBoard(state, station);
  const full = state.career.contracts.length >= MAX_ACTIVE_CONTRACTS;
  const accept = full ? { enabled: false, reason: tx().goals.slip.full } : { enabled: true };
  const offerCaptains = new Set(board.offers.flatMap((o) => (o.target.kind === 'captain' ? [o.target.captain] : [])));
  return {
    active: state.career.contracts.map((c) => contractSlip(state, c, station)),
    offers: board.offers.map((o) => offerSlip(state, o, accept)),
    full,
    refreshMinutes: minutesUntil(state, nextBoardRefresh(state.tick)),
    sector: sectorView(state, station.pos),
    factions: REP_FACTION_IDS.map((f) => factionView(state, f, station)),
    captains: captainsView(state, offerCaptains),
    trophies: state.career.trophies.map((t) => ({ name: captainName(state.seed, t.captain), parts: t.parts.map(partLabel) })),
    cartography: cartographyView(state, station),
  };
}

/** Station demand for the market (the tag next to a resource). */
export function demandView(state: SimState, station: StationDef): { resource: ResourceId; left: number } | null {
  return stationDemand(state, station);
}

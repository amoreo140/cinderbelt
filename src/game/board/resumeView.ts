// The "Where you left off" card (9.2): last activity, active contracts, next goal
// and the latest journal entries – within 10 s you know what to do.
import { RESOURCE_IDS } from '../../data/resources';
import { tx } from '../../i18n';
import type { LogEntry } from '../../sim/career/types';
import { sectorInfoAt } from '../../sim/regions';
import type { SimState } from '../../sim/Simulation';
import { nearestDiscoveredStation, stationById } from '../../sim/world/stations';
import { journalTitle } from '../discovery/journalView';
import { formatInt } from '../../ui/format';
import { formatStationName } from '../../ui/stationName';
import { computeObjectives, type Objective } from '../objectives/objectives';
import { amountText, captainName, durationText, resourceName, stationLabel } from './names';
import { contractSlip, type SlipData } from './slipView';

export interface ResumeData {
  played: string;
  /** Where the ship is and what it carries. */
  activity: string[];
  /** Depth of the sector the ship is in (sectors §6.2; the badge shows it with the depth's name). */
  ring: number;
  contracts: SlipData[];
  next: Objective | null;
  journal: { text: string; ago: string }[];
}

export function logText(state: SimState, e: LogEntry): string {
  const t = tx().goals.log;
  switch (e.kind) {
    case 'contractAccepted':
      return t.contractAccepted(tx().goals.contractTypes[e.type], stationLabel(state.seed, e.station));
    case 'contractCompleted':
      return t.contractCompleted(tx().goals.contractTypes[e.type], stationLabel(state.seed, e.station));
    case 'contractAbandoned':
      return t.contractAbandoned(tx().goals.contractTypes[e.type]);
    case 'contractFailed':
      return t.contractFailed(tx().goals.contractTypes[e.type]);
    case 'levelUp':
      return t.levelUp(tx().goals.factionShort[e.faction], e.level);
    case 'stationDiscovered':
      return t.stationDiscovered(stationLabel(state.seed, e.station));
    case 'captainDefeated':
      return t.captainDefeated(captainName(state.seed, e.captain));
    case 'captainPromoted':
      return t.captainPromoted(captainName(state.seed, e.captain));
    case 'courierDelivered':
      return t.courierDelivered(stationLabel(state.seed, e.station));
    case 'firstDayStep':
      return t.firstDayStep;
    case 'trainingStep':
      return t.trainingStep(tx().training.steps[e.step].title);
    case 'died':
      return t.died;
  }
}

export function resumeData(state: SimState): ResumeData {
  const { player } = state;
  const pos = player.body.pos;
  const ring = sectorInfoAt(state.seed, pos.x, pos.y).depth;
  const activity: string[] = [];
  const dock = player.dock;
  if (dock.mode !== 'flying') {
    activity.push(tx().goals.resume.docked(stationLabel(state.seed, dock.stationId)));
  } else {
    const near = nearestDiscoveredStation(state.seed, state.world.discovered, pos);
    activity.push(tx().goals.resume.flying(tx().station.ring(ring, tx().rings[ring - 1]!), formatStationName(near), formatInt(Math.hypot(near.pos.x - pos.x, near.pos.y - pos.y))));
    // heading: the discovered station the ship is flying towards
    const v = player.body.vel;
    if (Math.hypot(v.x, v.y) > 2) {
      let best: { name: string; score: number } | null = null;
      for (const id of state.world.discovered) {
        const s = stationById(state.seed, id);
        if (!s) continue;
        const dx = s.pos.x - pos.x;
        const dy = s.pos.y - pos.y;
        const d = Math.hypot(dx, dy);
        const cos = (dx * v.x + dy * v.y) / (d * Math.hypot(v.x, v.y) || 1);
        if (cos > 0.9 && (!best || d < best.score)) best = { name: formatStationName(s), score: d };
      }
      if (best) activity.push(tx().goals.resume.heading(best.name));
    }
  }
  const cargo = RESOURCE_IDS.filter((r) => player.cargo[r] >= 0.5).map((r) => `${amountText(player.cargo[r])} ${resourceName(r)}`);
  activity.push(cargo.length > 0 ? tx().goals.resume.cargo(cargo.join(', ')) : tx().goals.resume.emptyCargo);
  const docked = dock.mode === 'docked' ? stationById(state.seed, dock.stationId) : null;
  const objectives = computeObjectives(state);
  return {
    played: durationText(state.tick),
    activity,
    ring,
    contracts: state.career.contracts.map((c) => contractSlip(state, c, docked)),
    next: objectives.find((o) => o.track !== 'contract') ?? objectives[0] ?? null,
    // career and the discovery journal (M3.5b) together, the 3 newest
    journal: [
      ...state.career.log.map((e) => ({ tick: e.tick, text: logText(state, e) })),
      ...state.discovery.journal.map((e) => ({ tick: e.tick, text: tx().discovery.toasts.journal(journalTitle(e.id)).replace(/ \(J\)$/, '') })),
    ]
      .sort((a, b) => a.tick - b.tick)
      .slice(-3)
      .reverse()
      .map((e) => ({ text: e.text, ago: tx().goals.log.ago(durationText(Math.max(60, state.tick - e.tick))) })),
  };
}

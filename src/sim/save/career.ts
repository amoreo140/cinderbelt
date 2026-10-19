// Career ↔ save (V4, Guild Training since V10). Maps as sorted pairs, the boards and demand only
// from the current period (older ones are never used – after loading they are generated the same way).
import { boardEpoch } from '../contracts/board';
import { sectorEpoch } from '../sector/sector';
import type { CareerState } from '../career/types';
import { createCareer } from '../career/career';
import type { SavedCareerV10, SavedCareerV4 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function careerToSave(career: CareerState, tick: number): SavedCareerV10 {
  const board = boardEpoch(tick);
  const sector = sectorEpoch(tick);
  return structuredClone({
    nextId: career.nextId,
    contracts: career.contracts,
    boards: [...career.boards].filter(([, b]) => b.epoch === board).sort((a, b) => byString(a[0], b[0])),
    rep: career.rep,
    captains: [...career.captains].sort((a, b) => a[0] - b[0]),
    engaged: [...career.engaged].sort((a, b) => a[0] - b[0]),
    shipments: career.shipments,
    training: career.training,
    demandSold: [...career.demandSold]
      .filter(([, d]) => d.epoch === sector)
      .sort((a, b) => byString(a[0], b[0]))
      .map(([id, d]): [string, number, number] => [id, d.epoch, d.amount]),
    completed: career.completed,
    trophies: career.trophies,
    log: career.log,
  });
}

export function careerFromSave(saved: SavedCareerV10): CareerState {
  const c = structuredClone(saved);
  return {
    nextId: c.nextId,
    contracts: c.contracts,
    boards: new Map(c.boards),
    rep: c.rep,
    captains: new Map(c.captains),
    engaged: new Map(c.engaged),
    shipments: c.shipments,
    training: c.training,
    demandSold: new Map(c.demandSold.map(([id, epoch, amount]) => [id, { epoch, amount }])),
    completed: c.completed,
    trophies: c.trophies,
    log: c.log,
  };
}

/** Career for an old save (V3): no contracts, "First day" skipped (the player is already playing). V4 shape. */
export function legacyCareer(): SavedCareerV4 {
  const { training: _t, ...career } = careerToSave(createCareer(), 0);
  return { ...career, firstDay: { step: 0, status: 'skipped', base: 0 } };
}

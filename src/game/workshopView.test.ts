// M4c T10: the workshop lamps' view model (RAF / OPR, the refined count) and their idle hold.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PartId, Tier } from '../data/parts';
import { emptyCargo, type Cargo } from '../data/resources';
import { setLocale } from '../i18n';
import type { SimState } from '../sim/Simulation';
import { createGrid } from '../sim/ship/grid';
import type { HpMap, Rotation } from '../sim/ship/types';
import { idleWorkshop, type WorkshopActivity } from '../sim/ship/workshop';
import { IDLE_HOLD, WorkshopLamps, rawLamps, refinedCount } from './workshopView';

type Entry = [PartId, number, number, Rotation?, Tier?];

/** Just the player fields the lamps read. */
function fakeState(parts: Entry[], patch: { workshop?: WorkshopActivity; refined?: Partial<Cargo>; hp?: HpMap; fuel?: number } = {}): SimState {
  const grid = createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0], ...parts]);
  const player = {
    grid,
    gridVersion: 1,
    hp: patch.hp ?? new Map(),
    workshop: patch.workshop ?? idleWorkshop(),
    refined: { ...emptyCargo(), ...patch.refined },
    cargo: emptyCargo(),
    fuel: patch.fuel ?? 50,
    props: { fuelCapacity: 100 },
  };
  return { player } as unknown as SimState;
}
const plain = (s: string | null): string => (s ?? '').replace(/[  ]/g, ' ');

beforeEach(() => setLocale('sk'));

describe('rawLamps', () => {
  it('no workshop part: no lamps', () => {
    expect(rawLamps(fakeState([]))).toEqual({ refinery: null, repair: null });
  });
  it('reads what the refinery and the repair modules do', () => {
    const s = fakeState([['refinery', 1, 0], ['repairModule', 0, 1]], { workshop: { refining: 'ore', repairing: [{ module: 4, target: 1 }] } });
    expect(rawLamps(s)).toEqual({ refinery: 'ore', repair: 'working' });
  });
  it('carries the idle reasons', () => {
    const s = fakeState([['refinery', 1, 0], ['repairModule', 0, 1]], { workshop: { refining: null, repairing: [], refineryIdle: 'energy', repairIdle: 'material' } });
    expect(rawLamps(s)).toEqual({ refinery: 'idle', refineryReason: 'energy', repair: 'idle', repairReason: 'material' });
  });
});

describe('WorkshopLamps', () => {
  it('nothing to draw without a workshop part and refined ore', () => {
    expect(new WorkshopLamps().view(fakeState([]), 0)).toBeNull();
  });

  it('a refinery topping up the tank: lamp "fuel" with the tank level in the tooltip', () => {
    const v = new WorkshopLamps().view(fakeState([['refinery', 1, 0]], { workshop: { refining: 'fuel', repairing: [] }, fuel: 40 }), 0)!;
    expect(v.refinery).toBe('fuel');
    expect(v.repair).toBeNull();
    expect(plain(v.refineryTip)).toContain('ľad na palivo');
    expect(plain(v.refineryTip)).toContain('40 %');
  });

  it('a fresh idle lamp shows its reason at once (energy, material, nothing)', () => {
    const tips = (['energy', 'material', 'nothing'] as const).map((reason) => {
      const v = new WorkshopLamps().view(fakeState([['refinery', 1, 0]], { workshop: { refining: null, repairing: [], refineryIdle: reason } }), 0)!;
      expect(v.refinery).toBe('idle');
      expect(v.refineryReason).toBe(reason);
      return plain(v.refineryTip);
    });
    expect(tips[0]).toContain('20 %');
    expect(tips[1]).toContain('ľad');
    expect(tips[2]).toContain('nádrž je plná');
  });

  it('work shows at once; a short idle flicker does not, a lasting one does', () => {
    const lamps = new WorkshopLamps();
    const working = fakeState([['refinery', 1, 0]], { workshop: { refining: 'ore', repairing: [] } });
    const idle = fakeState([['refinery', 1, 0]], { workshop: { refining: null, repairing: [], refineryIdle: 'energy' } });
    expect(lamps.view(working, 0)!.refinery).toBe('ore');
    // the battery at the floor: idle and work alternate every step
    expect(lamps.view(idle, 0.1)!.refinery).toBe('ore');
    expect(lamps.view(working, 0.2)!.refinery).toBe('ore');
    expect(lamps.view(idle, 0.3)!.refinery).toBe('ore');
    expect(lamps.view(idle, 0.3 + IDLE_HOLD / 2)!.refinery).toBe('ore');
    const v = lamps.view(idle, 0.3 + IDLE_HOLD)!;
    expect(v.refinery).toBe('idle');
    expect(v.refineryReason).toBe('energy');
  });

  it('a new idle reason waits for the hold too', () => {
    const lamps = new WorkshopLamps();
    const idle = (reason: 'energy' | 'nothing') => fakeState([['refinery', 1, 0]], { workshop: { refining: null, repairing: [], refineryIdle: reason } });
    expect(lamps.view(idle('nothing'), 0)!.refineryReason).toBe('nothing');
    expect(lamps.view(idle('energy'), 1)!.refineryReason).toBe('nothing');
    expect(lamps.view(idle('energy'), 1 + IDLE_HOLD)!.refineryReason).toBe('energy');
  });

  it('a repair module names the parts it repairs and their HP', () => {
    // armour (id 3) at (1,0), repair module (id 4) at (2,0)
    const s = fakeState([['armor', 1, 0], ['repairModule', 2, 0]], { workshop: { refining: null, repairing: [{ module: 4, target: 3 }] }, hp: new Map([[3, 30]]) });
    const v = new WorkshopLamps().view(s, 0)!;
    expect(v.repair).toBe('working');
    expect(plain(v.repairTip)).toContain('Pancier T1 (');
  });

  it('a repair module without material names what is missing: iron for a T1 part, titanium for a T2 part', () => {
    const t1 = fakeState([['armor', 1, 0], ['repairModule', 2, 0]], { workshop: { refining: null, repairing: [], repairIdle: 'material' }, hp: new Map([[3, 10]]) });
    expect(plain(new WorkshopLamps().view(t1, 0)!.repairTip)).toContain('chýba železo');
    const t2 = fakeState([['armor', 1, 0, 0, 2], ['repairModule', 2, 0]], { workshop: { refining: null, repairing: [], repairIdle: 'material' }, hp: new Map([[3, 10]]) });
    expect(plain(new WorkshopLamps().view(t2, 0)!.repairTip)).toContain('chýba titán');
  });

  it('reset forgets the hold (docking, another ship)', () => {
    const lamps = new WorkshopLamps();
    lamps.view(fakeState([['refinery', 1, 0]], { workshop: { refining: 'ore', repairing: [] } }), 0);
    lamps.reset();
    const v = lamps.view(fakeState([['refinery', 1, 0]], { workshop: { refining: null, repairing: [], refineryIdle: 'nothing' } }), 0.1)!;
    expect(v.refinery).toBe('idle');
  });

  it('English tooltips', () => {
    setLocale('en');
    const v = new WorkshopLamps().view(fakeState([['repairModule', 1, 0]], { workshop: { refining: null, repairing: [], repairIdle: 'energy' } }), 0)!;
    expect(plain(v.repairTip)).toContain('not enough energy');
  });
});

describe('refined count', () => {
  it('counts whole refined units and lists them', () => {
    const s = fakeState([], { refined: { titanium: 12.6, iron: 30.2, copper: 0.4 } });
    const r = refinedCount(s);
    expect(r.count).toBe(42);
    expect(plain(r.tip)).toContain('Fe 30 · Ti 12');
    expect(plain(r.tip)).toContain('o 15 % drahšie');
  });
  it('refined ore alone (the refinery was shot off) still shows the count', () => {
    const v = new WorkshopLamps().view(fakeState([], { refined: { copper: 5 } }), 0)!;
    expect(v).toMatchObject({ refinery: null, repair: null, refined: 5 });
  });
});

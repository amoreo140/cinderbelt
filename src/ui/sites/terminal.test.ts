import { describe, expect, it } from 'vitest';
import { DERELICT } from '../../data/sites';
import type { DerelictTerminalData } from '../../game/sites/types';
import { materialList, terminalLayout } from './terminal';

const base = (over: Partial<DerelictTerminalData> = {}): DerelictTerminalData => ({
  id: 'dl:3,4',
  name: 'Opustená stanica',
  model: 'a',
  log: 'log',
  data: 80,
  items: [],
  fabricator: null,
  holdFree: 40,
  ...over,
});

describe('terminalLayout', () => {
  it('a stash shows its item rows', () => {
    const d = base({
      service: 'stash',
      items: [
        { index: 0, label: 'Reaktor T2', key: 'reactor:2', taken: false },
        { index: 1, label: 'Motor T2', key: 'engine:2', taken: true },
      ],
    });
    const l = terminalLayout(d);
    expect(l.service).toBe('stash');
    expect(l.rows.map((r) => r.index)).toEqual([0, 1]);
    expect(l.fabricator).toBeNull();
    expect(l.used).toBe(false);
  });

  it('the fabricator list replaces its single item row while unused', () => {
    const d = base({
      service: 'fabricator',
      items: [{ index: 0, label: 'Bezplatná výroba', taken: false }],
      fabricator: [{ key: 'engine:1', label: 'Motor', materials: { iron: 12 } }],
    });
    const l = terminalLayout(d);
    expect(l.rows).toEqual([]);
    expect(l.fabricator).toHaveLength(1);
    expect(l.used).toBe(false);
  });

  it('a used fabricator shows its taken row and counts as used', () => {
    const d = base({ service: 'fabricator', items: [{ index: 0, label: 'Bezplatná výroba', taken: true }], fabricator: null });
    const l = terminalLayout(d);
    expect(l.rows).toHaveLength(1);
    expect(l.used).toBe(true);
  });

  it('derives the service when the view model does not carry it', () => {
    expect(terminalLayout(base({ fabricator: [] })).service).toBe('fabricator');
    expect(terminalLayout(base({ items: [{ index: 0, label: 'x', key: 'cargo:1', taken: false }] })).service).toBe('stash');
    expect(terminalLayout(base({ items: [{ index: 0, label: '2 fragmenty', taken: false }] })).service).toBe('plan');
    expect(terminalLayout(base()).service).toBeNull();
  });

  it('the hold is full when one more part does not fit', () => {
    expect(terminalLayout(base({ holdFree: DERELICT.itemCargo })).holdFull).toBe(false);
    expect(terminalLayout(base({ holdFree: DERELICT.itemCargo - 0.5 })).holdFull).toBe(true);
    expect(terminalLayout(base({ holdFree: 0 })).holdFull).toBe(true);
  });

  it('an empty offer (everything taken) is used', () => {
    expect(terminalLayout(base({ items: [{ index: 0, label: 'x', key: 'cargo:1', taken: true }] })).used).toBe(true);
  });
});

describe('materialList', () => {
  it('lists the materials in the cargo order and drops zeros', () => {
    expect(materialList({ titanium: 4, iron: 12, copper: 0 })).toEqual([
      { id: 'iron', amount: 12 },
      { id: 'titanium', amount: 4 },
    ]);
    expect(materialList({})).toEqual([]);
  });
});

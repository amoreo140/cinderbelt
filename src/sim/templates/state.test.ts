// Template slots by the Archive (M4a, long-term design 3.4.3).
import { describe, expect, it } from 'vitest';
import { archiveNode } from '../../data/archive';
import { Simulation } from '../Simulation';
import { templateCap } from './state';

describe('templateCap', () => {
  it('0 before the Archive node, 5 with "Ship templates", 20 with "20-slot templates"', () => {
    const { state } = new Simulation({ seed: 1 });
    expect(templateCap(state)).toBe(0);
    state.discovery.archive.add('templates');
    expect(templateCap(state)).toBe(5);
    state.discovery.archive.add('templates20');
    expect(templateCap(state)).toBe(20);
  });

  it('the M4a Archive nodes are buyable features now', () => {
    expect(archiveNode('templates').unlock).toEqual({ kind: 'feature', feature: 'templates' });
    expect(archiveNode('templates20').unlock).toEqual({ kind: 'feature', feature: 'templates20' });
    expect(archiveNode('hangarPlus').unlock).toEqual({ kind: 'feature', feature: 'hangarPlus' });
    for (const id of ['templates', 'templates20', 'hangarPlus'] as const) expect(archiveNode(id).since).toBeUndefined();
  });
});

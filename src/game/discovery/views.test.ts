import { describe, expect, it } from 'vitest';
import { letterKey } from '../input';
import { findPoi, flyingAt, tapScan, teleport } from '../../sim/discovery/testing';
import { dockedSim } from '../../sim/station/testHarness';
import type { SimEvent } from '../../sim/Simulation';
import { archiveData } from './archiveView';
import { ExploreUi } from './exploreUi';
import { journalData } from './journalView';
import { regionWorld, sectorInfo } from '../../sim/regions';
import { sectorName } from '../../ui/sectors/sectorText';

const SEED = 4242;

function ui(state: () => ReturnType<typeof dockedSim>['state']) {
  const sent: unknown[] = [];
  const explore = new ExploreUi({ state, send: (a) => sent.push(a), render: () => {}, click: () => {} });
  return { explore, sent };
}

describe('archive view', () => {
  it('shows the tree with states: owned, ready, locked, future; hidden nodes appear after their journal entry', () => {
    const sim = dockedSim();
    let d = archiveData(sim.state, null);
    // 40 tree nodes + the early docking computer in Propulsion and navigation (2026-10-17)
    expect(d.branches.map((b) => b.nodes.length)).toEqual([8, 8, 9, 8, 8]);
    expect(d.branches.find((b) => b.id === 'logistics')!.licensed).toBe(true);
    const node = (id: string) => d.branches.flatMap((b) => b.nodes).find((n) => n.id === id);
    expect(node('battery')!.state).toBe('locked');
    // M4c: the refinery is a buyable part node, the resonant laser still a later milestone
    expect(node('refinery')!.state).toBe('locked');
    expect(node('resonantLaser')!.state).toBe('future');
    expect(node('echoDecoder')).toBeUndefined();
    sim.state.discovery.dataTotal = 100;
    sim.state.discovery.dataFund = 100;
    sim.state.discovery.archive.add('largeCargo');
    sim.state.discovery.journal.push({ id: 'echo0', tick: 0 });
    d = archiveData(sim.state, 'heavyLaser');
    expect(node('battery')!.state).toBe('ready');
    expect(node('largeCargo')!.state).toBe('owned');
    expect(node('echoDecoder')!.state).toBe('ready');
    expect(node('dockingComputer')!.state).toBe('ready');
    expect(d.selected!.id).toBe('heavyLaser');
    expect(d.selected!.state).toBe('locked');
    expect(d.selected!.reason).toContain('nižšej úrovne');
    expect(node('crystalMetallurgy')!.key).toBe(true);
  });
});

describe('journal view', () => {
  it('is empty at first, then shows known entries and the "?" they point to', () => {
    const sim = dockedSim();
    expect(journalData(sim.state, 'knowledge', null).nodes).toEqual([]);
    sim.state.discovery.journal.push({ id: 'scanner', tick: 3600 });
    const d = journalData(sim.state, 'knowledge', null);
    const scanner = d.nodes.find((n) => n.id === 'scanner')!;
    expect(scanner.known).toBe(true);
    expect(scanner.more).toBe(true);
    expect(d.nodes.filter((n) => !n.known).map((n) => n.title)).toEqual(['?', '?', '?']);
    expect(d.edges.length).toBe(3);
    expect(d.selected?.title).toBe('Skener');
    expect(d.selected?.when).toBe('1 min');
    expect(d.atlas.map((a) => a.id)).toContain('anomalies');
    expect(d.trainingSteps.length).toBe(9);
  });
});

describe('explore UI', () => {
  it('J toggles the journal, digits toggle map layers only with the map open', () => {
    const sim = dockedSim();
    const { explore } = ui(() => sim.state);
    expect(explore.onKey(letterKey('j'), letterKey, false)).toBe(true);
    expect(explore.journalOpen).toBe(true);
    expect(explore.onKey('Digit2', letterKey, false)).toBe(true);
    expect(explore.journalTab).toBe('atlas');
    explore.onKey('Escape', letterKey, false);
    expect(explore.journalOpen).toBe(false);
    expect(explore.onKey('Digit1', letterKey, false)).toBe(false);
    expect(explore.onKey('Digit5', letterKey, true)).toBe(true);
    expect(explore.layers.fields).toBe(false);
  });

  it('names the needed and available energy when the scanner is short of it', () => {
    const sim = flyingAt(4242, { x: 700, y: 0 });
    sim.state.player.energy = 9.4;
    const events = tapScan(sim);
    const failed = events.find((e) => e.type === 'scanFailed');
    expect(failed).toMatchObject({ reason: 'energy', required: 15 });
    sim.state.player.energy = 9.4; // fixed value for the text (the tap itself lets the reactor recharge)
    const { explore } = ui(() => sim.state);
    const toast = explore.toast(sim.state, [{ type: 'scanFailed', reason: 'energy', required: 15, available: 9.4 }]);
    expect(toast?.text).toBe('Skener potrebuje 15 energie, máš 9 – reaktor dobíja');
    expect(toast?.seconds).toBe(3);
  });

  it('keeps the most important toast of a step', () => {
    const sim = dockedSim();
    const { explore } = ui(() => sim.state);
    const events: SimEvent[] = [
      { type: 'scanPulse', pos: { x: 0, y: 0 }, range: 540, found: 2 },
      { type: 'fragmentFound', plan: 'eco', count: 2, complete: false, duplicate: false },
    ];
    expect(explore.toast(sim.state, events)?.text).toContain('2/3');
    expect(explore.toast(sim.state, [events[0]!])?.text).toContain('2 signály');
  });

  it('names the sector and its Data when it becomes Charted (sectors 4.1)', () => {
    const sim = dockedSim();
    const { explore } = ui(() => sim.state);
    const id = regionWorld(sim.state.seed).regions.find((r) => r.seed.depth === 2)!.seed.id;
    const name = sectorName(sectorInfo(sim.state.seed, id)!.name);
    const toast = explore.toast(sim.state, [{ type: 'sectorCharted', id, depth: 2, data: 3, via: 'coverage' }]);
    expect(toast?.text).toBe(`Sektor zmapovaný: ${name} · +3 D`);
    expect(toast?.kind).toBe('ok');
  });

  it('puts signals on the radar and at most two callouts at the nearest places', () => {
    const anomaly = findPoi(SEED, 'anomaly');
    const sim = flyingAt(SEED, { x: anomaly.pos.x + 380, y: anomaly.pos.y });
    const { explore } = ui(() => sim.state);
    tapScan(sim);
    const radar = explore.radar(sim.state, 180);
    expect(radar.signals.some((s) => Math.abs(s.x + 380) < 120)).toBe(true);
    teleport(sim, { x: anomaly.pos.x + 22, y: anomaly.pos.y });
    const callouts = explore.callouts(sim.state);
    expect(callouts.length).toBeGreaterThan(0);
    expect(callouts.length).toBeLessThanOrEqual(2);
    // a survey point at the anomaly (sectors stage 2) may lead – the anomaly keeps its own label
    const label = callouts.find((c) => c.id === anomaly.id)!;
    expect(label).toBeDefined();
    expect(label.keys).toBe('Tab');
    expect(callouts.every((c) => c.id === anomaly.id || c.id.startsWith('survey:'))).toBe(true);
    const map = explore.map(sim.state);
    expect(map.signals.length + map.places.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { archiveNode } from '../../data/archive';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import { DOCK_RULES, DOCKING_COMPUTER_RULES } from './dock';
import { playerDockRules } from './dockRules';
import { act, dockedSim, homeOnly } from './testHarness';

describe('playerDockRules', () => {
  it('a new game docks by the manoeuvre rules', () => {
    expect(playerDockRules(dockedSim().state)).toBe(DOCK_RULES);
  });

  it('buying the docking computer in the Archive relaxes the rules, and a save keeps it', () => {
    const sim = dockedSim();
    const node = archiveNode('dockingComputer');
    sim.state.discovery.dataTotal = node.data;
    sim.state.discovery.dataFund = node.data;
    const credits = sim.state.credits;
    const events = act(sim, { type: 'archiveBuy', node: 'dockingComputer' });
    expect(events).toContainEqual({ type: 'archiveBought', node: 'dockingComputer' });
    expect(sim.state.credits).toBe(credits - node.credits);
    expect(sim.state.discovery.dataFund).toBe(0);
    expect(playerDockRules(sim.state)).toBe(DOCKING_COMPUTER_RULES);

    const loaded = loadSave(toEnvelope(toSave(sim, testContext())));
    if (!loaded.ok) throw new Error(loaded.error);
    const restored = restoreSimulation(loaded.save, { generator: homeOnly });
    expect(playerDockRules(restored.state)).toBe(DOCKING_COMPUTER_RULES);
  });
});

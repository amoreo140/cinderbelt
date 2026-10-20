import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameActionInput } from '../../sim/commands';
import { dockedSim } from '../../sim/station/testHarness';
import type { Simulation } from '../../sim/Simulation';
import { letterKey } from '../input';
import { CareerUi } from './careerUi';

function setup(resume = false): { sim: Simulation; ui: CareerUi; sent: GameActionInput[]; renders: number[]; skips: number[] } {
  const sim = dockedSim();
  sim.step(IDLE_COMMAND);
  const sent: GameActionInput[] = [];
  const renders: number[] = [];
  const skips: number[] = [];
  const ui = new CareerUi(
    { state: () => sim.state, send: (a) => sent.push(a), render: () => renders.push(1), click: () => {}, requestSkipTraining: () => skips.push(1) },
    { resume, name: 'Hra' },
  );
  return { sim, ui, sent, renders, skips };
}

describe('CareerUi keys', () => {
  it('G toggles objectives, I storages, Esc closes a panel', () => {
    const { ui } = setup();
    expect(ui.onKey(letterKey('g'), letterKey)).toBe(true);
    expect(ui.panel).toBe('objectives');
    expect(ui.onKey(letterKey('i'), letterKey)).toBe(true);
    expect(ui.panel).toBe('storages');
    expect(ui.onKey('Escape', letterKey)).toBe(true);
    expect(ui.panel).toBeNull();
    // without a panel, Esc belongs to the game (pause)
    expect(ui.onKey('Escape', letterKey)).toBe(false);
    expect(ui.onKey('KeyW', letterKey)).toBe(false);
  });

  it('the resume card swallows keys until Enter / Esc / Space continues', () => {
    const { ui } = setup(true);
    expect(ui.onKey(letterKey('g'), letterKey)).toBe(true);
    expect(ui.panel).toBeNull();
    expect(ui.resumeOpen).toBe(true);
    ui.onKey('Enter', letterKey);
    expect(ui.resumeOpen).toBe(false);
  });
});

describe('CareerUi data', () => {
  it('builds the panel and the resume card, asks to skip the training and sends contract actions', () => {
    const { sim, ui, sent, skips } = setup(true);
    const data = ui.uiData(sim.state, 0, false);
    expect(data.resume?.name).toBe('Hra');
    expect(data.band).toBeNull();
    ui.setPanel('objectives');
    const panel = ui.uiData(sim.state, 0, true).panel;
    expect(panel?.kind).toBe('objectives');
    ui.handlers.skipTraining();
    ui.handlers.abandon(3);
    expect(skips).toEqual([1]);
    expect(sent).toEqual([{ type: 'abandonContract', contractId: 3 }]);
  });

  it('turns career events into toasts', () => {
    const { sim, ui } = setup();
    expect(ui.toast(sim.state, { type: 'contractCompleted', contractId: 1, reward: 900, rep: 20, part: 'engine:2' })?.text).toMatch(/900 kr.*Motor T2/);
    expect(ui.toast(sim.state, { type: 'repLevelUp', faction: 'guild', level: 2 })?.text).toMatch(/Cech: úroveň 2/);
    expect(ui.toast(sim.state, { type: 'trainingStep', step: 'dockSell', index: 2, credits: 100, parts: { 'engine:1': 2 }, kit: false, stationId: 'home', done: false })?.text).toBeUndefined();
    expect(ui.toast(sim.state, { type: 'trainingStep', step: 'finishShip', index: 8, credits: 100, parts: {}, kit: false, stationId: 'home', done: true })?.text).toBeUndefined();
    expect(ui.toast(sim.state, { type: 'cargoFull' })).toBeNull();
  });
});

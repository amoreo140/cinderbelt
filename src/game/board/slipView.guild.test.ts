// M4d slips of the Guild relay and the escort (T11): the relay chain's stage hints and progress, the
// escort's deposit, lane and ambush tags, its next step by the convoy's state.
import { describe, expect, it } from 'vitest';
import { ESCORT } from '../../data/convoys';
import { IDLE_COMMAND } from '../../sim/commands';
import type { Contract, ContractOffer } from '../../sim/career/types';
import { dockedSim } from '../../sim/station/testHarness';
import type { SimState } from '../../sim/Simulation';
import { slipTags } from '../../ui/board/Slip';
import { contractSlip, contractTarget, contractWhy, escortDepositOf, offerSlip, relayMaterials, relayMissing, relayStageView } from './slipView';

function state(): SimState {
  const s = dockedSim();
  s.step(IDLE_COMMAND);
  return s.state;
}

const relayOffer: ContractOffer = {
  id: 'home@0.9',
  type: 'relay',
  faction: 'guild',
  station: 'home',
  ring: 2,
  risk: 0.5,
  target: { kind: 'relay', lane: 'A', relay: 'gr:A', sector: '0,1', pos: { x: 900, y: 300 } },
  modifiers: [],
  bonus: 0,
  part: null,
};

const escortOffer: ContractOffer = {
  id: 'home@0.8',
  type: 'escort',
  faction: 'guild',
  station: 'home',
  ring: 1,
  risk: 0.5,
  target: { kind: 'escort', lane: 'B', from: 400, to: 3200, meet: { x: 400, y: 0 }, end: { x: 3200, y: 0 }, ambushes: [1500, 2400] },
  modifiers: [],
  bonus: 0,
  part: null,
};

const accepted = (o: ContractOffer, serial: number): Contract => ({ ...o, serial, acceptedTick: 0, seconds: 600, reward: 2400, rep: 30, progress: 0, base: 0, ready: false });
const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('relay slip (M4d §2.2)', () => {
  it('materials and what the cargo lacks', () => {
    expect(relayMaterials()).toBe('60 Fe, 40 Cu, 10 Ti');
    expect(relayMissing({ iron: 70, copper: 12, ice: 0, titanium: 10 })).toEqual({ copper: 28 });
    expect(relayMissing({ iron: 60, copper: 40, ice: 0, titanium: 10 })).toEqual({});
  });

  it('walks the stages: repair → power → hold, with progress steps', () => {
    const st = state();
    const c = accepted(relayOffer, 7);
    const at = () => contractSlip(st, c, null);
    expect(at()).toMatchObject({ next: 'Oprav relé (F): 60 Fe, 40 Cu, 10 Ti z nákladu', progress: { value: 0, max: 3 }, lane: 'A' });
    st.guild.relays.set('A', { stage: 'repaired', sector: '0,1', tick: 1 });
    expect(at()).toMatchObject({ next: 'Napájaj relé ťažobným laserom (5 s)', progress: { value: 1, max: 3 } });
    st.guild.relays.set('A', { stage: 'powered', sector: '0,1', tick: 2 });
    st.guild.hold = { lane: 'A', start: 100, phase: 'warning', reinforced: false };
    expect(at().next).toMatch(/protiútok/);
    st.guild.hold = { lane: 'A', start: 100, phase: 'idle', reinforced: false };
    expect(at()).toMatchObject({ next: 'Vráť sa k relé – Hrdza zaútočí znova', progress: { value: 2, max: 3 } });
    st.guild.relays.set('A', { stage: 'secured', sector: '0,1', tick: 3 });
    expect(relayStageView(st, 'A', '0,1').stage).toBe('secured');
  });

  it('the offer says what securing does and carries the lane tag', () => {
    const st = state();
    const slip = offerSlip(st, relayOffer, { enabled: true });
    expect(slip.rewardNote).toBe('Sektor bude natrvalo Strážený');
    expect(slip.title).toMatch(/^Opraviť, napájať a ubrániť relé Cechu v sektore /);
    expect(slipTags(slip).map((t) => t.text)).toContain('Cechová cesta A');
  });
});

describe('escort slip (M4d §2.7)', () => {
  it('the offer shows the deposit (10 %), the lane and the ambushes', () => {
    const st = state();
    const slip = offerSlip(st, escortOffer, { enabled: true });
    expect(slip.deposit).toBe(escortDepositOf(slip.reward));
    expect(slip.deposit).toBe(Math.round(slip.reward * ESCORT.deposit));
    expect(norm(slip.rewardNote!)).toMatch(/^Záloha 10 %: [\d ]+ kr – prepadne, ak eskorta zlyhá$/);
    const tags = slipTags(slip);
    expect(tags.map((t) => norm(t.text))).toEqual(expect.arrayContaining(['Cechová cesta B', '2 prepadnutia']));
    expect(tags.find((t) => t.text.startsWith('Záloha'))?.tone).toBe('warn');
    expect(slip.title).toBe('Sprevádzať konvoj Voľných obchodníkov po Cechovej ceste B');
  });

  it('the objective says when the deposit is lost', () => {
    expect(contractWhy(state(), escortOffer)).toMatch(/^Záloha prepadne/);
  });

  it('the next step follows the convoy', () => {
    const st = state();
    const c = accepted(escortOffer, 9);
    expect(contractSlip(st, c, null)).toMatchObject({ next: 'Leť k bodu stretnutia', progress: null, deposit: 240 });
    const e = { progress: 0, state: 'waiting' as const, departed: null, away: 0, stopUntil: 0, fired: 0, hulls: [400] };
    st.convoys.escorts.set(9, e);
    st.player.body.pos = { x: 420, y: 10 };
    expect(contractSlip(st, c, null).next).toMatch(/^Konvoj čaká/);
    st.convoys.escorts.set(9, { ...e, state: 'moving', departed: 10, progress: 1400 });
    expect(contractSlip(st, c, null)).toMatchObject({ next: 'Sprevádzaj konvoj, drž sa do 800 j', progress: { value: 1400, max: 2800 } });
    st.convoys.escorts.set(9, { ...e, state: 'stopped', departed: 10, progress: 1500 });
    expect(contractSlip(st, c, null).next).toBe('Konvoj stojí – piráti nablízku');
  });
});

describe('escort target (M4d T9)', () => {
  it('the meeting point until the convoy departs, then the trader as it flies', () => {
    const st = state();
    const c = accepted(escortOffer, 9);
    expect(contractTarget(st, c)).toEqual(escortOffer.target.kind === 'escort' ? escortOffer.target.meet : null);
    st.convoys.escorts.set(9, { progress: 400, state: 'waiting', departed: null, away: 0, stopUntil: 0, fired: 0, hulls: [ESCORT.traderHull] });
    expect(contractTarget(st, c)).toEqual({ x: 400, y: 0 });
    st.convoys.escorts.set(9, { progress: 900, state: 'moving', departed: 5, away: 0, stopUntil: 0, fired: 0, hulls: [ESCORT.traderHull] });
    const a = contractTarget(st, c)!;
    st.convoys.escorts.get(9)!.progress = 1400;
    const b = contractTarget(st, c)!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(100);
    // an offer (no serial) always shows the meeting point
    expect(contractTarget(st, escortOffer)).toEqual({ x: 400, y: 0 });
  });
});

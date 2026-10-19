// M4d T9: GuildUi – the toasts of the link, the escort and the relay chain (contractFailed with the
// escort texts, a refusal with the values, no toast for the player's own unlink), the memoised view
// models (the same object while nothing changed) and the trade window only while linked.
import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n/locale';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { besideTrader, linkedTo } from '../../sim/convoys/convoyTesting';
import { departureTick } from '../../sim/convoys/schedule';
import type { SimState } from '../../sim/Simulation';
import { GuildUi } from './guildUi';

const SEED = 3;

function ui(state: () => SimState): { ui: GuildUi; sent: GameActionInput[] } {
  const sent: GameActionInput[] = [];
  return { ui: new GuildUi({ state, send: (a) => sent.push(a) }), sent };
}

describe('GuildUi toasts', () => {
  setLocale('sk');
  const sim = besideTrader(SEED, 'cv:A@2', departureTick('A', 2) + 3600, 30);
  const { ui: g } = ui(() => sim.state);

  it('a failed escort says why', () => {
    expect(g.toast(sim.state, [{ type: 'contractFailed', contractId: 1, reason: 'traderLost' }])).toEqual({ text: tx().guild.escort.failed.traderLost, kind: 'error', seconds: 5 });
  });

  it('a refused link gives the values; the convoy ending the link is info; the player unlinking says nothing', () => {
    expect(g.toast(sim.state, [{ type: 'linkRejected', reason: 'tooFast', distance: 1, speed: 3.4 }])!.text).toBe(tx().guild.link.rejected.tooFast('3,4', '2,5'));
    expect(g.toast(sim.state, [{ type: 'convoyUnlinked', pass: 'cv:A@2', reason: 'turnaround' }])).toMatchObject({ kind: 'info', text: tx().guild.link.unlinked.turnaround });
    expect(g.toast(sim.state, [{ type: 'convoyUnlinked', pass: 'cv:A@2', reason: 'player' }])).toBeNull();
  });

  it('the most important event of a step wins', () => {
    const t = g.toast(sim.state, [
      { type: 'escortDeparted', serial: 1 },
      { type: 'escortAmbush', serial: 1, pos: { x: 0, y: 0 } },
    ]);
    expect(t!.text).toBe(tx().guild.toasts.escortAmbush);
  });
});

describe('GuildUi view models', () => {
  it('the trade window only while linked, the same object while nothing changed', () => {
    const sim = linkedTo(SEED, 'A', 2, 60);
    const { ui: g, sent } = ui(() => sim.state);
    const a = g.trade(sim.state);
    expect(a).not.toBeNull();
    expect(g.trade(sim.state)).toBe(a);
    sim.state.credits += 100;
    const b = g.trade(sim.state);
    expect(b).not.toBe(a);
    expect(b!.credits).toBe(a!.credits + 100);
    expect(g.linked(sim.state)).toBe(true);
    g.unlink();
    expect(sent).toEqual([{ type: 'convoyUnlink' }]);
    sim.state.convoys.link = null;
    expect(g.trade(sim.state)).toBeNull();
  });

  it('the link prompt marks the trade port in play; the status is null without Guild contracts', () => {
    const sim = besideTrader(SEED, 'cv:A@2', departureTick('A', 2) + 3600, 1);
    const { ui: g } = ui(() => sim.state);
    expect(g.prompt(sim.state)).toMatchObject({ kind: 'ok' });
    expect(g.portInPlay).toBe(true);
    expect(g.status(sim.state)).toBeNull();
    expect(g.radar(sim.state, 300)).toBe(g.radar(sim.state, 300));
    expect(g.radar(sim.state, 300).some((c) => c.kind === 'convoy')).toBe(true);
  });

  it('after an unlink the link prompt stays quiet beside the port for a few seconds, back once away and in again', () => {
    // the ship drifting on beside the port (matched velocity) `s` seconds after the unlink
    const t0 = departureTick('A', 2) + 3600;
    const beside = (s: number, gap = 1) => besideTrader(SEED, 'cv:A@2', t0 + Math.round(s * 60), gap).state;
    const { ui: g } = ui(() => beside(0));
    expect(g.prompt(beside(0))).not.toBeNull();
    g.onEvents([{ type: 'convoyUnlinked', pass: 'cv:A@2', reason: 'player' }]);
    expect(g.prompt(beside(0.1))).toBeNull();
    // the port is still in play: the station's readout stays hidden too
    expect(g.portInPlay).toBe(true);
    expect(g.prompt(beside(5))).toBeNull();
    expect(g.prompt(beside(6.2))).toMatchObject({ kind: 'ok' });
    // flown off right after the unlink: the prompt is back on the next approach
    g.onEvents([{ type: 'convoyUnlinked', pass: 'cv:A@2', reason: 'player' }]);
    expect(g.prompt(beside(7))).toBeNull();
    expect(g.prompt(beside(8, 200))).toBeNull();
    expect(g.prompt(beside(9))).toMatchObject({ kind: 'ok' });
  });

  it('flight marks: the nearest open convoy', () => {
    const sim = besideTrader(SEED, 'cv:A@2', departureTick('A', 2) + 3600, 300);
    const { ui: g } = ui(() => sim.state);
    const marks = g.navMarks(sim.state);
    expect(marks.filter((m) => m.mark.kind === 'convoy')).toHaveLength(1);
    expect(marks[0]!.mark.key).toBe('convoy:cv:A@2');
  });
});

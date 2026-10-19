// M4d T0: the hooks of "Guild and Trade" are in place and change nothing yet – the new state exists, the new
// commands answer "unavailable" until their tasks fill them, and an escort may be rolled only near a lane.
import { describe, expect, it } from 'vitest';
import { IDLE_COMMAND, type GameActionInput, type GameAction } from './commands';
import { boardContext } from './contracts/board';
import { escortAvailable } from './convoys';
import { sectorLanes } from './regions';
import { Simulation } from './Simulation';
import { homeStation, stationsInArea } from './world/stations';

const COMMANDS: GameActionInput[] = [
  { type: 'convoyBuy', slot: 0 },
  { type: 'convoySell', resource: 'iron', qty: 10 },
  { type: 'convoyFuel', amount: 'full' },
  { type: 'convoyUnlink' },
  // debugGuild 'secure' answers since T2 (guild/relayChain.test.ts)
];

describe('M4d hooks (T0)', () => {
  it('a new game has an empty Guild, convoy and navigation state', () => {
    const sim = new Simulation({ seed: 3 });
    expect(sim.state.guild).toEqual({ relays: new Map(), hold: null, watch: [], lost: new Map(), lastRadio: -1e9 });
    expect(sim.state.convoys).toEqual({ trades: new Map(), link: null, escorts: new Map() });
    expect(sim.state.navigation).toEqual({ notes: [], nextNote: 1 });
  });

  it('answers every new command "unavailable", docked and in flight', () => {
    for (const startDocked of [true, false]) {
      const sim = new Simulation({ seed: 3, startDocked });
      COMMANDS.forEach((cmd, i) => {
        const events = sim.step({ ...IDLE_COMMAND, actions: [{ ...cmd, reqId: i + 1 } as GameAction] });
        // the convoy trade (T5) needs a link to a convoy trader
        const reason = cmd.type.startsWith('convoy') ? 'notLinked' : 'serviceUnavailable';
        expect(events.find((e) => e.type === 'actionResult'), cmd.type).toEqual({ type: 'actionResult', reqId: i + 1, ok: false, reason });
      });
      expect(sim.state.navigation.notes).toEqual([]);
    }
  });

  it('an escort can be rolled only at stations near a Guild Lane', () => {
    const sim = new Simulation({ seed: 3 });
    const lanes = sectorLanes(3);
    expect(lanes.length).toBe(2);
    expect(escortAvailable(boardContext(sim.state, homeStation()))).toBe(true);
    const far = stationsInArea(3, -40, 40, -40, 40).filter((s) => !escortAvailable(boardContext(sim.state, s)));
    expect(far.length).toBeGreaterThan(0);
  });
});

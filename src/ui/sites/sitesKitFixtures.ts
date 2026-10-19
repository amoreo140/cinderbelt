// UI-kit fixtures of the M4b event chips and the derelict terminal (plan T9): every chip state and a
// terminal for each service, the hold full and a used one. Texts go through tx() so the kit section
// switches language; the game layer (T7) builds the real view models from the state.
import { RECIPES } from '../../data/economy';
import type { PartKey } from '../../data/parts';
import type { Cargo } from '../../data/resources';
import type { DerelictTerminalData, EventChipItem, FabOption } from '../../game/sites/types';
import { tx } from '../../i18n';
import type { JournalText } from '../../i18n/skJournal';
import { formatInt } from '../format';

const names = () => tx().world.events.names;

/** Every chip state, one per row in the kit. */
export function kitChips(): { label: string; chips: EventChipItem[] }[] {
  const n = names();
  const comet = tx().world.comet.name(3);
  return [
    {
      label: "Micrometeors - warning (8 s), a stream from 4-5 o'clock",
      chips: [{ key: 'm1', kind: 'micrometeors', title: n.micrometeors, secondsLeft: 6, dirDeg: 135, tone: 'warn', pending: true }],
    },
    {
      label: 'Micrometeors - in progress',
      chips: [{ key: 'm2', kind: 'micrometeors', title: n.micrometeors, secondsLeft: 27, dirDeg: 300, tone: 'warn', pending: false }],
    },
    {
      label: "Ambush - contacts at 5 o'clock",
      chips: [{ key: 'a1', kind: 'ambush', title: n.ambush, secondsLeft: 4, dirDeg: 150, tone: 'danger', pending: true }],
    },
    {
      label: 'Ambush - no timer (direction to the leader)',
      chips: [{ key: 'a2', kind: 'ambush', title: n.ambush, secondsLeft: null, dirDeg: 212, tone: 'danger', pending: false }],
    },
    {
      label: 'Ion storm',
      chips: [{ key: 's1', kind: 'ionStorm', title: n.ionStorm, secondsLeft: 94, dirDeg: null, tone: 'warn', pending: false }],
    },
    {
      label: 'Comet flyby - ETA',
      chips: [{ key: 'c1', kind: 'cometFlyby', title: comet, secondsLeft: 168, dirDeg: 40, tone: 'info', pending: true }],
    },
    {
      label: 'Distress signal',
      chips: [{ key: 'd1', kind: 'distress', title: n.distress, secondsLeft: 412, dirDeg: 290, tone: 'info', pending: false }],
    },
  ];
}

/** Two chips as the HUD stacks them (storm + one more). */
export function kitChipStack(): EventChipItem[] {
  const n = names();
  return [
    { key: 'a2', kind: 'ambush', title: n.ambush, secondsLeft: null, dirDeg: 150, tone: 'danger', pending: false },
    { key: 'm2', kind: 'micrometeors', title: n.micrometeors, secondsLeft: 21, dirDeg: 300, tone: 'warn', pending: false },
    { key: 's1', kind: 'ionStorm', title: n.ionStorm, secondsLeft: 94, dirDeg: null, tone: 'warn', pending: false },
  ];
}

/** A derelict log: the model's journal entry once T4 has it, else a stand-in entry. */
function logText(model: 'a' | 'b' | 'c' | 'd'): string {
  const d = tx().journal as unknown as Record<string, JournalText | undefined>;
  return d[`derelictLog_${model}`]?.text ?? tx().journal.wrecks.text;
}

const stationName = (adjective: number, noun: number) => `${tx().world.derelict.name} ${tx().sectors.generated(adjective, noun)}`;

function partLabel(key: PartKey): string {
  const [part, tier, variant] = key.split(':') as [keyof ReturnType<typeof tx>['parts'], string, string | undefined];
  const v = variant ? ` – ${tx().discovery.variants[variant as keyof ReturnType<typeof tx>['discovery']['variants']]}` : '';
  return `${tx().parts[part]}${v} T${tier}`;
}

function fab(key: PartKey, short?: Partial<Cargo>): FabOption {
  const materials = { ...RECIPES[key].resources };
  const missing = short
    ? Object.entries(short)
        .map(([id, n]) => `${formatInt(n ?? 0)} ${tx().resources[id as keyof Cargo].toLowerCase()}`)
        .join(', ')
    : null;
  return { key, label: partLabel(key), materials, ...(missing ? { reason: tx().crafting.missing(missing) } : {}) };
}

/** The terminal in each state, with the kit's label. */
export function kitTerminals(): { label: string; d: DerelictTerminalData }[] {
  const tt = tx().world.derelict.terminal;
  const holdFull = tx().actionErrors.holdFull;
  return [
    {
      label: 'Parts stash - first visit (80 D + log)',
      d: {
        id: 'dl:4,-2',
        name: stationName(1, 4),
        model: 'a',
        service: 'stash',
        log: logText('a'),
        data: 80,
        items: [
          { index: 0, label: partLabel('reactor:2'), key: 'reactor:2', taken: false },
          { index: 1, label: partLabel('engine:2:overdrive'), key: 'engine:2:overdrive', taken: false },
          { index: 2, label: partLabel('shield:1'), key: 'shield:1', taken: true },
        ],
        fabricator: null,
        holdFree: 46,
      },
    },
    {
      label: 'Plan archive - second visit (data and log already taken)',
      d: {
        id: 'dl:6,1',
        name: stationName(3, 8),
        model: 'b',
        service: 'plan',
        log: null,
        data: null,
        items: [{ index: 0, label: tt.planItem(2, partLabel('cannon:1:rapid').replace(/ T1$/, '')), taken: false }],
        fabricator: null,
        holdFree: 25,
      },
    },
    {
      label: 'Fabricator - material from the cargo, the missing one in amber',
      d: {
        id: 'dl:-5,3',
        name: stationName(6, 10),
        model: 'c',
        service: 'fabricator',
        log: logText('c'),
        data: 80,
        items: [{ index: 0, label: tt.fabricateItem, taken: false }],
        fabricator: [fab('engine:1'), fab('armor:1'), fab('cannon:1'), fab('shield:2', { titanium: 8 }), fab('reactor:2', { titanium: 14, copper: 6 })],
        holdFree: 36,
      },
    },
    {
      label: 'Full parts hold',
      d: {
        id: 'dl:2,7',
        name: stationName(0, 2),
        model: 'd',
        service: 'stash',
        log: null,
        data: null,
        items: [
          { index: 0, label: partLabel('cannon:2'), key: 'cannon:2', taken: true },
          { index: 1, label: partLabel('radar:2'), key: 'radar:2', taken: false, reason: holdFull },
          { index: 2, label: partLabel('battery:1'), key: 'battery:1', taken: false, reason: holdFull },
        ],
        fabricator: null,
        holdFree: 4,
      },
    },
    {
      label: 'Exhausted service',
      d: {
        id: 'dl:-1,-6',
        name: stationName(5, 6),
        model: 'c',
        service: 'fabricator',
        log: null,
        data: null,
        items: [{ index: 0, label: tt.fabricateItem, taken: true }],
        fabricator: null,
        holdFree: 30,
      },
    },
  ];
}

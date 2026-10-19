// UI-kit fixtures of M4d "Guild and trade" (plan T11): the convoy trade window in every item state, the
// Guild status chips (escort, relay stages), the relay and escort board slips, the radar's Guild glyphs and
// the flight navigation marks. Texts go through tx() so the kit section switches language; the game layer
// (T9) builds the real view models from the state – these only stand in for them.
import { CONVOY } from '../../data/convoys';
import { RING_RESOURCE_MULT } from '../../data/economy';
import type { PartKey } from '../../data/parts';
import type { ConvoyTradeData, ConvoyTradeItem } from '../../game/convoys/types';
import type { GuildStatusData } from '../../game/guild/types';
import { escortDepositOf, relayMaterials, type SlipData } from '../../game/board/slipView';
import { partLabel } from '../../game/board/names';
import type { EventChipItem } from '../../game/sites/types';
import { tx } from '../../i18n';
import { emblemPath } from '../../data/factions';
import { formatCredits, formatPercent } from '../format';

const tt = () => tx().guild.trade;

const planName = (part: 'miningLaser' | 'engine', variant: 'focused' | 'eco') => `${tx().parts[part]} – ${tx().discovery.variants[variant]}`;

function fragment(state: ConvoyTradeItem['state'], price: number, missing = 0): ConvoyTradeItem {
  return {
    slot: 0,
    title: tt().items.fragment(planName('miningLaser', 'focused')),
    detail: tt().items.fragments(2, 3),
    price,
    state,
    reason: state === 'noCredits' ? tt().reasons.noCredits(formatCredits(missing)) : state === 'sold' ? tt().reasons.sold : null,
  };
}

function part(slot: number, key: PartKey, detail: string, state: ConvoyTradeItem['state'], price: number, missing = 0): ConvoyTradeItem {
  return {
    slot,
    title: partLabel(key),
    detail,
    price,
    state,
    reason: state === 'noCredits' ? tt().reasons.noCredits(formatCredits(missing)) : state === 'holdFull' ? tt().reasons.holdFull : state === 'sold' ? tt().reasons.sold : null,
    part: key,
  };
}

const sellUnit = (base: number, ring: 1 | 2 | 3, r: 'iron' | 'copper' | 'ice' | 'titanium') => Math.floor(CONVOY.sellMult * base * RING_RESOURCE_MULT[ring][r] * 0.8 * 100) / 100;

/** The trade window states of the kit (label, data). */
export function kitTrades(): { id: string; label: string; d: ConvoyTradeData }[] {
  const traders = tx().guild.convoy.traders;
  return [
    {
      id: 'open',
      label: 'Ring 2, tanker, everything for sale (refined Fe)',
      d: {
        pass: 'cv:A@12',
        trader: tx().guild.convoy.trader(traders[0]!),
        ring: 2,
        credits: 6240,
        items: [
          fragment('buyable', CONVOY.fragmentPrice[2]),
          part(1, 'armor:2:light', tt().items.variant, 'buyable', 3960),
          part(2, 'engine:2:eco', tt().items.variant, 'buyable', 3420),
        ],
        sell: [
          { resource: 'iron', unit: sellUnit(2.6, 2, 'iron'), max: 120, refined: 40 },
          { resource: 'copper', unit: sellUnit(3.6, 2, 'copper'), max: 30, refined: 0 },
          { resource: 'ice', unit: sellUnit(1.6, 2, 'ice'), max: 22.4, refined: 0 },
        ],
        capLeft: 200,
        fuel: { unit: 3.3, max: 48.6, reason: null },
      },
    },
    {
      id: 'states',
      label: 'Item states: sold · missing credits · parts hold full; the convoy still takes 35 u',
      d: {
        pass: 'cv:B@7',
        trader: tx().guild.convoy.trader(traders[3]!),
        ring: 1,
        credits: 940,
        items: [
          fragment('sold', CONVOY.fragmentPrice[1]),
          part(1, 'cargo:1:armored', tt().items.variant, 'holdFull', 860),
          part(2, 'gyro:2', tt().items.t2, 'noCredits', 2520, 2520 - 940),
        ],
        sell: [
          { resource: 'titanium', unit: sellUnit(8, 1, 'titanium'), max: 8, refined: 8 },
          { resource: 'iron', unit: sellUnit(2.6, 1, 'iron'), max: 35, refined: 0 },
        ],
        capLeft: 35,
        fuel: { unit: 2.4, max: 6, reason: null },
      },
    },
    {
      id: 'closedTank',
      label: 'No tanker, the convoy takes no more, everything sold',
      d: {
        pass: 'cv:A@13',
        trader: tx().guild.convoy.trader(traders[6]!),
        ring: 3,
        credits: 18400,
        items: [fragment('sold', CONVOY.fragmentPrice[3]), part(1, 'cannon:2:longBarrel', tt().items.variant, 'sold', 5180), part(2, 'radar:2:survey', tt().items.variant, 'sold', 4210)],
        sell: [{ resource: 'copper', unit: sellUnit(3.6, 3, 'copper'), max: 0, refined: 0 }],
        capLeft: 0,
        fuel: null,
      },
    },
    {
      id: 'tankFull',
      label: 'Empty cargo, tank full',
      d: {
        pass: 'cv:B@8',
        trader: tx().guild.convoy.trader(traders[1]!),
        ring: 2,
        credits: 3100,
        items: [fragment('buyable', CONVOY.fragmentPrice[2]), part(1, 'reactor:2:buffer', tt().items.variant, 'buyable', 2860)],
        sell: [],
        capLeft: 200,
        fuel: { unit: 3.3, max: 0, reason: tt().reasons.tankFull },
      },
    },
  ];
}

/** The Guild status chip states of the kit. */
export function kitGuildStatus(): { label: string; d: GuildStatusData }[] {
  const e = tx().guild.escort;
  const r = tx().guild.relay;
  return [
    { label: 'Escort - waiting at the meeting point', d: { escort: { hull: [1, 1], state: 'waiting', distance: 1240, next: e.next.waiting }, relay: null } },
    { label: 'Escort - under way (trader only)', d: { escort: { hull: [0.92], state: 'moving', distance: 86, next: e.next.follow }, relay: null } },
    { label: 'Escort - stopped, pirates, damaged convoy', d: { escort: { hull: [0.42, 0.18], state: 'stopped', distance: 210, next: e.next.stopped }, relay: null } },
    { label: 'Escort - arrived', d: { escort: { hull: [0.55, 0.8], state: 'done', distance: 40, next: e.next.done }, relay: null } },
    { label: 'Relay - damaged (repair)', d: { escort: null, relay: { lane: 'A', stage: 'broken', hint: r.hints.repair(relayMaterials()) } } },
    { label: 'Relay - repaired (power)', d: { escort: null, relay: { lane: 'A', stage: 'repaired', hint: r.hints.power } } },
    { label: 'Relay - powered (defence)', d: { escort: null, relay: { lane: 'B', stage: 'powered', hint: r.hints.hold } } },
    { label: 'Relay - secured', d: { escort: null, relay: { lane: 'B', stage: 'secured', hint: r.hints.secured('Quiet Threshold') } } },
  ];
}

/** The convoy flyby event chip (M4d derived event). */
export function kitConvoyChip(): EventChipItem {
  return { key: 'cv', kind: 'convoyFlyby', title: tx().world.events.names.convoyFlyby, secondsLeft: 104, dirDeg: 250, tone: 'info', pending: true };
}

function slipBase(type: 'relay' | 'escort'): Omit<SlipData, 'key' | 'title' | 'state' | 'next' | 'progress' | 'reward' | 'rewardNote' | 'risk' | 'minutes'> {
  return {
    serial: null,
    offerId: `kit-${type}`,
    type,
    typeName: tx().goals.contractTypes[type],
    faction: 'guild',
    factionName: tx().goals.factionShort.guild,
    emblem: emblemPath('guild'),
    why: '',
    rep: type === 'relay' ? 48 : 30,
    part: null,
    short: false,
    ring: 2,
    modifiers: [],
    target: null,
  };
}

/** The relay and escort slips of the kit: offers and active contracts. */
export function kitSlips(): { label: string; d: SlipData }[] {
  const p = tx().goals;
  const sector = 'Quiet Threshold';
  const reward = 2400;
  const deposit = escortDepositOf(reward);
  const depositNote = tx().guild.escort.deposit(formatPercent(10), formatCredits(deposit));
  return [
    {
      label: 'Guild relay - offer',
      d: { ...slipBase('relay'), key: 'r0', title: p.task.relay(sector), state: 'offer', next: null, progress: null, reward: 3150, rewardNote: tx().guild.relay.slipNote, risk: 2, minutes: 14, lane: 'A', accept: { enabled: true } },
    },
    {
      label: 'Guild relay - accepted, defence',
      d: { ...slipBase('relay'), key: 'r1', serial: 4, title: p.task.relay(sector), state: 'active', next: tx().guild.relay.hints.hold, progress: { value: 2, max: 3 }, reward: 3150, rewardNote: tx().guild.relay.slipNote, risk: 2, minutes: 14, lane: 'A' },
    },
    {
      label: 'Escort - offer with a deposit',
      d: { ...slipBase('escort'), key: 'e0', title: p.task.escort('B'), state: 'offer', next: null, progress: null, reward, rewardNote: depositNote, risk: 2, minutes: 11, lane: 'B', deposit, ambushes: 2, accept: { enabled: true } },
    },
    {
      label: 'Escort - accepted, under way',
      d: { ...slipBase('escort'), key: 'e1', serial: 5, title: p.task.escort('B'), state: 'active', next: tx().guild.escort.next.follow, progress: { value: 1400, max: 2800 }, reward, rewardNote: depositNote, risk: 1, minutes: 9, lane: 'B', deposit, ambushes: 1 },
    },
  ];
}

// English texts: pirates and salvage (tractor beam, attention, toll, fortress, wrecks). Same keys as skPirates.ts (PiratesTexts).
import type { TractorFailReason, TractorReleaseReason } from '../sim/salvage/types';
import type { PiratesTexts } from './skPirates';

import { enPlural as plural } from './plural';

const ROMAN = ['I', 'II', 'III', 'IV'] as const;

export const enPirates = {
  fortressName: (index: number): string => `Rust Fortress ${ROMAN[index] ?? String(index + 1)}`,
  beaconName: 'Pirate beacon',
  resonator: 'Resonator',
  container: 'Container',
  piece: 'Cut-off piece',
  scavenger: 'Scavenger',
  gunner: 'Gunner',
  sentry: 'Sentry drone',

  prompts: {
    container: 'F – load the container',
    containerApproach: (gap: string): string => `Container – fly closer (${gap} u)`,
    hulk: (parts: number): string => `The wreck has ${parts} ${plural(parts, 'part', 'parts')} – cut a joint with the laser or rip a part out with the beam (T)`,
    beacon: 'F – challenge the clan to a duel',
    beaconBusy: 'The clan is on its way – the beacon waits',
    beaconCooldown: (min: number): string => `The beacon is silent – again in ${min} min`,
  },

  tractor: {
    label: 'Tractor beam',
    holding: (what: string): string => `Towing: ${what}`,
    ripping: (pct: number): string => `Ripping out part ${pct}%`,
    release: 'release',
    idle: 'grab under the cursor',
  },

  callout: {
    hulk: 'Salvageable wreck',
    joints: (n: number, intact: number): string => `${n} ${plural(n, 'joint', 'joints')} · ${intact} ${plural(intact, 'valuable part', 'valuable parts')}`,
    jointsUnknown: 'Scan the wreck – it shows joints and valuable parts',
    cutting: (pct: number): string => `Cutting joint ${pct}%`,
    cut: 'Laser the joint',
    rip: 'Rip out',
    load: 'Load',
    tow: 'Tow',
    pieceParts: (n: number): string => `${n} ${plural(n, 'valuable part', 'valuable parts')}`,
    pieceScrap: 'Scrap only',
    container: 'Cargo under a tarp',
    fortressShield: (gens: number): string => `The core shield is held by ${gens} ${plural(gens, 'generator', 'generators')} behind the rock`,
    fortressCore: (pct: number): string => `Core ${pct}%`,
    fortressDown: (min: number): string => `Destroyed – rebuilt in ${min} min`,
    beacon: 'Call a clan captain to a duel',
    challenge: 'Challenge',
  },

  attention: {
    label: 'Rust',
    levels: ['Calm', 'Watched', 'Hunted', 'Raid'] as const,
    hint: (value: number): string => `Pirate attention ${value}/100 – rises with cargo and combat, falls over time`,
    raid: (where: string, time: string): string => `Raid: ${where} in ${time}`,
    challenge: (time: string): string => `Duel at the beacon in ${time}`,
    raidHere: (where: string): string => `Raid under way: ${where}`,
    nearYou: 'near you',
  },

  toll: {
    title: 'The Rust demands a toll',
    amount: (credits: string): string => `${credits}`,
    pay: 'Pay',
    refuse: 'Refuse',
    escape: (distance: number): string => `or fly ${distance} u away`,
    noMoney: 'Not enough credits',
  },

  fortress: {
    core: 'Core',
    shield: 'Shield',
    gens: 'Generators',
    turrets: 'Turrets',
    shielded: 'shielded',
    open: 'exposed',
  },

  reticle: (covering: number, total: number): string => `${covering}/${total} ${plural(total, 'cannon', 'cannons')} on target`,

  map: {
    fortress: 'Fortress',
    beacon: 'Clan beacon',
    raid: 'Raid',
  },

  toasts: {
    tractorLocked: 'Tractor beam locked on',
    tractorRip: 'The beam is ripping a part out of the wreck…',
    tractorReleased: {
      manual: 'Tractor beam released',
      range: 'The object slipped out of the beam’s range',
      energy: 'The beam ran out of energy',
      lost: 'The beam lost its target',
      loaded: 'Loaded – the beam is free',
      stolen: 'A scavenger stole your towed cargo!',
    } satisfies Record<TractorReleaseReason, string>,
    tractorFailed: {
      noTractor: 'The ship has no tractor beam (a crafted part)',
      noTarget: 'Nothing to tow under the cursor',
      tooHeavy: 'Too heavy for the tractor beam',
      joint: 'This is a joint – it holds the wreck together, cut it with the laser',
      energy: 'Not enough energy for the tractor beam',
    } satisfies Record<TractorFailReason, string>,
    wreckCut: (pieces: number): string => `Joint cut – ${pieces} ${plural(pieces, 'piece', 'pieces')} broke loose`,
    wreckCutBlast: 'Explosion! You cut into a tank or a reactor',
    partRipped: 'Part ripped out – the beam is pulling it to the ship',
    salvageBlocked: 'The wreck is too big – cut it into pieces',
    containerLoaded: (list: string): string => `From the container: ${list}`,
    containerFull: (list: string): string => `From the container: ${list} – the hold is full, the rest stayed in the container`,
    containerNothing: 'The hold is full – the contents stayed in the container',
    scavengerStole: 'A scavenger stole the loot – it is loaded, catch it',
    attention: [
      'The pirates have left you alone',
      'The Rust has noticed you – more pirates, better loot',
      'The Rust is after you – a hunting party with a captain',
      'The Rust is preparing a raid',
    ] as const,
    huntingParty: (captain: string | null): string =>
      captain ? `A hunting party led by captain ${captain} is looking for you` : 'A Rust hunting party is looking for you',
    raidAnnounced: (where: string, min: number): string => `The Rust attacks ${where} in ${min} min – a war chest awaits`,
    challengeIssued: (min: number): string => `Challenge accepted – a Rust captain comes to the beacon in ${min} min`,
    challengeRefused: { raidActive: 'The clan is on its way – the beacon waits', cooldown: 'The beacon is silent, the clan is still recovering' } as const,
    raidArrived: 'The raiders are here!',
    raidDefeated: (credits: string): string => `Raid repelled – a war chest of ${credits} and containers`,
    raidEnded: 'The raiders have left',
    tollDemanded: (credits: string): string => `Pirates demand a toll of ${credits}`,
    tollPaid: (credits: string): string => `Toll paid (${credits}) – they let you go`,
    tollRefused: 'Toll refused – they attack!',
    tollTimeout: 'They did not wait – they attack!',
    tollEscaped: 'You escaped the toll collectors',
    tollNoMoney: 'You do not have enough credits for the toll',
    fortressPart: { turret: 'Fortress turret destroyed', generator: 'Shield generator destroyed' } as const,
    fortressShieldDown: 'The core shield is down – attack the core!',
    fortressReinforcements: (n: number): string => `${n} ${plural(n, 'jackal', 'jackals')} launched from the fortress hangar`,
    fortressDestroyed: (credits: string): string => `The fortress has fallen! Reward ${credits} and the war chest`,
    fortressRebuilt: 'The Rust has rebuilt the fortress',
    resonator: 'Key item: Resonator (from the fortress core)',
  },

  help: ['T – tractor beam (grab / release)', 'Y / X – pay / refuse the toll'],
} satisfies PiratesTexts;

// Slovak texts of M3.6 "Fortress" (tractor beam, salvage, scavenger, pirate attention, toll, clan
// challenge, raids and the Rust fortress). A separate module next to sk.ts, skGoals.ts and skDiscovery.ts.
import type { TractorFailReason, TractorReleaseReason } from '../sim/salvage/types';

const ROMAN = ['I', 'II', 'III', 'IV'] as const;
import { skPlural as plural } from './plural';

export interface PiratesTexts {
  /** Fortress name by index (0 → "Rusty Fortress I"). */
  fortressName: (index: number) => string;
  beaconName: string;
  resonator: string;
  container: string;
  piece: string;
  scavenger: string;
  /** M4b enemy kinds: the long-range Gunner and a derelict's sentry drone. */
  gunner: string;
  sentry: string;
  // --- salvage prompts (F) ---
  prompts: {
    container: string;
    containerApproach: (gap: string) => string;
    hulk: (parts: number) => string;
    beacon: string;
    beaconBusy: string;
    beaconCooldown: (min: number) => string;
  };
  // --- tractor beam status (console) ---
  tractor: {
    label: string;
    holding: (what: string) => string;
    ripping: (pct: number) => string;
    release: string;
    idle: string;
  };
  // --- callouts ---
  callout: {
    hulk: string;
    joints: (n: number, intact: number) => string;
    jointsUnknown: string;
    cutting: (pct: number) => string;
    cut: string;
    rip: string;
    load: string;
    tow: string;
    pieceParts: (n: number) => string;
    pieceScrap: string;
    container: string;
    fortressShield: (gens: number) => string;
    fortressCore: (pct: number) => string;
    fortressDown: (min: number) => string;
    beacon: string;
    challenge: string;
  };
  // --- pirate attention (HUD) ---
  attention: {
    label: string;
    levels: readonly [string, string, string, string];
    hint: (value: number) => string;
    raid: (where: string, time: string) => string;
    challenge: (time: string) => string;
    raidHere: (where: string) => string;
    nearYou: string;
  };
  // --- toll ---
  toll: {
    title: string;
    amount: (credits: string) => string;
    pay: string;
    refuse: string;
    escape: (distance: number) => string;
    noMoney: string;
  };
  // --- fortress band ---
  fortress: {
    core: string;
    shield: string;
    gens: string;
    turrets: string;
    shielded: string;
    open: string;
  };
  // --- cannons reticle ---
  reticle: (covering: number, total: number) => string;
  // --- map ---
  map: {
    fortress: string;
    beacon: string;
    raid: string;
  };
  // --- toasts ---
  toasts: {
    tractorLocked: string;
    tractorRip: string;
    tractorReleased: Record<TractorReleaseReason, string>;
    tractorFailed: Record<TractorFailReason, string>;
    wreckCut: (pieces: number) => string;
    wreckCutBlast: string;
    partRipped: string;
    salvageBlocked: string;
    containerLoaded: (list: string) => string;
    containerFull: (list: string) => string;
    containerNothing: string;
    scavengerStole: string;
    attention: readonly [string, string, string, string];
    huntingParty: (captain: string | null) => string;
    raidAnnounced: (where: string, min: number) => string;
    challengeIssued: (min: number) => string;
    challengeRefused: {
      raidActive: string;
      cooldown: string;
    };
    raidArrived: string;
    raidDefeated: (credits: string) => string;
    raidEnded: string;
    tollDemanded: (credits: string) => string;
    tollPaid: (credits: string) => string;
    tollRefused: string;
    tollTimeout: string;
    tollEscaped: string;
    tollNoMoney: string;
    fortressPart: {
      turret: string;
      generator: string;
    };
    fortressShieldDown: string;
    fortressReinforcements: (n: number) => string;
    fortressDestroyed: (credits: string) => string;
    fortressRebuilt: string;
    resonator: string;
  };
  // --- help lines (K) ---
  help: readonly string[];
}

export const skPirates = {
  fortressName: (index: number): string => `Hrdzavá pevnosť ${ROMAN[index] ?? String(index + 1)}`,
  beaconName: 'Pirátsky maják',
  resonator: 'Rezonátor',
  container: 'Kontajner',
  piece: 'Odrezaný kus',
  scavenger: 'Zberač',
  gunner: 'Delostrelec',
  sentry: 'Strážny dron',

  prompts: {
    container: 'F – naložiť kontajner',
    containerApproach: (gap: string): string => `Kontajner – prileť bližšie (${gap} j)`,
    hulk: (parts: number): string => `Vrak má ${parts} ${plural(parts, 'diel', 'diely', 'dielov')} – rozrež spoj laserom alebo vytrhni diel lúčom (T)`,
    beacon: 'F – vyzvať klan na súboj',
    beaconBusy: 'Klan už letí – maják čaká',
    beaconCooldown: (min: number): string => `Maják mlčí – znova o ${min} min`,
  },

  tractor: {
    label: 'Vlečný lúč',
    holding: (what: string): string => `Ťahá: ${what}`,
    ripping: (pct: number): string => `Vytŕha diel ${pct} %`,
    release: 'pustiť',
    idle: 'zachytiť pod kurzorom',
  },

  callout: {
    hulk: 'Rozoberateľný vrak',
    joints: (n: number, intact: number): string => `${n} ${plural(n, 'spoj', 'spoje', 'spojov')} · ${intact} ${plural(intact, 'cenný diel', 'cenné diely', 'cenných dielov')}`,
    jointsUnknown: 'Naskenuj vrak – ukáže spoje a cenné diely',
    cutting: (pct: number): string => `Rez spoja ${pct} %`,
    cut: 'Laser na spoj',
    rip: 'Vytrhnúť',
    load: 'Naložiť',
    tow: 'Vliecť',
    pieceParts: (n: number): string => `${n} ${plural(n, 'cenný diel', 'cenné diely', 'cenných dielov')}`,
    pieceScrap: 'Len šrot',
    container: 'Náklad pod plachtou',
    fortressShield: (gens: number): string => `Štít jadra drží ${gens} ${plural(gens, 'generátor', 'generátory', 'generátorov')} za skalou`,
    fortressCore: (pct: number): string => `Jadro ${pct} %`,
    fortressDown: (min: number): string => `Zničená – obnoví sa o ${min} min`,
    beacon: 'Výzva klanu: kapitán príde na súboj',
    challenge: 'Vyzvať',
  },

  attention: {
    label: 'Hrdza',
    levels: ['Pokoj', 'Sledujú ťa', 'Lovia ťa', 'Nájazd'] as const,
    hint: (value: number): string => `Pozornosť pirátov ${value}/100 – rastie s nákladom a bojom, časom klesá`,
    raid: (where: string, time: string): string => `Nájazd: ${where} o ${time}`,
    challenge: (time: string): string => `Súboj pri majáku o ${time}`,
    raidHere: (where: string): string => `Nájazd prebieha: ${where}`,
    nearYou: 'pri tebe',
  },

  toll: {
    title: 'Klan Hrdze žiada mýto',
    amount: (credits: string): string => `${credits}`,
    pay: 'Zaplatiť',
    refuse: 'Odmietnuť',
    escape: (distance: number): string => `alebo uleť ${distance} j`,
    noMoney: 'Nemáš dosť kreditov',
  },

  fortress: {
    core: 'Jadro',
    shield: 'Štít',
    gens: 'Generátory',
    turrets: 'Veže',
    shielded: 'chránené',
    open: 'odkryté',
  },

  reticle: (covering: number, total: number): string => `${covering}/${total} ${plural(total, 'kanón', 'kanóny', 'kanónov')} zasiahne cieľ`,

  map: {
    fortress: 'Pevnosť',
    beacon: 'Maják klanu',
    raid: 'Nájazd',
  },

  toasts: {
    tractorLocked: 'Vlečný lúč zachytil objekt',
    tractorRip: 'Lúč trhá diel z vraku…',
    tractorReleased: {
      manual: 'Vlečný lúč pustený',
      range: 'Objekt sa vytrhol z dosahu lúča',
      energy: 'Lúču došla energia',
      lost: 'Lúč stratil cieľ',
      loaded: 'Naložené – lúč voľný',
      stolen: 'Zberač ti ukradol vlečený náklad!',
    } satisfies Record<TractorReleaseReason, string>,
    tractorFailed: {
      noTractor: 'Loď nemá vlečný lúč (diel z výroby)',
      noTarget: 'Pod kurzorom nie je nič na vlečenie',
      tooHeavy: 'Príliš ťažké pre vlečný lúč',
      joint: 'Toto je spoj – drží vrak pokope, prerež ho laserom',
      energy: 'Nedostatok energie na vlečný lúč',
    } satisfies Record<TractorFailReason, string>,
    wreckCut: (pieces: number): string => `Spoj prerezaný – ${pieces} ${plural(pieces, 'kus sa uvoľnil', 'kusy sa uvoľnili', 'kusov sa uvoľnilo')}`,
    wreckCutBlast: 'Výbuch! Prerezal si nádrž alebo reaktor',
    partRipped: 'Diel vytrhnutý – lúč ho ťahá k lodi',
    salvageBlocked: 'Vrak je príliš veľký – rozrež ho na kusy',
    containerLoaded: (list: string): string => `Z kontajnera: ${list}`,
    containerFull: (list: string): string => `Z kontajnera: ${list} – náklad je plný, zvyšok ostal v kontajneri`,
    containerNothing: 'Náklad je plný – obsah ostal v kontajneri',
    scavengerStole: 'Zberač ukradol korisť – je naložený, dobehni ho',
    attention: ['Piráti ťa nechali na pokoji', 'Hrdza si ťa všíma – viac pirátov, lepšia korisť', 'Hrdza po tebe ide – lovecká skupina s kapitánom', 'Hrdza chystá nájazd'] as const,
    huntingParty: (captain: string | null): string => (captain ? `Lovecká skupina kapitána ${captain} ťa hľadá` : 'Lovecká skupina Hrdze ťa hľadá'),
    raidAnnounced: (where: string, min: number): string => `Nájazd Hrdze o ${min} min: ${where} – vojnová pokladnica čaká`,
    challengeIssued: (min: number): string => `Výzva prijatá – kapitán Hrdze príde k majáku o ${min} min`,
    challengeRefused: { raidActive: 'Klan už letí – maják čaká', cooldown: 'Maják mlčí, klan sa ešte spamätáva' } as const,
    raidArrived: 'Nájazdníci sú tu!',
    raidDefeated: (credits: string): string => `Nájazd odrazený – vojnová pokladnica ${credits} a kontajnery`,
    raidEnded: 'Nájazdníci odleteli',
    tollDemanded: (credits: string): string => `Piráti žiadajú mýto ${credits}`,
    tollPaid: (credits: string): string => `Mýto zaplatené (${credits}) – nechajú ťa ísť`,
    tollRefused: 'Mýto odmietnuté – útočia!',
    tollTimeout: 'Nečakali – útočia!',
    tollEscaped: 'Unikol si pred mýtnikmi',
    tollNoMoney: 'Na mýto nemáš dosť kreditov',
    fortressPart: { turret: 'Veža pevnosti zničená', generator: 'Generátor štítu zničený' } as const,
    fortressShieldDown: 'Štít jadra padol – útoč na jadro!',
    fortressReinforcements: (n: number): string => `Z hangára pevnosti vyleteli ${n} ${plural(n, 'šakal', 'šakali', 'šakalov')}`,
    fortressDestroyed: (credits: string): string => `Pevnosť padla! Odmena ${credits} a vojnová pokladnica`,
    fortressRebuilt: 'Hrdza obnovila pevnosť',
    resonator: 'Kľúčový predmet: Rezonátor (z jadra pevnosti)',
  },

  help: ['T – vlečný lúč (zachytiť / pustiť)', 'Y / X – zaplatiť / odmietnuť mýto'],
} satisfies PiratesTexts;

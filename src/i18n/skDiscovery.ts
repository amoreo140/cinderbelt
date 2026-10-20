// Texts of M3.5b "Objavy" (Discovery: scanner, signals, places, Data, Archive, blueprints, journal,
// Atlas, Echoes, map). A separate module next to sk.ts and skGoals.ts. The journal content (entries)
// is in data/journal.ts.
import type { ArchiveBranch, ArchiveNodeId } from '../data/archive';
import type { AtlasCollection } from '../data/atlas';
import type { DistressKind } from '../data/events';
import type { AnomalyType, BuffKind, WreckClass } from '../data/poi';
import type { VariantId } from '../data/variants';
import type { ArchiveBlock } from '../sim/discovery/archive';
import type { ScanKind, SignalKind } from '../sim/discovery/types';
import { skDocking } from './skDocking';

import { skPlural as plural } from './plural';

/** Archive nodes with a one-line effect text. */
export type ArchiveEffectId = 'battery' | 'heavyLaser' | 'largeCargo' | 'fuelTankPlus' | 'slingPlus' | 'cannonRapid' | 'shieldQuick' | 'instituteLicense' | 'echoDecoder' | 'dockingComputer' | 'templates' | 'templates20' | 'hangarPlus' | 'veinAnalyzer' | 'tractorPlus' | 'refinery' | 'largeReactor' | 'repairModule' | 'mapNotes';

export interface DiscoveryTexts {
  variants: Record<VariantId, string>;
  /** The variant's trade-off in one sentence. */
  variantTradeoff: Record<VariantId, string>;
  variant: string;
  plan: string;
  /** Name of an Echo beacon: "Ozvena-0". */
  echoName: (index: number) => string;
  scanKinds: Record<ScanKind, string>;
  signalKinds: Record<SignalKind, string>;
  anomalies: Record<AnomalyType, string>;
  wreckClasses: Record<WreckClass, string>;
  distressKinds: Record<DistressKind, string>;
  buffs: Record<BuffKind, string>;
  buffEffect: Record<BuffKind, string>;
  callout: {
    analyze: string;
    open: string;
    help: string;
    analyzing: (pct: number) => string;
    unscanned: string;
    fragment: string;
    noFragment: string;
    shell: (pct: number) => string;
    core: string;
    anomalyBoon: (buff: string) => string;
    echo: string;
    echoDeep: string;
    trap: string;
  };
  prompts: {
    cache: string;
    fuel: (n: number) => string;
    repair: (n: number) => string;
  };
  toasts: {
    pulse: (n: number) => string;
    pulseEmpty: string;
    cooldown: (s: number) => string;
    energy: string;
    noTarget: string;
    analysed: (what: string, d: number) => string;
    analysedNoData: (what: string) => string;
    analysedAgain: (what: string) => string;
    cacheLocated: string;
    cacheOpened: (kr: string) => string;
    echoHeard: (i: number, n: number) => string;
    echoLocated: (i: number) => string;
    fragment: (name: string, n: number) => string;
    planDone: (name: string) => string;
    fragmentDuplicate: (name: string) => string;
    keyItem: (name: string) => string;
    journal: (title: string) => string;
    buff: (name: string, effect: string, s: number) => string;
    giantBroken: string;
    distress: string;
    distressDone: (kr: string) => string;
    ambush: string;
    needFuel: string;
    needIron: (n: number) => string;
    atlas: (name: string, d: number) => string;
    /** A sector became Charted by flight (sectors §4.1): its name and the flat Data. */
    sectorCharted: (name: string, d: number) => string;
    storm: string;
    stormOver: string;
  };
  journalUi: {
    title: string;
    tabs: {
      knowledge: string;
      atlas: string;
      log: string;
      manual: string;
    };
    close: string;
    legendMore: string;
    legendUnknown: string;
    legendLead: string;
    leads: string;
    empty: string;
    noLog: string;
    plans: string;
    keyItems: string;
    none: string;
    training: string;
    kinds: {
      place: string;
      topic: string;
      observation: string;
    };
    /** Story chapters of the knowledge graph. */
    chapters: readonly [string, string];
    /** Lines of the Log tab. */
    logEntry: {
      analysed: (what: string) => string;
      echoLocated: (echo: string) => string;
      journal: (title: string) => string;
      planDone: (part: string) => string;
      archive: (node: string) => string;
    };
  };
  /** Story objective (Objectives → Echoes). */
  story: {
    locate0: string;
    locate0Why: string;
    analyse: (i: number) => string;
    analyseWhy: string;
    decoder: string;
    decoderWhy: string;
    listen: (i: number) => string;
    listen1Why: string;
    listen2Why: string;
    shard: string;
    shardWhy: string;
  };
  archiveUi: {
    license: string;
    levelShort: (n: number) => string;
  };
  map: {
    layers: {
      stations: string;
      signals: string;
      places: string;
      contracts: string;
      fields: string;
      sectors: string;
      convoys: string;
      notes: string;
    };
    layersLabel: string;
    legend: string;
    targets: string;
    zoomIn: string;
    zoomOut: string;
    recenter: string;
    hint: string;
    /** The "you are here" label next to my ship (and at the edge arrow when it is out of view). */
    youAreHere: string;
    legendShip: string;
    legendTarget: string;
    legendDepleted: string;
    legendRich: string;
    /** Under the legend while ore grade labels are hidden (zoomed out). */
    gradeZoomHint: string;
  };
  scanner: {
    title: string;
    pulse: string;
    ready: string;
    charging: (s: number) => string;
    analyzing: string;
    hint: string;
  };
  data: string;
  /** An Institute contract pays in Data too. */
  slipData: (d: number) => string;
  dataUnit: string;
  archive: {
    tab: string;
    branches: Record<ArchiveBranch, string>;
    nodes: Record<ArchiveNodeId, string>;
    /** One-line effect of the nodes that have one (the rest show none). */
    effects: Record<ArchiveEffectId, string> & Partial<Record<ArchiveNodeId, string>>;
    level: (n: number) => string;
    key: string;
    threshold: (n: string) => string;
    cost: (data: string) => string;
    unlock: string;
    owned: string;
    hidden: string;
    blocks: Record<ArchiveBlock, string>;
    soon: (ms: string) => string;
    fund: string;
    total: string;
    fundHint: string;
    plans: string;
    fragments: (n: number, of: number) => string;
    planDone: string;
    keyItems: string;
    shard: string;
    unlocked: (name: string) => string;
    lockedPart: (node: string) => string;
    lockedPlan: (plan: string) => string;
  };
  /** Journal → Manual (every hint is here too). */
  manual: readonly {
    title: string;
    text: string;
  }[];
  atlas: {
    collections: Record<AtlasCollection, string>;
    reward: (d: number) => string;
    done: string;
    unknown: string;
  };
  /** Radar legend (readability pass R7): pinned while "?" is held and on hovering the radar. */
  radarLegend: {
    title: string;
    /** The grammar in one line: filled = ships, hollow = objects. */
    rule: string;
    hover: string;
    shipAttacking: string;
    shipHostile: string;
    shipNeutral: string;
    station: string;
    rock: string;
    richRock: string;
    signal: string;
    place: string;
    wreck: string;
    pirateBase: string;
    survey: string;
  };
  /** Edge arrows to the scanner pulse's finds (R6). */
  scanFinds: {
    /** Rich rock: ore symbol and grade ("Cu 145 %"). */
    rich: (symbol: string, grade: string) => string;
  };
}

export const skDiscovery = {
  variants: {
    overdrive: 'pretlakový',
    eco: 'úsporný',
    rapid: 'rýchlopal',
    armored: 'pancierovaný',
    survey: 'merací',
    combat: 'bojový',
    scout: 'prieskumný',
    extended: 'veľká',
    quick: 'rýchle dobíjanie',
    focused: 'sústredený',
    light: 'ľahký',
    flywheel: 'zotrvačníkový',
    buffer: 'zásobníkový',
    longBarrel: 'dlhá hlaveň',
  } satisfies Record<VariantId, string>,
  variantTradeoff: {
    overdrive: 'Ťah ×1,4, spotreba paliva ×1,8',
    eco: 'Ťah ×0,8, spotreba paliva ×0,6',
    rapid: 'Kadencia ×2,5, poškodenie ×0,45',
    armored: 'Náklad ×0,7, HP ×2',
    survey: 'Dosah radaru ×1,5, HP ×0,6',
    combat: 'HP ×1,6, rozpočet trupu −4 b',
    scout: 'Radar +60 %, pulz skenera −30 %, HP ×0,8',
    extended: 'Palivo ×1,5, HP ×0,7',
    quick: 'Dobíjanie ×1,8, kapacita ×0,7',
    focused: 'Ťažba ×1,35, energia ×1,5',
    light: 'HP ×0,6, hmotnosť ×0,5',
    flywheel: 'Krútiaci moment ×1,6, hmotnosť ×1,75',
    buffer: 'Energia ×0,6, batéria ×3',
    longBarrel: 'Dolet ×1,4, kadencia ×0,5, poškodenie ×1,5',
  } satisfies Record<VariantId, string>,
  variant: 'Variant',
  plan: 'Plán',
  echoName: (index: number): string => `Ozvena-${index}`,

  scanKinds: {
    wreck: 'Vrak',
    anomaly: 'Anomália',
    giant: 'Obrí asteroid',
    cache: 'Úkryt',
    echo: 'Ozvena Kováčov',
    distress: 'Núdzový signál',
    asteroid: 'Asteroid',
    derelict: 'Opustená stanica',
    relay: 'Relé',
    comet: 'Kométa',
    graveyard: 'Cintorín lodí',
  } satisfies Record<ScanKind, string>,
  signalKinds: {
    wreck: 'Kovový objekt',
    anomaly: 'Anomália',
    giant: 'Veľká hmota',
    cache: 'Slabý odraz',
    echo: 'Pravidelný tón',
    distress: 'Núdzové volanie',
    derelict: 'Mŕtva konštrukcia',
    graveyard: 'Pole kovových ozvien',
    comet: 'Rýchly ľadový odraz',
  } satisfies Record<SignalKind, string>,
  anomalies: { gravity: 'Gravitačná', ion: 'Iónová', radiation: 'Radiačná', time: 'Časová ozvena' } satisfies Record<AnomalyType, string>,
  wreckClasses: { miner: 'Ťažiar', freighter: 'Nákladná loď', pirate: 'Pirátska loď' } satisfies Record<WreckClass, string>,
  distressKinds: {
    fuel: 'Uviaznutý ťažiar – došlo mu palivo',
    repair: 'Poškodená loď – potrebuje železo na opravu',
    trap: 'Uviaznutý ťažiar – došlo mu palivo',
  } satisfies Record<DistressKind, string>,
  buffs: {
    sling: 'Prak',
    charge: 'Iónový náboj',
    irradiated: 'Ožiarenie',
    echo: 'Ozvena času',
  } satisfies Record<BuffKind, string>,
  buffEffect: {
    sling: 'ťah ×1,5',
    charge: 'energia ×2,5',
    irradiated: 'dosah pulzu ×1,5',
    echo: 'lasery sa neprehrievajú, pulz ×2 rýchlejšie',
  } satisfies Record<BuffKind, string>,

  callout: {
    analyze: 'analyzovať',
    open: 'otvoriť',
    help: 'pomôcť',
    analyzing: (pct: number): string => `Analýza ${pct} %`,
    unscanned: 'Neznámy obsah',
    fragment: '◈ Fragment plánu na palube',
    noFragment: 'Bez fragmentu',
    shell: (pct: number): string => `Škrupina ${pct} % – ťažký laser alebo kanón`,
    core: 'Jadro odkryté – ťaž ho',
    anomalyBoon: (buff: string): string => `Prelet jadrom: ${buff}`,
    echo: 'Maják Kováčov',
    echoDeep: 'Maják Kováčov – druhá vrstva signálu',
    trap: 'Nesúlad signatúry – pasca',
  },
  prompts: {
    cache: 'F – otvoriť úkryt',
    fuel: (n: number): string => `F – odovzdať ${n} j paliva`,
    repair: (n: number): string => `F – odovzdať ${n} železa na opravu`,
  },
  toasts: {
    pulse: (n: number): string => `Pulz: ${n} ${plural(n, 'signál', 'signály', 'signálov')} – pozri radar a mapu (M)`,
    pulseEmpty: 'Pulz: v dosahu nič',
    cooldown: (s: number): string => `Skener sa nabíja – ${s} s`,
    energy: 'Skener: málo energie',
    noTarget: 'Nič na analýzu v dosahu radaru – namier kurzor na objekt',
    analysed: (what: string, d: number): string => `Analýza: ${what} +${d} D`,
    analysedNoData: (what: string): string => `Analýza: ${what}`,
    analysedAgain: (what: string): string => `${what}: už analyzované`,
    cacheLocated: 'Úkryt zameraný (+20 D) – F pri ňom ho otvorí',
    cacheOpened: (kr: string): string => `Úkryt otvorený: ${kr} a suroviny`,
    echoHeard: (i: number, n: number): string => `Ozvena-${i}: zachytená z ${n}/3 miest – presuň sa a pulzuj znova`,
    echoLocated: (i: number): string => `Ozvena-${i} zameraná – je na mape`,
    fragment: (name: string, n: number): string => `Fragment plánu ${name}: ${n}/3`,
    planDone: (name: string): string => `Plán hotový: ${name} – vyrobíš ho vo Výrobe`,
    fragmentDuplicate: (name: string): string => `${name}: plán už máš – fragment za 30 D`,
    keyItem: (name: string): string => `Kľúčový predmet: ${name}`,
    journal: (title: string): string => `Denník: ${title} (J)`,
    buff: (name: string, effect: string, s: number): string => `${name}: ${effect}, ${s} s`,
    giantBroken: 'Škrupina praskla – jadro sa dá ťažiť',
    distress: 'Núdzové volanie v dosahu – pozri radar',
    distressDone: (kr: string): string => `Pomoc doručená: ${kr}, Cech si to pamätá`,
    ambush: 'Pasca – piráti!',
    needFuel: 'Nemáš dosť paliva na odovzdanie',
    needIron: (n: number): string => `Treba ${n} železa v náklade`,
    atlas: (name: string, d: number): string => (d > 0 ? `Atlas: ${name} kompletné +${d} D` : `Atlas: ${name} kompletné`),
    sectorCharted: (name: string, d: number): string => (d > 0 ? `Sektor zmapovaný: ${name} · +${d} D` : `Sektor zmapovaný: ${name}`),
    storm: 'Iónová búrka – štít vypadol, radar slepne',
    stormOver: 'Búrka prešla',
  },
  journalUi: {
    title: 'Denník',
    tabs: { knowledge: 'Vedomosti', atlas: 'Atlas', log: 'Záznamy', manual: 'Príručka' },
    close: 'J – zavrieť',
    legendMore: 'tu je ešte niečo',
    legendUnknown: 'neznáme',
    legendLead: 'indícia',
    leads: 'Vedie k',
    empty: 'Denník je zatiaľ prázdny. Ťukni Tab – pulz skenera zachytí, čo radar nevidí.',
    noLog: 'Zatiaľ nič. Objavy sa zapisujú sem.',
    plans: 'Plány',
    keyItems: 'Kľúčové predmety',
    none: 'Žiadne',
    training: 'Výcvik Cechu',
    kinds: { place: 'Miesto', topic: 'Téma', observation: 'Pozorovanie' },
    chapters: ['Kapitola 0 · Signál', 'Kapitola 1 · Hrdza'],
    logEntry: {
      analysed: (what: string): string => `Analyzované: ${what}`,
      echoLocated: (echo: string): string => `${echo} zameraná`,
      journal: (title: string): string => `Denník: ${title}`,
      planDone: (part: string): string => `Plán hotový: ${part}`,
      archive: (node: string): string => `Archív: ${node}`,
    },
  },
  story: {
    locate0: 'Zameraj Ozvenu-0: pulz (Tab) z troch rôznych miest',
    locate0Why: 'Tón pri domove nikto nezameral. Z jedného miesta poznáš len smer.',
    analyse: (i: number): string => `Analyzuj Ozvenu-${i} – podrž Tab pri majáku`,
    analyseWhy: 'Maják Kováčov je starší než čokoľvek tu. Inštitút platí 100 Dát.',
    decoder: 'Archív (7): odomkni Frekvencie Kováčov',
    decoderWhy: 'V signáli Ozveny-0 je druhá vrstva – bez dekódera ju skener nepočuje.',
    listen: (i: number): string => `Pulzuj ďalej od domova – hľadaj Ozvenu-${i}`,
    listen1Why: 'Ozvena-0 mieri von, k Vonkajším pásom.',
    listen2Why: 'S úlomkom na palube sa ozve aj maják, ktorý mlčal.',
    shard: 'Získaj žiariaci úlomok – piráti a ich úkryty',
    shardWhy: 'Ozvena-1 zosilnie pri kryštáloch Kováčov. Hrdza ich zbiera.',
  },
  archiveUi: {
    license: 'Licencia',
    levelShort: (n: number): string => `Ú${n}`,
  },
  map: {
    layers: { stations: 'Stanice', signals: 'Signály skenera', places: 'Objavené miesta', contracts: 'Ciele a kontrakty', fields: 'Asteroidové polia', sectors: 'Sektory', convoys: 'Konvoje a Cech', notes: 'Značky' },
    layersLabel: 'Vrstvy',
    legend: 'Legenda mapy',
    targets: 'Ciele',
    zoomIn: 'Priblížiť',
    zoomOut: 'Oddialiť',
    recenter: 'Na loď',
    hint: 'Koliesko priblíži, ťahaním posunieš. Tmavé = ešte nepreskúmané.',
    youAreHere: 'Tu si',
    legendShip: 'Tvoja loď',
    legendTarget: 'Cieľ',
    legendDepleted: 'vyťažené',
    legendRich: 'bohatá ruda',
    gradeZoomHint: 'Kvalitu rudy (%) uvidíš po priblížení.',
  },
  scanner: {
    title: 'Skener',
    pulse: 'pulz',
    ready: 'Pripravený',
    charging: (s: number): string => `${s} s`,
    analyzing: 'Analýza',
    hint: 'Tab – pulz, podrž – analýza',
  },
  data: 'Dáta',
  slipData: (d: number): string => `+ ${d} D pre Archív`,
  dataUnit: 'D',

  archive: {
    tab: 'Archív',
    branches: {
      mining: 'Ťažba',
      construction: 'Konštrukcia',
      navigation: 'Pohon a navigácia',
      combat: 'Boj',
      logistics: 'Logistika a základne',
    } satisfies Record<ArchiveBranch, string>,
    nodes: {
      veinAnalyzer: 'Analyzátor žíl',
      battery: 'Batéria',
      heavyLaser: 'Ťažký laser 2×1',
      refinery: 'Palubná rafinéria',
      miningDrones: 'Ťažobné drony',
      crystalMetallurgy: 'Kryštálová metalurgia (T3)',
      exoticMetallurgy: 'Exotická metalurgia (T4)',
      resonantLaser: 'Rezonančný laser',
      templates: 'Šablóny lodí',
      largeCargo: 'Veľký nákladný priestor 2×2',
      largeReactor: 'Veľký reaktor 2×2',
      repairModule: 'Opravárenský modul',
      testTrackPlus: 'Skúšobná dráha+',
      hangarPlus: 'Hangár +2',
      kovaciArmor: 'Pancier Kováčov',
      templates20: 'Šablóny 20 slotov',
      fuelTankPlus: 'Palivová nádrž+',
      mapNotes: 'Značky na mape',
      cruiseDrive: 'Cestovný pohon 2×1',
      slingPlus: 'Prak+',
      shielding: 'Tienenie',
      deepScanner: 'Skener hlbín',
      warpStabilizer: 'Warpový stabilizátor',
      jumpBeacon: 'Skokový maják',
      cannonRapid: 'Kanón: rýchlopal',
      shieldQuick: 'Štít: rýchle dobíjanie',
      pointDefense: 'Bodová obrana',
      missiles: 'Raketomet',
      largeShield: 'Veľký štítový projektor',
      railgun: 'Railgun 3×1',
      kovaciBeam: 'Lúč Kováčov',
      swarmDefense: 'Rojová obrana',
      instituteLicense: 'Licencia na kontrakty Inštitútu',
      tractorPlus: 'Vlečný lúč+',
      landingModule: 'Výsadkový modul základne',
      cargoDrones: 'Nákladné drony',
      refineryModule: 'Rafinéria medziproduktov',
      outpost: 'Predsunutá základňa',
      orbitalDrop: 'Orbitálny vrh',
      riftBeacon: 'Trhlinový maják',
      echoDecoder: 'Frekvencie Kováčov',
      dockingComputer: skDocking.archive.name,
    } satisfies Record<ArchiveNodeId, string>,
    effects: {
      battery: 'Batéria v obchode a výrobe: +120 energie bez reaktora.',
      heavyLaser: 'Ťažký laser: ťažba ×2,4 za energiu ×1,8, láme škrupiny obrov.',
      largeCargo: 'Veľký náklad 2×2: 300 j za 3 b trupu.',
      fuelTankPlus: 'Variant nádrže: palivo ×1,5, HP ×0,7.',
      slingPlus: 'Prak gravitačnej anomálie trvá dvakrát dlhšie.',
      cannonRapid: 'Variant kanóna: kadencia ×2,5, poškodenie ×0,45.',
      shieldQuick: 'Variant štítu: dobíjanie ×1,8, kapacita ×0,7.',
      instituteLicense: 'Inštitút ponúkne Vyzdvihnutia – odmenou je fragment plánu.',
      echoDecoder: 'Skener počuje Ozveny, ktoré sú utopené v šume.',
      dockingComputer: skDocking.archive.effect,
      templates: 'Šablóny lodí: 5 uložených návrhov, stavba zo šablóny, export a import.',
      templates20: 'Šablóny lodí: 20 uložených návrhov.',
      hangarPlus: 'Hangár: najviac 4 sloty na odstavené lode namiesto 2.',
      veinAnalyzer: 'Rozbor rudy po pulze siaha na 2× dosah radaru; zloženie jadra kométy vidíš z rovnakej diaľky.',
      tractorPlus: 'Vlečný lúč: dosah ×1,5 a o 2 diely väčšie vraky.',
      refinery: 'Palubná rafinéria 2×1: za letu ľad na palivo, ruda na rafinovanú (+15\u00a0% pri predaji).',
      largeReactor: 'Veľký reaktor 2×2: energia 45/s a batéria 120, pri zničení vybuchne.',
      repairModule: 'Opravárenský modul: za letu opravuje susedný diel železom či titánom z nákladu.',
      mapNotes: 'Značky na mape: vlastné značky s krátkou poznámkou a ikonou; v lete ich ukážu šípky na okraji obrazovky.',
    },
    level: (n: number): string => `Úroveň ${n}`,
    key: 'Kľúčový uzol',
    threshold: (n: string): string => `prah ${n} D nazbieraných`,
    cost: (data: string): string => `${data} D`,
    unlock: 'Odomknúť',
    owned: 'Odomknuté',
    hidden: 'Skrytý uzol – nájdi ho v denníku',
    blocks: {
      owned: 'Už odomknuté',
      hidden: 'Skrytý uzol',
      future: 'Príde v neskoršej verzii',
      license: 'Vyžaduje licenciu Archívu (Inštitút 2)',
      prerequisite: 'Najprv odomkni uzol z nižšej úrovne vetvy',
      threshold: 'Ešte nemáš dosť nazbieraných Dát',
      data: 'Nedostatok Dát vo fonde',
      credits: 'Nedostatok kreditov',
    } satisfies Record<ArchiveBlock, string>,
    soon: (ms: string): string => `príde v ${ms}`,
    fund: 'Fond',
    total: 'Nazbierané',
    fundHint: 'Dáta sa nepredávajú ani nekupujú. Bežné uzly sa platia z fondu, kľúčové majú prah nazbieraných Dát.',
    plans: 'Plány a fragmenty',
    fragments: (n: number, of: number): string => `${n}/${of} ${plural(of, 'fragment', 'fragmenty', 'fragmentov')}`,
    planDone: 'Plán hotový – variant sa dá vyrobiť',
    keyItems: 'Kľúčové predmety',
    shard: 'Žiariaci úlomok Kováčov',
    unlocked: (name: string): string => `Archív: ${name} odomknuté`,
    lockedPart: (node: string): string => `Archív: ${node}`,
    lockedPlan: (plan: string): string => `Treba plán: ${plan}`,
  },

  manual: [
    { title: 'Pulz skenera (ťuknutie Tab)', text: 'Stojí 30 energie a nabíja sa 8 s. Zachytí signály do trojnásobku dosahu radaru: kovový objekt, anomália, slabý odraz úkrytu, tón Ozveny. Signál je kruh, kde niečo je – presne to uvidíš až zblízka.' },
    { title: 'Analýza (podržať Tab)', text: 'Namier kurzor na objekt v dosahu radaru a podrž Tab 2 s. Prvá analýza dá Dáta, záznam v denníku a pri vraku ukáže, či nesie fragment plánu.' },
    { title: 'Triangulácia', text: 'Úkryt ani vzdialenú Ozvenu nezameriaš z jedného miesta. Každý pulz z iného miesta (aspoň 120–150 j od predošlých) kruh neistoty zmenší. Úkryt otvoríš klávesom F.' },
    { title: 'Dáta a Archív', text: 'Dáta sa nepredávajú ani nekupujú – zbierajú sa skenmi a kontraktmi Inštitútu. V Archíve (záložka 5 v doku) za ne odomkneš diely a varianty. Kľúčové uzly majú prah nazbieraných Dát.' },
    { title: 'Plány a varianty', text: 'Tri fragmenty z vrakov a úkrytov dajú plán variantu dielu. Fragmenty sú kľúčové predmety – nestratia sa ani pri zničení lode.' },
    { title: 'Anomálie a obri', text: 'Prelet jadrom anomálie dá krátky bonus (raz za 5 min). Škrupinu obrieho asteroidu rozbije len ťažký laser alebo kanón – jadro potom ťaží každý laser rýchlejšie.' },
    { title: 'Núdzové signály', text: 'Lode v núdzi vysielajú samy. Pomoc (palivo alebo 20 železa) platí Cech. Pasca sa prezradí pri druhej analýze – nesúlad signatúry.' },
  ] as readonly { title: string; text: string }[],

  atlas: {
    collections: {
      asteroids: 'Typy asteroidov',
      anomalies: 'Anomálie',
      wrecks: 'Triedy vrakov',
      giants: 'Obrie asteroidy',
      echoes: 'Ozveny Kováčov',
      variants: 'Varianty dielov',
      captains: 'Menovaní kapitáni',
    } satisfies Record<AtlasCollection, string>,
    reward: (d: number): string => `Odmena ${d} D`,
    done: 'Kompletné',
    unknown: '?',
  },
  radarLegend: {
    title: 'Radar',
    rule: 'Plné = lode · duté = objekty',
    hover: 'Legenda radaru',
    shipAttacking: 'Útočí na teba',
    shipHostile: 'Nepriateľ, zatiaľ pokojný',
    shipNeutral: 'Loď v núdzi',
    station: 'Stanica (domov / stanica / základňa)',
    rock: 'Kameň vo farbe rudy',
    richRock: 'Bohatá ruda',
    signal: 'Signál – odhad polohy',
    place: 'Miesto objavu',
    wreck: 'Vrak s korisťou',
    pirateBase: 'Pirátska pevnosť, maják',
    survey: 'Merací bod (zameraný = zelený)',
  },
  scanFinds: {
    rich: (symbol: string, grade: string): string => `${symbol} ${grade}`,
  },
} as const satisfies DiscoveryTexts;


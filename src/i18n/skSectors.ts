// Slovak texts of the sectors (stage 1a): sector
// names (§2.7), security, threat and knowledge words (§0, §3.1, §3.3), the entry notice and the HUD
// badge (§5.2), the map layer (§5.1); stage 1b: environment names, the sector card (§5.1) and the radio
// lines on entering a sector (§3.1). `SectorsTexts` is the shape, enSectors.ts implements it in English.
//
// Generated names are an adjective (masculine / feminine / neuter forms) and a noun with its gender,
// 12 × 12; the simulation keeps only the two indexes (src/sim/regions/sectors.ts). Every combination
// agrees in gender – checked by skSectors.test.ts.
import type { LandmarkKind } from '../sim/world/landmarks';
import type { Knowledge, Security } from '../sim/regions/constants';
import type { Biome, Threat } from '../sim/regions/sectors';

export type SkGender = 'm' | 'f' | 'n';

/** A Slovak adjective in the nominative singular of each gender. */
export interface SkAdjective {
  m: string;
  f: string;
  n: string;
}

export interface SkNoun {
  word: string;
  gender: SkGender;
}

/** 12 adjectives (§2.7) – the same order as `EN_ADJECTIVES`. */
export const SK_ADJECTIVES: readonly SkAdjective[] = [
  { m: 'Tichý', f: 'Tichá', n: 'Tiché' },
  { m: 'Hrdzavý', f: 'Hrdzavá', n: 'Hrdzavé' },
  { m: 'Studený', f: 'Studená', n: 'Studené' },
  { m: 'Sivý', f: 'Sivá', n: 'Sivé' },
  { m: 'Dlhý', f: 'Dlhá', n: 'Dlhé' },
  { m: 'Zlomený', f: 'Zlomená', n: 'Zlomené' },
  { m: 'Strieborný', f: 'Strieborná', n: 'Strieborné' },
  { m: 'Temný', f: 'Temná', n: 'Temné' },
  { m: 'Prázdny', f: 'Prázdna', n: 'Prázdne' },
  { m: 'Ďaleký', f: 'Ďaleká', n: 'Ďaleké' },
  { m: 'Vlčí', f: 'Vlčia', n: 'Vlčie' },
  { m: 'Starý', f: 'Stará', n: 'Staré' },
];

/** 12 nouns with their gender (four of each) – the same order as `EN_NOUNS`. */
export const SK_NOUNS: readonly SkNoun[] = [
  { word: 'prah', gender: 'm' },
  { word: 'priesmyk', gender: 'm' },
  { word: 'záliv', gender: 'm' },
  { word: 'hrebeň', gender: 'm' },
  { word: 'zátoka', gender: 'f' },
  { word: 'hlbina', gender: 'f' },
  { word: 'trhlina', gender: 'f' },
  { word: 'plytčina', gender: 'f' },
  { word: 'údolie', gender: 'n' },
  { word: 'pobrežie', gender: 'n' },
  { word: 'rameno', gender: 'n' },
  { word: 'ústie', gender: 'n' },
];

/** Generated name of adjective × noun with the adjective in the noun's gender. */
export function skSectorName(adjective: number, noun: number): string {
  const a = SK_ADJECTIVES[((adjective % SK_ADJECTIVES.length) + SK_ADJECTIVES.length) % SK_ADJECTIVES.length]!;
  const n = SK_NOUNS[((noun % SK_NOUNS.length) + SK_NOUNS.length) % SK_NOUNS.length]!;
  return `${a[n.gender]} ${n.word}`;
}

export interface SectorsTexts {
  /** A generated name (§2.7): adjective index × noun index. */
  generated: (adjective: number, noun: number) => string;
  /** The home sector. */
  origin: string;
  /** The two pirate corners (§2.4): depth 1 and depth 2. */
  corner1: string;
  corner2: string;
  /** A fortress sector by the fortress's Roman numeral. */
  fortress: (numeral: string) => string;
  /** Sectors with a landmark, by kind; the n-th landmark of a kind takes the n-th name (then a numeral). */
  landmarks: Record<LandmarkKind, readonly string[]>;
  /** Security of a sector (agrees with "sektor"). */
  security: Record<Security, string>;
  /** Threat word (§3.1). */
  threat: Record<Threat, string>;
  /** "threat: nest" line of the HUD badge. */
  threatLine: (word: string) => string;
  /** Knowledge state (§3.3). */
  knowledge: Record<Knowledge, string>;
  /** Knowledge glyph `[x] [?] [ ]`. */
  glyph: Record<Knowledge, string>;
  /** Depth subtitle: "depth 2 · Outer belts" (the ring name lives on only here, §0). */
  depth: (depth: number, ring: string) => string;
  /** The entry notice (§5.2): ENTERING · name · SECURITY [?]. */
  entry: string;
  hud: {
    /** Accessible name of the HUD badge. */
    badge: string;
  };
  map: {
    /** The Guild Lane label on the map (only when zoomed out). */
    lane: (id: string) => string;
    legendLane: string;
  };
  /** Environment names (§0, §3.2 – never the word "belt"). */
  biome: Record<Biome, string>;
  /** The sector card on the map (§5.1, stage 1b). */
  card: {
    /** Name of a sector the player knows nothing about. */
    unknown: string;
    /** "You are here" tag of the ship's sector. */
    here: string;
    environment: string;
    stations: string;
    landmarks: string;
    /** Knowledge line: "[?] Reported · flown 35 %" (`coverage` null = not counted). */
    mapping: (glyph: string, word: string, coverage: number | null) => string;
    /** "Route home: 3 sectors · 4 200 u" (straight line from the sector). */
    route: (sectors: number, distance: string) => string;
    /** One risk on the route: "1× Pirate". */
    count: (n: number, word: string) => string;
    /** A sector on the route the player does not know yet. */
    unknownWord: string;
    /** The route crosses no dangerous (and no unknown) sector. */
    routeClear: string;
    /** The card of the home sector itself. */
    routeHome: string;
    /** Footer hint: click pins the card / releases it. */
    pin: string;
    unpin: string;
  };
  /** Survey points (§4.1, stage 2): the label in flight, the HUD badge, the toasts and the map legend. */
  survey: {
    /** Name of a survey point (callout title, legends). */
    point: string;
    /** Legend: a point the scanner already marked. */
    pointDone: string;
    /** Callout detail: the sector and how many of its points are marked. */
    detail: (sector: string, done: number, total: number) => string;
    /** Callout detail of a point farther than the pulse reaches. */
    approach: (range: string) => string;
    /** Callout action next to the Tab key. */
    pulse: string;
    /** Toast: a pulse marked a point – "Survey point 2/4 · Rust Threshold". */
    marked: (done: number, total: number, sector: string) => string;
    /** Toast: the sector is Charted and the Guild buys its chart. */
    chartedSell: (sector: string, data: number) => string;
    /** HUD badge: the label before the point dots. */
    badge: string;
  };
  /** Sector charts as a commodity (§4.2, §4.3, stage 2): the Cartography section of the Board, the card, the toasts. */
  charts: {
    /** Board view (Segmented). */
    tab: string;
    intro: string;
    sellTitle: string;
    sellNote: string;
    buyTitle: string;
    buyNote: string;
    /** What a chart never shows and that Data are not for sale. */
    never: string;
    emptySell: string;
    emptyBuy: string;
    sell: string;
    buy: string;
    sold: string;
    reserved: string;
    /** "6 200 u from the station". */
    distance: (d: string) => string;
    /** "survey points 4/4". */
    points: (done: number, total: number) => string;
    byFlight: string;
    /** What a bought chart reveals. */
    reveals: string;
    /** "+ 5 more charts farther away". */
    more: (n: number) => string;
    confirmSell: (sector: string) => string;
    confirmSellBody: (price: string) => string;
    confirmBuy: (sector: string) => string;
    confirmBuyBody: (price: string) => string;
    cancel: string;
    /** Toasts. */
    soldToast: (sector: string, credits: string) => string;
    boughtToast: (sector: string) => string;
    grantedToast: (sector: string) => string;
    /** The sector card (§5.1). */
    cardPoints: (done: number, total: number) => string;
    cardSell: (price: string) => string;
    cardToChart: (price: string) => string;
    cardSold: string;
    cardBought: string;
    cardGuild: (price: string) => string;
    cardReserved: string;
    /** Slip tag of the "First chart" offer and the reward note of a chart contract. */
    firstTag: string;
    includesSale: string;
    /** The objectives band in flight after the training (§6.6). */
    firstObjective: (sector: string) => string;
  };
  /** Guild Training step 8 (§6.6): callouts on the map while the checklist runs. */
  trainingMap: {
    originDetail: string;
    lane: string;
    laneDetail: string;
    reported: string;
    reportedDetail: string;
    cornerDetail: string;
    /** The step's reward also charts lane A's first sector (stage 2). */
    reward: (sector: string) => string;
  };
  /** Radio lines on entering a sector for the first time (§3.1). */
  radio: {
    /** The Guild Watch: name and role tag on the comm panel. */
    watch: string;
    watchRole: string;
    /** Guild Watch welcome in a Guarded sector. */
    welcome: readonly ((name: string) => string)[];
    /** Traffic control / the instructor warns about a Contested sector. */
    warnContested: readonly ((name: string) => string)[];
    warnContestedInstructor: readonly ((name: string) => string)[];
    /** … and about a Pirate sector. */
    warnPirate: readonly ((name: string) => string)[];
    warnPirateInstructor: readonly ((name: string) => string)[];
    /** A pirate on an open channel in a pirate nest (sometimes). */
    taunt: readonly ((name: string) => string)[];
  };
}

/** "1 sektor", "3 sektory", "5 sektorov". */
export function skSectorCount(n: number): string {
  if (n === 1) return '1 sektor';
  if (n >= 2 && n <= 4) return `${n} sektory`;
  return `${n} sektorov`;
}

export const skSectors: SectorsTexts = {
  generated: skSectorName,
  origin: 'Počiatok',
  corner1: 'Šakalí kút',
  corner2: 'Zbojnícky kút',
  fortress: (numeral: string): string => `Hrdzavé hniezdo ${numeral}`,
  landmarks: {
    gas_giant: ['Pri plynnom obrovi'],
    guild_relay: ['Pri stožiari'],
    rust_ring_shard: ['Pri úlomku', 'Lom prstenca', 'Úlomkový oblúk'],
    crystal_spire: ['Kryštálová stena', 'Pri kryštáli', 'Sklený hrebeň', 'Ihlová brána'],
    dead_forge: ['Vyhasnutá výheň', 'Popol Kováčov'],
  },
  security: { quiet: 'Pokojný', guarded: 'Strážený', contested: 'Sporný', pirate: 'Pirátsky' },
  threat: { none: 'žiadni piráti', rare: 'zriedka', often: 'často', nest: 'hniezdo' },
  threatLine: (word: string): string => `hrozba: ${word}`,
  knowledge: { charted: 'Zmapovaný', reported: 'Hlásený', uncharted: 'Nezmapovaný' },
  glyph: { charted: '[x]', reported: '[?]', uncharted: '[ ]' },
  depth: (depth: number, ring: string): string => `hĺbka ${depth} · ${ring}`,
  entry: 'Vstup',
  hud: { badge: 'Sektor' },
  map: {
    lane: (id: string): string => `Cechová cesta ${id}`,
    legendLane: 'Cechová cesta',
  },
  biome: {
    asteroidField: 'Asteroidové pole',
    iceField: 'Ľadové pole',
    quietSpace: 'Tichý priestor',
    rustField: 'Hrdzavé pole',
    ionFringe: 'Iónový lem',
    wreckField: 'Vrakovisko',
    titanPlateau: 'Titánová plošina',
    crystalNebula: 'Kryštálová hmlovina',
    cometPath: 'Kométová dráha',
    deepDark: 'Hlboká tma',
  },
  card: {
    unknown: 'Neznámy sektor',
    here: 'Si tu',
    environment: 'Prostredie',
    stations: 'Stanice',
    landmarks: 'Orientačné body',
    mapping: (glyph, word, coverage) => (coverage === null ? `${glyph} ${word}` : `${glyph} ${word} · preletené ${coverage} %`),
    route: (sectors, distance) => `Trasa domov: ${skSectorCount(sectors)} · ${distance}`,
    count: (n, word) => `${n}× ${word}`,
    unknownWord: 'neznámy',
    routeClear: 'bez nebezpečných sektorov',
    routeHome: 'Domovský sektor – stanica Cechu je tu.',
    pin: 'Klik kartu pripne',
    unpin: 'Pripnuté · klik uvoľní',
  },
  survey: {
    point: 'Merací bod',
    pointDone: 'Zameraný merací bod',
    detail: (sector, done, total) => `${sector} · zamerané ${done}/${total}`,
    approach: (range) => `Priblíž sa – pulz zameria bod do ${range}`,
    pulse: 'pulz',
    marked: (done, total, sector) => `Merací bod ${done}/${total} · ${sector}`,
    chartedSell: (sector, data) => (data > 0 ? `Sektor zmapovaný: ${sector} · +${data} D · mapu môžeš predať Cechu` : `Sektor zmapovaný: ${sector} · mapu môžeš predať Cechu`),
    badge: 'body',
  },
  charts: {
    tab: 'Kartografia',
    intro: 'Cech obchoduje s mapami sektorov – len za kredity.',
    sellTitle: 'Tvoje mapy · Cech kúpi',
    sellNote: 'Mapu sektora, ktorý si zmapoval sám (meracie body alebo prelet), Cech kúpi raz za hru.',
    buyTitle: 'Mapy Cechu na predaj',
    buyNote: 'Strážené sektory a sektory na cestách Cechu. Kúpená mapa nedá Dáta a nedá sa predať.',
    never: 'Mapa nikdy neukáže úkryty, Ozveny ani obsah vrakov. Dáta sa nedajú kúpiť ani predať.',
    emptySell: 'Zatiaľ nemáš mapu na predaj. Zmapuj sektor: leť k jeho meracím bodom a stlač Tab (pulz), alebo ho preleť zo 70 %.',
    emptyBuy: 'Cech už nemá mapu, ktorú by si nemal – všetky jeho sektory máš zmapované.',
    sell: 'Predať',
    buy: 'Kúpiť',
    sold: 'Predaná',
    reserved: 'Ku kontraktu',
    distance: (d) => `${d} od stanice`,
    points: (done, total) => `meracie body ${done}/${total}`,
    byFlight: 'zmapovaný preletom',
    reveals: 'Zmapuje sektor, objaví jeho stanice, susedov urobí Hlásenými.',
    more: (n) => `+ ${n} ${n === 1 ? 'ďalšia mapa' : n <= 4 ? 'ďalšie mapy' : 'ďalších máp'} ďalej od stanice`,
    confirmSell: (sector) => `Predať mapu sektora ${sector}?`,
    confirmSellBody: (price) => `Cech zaplatí ${price}. Mapu každého sektora predáš len raz – sektor ti ostane Zmapovaný.`,
    confirmBuy: (sector) => `Kúpiť mapu sektora ${sector}?`,
    confirmBuyBody: (price) => `Zaplatíš ${price}. Sektor bude Zmapovaný, jeho stanice objavené a susedia Hlásení. Nedá Dáta a neukáže úkryty, Ozveny ani vraky.`,
    cancel: 'Späť',
    soldToast: (sector, credits) => `Mapa predaná: ${sector} · +${credits}`,
    boughtToast: (sector) => `Mapa kúpená: ${sector} je Zmapovaný`,
    grantedToast: (sector) => `Cech ti dal mapu sektora ${sector} – je Zmapovaný`,
    cardPoints: (done, total) => `Meracie body ${done}/${total}`,
    cardSell: (price) => `Mapa: Cech kúpi za ${price}`,
    cardToChart: (price) => `Mapa: po zmapovaní ju Cech kúpi za ${price}`,
    cardSold: 'Mapa: predaná Cechu',
    cardBought: 'Mapa: kúpená od Cechu',
    cardGuild: (price) => `Mapa: Cech predáva za ${price}`,
    cardReserved: 'Mapa: patrí ku kontraktu Mapa',
    firstTag: 'Prvá mapa',
    includesSale: 'vrátane predaja mapy',
    firstObjective: (sector) => `Prvá mapa: zmapuj sektor ${sector} (meracie body, pulz Tab)`,
  },
  trainingMap: {
    originDetail: 'Domov – Zmapovaný sektor [x]: vidíš jeho stanice aj polia.',
    lane: 'Cechová cesta',
    laneDetail: 'Strážená trasa Cechu – najbezpečnejšia cesta von.',
    reported: 'Hlásený sektor',
    reportedDetail: 'Cech o ňom vie, mapu ešte nemáš.',
    cornerDetail: 'Tam bez kanóna nelietaj.',
    reward: (sector) => `mapa sektora ${sector}`,
  },
  radio: {
    watch: 'Stráž Cechu',
    watchRole: 'Cech',
    welcome: [
      (name) => `Vitaj v sektore ${name}. Stráž Cechu ťa má na radare, pilot.`,
      (name) => `Tu Stráž Cechu. Sektor ${name} je pod našou ochranou – leť pokojne.`,
      (name) => `Sektor ${name}, tu Stráž Cechu. Ak bude zle, volaj nás.`,
    ],
    warnContested: [
      (name) => `${name} je sporný sektor. Hrdza tu loví – drž zbrane a oči otvorené.`,
      (name) => `Pozor, pilot, vletel si do sektora ${name}. Stráž Cechu sem nechodí.`,
    ],
    warnContestedInstructor: [
      (name) => `Pilot, ${name} je sporný sektor – sem Stráž Cechu nedohliada. S cvičným trupom sa radšej vráť.`,
      (name) => `Toto je ${name}, sporné územie. Ak sa ukážu piráti, neváhaj a uteč k stanici.`,
    ],
    warnPirate: [
      (name) => `Pozor, ${name} je pirátsky sektor! Hrdza si ho drží – otoč to, ak nie si pripravený.`,
      (name) => `Pilot, si v sektore ${name}. To je hniezdo Hrdze. Odtiaľto ti nikto nepomôže.`,
    ],
    warnPirateInstructor: [
      (name) => `Stoj, pilot! ${name} je pirátsky sektor. Cvičný trup tu neprežije – okamžite sa otoč.`,
      (name) => `${name} patrí Hrdzi. Toto nie je cvičná trasa – vráť sa k Počiatku.`,
    ],
    taunt: [
      (name) => `Ďalší ťažiar v sektore ${name}? Výborne, sklady máme poloprázdne.`,
      (name) => `Vitaj v sektore ${name}, pilot. Odtiaľto sa platí za odchod.`,
      () => `Počujeme tvoj motor. Len pokračuj, čakáme ťa.`,
    ],
  },
};

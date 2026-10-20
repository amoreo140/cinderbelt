// Texts of M3.5a "Why" (Why: contracts, factions, local conditions, objectives, resume card, storage,
// courier, captains; the Guild Training has its own module skTraining.ts). A separate module next to
// sk.ts, so the dictionary can be read in parts.
import type { CaptainTrait } from '../data/captains';
import type { ContractType } from '../data/contracts';
import type { FactionId, RepUnlock } from '../data/factions';
import type { SectorModifierId } from '../data/sector';

import { skPlural as plural } from './plural';

/** Ship parts (`partId:tier`) with a "why" line in the objectives. */
export type ShipWhyKey = 'cargo:1' | 'miningLaser:1' | 'reactor:1' | 'fuelTank:1' | 'cannon:1' | 'shield:1' | 'miningLaser:2' | 'cockpit:2' | 'cargo:2' | 'engine:2';

export interface GoalsTexts {
  factions: Record<FactionId, string>;
  factionShort: Record<FactionId, string>;
  relations: {
    friendly: string;
    neutral: string;
    hostile: string;
  };
  repLevels: readonly [string, string, string, string];
  unlocks: Record<RepUnlock, string>;
  soon: (milestone: string) => string;
  contractTypes: Record<ContractType, string>;
  /** One sentence: what has to be done. */
  task: {
    delivery: (amount: string, res: string, station: string) => string;
    mining: (amount: string, res: string) => string;
    hunt: (n: number) => string;
    captain: (name: string) => string;
    rescue: (fuel: number) => string;
    survey: (n: number) => string;
    scan: (what: string) => string;
    retrieve: (part: string) => string;
    fortress: (name: string) => string;
    chart: (sector: string, points: number) => string;
    relay: (sector: string) => string;
    escort: (lane: string) => string;
  };
  /** Next step of an active contract. */
  next: {
    delivery: (have: string, amount: string, res: string, station: string) => string;
    deliveryReady: (station: string) => string;
    mining: (have: string, amount: string, res: string) => string;
    hunt: (done: number, total: number) => string;
    captain: (name: string) => string;
    rescue: (fuel: number) => string;
    survey: (done: number, total: number) => string;
    scan: (what: string) => string;
    retrieve: (part: string) => string;
    fortress: (name: string) => string;
    chart: (sector: string, done: number, total: number) => string;
    ready: string;
  };
  why: {
    delivery: string;
    mining: string;
    hunt: string;
    captain: string;
    revenge: string;
    rescue: string;
    survey: string;
    scan: string;
    retrieve: string;
    fortress: string;
    chart: string;
    /** The "First chart" offer after the Guild Training (sectors §4.3). */
    chartFirst: string;
    relay: string;
    escort: string;
  };
  /** What is being scanned (Slovak accusative case). */
  scanWhat: {
    wreck: string;
    anomaly: string;
    giant: string;
  };
  slip: {
    short: string;
    risk: readonly [string, string, string];
    reward: string;
    rep: (n: number) => string;
    duration: (min: number) => string;
    distance: (d: string) => string;
    /** Depth tag on a slip: "depth 2" (the old ring badge "P2"). */
    depth: (n: number) => string;
    accept: string;
    turnIn: string;
    abandon: string;
    giveUp: string;
    abandonFree: string;
    giveUpHint: string;
    full: string;
    ready: string;
    active: string;
    partBonus: (part: string) => string;
    bounty: (kr: string) => string;
    goods: (kr: string) => string;
    notHere: (station: string) => string;
    missing: (amount: string, res: string) => string;
    notReady: string;
  };
  board: {
    tab: string;
    views: {
      contracts: string;
      factions: string;
      wanted: string;
      charts: string;
    };
    active: string;
    offers: string;
    noActive: string;
    noOffers: string;
    refresh: (min: number) => string;
    recommended: string;
    recommendedWhy: { noRisk: string; short: string; bestPay: string };
    needs: (amount: string, res: string) => string;
    otherOffers: (min: number) => string;
    sector: string;
    calm: string;
    sectorChange: (min: number) => string;
    factions: string;
    level: (n: number, name: string) => string;
    points: (have: number, need: number) => string;
    maxLevel: string;
    assignment: string;
    or: string;
    unlocks: string;
    nextUnlocks: string;
    deliver: (amount: string, res: string) => string;
    wanted: string;
    wantedNote: string;
    trophies: string;
    noTrophies: string;
  };
  assignments: {
    contracts: (n: number, type: string) => string;
    contractsRing: (n: number, type: string, ring: number) => string;
    deliver: (amount: number, res: string) => string;
    scans: {
      anomaly: (n: number) => string;
      cache: (n: number) => string;
      echo: (n: number) => string;
    };
  };
  sector: {
    kinds: {
      warning: string;
      anomaly: string;
      market: string;
      event: string;
    };
    names: Record<SectorModifierId, string>;
    effects: Record<SectorModifierId, string>;
    demandOf: (res: string) => string;
    bonus: (pct: number) => string;
  };
  objectives: {
    title: string;
    scales: {
      now: string;
      today: string;
      week: string;
    };
    tracks: {
      training: string;
      contract: string;
      ship: string;
      career: string;
      main: string;
      story: string;
    };
    why: string;
    where: string;
    close: string;
    open: string;
    none: string;
    skipTraining: string;
    hereDocked: string;
    takeContract: string;
    takeContractWhy: string;
    mineAndSell: string;
    mineAndSellWhy: string;
    ship: (part: string) => string;
    shipMissing: (list: string) => string;
    shipReady: string;
    /** Why the next ship part matters, by `partId:tier` (parts without a line show none). */
    shipWhy: Record<ShipWhyKey, string> & Partial<Record<string, string>>;
    career: (faction: string, level: number, task: string) => string;
    careerPoints: (faction: string, level: number, need: number) => string;
    careerWhy: (unlock: string) => string;
    ring2: string;
    ring2Why: string;
    ring3: string;
    ring3Why: string;
    findStation: (name: string) => string;
    findStationWhy: string;
    distance: (d: string) => string;
  };
  resume: {
    title: string;
    played: (time: string) => string;
    lastActivity: string;
    docked: (station: string) => string;
    /** `where` = depth and its name of the sector the ship is in (station.ring). */
    flying: (where: string, station: string, d: string) => string;
    heading: (station: string) => string;
    cargo: (list: string) => string;
    emptyCargo: string;
    contracts: string;
    noContracts: string;
    next: string;
    journal: string;
    noJournal: string;
    continue: string;
  };
  log: {
    contractAccepted: (type: string, station: string) => string;
    contractCompleted: (type: string, station: string) => string;
    contractAbandoned: (type: string) => string;
    levelUp: (faction: string, level: number) => string;
    stationDiscovered: (station: string) => string;
    captainDefeated: (name: string) => string;
    captainPromoted: (name: string) => string;
    courierDelivered: (station: string) => string;
    firstDayStep: string;
    trainingStep: (step: string) => string;
    died: string;
    contractFailed: (type: string) => string;
    ago: (time: string) => string;
  };
  storages: {
    title: string;
    close: string;
    search: string;
    allRings: string;
    empty: string;
    noMatch: string;
    here: string;
    send: string;
    courier: string;
    courierLocked: string;
    to: string;
    items: string;
    fee: string;
    time: string;
    confirm: string;
    cancel: string;
    inTransit: string;
    eta: (time: string) => string;
    nothingSelected: string;
    noTarget: string;
    /** Ship rows (M4a): the active ship and the ships stored in station hangars. */
    ships: string;
    /** The active ship's tag and lamp label. */
    shipActive: string;
    /** Where the active ship is while it flies. */
    shipInFlight: string;
    /** A stored ship's lamp label: it stands in a hangar. */
    shipStored: string;
    /** Hull points of the design: "trup 31 b". */
    shipHull: (points: number) => string;
  };
  captains: {
    /** Captain nicknames (epithets) by the sim's index – exactly CAPTAIN_NICKNAME_COUNT, all different. */
    nicknames: readonly string[];
    /** Captain given names by the sim's index (CAPTAIN_NAMES order) – proper names are localised too. */
    names: readonly string[];
    name: (nick: string, name: string) => string;
    traits: Record<CaptainTrait, string>;
    level: (n: number) => string;
    bounty: string;
    replica: (parts: string) => string;
    killedYou: (n: number) => string;
    defeated: string;
    promoted: (name: string, level: number) => string;
    promotedReplica: (name: string, part: string) => string;
  };
  toasts: {
    accepted: (type: string) => string;
    ready: (type: string) => string;
    completed: (kr: string) => string;
    abandoned: string;
    buoy: (n: number, total: number) => string;
    rescue: (fuel: number) => string;
    notEnoughFuel: (fuel: number) => string;
    levelUp: (faction: string, level: number, name: string) => string;
    courierSent: (time: string) => string;
    courierDelivered: (station: string) => string;
    captainDefeated: (name: string) => string;
  };
  prompts: {
    buoy: (n: number, total: number) => string;
    rescue: (fuel: number) => string;
  };
  hud: {
    objectives: string;
    storages: string;
  };
}

export const skGoals = {
  factions: {
    guild: 'Ťažobný cech',
    institute: 'Kartografický inštitút',
    freeTraders: 'Voľní obchodníci',
    rust: 'Hrdza',
    cauldron: 'Kotol',
    slantedStar: 'Šikmá hviezda',
    wardens: 'Strážcovia',
  } satisfies Record<FactionId, string>,
  factionShort: { guild: 'Cech', institute: 'Inštitút', freeTraders: 'Obchodníci', rust: 'Hrdza', cauldron: 'Kotol', slantedStar: 'Šikmá hviezda', wardens: 'Strážcovia' } satisfies Record<FactionId, string>,
  relations: { friendly: 'priateľský', neutral: 'neutrálny', hostile: 'nepriateľský' },
  repLevels: ['Neznámy', 'Známy', 'Overený', 'Dôveryhodný'] as const,
  unlocks: {
    contractsBasic: 'Dodávky a ťažba v hĺbke 1',
    contractsRing1: 'Všetky kontrakty v hĺbke 1',
    contractsRing2: 'Kontrakty v hĺbke 2',
    t2PartsRing1: 'Diely T2 na trhu v hĺbke 1',
    courier: 'Kuriérska služba',
    captainHunts: 'Lov menovaných kapitánov',
    surveyRing1: 'Meranie v hĺbke 1',
    surveyRing2: 'Meranie v hĺbke 2',
    archiveLicense: 'Licencia Archívu (vetva Logistika)',
    surveyRing3: 'Meranie v hĺbke 3',
    scanContracts: 'Prieskumné kontrakty',
    retrieveContracts: 'Vyzdvihnutia (Archív: licencia)',
    guildRelay: 'Kontrakty Relé Cechu',
  } satisfies Record<RepUnlock, string>,
  soon: (milestone: string): string => `príde v ${milestone}`,

  contractTypes: {
    delivery: 'Dodávka',
    mining: 'Ťažba',
    hunt: 'Lov',
    rescue: 'Záchrana',
    survey: 'Meranie',
    scan: 'Prieskum',
    escort: 'Eskorta',
    retrieve: 'Vyzdvihnutie',
    build: 'Stavba',
    fortress: 'Pevnosť',
    chart: 'Mapa',
    relay: 'Relé Cechu',
  } satisfies Record<ContractType, string>,
  task: {
    delivery: (amount: string, res: string, station: string): string => `Doviezť ${amount} ${res} na stanicu ${station}`,
    mining: (amount: string, res: string): string => `Vyťažiť ${amount} ${res} – žily dávajú viac`,
    hunt: (n: number): string => `Rozprášiť pirátsku skupinu (${n} ${plural(n, 'loď', 'lode', 'lodí')})`,
    captain: (name: string): string => `Zničiť kapitána ${name}`,
    rescue: (fuel: number): string => `Doniesť ${fuel} j paliva uviaznutej obchodnej lodi`,
    survey: (n: number): string => `Rozmiestniť ${n} meracie bóje v oblasti`,
    scan: (what: string): string => `Naskenovať ${what} (podrž Tab)`,
    retrieve: (part: string): string => `Vyzdvihnúť ${part} z vraku`,
    fortress: (name: string): string => `Zničiť ${name} – najprv generátory štítu za skalou`,
    chart: (sector: string, points: number): string => `Zmapovať sektor ${sector} – ${points} ${plural(points, 'merací bod', 'meracie body', 'meracích bodov')} (pulz Tab)`,
    relay: (sector: string): string => `Opraviť, napájať a ubrániť relé Cechu v sektore ${sector}`,
    escort: (lane: string): string => `Sprevádzať konvoj Voľných obchodníkov po Cechovej ceste ${lane}`,
  },
  next: {
    delivery: (have: string, amount: string, res: string, station: string): string => `Doviez ${res} na stanicu ${station} (${have}/${amount})`,
    deliveryReady: (station: string): string => `Odovzdaj dodávku na stanici ${station}`,
    mining: (have: string, amount: string, res: string): string => `Vyťaž ${res} (${have}/${amount})`,
    hunt: (done: number, total: number): string => `Znič pirátov skupiny (${done}/${total})`,
    captain: (name: string): string => `Nájdi a znič kapitána ${name}`,
    rescue: (fuel: number): string => `Leť k uviaznutej lodi a odovzdaj ${fuel} j paliva (F)`,
    survey: (done: number, total: number): string => `Rozmiestni bóju ${done + 1}/${total} (F na značke)`,
    scan: (what: string): string => `Leť k cieľu a podrž Tab na ${what}`,
    retrieve: (part: string): string => `Nájdi vrak a nalož ${part} (F)`,
    fortress: (name: string): string => `Znič generátory a jadro – ${name}`,
    chart: (sector: string, done: number, total: number): string => `Zameraj merací bod ${Math.min(total, done + 1)}/${total} v sektore ${sector} (pulz Tab do 150 j)`,
    ready: 'Splnené – odovzdaj na ktorejkoľvek stanici',
  },
  why: {
    delivery: 'Cech zásobuje stanice – platí za tovar aj za cestu.',
    mining: 'Cech potrebuje suroviny z polí – odmena je navyše k predaju rudy.',
    hunt: 'Piráti prepadávajú ťažiarov – Cech platí za pokoj v sektoroch.',
    captain: 'Menovaný kapitán – odmena za hlavu a trofej do siene.',
    revenge: 'Tento kapitán ťa už raz zničil – je čas na odvetu.',
    rescue: 'Obchodníkovi došlo palivo – pomoc sa oplatí a Cech si ju pamätá.',
    survey: 'Inštitút mapuje sektory – merania odomykajú ďalšiu prácu.',
    scan: 'Inštitút platí za každý sken – kreditmi aj Dátami pre Archív.',
    retrieve: 'Inštitút chce späť svoj diel – a za odmenu pridá kus plánu.',
    fortress: 'Pevnosť Hrdze ovláda sektor – Cech zaplatí navyše ku koristi z jadra.',
    chart: 'Cech kupuje mapy sektorov – odmena zahŕňa predaj mapy.',
    chartFirst: 'Prvá mapa: zmapuj neznámy sektor pri domove – Cech mapu kúpi.',
    relay: 'Cech chce sektor späť – funkčné relé privedie Stráž Cechu natrvalo.',
    escort: 'Obchodníci platia Cechu za ochranu – ak konvoj padne, záloha prepadne.',
  },
  scanWhat: { wreck: 'vrak', anomaly: 'anomáliu', giant: 'obrí asteroid' },
  slip: {
    short: 'Krátky',
    risk: ['Bez rizika', 'Riziko', 'Vysoké riziko'] as const,
    reward: 'Odmena',
    rep: (n: number): string => `+${n} rep.`,
    duration: (min: number): string => `~${min} min`,
    distance: (d: string): string => `${d} j`,
    depth: (n: number): string => `hĺbka ${n}`,
    accept: 'Prijať',
    turnIn: 'Odovzdať',
    abandon: 'Zrušiť',
    giveUp: 'Vzdať',
    abandonFree: 'Do 2 min zadarmo – lístok sa vráti na tabuľu',
    giveUpHint: 'Bez trestu, lístok sa už nevráti',
    full: 'Najviac 3 aktívne kontrakty',
    ready: 'Splnené',
    active: 'Aktívny',
    partBonus: (part: string): string => `+ ${part}`,
    bounty: (kr: string): string => `z toho ${kr} za hlavu`,
    goods: (kr: string): string => `z toho ${kr} za tovar`,
    notHere: (station: string): string => `Odovzdáva sa na stanici ${station}`,
    missing: (amount: string, res: string): string => `Chýba ${amount} ${res}`,
    notReady: 'Ciele ešte nie sú splnené',
  },
  board: {
    tab: 'Zákazky',
    views: { contracts: 'Kontrakty', factions: 'Frakcie', wanted: 'Hľadaní', charts: 'Kartografia' },
    active: 'Aktívne kontrakty',
    offers: 'Ponuka stanice',
    noActive: 'Žiadny aktívny kontrakt – vyber si lístok z ponuky.',
    noOffers: 'Zákazky sú prázdne. Nové lístky prídu o chvíľu – alebo zvýš reputáciu.',
    refresh: (min: number): string => `Nové lístky o ${min} min`,
    recommended: 'Odporúčané',
    recommendedWhy: { noRisk: 'bez rizika', short: 'krátke', bestPay: 'najlepšia odmena za minútu' },
    needs: (amount: string, res: string): string => `Potrebuješ ${amount} ${res} – vyťaž to alebo kúp.`,
    otherOffers: (min: number): string => `Ďalšie ponuky · nové o ${min} min`,
    sector: 'Miestne podmienky',
    calm: 'Nič mimoriadne – žiadne varovania ani anomálie.',
    sectorChange: (min: number): string => `zmena o ${min} min`,
    factions: 'Reputácia',
    level: (n: number, name: string): string => `Úroveň ${n} · ${name}`,
    points: (have: number, need: number): string => `${have} / ${need} b`,
    maxLevel: 'Najvyššia úroveň v tejto verzii',
    assignment: 'Kariérne zadanie',
    or: 'alebo',
    unlocks: 'Odomyká',
    nextUnlocks: 'Ďalšia úroveň',
    deliver: (amount: string, res: string): string => `Odovzdať ${amount} ${res}`,
    wanted: 'Hľadaní kapitáni',
    wantedNote: 'Polohu kapitána prezradí lovecký kontrakt Cechu (úroveň 3).',
    trophies: 'Trofejná sieň',
    noTrophies: 'Zatiaľ prázdna.',
  },
  assignments: {
    contracts: (n: number, type: string): string => `${n}× ${type}`,
    contractsRing: (n: number, type: string, ring: number): string => `${n}× ${type} v hĺbke ${ring}+`,
    deliver: (amount: number, res: string): string => `Doviezť ${amount} ${res}`,
    scans: {
      anomaly: (n: number): string => `${n}× sken anomálie`,
      cache: (n: number): string => (n === 1 ? 'Nájsť úkryt' : `Nájsť ${n} úkryty`),
      echo: (n: number): string => `${n} Ozveny Kováčov`,
    },
  },
  sector: {
    kinds: { warning: 'Varovanie', anomaly: 'Anomália', market: 'Trh', event: 'Udalosť' },
    names: {
      ionSeason: 'Iónová sezóna',
      huntingGrounds: 'Lovecké revíry',
      radiationWave: 'Radiačná vlna',
      currents: 'Prúdy',
      richVein: 'Bohatá žila',
      demand: 'Dopyt',
      convoy: 'Konvoj v oblasti',
      eclipse: 'Zatmenie',
      silentZone: 'Tichá zóna',
      cometFlyby: 'Prelet kométy',
      crystalSong: 'Kryštálový spev',
      pirateWar: 'Pirátska vojna',
      fuelShortage: 'Nedostatok paliva',
      solarWind: 'Slnečný vietor',
    } satisfies Record<SectorModifierId, string>,
    effects: {
      ionSeason: 'Iónové búrky sú trikrát častejšie – v búrke vypadnú štíty a radar slepne.',
      huntingGrounds: 'Pirátov je o polovicu viac.',
      radiationWave: 'Dávka radiácie ×1,5.',
      currents: 'Gravitačný prúd unáša loď – tlmiče míňajú palivo.',
      richVein: 'Žily na asteroidoch dávajú dvojnásobný bonus.',
      demand: 'Stanice vykupujú surovinu o 45 % drahšie (najviac 150 j).',
      convoy: 'Obchodník lieta trasou cez oblasť.',
      eclipse: 'Signálová tma – radar dosiahne len 40 %.',
      silentZone: 'Strážcovia neútočia, kým nestrieľaš.',
      cometFlyby: 'Kométa vo vnútri oblasti.',
      crystalSong: 'Kryštály ×1,5, radiácia ×1,2.',
      pirateWar: 'Klany bojujú medzi sebou – na hliadkach je ich polovica.',
      fuelShortage: 'Palivo na staniciach je o polovicu drahšie.',
      solarWind: 'Motory míňajú o 30 % menej paliva.',
    } satisfies Record<SectorModifierId, string>,
    demandOf: (res: string): string => `Dopyt: ${res}`,
    bonus: (pct: number): string => `+${pct} % odmeny`,
  },
  objectives: {
    title: 'Ciele',
    scales: { now: 'Teraz', today: 'Dnes', week: 'Tento týždeň' },
    tracks: { training: 'Výcvik', contract: 'Kontrakt', ship: 'Loď', career: 'Kariéra', main: 'Hlavná', story: 'Ozveny' },
    why: 'Prečo',
    where: 'Kde',
    close: 'G – zavrieť',
    open: 'Ciele',
    none: 'Žiadny cieľ – vezmi si kontrakt v Zákazkách na stanici.',
    skipTraining: 'Preskočiť výcvik',
    hereDocked: 'Si na stanici',
    takeContract: 'Vezmi si kontrakt v Zákazkách (4)',
    takeContractWhy: 'Kontrakty platia ako ťažba a zvyšujú reputáciu – tá odomyká licencie a služby.',
    mineAndSell: 'Vyťaž náklad a predaj ho na stanici',
    mineAndSellWhy: 'Kredity a suroviny sú cesta k lepším dielom.',
    ship: (part: string): string => `${part}`,
    shipMissing: (list: string): string => `Chýba: ${list}`,
    shipReady: 'Všetko máš – vyrob ho vo Výrobe',
    shipWhy: {
      'cargo:1': 'Viac nákladu = menej letov domov.',
      'miningLaser:1': 'Druhý laser zdvojnásobí ťažbu.',
      'reactor:1': 'Lasery a štít potrebujú energiu.',
      'fuelTank:1': 'S prídavnou nádržou doletíš hlbšie – k titánu v hĺbke 2.',
      'cannon:1': 'V sporných a pirátskych sektoroch striehnu piráti – kanón je tvoja obrana.',
      'shield:1': 'Štít zachytí prvé zásahy, kým odpovieš.',
      'miningLaser:2': 'Prvý diel T2: rýchlejšia ťažba za titán.',
      'cockpit:2': 'Kokpit T2 zväčší rozpočet trupu na 48 b.',
      'cargo:2': 'Nákladný priestor T2 unesie o polovicu viac.',
      'engine:2': 'Silnejšie motory pre ťažšiu loď.',
    },
    career: (faction: string, level: number, task: string): string => `${faction} ${level}: ${task}`,
    careerPoints: (faction: string, level: number, need: number): string => `${faction} ${level}: ešte ${need} b reputácie`,
    careerWhy: (unlock: string): string => `Odomkne: ${unlock}.`,
    ring2: 'Leť hlbšie – do sektorov hĺbky 2 (Vonkajšie pásy)',
    ring2Why: 'V hĺbke 2 je titán na diely T2 – a v sporných a pirátskych sektoroch aj piráti.',
    ring3: 'Preskúmaj hĺbku 3 – Kryštálové hmloviny',
    ring3Why: 'Ďalej je bohatšie – a Ozveny Kováčov vedú von.',
    findStation: (name: string): string => `Nájdi stanicu ${name}`,
    findStationWhy: 'Viac staníc = viac kontraktov a lepšie ceny.',
    distance: (d: string): string => `${d} j`,
  },
  resume: {
    title: 'Kde si skončil',
    played: (time: string): string => `Odohraté ${time}`,
    lastActivity: 'Posledná činnosť',
    docked: (station: string): string => `Si zadokovaný na stanici ${station}.`,
    flying: (where: string, station: string, d: string): string => `Si v lete (${where}), ${d} j od stanice ${station}.`,
    heading: (station: string): string => `Smer: ${station}`,
    cargo: (list: string): string => `Na palube: ${list}`,
    emptyCargo: 'Náklad je prázdny.',
    contracts: 'Aktívne kontrakty',
    noContracts: 'Žiadne – nové sú v Zákazkách každej stanice.',
    next: 'Ďalší cieľ',
    journal: 'Posledné záznamy',
    noJournal: 'Denník je zatiaľ prázdny.',
    continue: 'Pokračovať',
  },
  log: {
    contractAccepted: (type: string, station: string): string => `Prijatý kontrakt ${type} (${station})`,
    contractCompleted: (type: string, station: string): string => `Splnený kontrakt ${type} (${station})`,
    contractAbandoned: (type: string): string => `Zrušený kontrakt ${type}`,
    levelUp: (faction: string, level: number): string => `${faction}: úroveň ${level}`,
    stationDiscovered: (station: string): string => `Objavená stanica ${station}`,
    captainDefeated: (name: string): string => `Zničený kapitán ${name}`,
    captainPromoted: (name: string): string => `Kapitán ${name} povýšil`,
    courierDelivered: (station: string): string => `Kuriér doručil na stanicu ${station}`,
    firstDayStep: 'Prvý deň: krok splnený',
    trainingStep: (step: string): string => `Výcvik: ${step}`,
    died: 'Loď zničená',
    contractFailed: (type: string): string => `Neúspešný kontrakt ${type}`,
    ago: (time: string): string => `pred ${time}`,
  },
  storages: {
    title: 'Sklady',
    close: 'I – zavrieť',
    search: 'Hľadať diel alebo surovinu',
    allRings: 'Všetky',
    empty: 'Na staniciach zatiaľ nič nemáš.',
    noMatch: 'Nič také v skladoch nie je.',
    here: 'tu',
    send: 'Poslať kuriérom',
    courier: 'Kuriér',
    courierLocked: 'Kuriérsku službu odomkne Cech na úrovni 2.',
    to: 'Cieľ',
    items: 'Zásielka',
    fee: 'Poplatok',
    time: 'Doručenie',
    confirm: 'Poslať',
    cancel: 'Späť',
    inTransit: 'Na ceste',
    eta: (time: string): string => `o ${time}`,
    nothingSelected: 'Vyber, čo poslať',
    noTarget: 'Nepoznáš inú stanicu',
    ships: 'Lode',
    shipActive: 'aktívna',
    shipInFlight: 'v lete',
    shipStored: 'v hangári',
    shipHull: (points: number): string => `trup ${points} b`,
  },
  captains: {
    nicknames: [
      'Vdova', 'Hrdzavý', 'Kotlík', 'Šikmák', 'Bez mena', 'Pila', 'Ihla', 'Žeriav', 'Mráz', 'Klinec', 'Vrtuľa', 'Sklo', 'Kosť', 'Iskra', 'Zubatá',
    ],
    names: ['Korma', 'Vlasta', 'Brano', 'Jarka', 'Dušan', 'Ilka', 'Mirko', 'Zora', 'Tibor', 'Hela', 'Radim', 'Soňa', 'Ondro', 'Vanda', 'Kazi'],
    name: (nick: string, name: string): string => `„${nick}“ ${name}`,
    traits: {
      cautious: 'opatrný',
      reckless: 'bezhlavý',
      vengeful: 'pomstychtivý',
      showoff: 'chvastúň',
      greedy: 'chamtivý',
    } satisfies Record<CaptainTrait, string>,
    level: (n: number): string => `úr. ${n}`,
    bounty: 'Odmena',
    replica: (parts: string): string => `Nesie repliku tvojho dielu: ${parts}`,
    killedYou: (n: number): string => `Zničil ťa ${n}×`,
    defeated: 'Zničený',
    promoted: (name: string, level: number): string => `Kapitán ${name} povýšil na úroveň ${level}`,
    promotedReplica: (name: string, part: string): string => `${name} si odniesol repliku: ${part}. Nič si nestratil.`,
  },
  toasts: {
    accepted: (type: string): string => `Kontrakt prijatý: ${type}`,
    ready: (type: string): string => `Kontrakt splnený: ${type} – odovzdaj na stanici`,
    completed: (kr: string): string => `Kontrakt odovzdaný: +${kr}`,
    abandoned: 'Kontrakt zrušený',
    buoy: (n: number, total: number): string => `Bója ${n}/${total} rozmiestnená`,
    rescue: (fuel: number): string => `Odovzdané palivo: ${fuel} j`,
    notEnoughFuel: (fuel: number): string => `Uviaznutá loď potrebuje ${fuel} j paliva`,
    levelUp: (faction: string, level: number, name: string): string => `${faction}: úroveň ${level} – ${name}`,
    courierSent: (time: string): string => `Kuriér vyrazil – doručenie o ${time}`,
    courierDelivered: (station: string): string => `Kuriér doručil zásielku na stanicu ${station}`,
    captainDefeated: (name: string): string => `Kapitán ${name} zničený – trofej v sieni`,
  },
  prompts: {
    buoy: (n: number, total: number): string => `F – vypustiť meraciu bóju (${n}/${total})`,
    rescue: (fuel: number): string => `F – odovzdať ${fuel} j paliva`,
  },
  hud: {
    objectives: 'G ciele',
    storages: 'I sklady',
  },
} satisfies GoalsTexts;


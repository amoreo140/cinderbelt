// Slovak texts of the home station (M4c "Home and workshop"): the
// Rozvoj (Development) tab, home modules, paints, trophies and the Index Kovania (T0 names, T2 view-model
// texts, T3 the tab's controls; T10 adds `workshop`). enHome.ts implements the same keys in English.
import type { HomeModuleId } from '../data/home';
import type { PaintId } from '../data/paints';

export interface HomeTexts {
  /** The Rozvoj tab. */
  tab: {
    /** Stencil heading of the module list. */
    title: string;
    /** Tag of a module that comes later: "Later · M5a". */
    later: (milestone: string) => string;
    /** State tag of a built module. */
    owned: string;
    /** Label of the price in the detail. */
    price: string;
    /** Index Kovania points a module adds: "+1 Index Kovania". */
    indexPoints: (points: number) => string;
    /** The build button. */
    build: string;
    /** The build confirmation dialog: title, body, buttons. */
    confirmTitle: (module: string) => string;
    confirmBody: (price: string) => string;
    confirm: string;
    cancel: string;
    /** "Show" – the dock camera flies to the module; its hint; back to the dock view. */
    show: string;
    showHint: string;
    showBack: string;
  };
  /** Home modules: name and a short effect line. */
  modules: Record<HomeModuleId, { name: string; effect: string }>;
  /** Paint names (Paint shop). */
  paints: Record<PaintId, string>;
  /** The paint shop's controls. */
  paintShop: {
    ship: string;
    paint: string;
    /** The selected ship's paint now. */
    current: (paint: string) => string;
    apply: string;
    /** "Paint" without a picked paint. */
    pick: string;
    /** Price tag of painting (free in M4c). */
    free: string;
    /** Hint under the swatches: hover previews on the model. */
    previewHint: string;
    /** The paint chip on a hangar card: "Lak: Grafit". */
    chip: (paint: string) => string;
  };
  /** Trophy hall. */
  trophies: {
    title: string;
    /** No trophy yet. */
    empty: string;
    /** The list without the hall. */
    buildHall: string;
    /** Stencil tag of a trophy's kind. */
    kind: { captain: string; fortress: string };
    /** Heading of the six pedestals. */
    pedestals: string;
    /** An empty pedestal. */
    emptyPedestal: string;
    /** Heading of the list of every trophy. */
    all: string;
    pin: string;
    unpin: string;
    /** How the pedestals fill. */
    pinHint: string;
    /** Trophies won while the hall is not built: kept, shown when it stands. */
    waiting: (count: number) => string;
  };
  /** The Index Kovania gauge. */
  forge: {
    title: string;
    /** "0 / 7". */
    value: (points: number, max: number) => string;
  };
  /** Texts of the view models (T2): why a module cannot be built, where a ship is, trophy lines. */
  status: {
    /** A future module: "Comes with M5a". */
    comesWith: (milestone: string) => string;
    /** Not enough credits: "2,300 cr missing". */
    missingCredits: (amount: string) => string;
    /** Not enough resources: "200 Titanium missing". */
    missingResources: (list: string) => string;
  };
  /** Where a ship in the paint shop's list is. */
  where: { docked: string; hangar: string };
  /** Trophy cards. */
  trophy: {
    /** A captain's subtitle: the clan and the replicas recovered from the captain ("Rust – replica returned: Engine T2"). */
    captain: (clan: string, replicas: readonly string[]) => string;
    /** A fortress's subtitle: its sector. */
    fortress: (sector: string) => string;
  };
  /** Toasts of the home actions. */
  toasts: {
    built: (module: string) => string;
    painted: (ship: string, paint: string) => string;
    pinned: (trophy: string) => string;
    unpinned: (trophy: string) => string;
  };
  /**
   * The on-board workshop (M4c T10): the flight lamps of the refinery and the repair module, the refined
   * ore count beside them, the market's refined-ore row and transfer warning, the reactor blast toast.
   */
  workshop: {
    /** Lamp codes (three stencil letters) and their accessible names. */
    lampRefinery: string;
    lampRepair: string;
    refineryName: string;
    repairName: string;
    /** Refinery at work: ice to fuel (`fuel` = the tank in %), refining ore (`bonus` = "15 %"). */
    refiningFuel: (fuel: string) => string;
    refiningOre: (bonus: string) => string;
    /** Repair modules at work: `parts` = "Pancier T1 (45 %), Motor T1 (80 %)". */
    repairing: (parts: string) => string;
    /** Why a lamp stands: `min` = the battery floor ("20 %"), `material` = "iron or titanium". */
    idle: {
      refineryEnergy: (min: string) => string;
      refineryMaterial: string;
      refineryNothing: string;
      repairEnergy: (min: string) => string;
      repairMaterial: (material: string) => string;
      repairNothing: string;
    };
    /** Joins material names: "iron or titanium". */
    or: (a: string, b: string) => string;
    /** The refined count beside the lamps: label and its tooltip (`list` = "Fe 30 · Ti 12", `bonus` = "15 %"). */
    refined: string;
    refinedTip: (list: string, bonus: string) => string;
    /** Market sell row: "of which refined 84 · +15 %" (`bonus` signed) and its tooltip (`bonus` = "15 %"). */
    marketRefined: (amount: string, bonus: string) => string;
    marketRefinedTip: (bonus: string) => string;
    /** The sell button's hint with refined units in the sale: what it pays. */
    sellHint: (credits: string) => string;
    /** Transfer to storage with refined units: the button's warning. */
    transferWarning: (amount: string) => string;
    /** The player's large reactor blew up: `damage` HP to its neighbours. */
    blast: (part: string, damage: number) => string;
  };
}

export const skHome: HomeTexts = {
  tab: {
    title: 'Rozvoj domova',
    later: (milestone) => `Neskôr · ${milestone}`,
    owned: 'Postavená',
    price: 'Cena',
    indexPoints: (points) => `+${points} Index Kovania`,
    build: 'Postaviť',
    confirmTitle: (module) => `Postaviť: ${module}`,
    confirmBody: (price) => `Stojí ${price}. Modul pribudne na domovskej stanici hneď a zostane na nej.`,
    confirm: 'Postaviť',
    cancel: 'Späť',
    show: 'Ukázať',
    showHint: 'Kamera doku preletí k modulu',
    showBack: 'Späť na dok',
  },
  modules: {
    paintShop: { name: 'Lakovňa', effect: 'Laky lodí' },
    trophyHall: { name: 'Trofejná sieň', effect: 'Trofeje v doku' },
    homeRefinery: { name: 'Rafinéria', effect: 'Medziprodukty bez poplatku' },
    observatory: { name: 'Observatórium', effect: 'Prieskumné drony, dráhy komét' },
    laboratory: { name: 'Laboratórium', effect: 'Analýza reliktov na Dáta' },
    droneHub: { name: 'Dronový hub', effect: '+3 trasy dronov' },
  },
  paints: {
    factory: 'Továrenský',
    graphite: 'Grafit',
    sand: 'Piesok',
    navy: 'Námornícka',
    racing: 'Pretekárska',
  },
  paintShop: {
    ship: 'Loď',
    paint: 'Lak',
    current: (paint) => `Teraz: ${paint}`,
    apply: 'Nalakovať',
    pick: 'Najprv vyber lak',
    free: 'zadarmo',
    previewHint: 'Prejdi myšou po laku – loď v doku ho hneď ukáže.',
    chip: (paint) => `Lak: ${paint}`,
  },
  trophies: {
    title: 'Trofejná sieň',
    empty: 'Zatiaľ žiadne trofeje – poraz menovaného kapitána alebo pevnosť',
    buildHall: 'Postav Trofejnú sieň',
    kind: { captain: 'Kapitán', fortress: 'Pevnosť' },
    pedestals: 'Podstavce',
    emptyPedestal: 'Voľný podstavec',
    all: 'Všetky trofeje',
    pin: 'Pripnúť',
    unpin: 'Odopnúť',
    pinHint: 'Pripnuté trofeje stoja na podstavcoch prvé, voľné miesta zaplnia najnovšie.',
    waiting: (count) => `${count === 1 ? 'Trofej čaká' : count < 5 ? `${count} trofeje čakajú` : `${count} trofejí čaká`} na sieň – nič sa nestratí.`,
  },
  forge: {
    title: 'Index Kovania',
    value: (points, max) => `${points} / ${max}`,
  },
  status: {
    comesWith: (milestone) => `Príde s ${milestone}`,
    missingCredits: (amount) => `Chýba ${amount}`,
    missingResources: (list) => `Chýba ${list}`,
  },
  where: { docked: 'zadokovaná', hangar: 'v hangári' },
  trophy: {
    captain: (clan, replicas) =>
      replicas.length === 0 ? clan : `${clan} – ${replicas.length === 1 ? 'vrátená replika' : 'vrátené repliky'}: ${replicas.join(', ')}`,
    fortress: (sector) => `sektor ${sector}`,
  },
  toasts: {
    built: (module) => `Postavené: ${module}`,
    painted: (ship, paint) => `${ship} má nový lak: ${paint}`,
    pinned: (trophy) => `Na podstavci: ${trophy}`,
    unpinned: (trophy) => `Z podstavca zložené: ${trophy}`,
  },
  workshop: {
    lampRefinery: 'RAF',
    lampRepair: 'OPR',
    refineryName: 'Rafinéria',
    repairName: 'Opravárenský modul',
    refiningFuel: (fuel) => `Rafinéria mení ľad na palivo (nádrž ${fuel}).`,
    refiningOre: (bonus) => `Rafinéria čistí rudu v náklade – rafinovaná sa predá o ${bonus} drahšie.`,
    repairing: (parts) => `Opravárenský modul opravuje: ${parts}.`,
    idle: {
      refineryEnergy: (min) => `Rafinéria stojí: málo energie. Dielňa pracuje, len kým je batéria nad ${min}.`,
      refineryMaterial: 'Rafinéria stojí: nádrž nie je plná, ale v náklade nie je ľad ani surová ruda.',
      refineryNothing: 'Rafinéria nemá čo robiť: nádrž je plná a všetka ruda v náklade je rafinovaná.',
      repairEnergy: (min) => `Opravárenský modul stojí: málo energie. Dielňa pracuje, len kým je batéria nad ${min}.`,
      repairMaterial: (material) => `Opravárenský modul stojí: v náklade chýba ${material}.`,
      repairNothing: 'Opravárenský modul nemá čo opravovať – susedné diely sú celé.',
    },
    or: (a, b) => `${a} alebo ${b}`,
    refined: 'Rafinované',
    refinedTip: (list, bonus) => `Rafinovaná ruda v náklade: ${list}. Pri predaji z lode o ${bonus} drahšie; v sklade stanice príplatok stratí.`,
    marketRefined: (amount, bonus) => `z toho rafinované ${amount} · ${bonus}`,
    marketRefinedTip: (bonus) => `Predaj z lode berie najprv rafinovanú rudu – o ${bonus} drahšie. Príplatok sa nesčítava s dopytom sektora.`,
    sellHint: (credits) => `Predaj z lode vynesie ${credits} – rafinovaná ruda ide prvá.`,
    transferWarning: (amount) => `Rafinovaná ruda stratí príplatok: v sklade stanice bude ${amount} j obyčajnou rudou.`,
    blast: (part, damage) => `${part} vybuchol – diely okolo neho stratili ${damage} HP.`,
  },
};

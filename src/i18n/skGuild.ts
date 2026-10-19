// Slovak texts of M4d "Cech a obchod":
// the Guild Watch, the Guild relay, convoys and their trade, the escort, the map Guild layer, map notes
// and the route planner. The English module (enGuild.ts) mirrors every key.
//
// T0 skeleton: each sub-object holds its title; the owning tasks add their texts (T11: watch, relay,
// convoy, trade, escort; T12: map, notes, route). Radio lines belong to skComms (T10). No friendly
// fire (user decision 2026-10-16) – there is no offence / hostility / fine sub-object.
import type { NoteIcon } from '../data/navigation';
import type { ContractFailReason } from '../sim/career/types';
import { skPlural } from './plural';

export interface GuildTexts {
  /** The Guild Watch as live ships (T11: radar legend, chips). */
  watch: {
    name: string;
    /** Radar legend row of a live Watch ship (a friend – never a target). */
    radar: string;
  };
  /** The Guild relay contract and its stages (T11). */
  relay: {
    name: string;
    /** Radar legend row (lit = powered). */
    radar: string;
    /** "Guild Lane A" – the Guild Lane of a relay or an escort (a slip tag, the relay chip). */
    lane: (lane: string) => string;
    /** The stage names of the relay chain (status chip). */
    stages: Record<'broken' | 'repaired' | 'powered' | 'secured', string>;
    /** The three steps of the chain (the chip's step pips). */
    steps: { repair: string; power: string; hold: string };
    /** Next-step hints (T9 `GuildRelayStatus.hint`, the slip's next step). */
    hints: {
      /** `materials` = "60 Fe, 40 Cu, 10 Ti". */
      repair: (materials: string) => string;
      power: string;
      /** The counterattack is coming (the hold armed, before the fight). */
      holdWarning: string;
      hold: string;
      /** The hold was interrupted: come back, the Rust attacks again. */
      holdIdle: string;
      secured: (sector: string) => string;
    };
    /** The F prompt at the mast: `materials` from the cargo; `missing` = what the cargo lacks. */
    prompt: { repair: (materials: string) => string; missing: (missing: string) => string };
    /** Slip note: what securing does. */
    slipNote: string;
  };
  /** Convoys of the Free Traders (T11: radar, flight arrows). */
  convoy: {
    name: string;
    /** Radar legend row. */
    radar: string;
    /** Edge-arrow label. */
    arrow: string;
    /** Trader ship names (T9 picks one per pass). */
    traders: readonly string[];
    /** "Free Traders 'Green Wave'". */
    trader: (name: string) => string;
  };
  /** The convoy trade window (T11). */
  trade: {
    title: string;
    /** "prstenec 2" in the header. */
    ring: (ring: number) => string;
    rare: string;
    sell: string;
    tanker: string;
    buy: string;
    sold: string;
    /** "takes another 120 u". */
    capLeft: (units: string) => string;
    capReached: string;
    /** "2,6 kr/j". */
    unitPrice: (price: string) => string;
    /** "z toho raf. 40" (refined ore sells first with its bonus). */
    refined: (units: string) => string;
    refinedTip: (bonus: string) => string;
    quantity: string;
    max: string;
    sellAction: string;
    /** Button tooltip: what the sale pays. */
    sellQuote: (credits: string) => string;
    noCargo: string;
    nothingToSell: string;
    /** "max 60 j" – fuel the tanker sells now. */
    fuelMax: (units: string) => string;
    refuel: (units: string) => string;
    refuelFull: string;
    noTanker: string;
    /** The ship's credits in the header. */
    credits: string;
    unlink: string;
    unlinkHint: string;
    /** Item texts and reasons for the game layer (T9 `ConvoyTradeItem`). */
    items: {
      fragment: (plan: string) => string;
      /** "you have 2/3 fragments". */
      fragments: (have: number, total: number) => string;
      variant: string;
      t2: string;
    };
    reasons: {
      /** "300 cr missing". */
      noCredits: (missing: string) => string;
      holdFull: string;
      sold: string;
      tankFull: string;
      fuelCap: string;
    };
  };
  /** The escort contract status (T11). */
  escort: {
    name: string;
    /** The convoy's state (status chip). */
    states: Record<'waiting' | 'moving' | 'stopped' | 'done', string>;
    ships: { trader: string; tanker: string };
    /** The status chips' region (screen readers). */
    region: string;
    /** A hull bar's label: "Trader: hull 62 %". */
    hull: (ship: string, percent: string) => string;
    /** Next-step hints (T9 `GuildEscortStatus.next`, the slip's next step). */
    next: { meet: string; waiting: string; follow: string; stopped: string; done: string };
    /** Slip tag: "Deposit 240 cr". */
    depositTag: (credits: string) => string;
    /** Slip note: "Deposit 10 %: 240 cr – forfeited if the escort fails" (it comes back with the reward). */
    deposit: (percent: string, credits: string) => string;
    /** When the deposit is lost (the slip's "why", the objective). */
    rules: string;
    /** Slip tag: the number of ambushes. */
    ambushes: (n: number) => string;
    /** A failed escort (toast; T9 / T10). */
    failed: Record<ContractFailReason, string>;
  };
  /** The map Guild layer (T12). */
  map: {
    layer: string;
    /** Legend rows of the Guild layer. */
    legendConvoy: string;
    legendWatch: string;
    legendRelay: string;
    legendRelayLit: string;
    /** Map label of a convoy; `eta` = "2:10" when it comes near the ship. */
    convoy: (eta: string | null) => string;
    /** A convoy whose trade the player already used this pass. */
    convoyDone: string;
    /** Map label of a Guild relay: "Guild Relay A · damaged". */
    relay: (lane: string, stage: 'broken' | 'repaired' | 'powered' | 'secured') => string;
    /** Stale marks (S6): legend rows, the mark names and the age label ("pred 3 min"). */
    legendStalePirates: string;
    legendStaleComet: string;
    stalePirates: string;
    staleComet: string;
    ago: (seconds: number) => string;
  };
  /** Map notes (T12). */
  notes: {
    title: string;
    /** Icon names (picker, labels; T8). The command errors are in `errors` (noMapNotes … invalidNote). */
    icons: Record<NoteIcon, string>;
    /** The note tool button (N) and its active hint. */
    tool: string;
    toolActive: string;
    /** "Marks 3/30". */
    count: (n: number, max: number) => string;
    /** The tool without the Archive node. */
    locked: string;
    /** The editor popover. */
    newTitle: string;
    editTitle: string;
    icon: string;
    text: string;
    placeholder: string;
    save: string;
    remove: string;
    cancel: string;
    /** Settings → Display: notes as edge arrows in flight. */
    inFlight: string;
  };
  /** The route planner (T12). */
  route: {
    title: string;
    /** "Trasa sem" (sector card, targets, notes). */
    here: string;
    clear: string;
    /** Label of a route to a bare map point. */
    point: string;
    /** Shown on the map while no route is planned. */
    hint: string;
    /** "4 300 j · 1:12". */
    line: (distance: string, time: string) => string;
    /** "Palivo 38 · zostane 22". */
    fuel: (need: string, left: string) => string;
    /** "Not enough fuel – 14 short". */
    short: (missing: string) => string;
    /** The sector's local fuel multiplier: "Miestne podmienky: palivo ×1,3". */
    fuelMult: (factor: string) => string;
    /** Head of the risk chips on the way (the chips count like the sector card); none = `safe`. */
    risks: string;
    safe: string;
    /** Legend of the range circles. */
    rangeOneWay: string;
    rangeRound: string;
    /** Edge arrow in flight: "Trasa · 1 240 j · 0:52" (T11 draws it). */
    arrow: (distance: string, time: string) => string;
    /** The station arrow when the route ends at that station: "Origin Base 1,742 u · route 0:52". */
    station: (label: string, time: string) => string;
  };
  /** The convoy link (T9): the F prompt at a trader's trade port, refusals and auto-unlinks (toasts). */
  link: {
    /** Title of the approach readout at a trader's trade port (the station's says "Dokovanie"). */
    readout: string;
    /** The readout's distance row: the gap to the trade port (the station's says "Svorka"). */
    port: string;
    /** F prompt within the link tolerances. */
    prompt: string;
    /** Prompt hints out of the tolerances (the approach readout shows the values). */
    approach: string;
    slowDown: string;
    pirates: string;
    /** "Trade port: gap 6.2 u (needs to be within 4 u)" – F refused. */
    rejected: { tooFar: (gap: string, max: string) => string; tooFast: (speed: string, max: string) => string; pirates: string };
    /** The convoy ended the link (not the player). */
    unlinked: { turnaround: string; pirates: string; passOver: string; blocked: string };
  };
  /** Toasts of the Guild and the escort (T9; the radio says them instead when it speaks, T10). */
  toasts: {
    escortDeparted: string;
    escortStopped: string;
    escortAmbush: string;
    relayRepaired: string;
    relayHold: string;
    sectorSecured: (sector: string) => string;
  };
}

export const skGuild: GuildTexts = {
  watch: { name: 'Stráž Cechu', radar: 'Stráž Cechu' },
  relay: {
    name: 'Relé Cechu',
    radar: 'Relé Cechu',
    lane: (lane) => `Cechová cesta ${lane}`,
    stages: { broken: 'Poškodené', repaired: 'Opravené', powered: 'Napájané', secured: 'Zabezpečené' },
    steps: { repair: 'Oprava', power: 'Napájanie', hold: 'Obrana' },
    hints: {
      repair: (materials) => `Oprav relé (F): ${materials} z nákladu`,
      power: 'Napájaj relé ťažobným laserom (5 s)',
      holdWarning: 'Hrdza ide na protiútok – priprav sa',
      hold: 'Ubráň relé, Stráž Cechu je na ceste',
      holdIdle: 'Vráť sa k relé – Hrdza zaútočí znova',
      secured: (sector) => `Sektor ${sector} je odteraz Strážený`,
    },
    prompt: {
      repair: (materials) => `F – opraviť relé Cechu (${materials} z nákladu)`,
      missing: (missing) => `Na opravu relé chýba ${missing}`,
    },
    slipNote: 'Sektor bude natrvalo Strážený',
  },
  convoy: {
    name: 'Konvoj Voľných obchodníkov',
    radar: 'Konvoj obchodníkov',
    arrow: 'Konvoj',
    traders: ['Zelená vlna', 'Ďaleký prístav', 'Tichá dohoda', 'Stará známa', 'Pokojná cesta', 'Šťastná ruka', 'Biela plachta', 'Dlhý dych'],
    trader: (name) => `Voľní obchodníci „${name}“`,
  },
  trade: {
    title: 'Obchod konvoja',
    ring: (ring) => `prstenec ${ring}`,
    rare: 'Vzácnosti',
    sell: 'Predaj nákladu',
    tanker: 'Cisterna',
    buy: 'Kúpiť',
    sold: 'Predané',
    capLeft: (units) => `berie ešte ${units}`,
    capReached: 'Konvoj už viac neberie',
    unitPrice: (price) => `${price} kr/j`,
    refined: (units) => `z toho raf. ${units}`,
    refinedTip: (bonus) => `Rafinovaná ruda sa predáva prvá, o ${bonus} drahšie`,
    quantity: 'Množstvo',
    max: 'Max',
    sellAction: 'Predať',
    sellQuote: (credits) => `Dostaneš ${credits}`,
    noCargo: 'V náklade nie je nič, čo konvoj kúpi.',
    nothingToSell: 'Nie je čo predať',
    fuelMax: (units) => `max ${units}`,
    refuel: (units) => `Tankovať ${units}`,
    refuelFull: 'Plná nádrž',
    noTanker: 'Konvoj letí bez cisterny – palivo nepredáva.',
    credits: 'Kredity',
    unlink: 'Odpojiť',
    unlinkHint: 'odpojí loď',
    items: {
      fragment: (plan) => `Fragment plánu „${plan}“`,
      fragments: (have, total) => `máš ${have}/${total} ${skPlural(total, 'fragment', 'fragmenty', 'fragmentov')}`,
      variant: 'Variant dielu – plán nemáš',
      t2: 'Diel T2 – v prvom prstenci ho stanice nepredávajú',
    },
    reasons: {
      noCredits: (missing) => `Chýba ${missing}`,
      holdFull: 'Plný priestor na diely',
      sold: 'Na tomto prelete už predané',
      tankFull: 'Nádrž je plná',
      fuelCap: 'Cisterna už viac nepredá',
    },
  },
  escort: {
    name: 'Eskorta',
    states: { waiting: 'Čaká', moving: 'Letí', stopped: 'Stojí', done: 'V cieli' },
    ships: { trader: 'Obchodník', tanker: 'Cisterna' },
    region: 'Úlohy Cechu',
    hull: (ship, percent) => `${ship}: trup ${percent}`,
    next: {
      meet: 'Leť k bodu stretnutia',
      waiting: 'Konvoj čaká pri bode stretnutia – priblíž sa na 150 j',
      follow: 'Sprevádzaj konvoj, drž sa do 800 j',
      stopped: 'Konvoj stojí – piráti nablízku',
      done: 'Konvoj je v cieli – odovzdaj na ktorejkoľvek stanici',
    },
    depositTag: (credits) => `Záloha ${credits}`,
    deposit: (percent, credits) => `Záloha ${percent}: ${credits} – prepadne, ak eskorta zlyhá`,
    rules: 'Záloha prepadne, ak obchodník zahynie, konvoj opustíš na viac ako minútu, zahynieš alebo zmeškáš stretnutie.',
    ambushes: (n) => `${n} ${skPlural(n, 'prepadnutie', 'prepadnutia', 'prepadnutí')}`,
    failed: {
      traderLost: 'Eskorta zlyhala: obchodník zahynul',
      abandoned: 'Eskorta zlyhala: konvoj si opustil',
      playerLost: 'Eskorta zlyhala: tvoja loď padla',
      missed: 'Eskorta zlyhala: stretnutie si zmeškal',
    },
  },
  map: {
    layer: 'Konvoje a Cech',
    legendConvoy: 'konvoj',
    legendWatch: 'Stráž Cechu',
    legendRelay: 'relé Cechu',
    legendRelayLit: 'relé svieti',
    convoy: (eta) => (eta ? `Konvoj · blízko o ${eta}` : 'Konvoj'),
    convoyDone: 'Konvoj · obchod hotový',
    relay: (lane, stage) => `Relé Cechu ${lane} · ${{ broken: 'poškodené', repaired: 'opravené', powered: 'napájané', secured: 'zabezpečené' }[stage]}`,
    legendStalePirates: 'piráti naposledy',
    legendStaleComet: 'kométa naposledy',
    stalePirates: 'Piráti',
    staleComet: 'Kométa',
    ago: (seconds) => (seconds < 60 ? 'pred chvíľou' : `pred ${Math.floor(seconds / 60)} min`),
  },
  notes: {
    title: 'Značky na mape',
    icons: { star: 'Hviezda', warning: 'Pozor', ore: 'Ruda', pirate: 'Piráti', flag: 'Vlajka' },
    tool: 'Značka',
    toolActive: 'Klikni na mapu – nová značka',
    count: (n, max) => `Značky ${n}/${max}`,
    locked: 'Značky na mape odomkneš v Archíve',
    newTitle: 'Nová značka',
    editTitle: 'Značka',
    icon: 'Ikona',
    text: 'Text',
    placeholder: 'napr. bohatá titánová žila',
    save: 'Uložiť',
    remove: 'Zmazať',
    cancel: 'Zrušiť',
    inFlight: 'Značky v lete',
  },
  route: {
    title: 'Trasa',
    here: 'Trasa sem',
    clear: 'Zrušiť trasu',
    point: 'Bod na mape',
    hint: 'Pravý klik: trasa sem',
    line: (distance, time) => `${distance} · ${time}`,
    fuel: (need, left) => `Palivo ${need} · zostane ${left}`,
    short: (missing) => `Palivo nestačí – chýba ${missing}`,
    fuelMult: (factor) => `Miestne podmienky: palivo ${factor}`,
    risks: 'Cestou',
    safe: 'bez nebezpečných sektorov',
    rangeOneWay: 'dolet tam',
    rangeRound: 'tam a späť',
    arrow: (distance, time) => `Trasa · ${distance} · ${time}`,
    station: (label, time) => `${label} · trasa ${time}`,
  },
  link: {
    readout: 'Pripojenie ku konvoju',
    port: 'Port',
    prompt: 'F – pripojiť sa k obchodníkovi',
    approach: 'Priblíž sa k obchodnému portu',
    slowDown: 'Vyrovnaj rýchlosť s konvojom',
    pirates: 'Piráti nablízku – obchodník sa nepripojí',
    rejected: {
      tooFar: (gap, max) => `Obchodný port je ďaleko: ${gap} j (treba do ${max} j)`,
      tooFast: (speed, max) => `Príliš rýchlo voči konvoju: ${speed} j/s (treba do ${max} j/s)`,
      pirates: 'Piráti nablízku – obchodník sa nepripojí',
    },
    unlinked: {
      turnaround: 'Konvoj sa otáča – odpojený',
      pirates: 'Piráti nablízku – obchodník sa odpojil',
      passOver: 'Konvoj odletel – odpojený',
      blocked: 'Skala v ceste – odpojený',
    },
  },
  toasts: {
    escortDeparted: 'Konvoj vyrazil – drž sa pri ňom',
    escortStopped: 'Konvoj zastal – piráti nablízku',
    escortAmbush: 'Prepadnutie! Chráň obchodníka',
    relayRepaired: 'Relé Cechu opravené – napájaj ho laserom',
    relayHold: 'Hrdza ide na protiútok – ubráň relé',
    sectorSecured: (sector) => `Sektor ${sector} je odteraz Strážený`,
  },
};

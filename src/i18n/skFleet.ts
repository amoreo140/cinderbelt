// Slovak texts of M4a "Hangar and fleet": the hangar modal, ship templates, the ship log, the death
// card action and the generated ship names. The shape is the exported `FleetTexts` interface;
// enFleet.ts implements the same keys in English.
//
// Ownership while M4a is built in parallel (M4a): T5 extends `hangar` and `log`,
// T6 extends `templates` and `death`; `names` is fixed (T0). The sub-objects start minimal.

import { TEMPLATE_CODE_MAX } from '../data/fleet';
import type { TemplateDecodeError } from '../sim/templates/types';
import { formatHullPoints } from './numberFormat';
import { skPlural as plural } from './plural';

export interface FleetTexts {
  /** The Hangar modal (Shipyard → Hangar): ship cards, slots, new ship, dismantle. */
  hangar: {
    /** Modal title and the Shipyard header button. */
    title: string;
    /** One line under the title: what the hangar is for. */
    lead: string;
    /** Close button of the modal. */
    close: string;
    /** Slot summary in the modal head: label + "1 / 2 occupied" + "2 of 4 in the whole game". */
    slotsLabel: string;
    slotsHere: (used: number, here: number) => string;
    slotsGame: (total: number, cap: number) => string;
    /** Card labels: the active ship / a ship parked in a slot. */
    active: string;
    stored: string;
    /** Where a ship stands (with a lamp): here / at another station / the active ship in flight. */
    here: string;
    standsAt: (station: string) => string;
    inFlight: string;
    /** Hull points used / the cockpit's budget: "31½ / 48 b" (formatHullPoints). */
    hullPoints: (used: number, budget: number) => string;
    /** Gauge labels in percent (condition = HP of the parts, fuel = tank). */
    hpPct: string;
    fuelPct: string;
    /** The active card instead of "Switch". */
    activeNote: string;
    /** Switch to a parked ship. */
    switch: string;
    switchHint: string;
    switchTitle: (name: string) => string;
    switchConfirm: string;
    /** Dismantle a parked ship (confirm with the fee). */
    dismantle: string;
    dismantleHint: string;
    dismantleTitle: (name: string) => string;
    dismantleBody: string;
    /** Repair fee of the damaged parts ("0 kr" = nothing to repair). */
    dismantleFee: (fee: string) => string;
    /** Parts scrapped because this station does not repair. */
    dismantleScrap: (parts: number) => string;
    dismantleConfirm: string;
    /** Back button of the confirm dialogs. */
    back: string;
    /** Inline rename (cards and the Shipyard header). */
    rename: (name: string) => string;
    renameLabel: string;
    renameHint: string;
    renameSave: string;
    /** Tag next to a generated name. */
    generated: string;
    /** Free slot card. */
    freeSlot: string;
    freeSlotHint: string;
    /** Next slot card: buy (price on the button) or locked (reason). */
    nextSlot: string;
    nextSlotHint: string;
    lockedSlot: string;
    buySlot: string;
    buyTitle: string;
    buyBody: (price: string, station: string) => string;
    buyConfirm: string;
    /** "New ship" from a cockpit. */
    newShip: {
      title: string;
      lead: string;
      /** Where the cockpit comes from. */
      source: { storage: string; buy: string; craft: string };
      free: string;
      none: string;
      confirmTitle: string;
      confirmBody: (cockpit: string, ship: string) => string;
      confirm: string;
    };
    /** Guild loan parts on the active ship (`loanNote`): said before a switch / new ship. */
    loan: {
      returned: string;
      dissolved: string;
      title: string;
    };
    /** Station hub overview row. */
    overview: {
      label: string;
      ships: (n: number) => string;
      freeSlots: (n: number) => string;
      empty: string;
      open: string;
    };
  };
  /** The Templates modal (Shipyard → Templates): save, build from, rename, delete, export / import. */
  templates: {
    /** Modal title and the Shipyard header button. */
    title: string;
    /** One line under the title: what templates are for. */
    lead: string;
    /** Used template slots: label and "3 / 5". */
    slotsLabel: string;
    slots: (used: number, cap: number) => string;
    /** Close button. */
    close: string;
    /** Locked by the Archive: the hint under the reason. */
    lockedHint: string;
    /** No template yet. */
    empty: string;
    /** Save section heading and its fields. */
    saveTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    /** Source of "Save": the active ship or the shipyard draft. */
    sourceLabel: string;
    sourceShip: string;
    sourceDraft: string;
    save: string;
    /** Save / rename disabled without a name. */
    nameMissing: string;
    /** Saved (feedback line). */
    saved: (name: string) => string;
    /** Slots full (import disabled). */
    full: string;
    /** Row facts. */
    parts: (n: number) => string;
    hullPoints: (points: number) => string;
    cockpitTier: (tier: number) => string;
    locked: (n: number) => string;
    /** Tooltip of the locked lamp. */
    lockedHelp: string;
    /** Row actions. */
    apply: string;
    applyHint: string;
    rename: string;
    renameSave: string;
    renameCancel: string;
    delete: string;
    export: string;
    /** Row action menu label for screen readers: "Template Miner II". */
    rowLabel: (name: string) => string;
    /** Delete confirmation. */
    deleteTitle: (name: string) => string;
    deleteBody: string;
    deleteConfirm: string;
    cancel: string;
    /** Export panel. */
    exportLabel: string;
    copy: string;
    copied: string;
    /** Clipboard unavailable: the code is selected, the player copies it with Ctrl+C. */
    copyManual: string;
    /** Import section. */
    importTitle: string;
    importLabel: string;
    importPlaceholder: string;
    import: string;
    importEmpty: string;
    imported: string;
    /** Why an import code was rejected, one text per `TemplateDecodeError`. */
    errors: Record<TemplateDecodeError, string>;
  };
  /** The ship log (the "ship log") line in the Shipyard header and on the ship cards. */
  log: {
    title: string;
    /** Log line parts ("1,284 u flown · 3 kills · 920 u mined · 1 destruction"). */
    distance: (amount: string) => string;
    kills: (n: number) => string;
    mined: (amount: string) => string;
    deaths: (n: number) => string;
    /** A ship with nothing in its log yet. */
    empty: string;
  };
  /** The death card's secondary action. */
  death: {
    /** "Restore from template". */
    restore: string;
    /** Tooltip of the enabled action: what happens after the click. */
    restoreHint: string;
  };
  /**
   * Generated ship names by the sim's index (`ShipRecord.nameIdx`) – exactly SHIP_NAME_COUNT, all
   * different; the same index is the same name in every language (a translation, not another word).
   */
  names: readonly string[];
}

export const skFleet: FleetTexts = {
  hangar: {
    title: 'Hangár',
    lead: 'Lode v slotoch stoja na stanici a čakajú na teba. Prepnúť sa dá na loď, ktorá stojí tu.',
    close: 'Zavrieť',
    slotsLabel: 'Sloty tu',
    slotsHere: (used, here) => `${used} / ${here} obsadené`,
    slotsGame: (total, cap) => `v celej hre ${total} z ${cap}`,
    active: 'Aktívna loď',
    stored: 'V slote',
    here: 'stojí tu',
    standsAt: (station) => `stojí na stanici ${station}`,
    inFlight: 'v lete',
    hullPoints: (used, budget) => `${formatHullPoints(used, 'sk')} / ${formatHullPoints(budget, 'sk')} b`,
    hpPct: 'Stav %',
    fuelPct: 'Palivo %',
    activeNote: 'Práve ňou letíš.',
    switch: 'Prepnúť',
    switchHint: 'Táto loď bude aktívna, súčasná zaparkuje v jej slote.',
    switchTitle: (name) => `Prepnúť na loď ${name}?`,
    switchConfirm: 'Prepnúť',
    dismantle: 'Rozobrať',
    dismantleHint: 'Diely aj náklad pôjdu do skladu tejto stanice, slot sa uvoľní.',
    dismantleTitle: (name) => `Rozobrať loď ${name}?`,
    dismantleBody: 'Všetky diely pôjdu do skladu tejto stanice, náklad tiež. Palivo sa stratí a loď aj s denníkom zanikne. Slot sa uvoľní.',
    dismantleFee: (fee) => `Oprava poškodených dielov: ${fee}`,
    dismantleScrap: (parts) => `Do šrotu (stanica neopravuje): ${parts} ${plural(parts, 'diel', 'diely', 'dielov')}`,
    dismantleConfirm: 'Rozobrať',
    back: 'Späť',
    rename: (name) => `Premenovať loď ${name}`,
    renameLabel: 'Meno lode',
    renameHint: 'Enter uloží, Esc zruší. Prázdne pole vráti vygenerované meno.',
    renameSave: 'Uložiť',
    generated: 'vygenerované',
    freeSlot: 'Voľný slot',
    freeSlotHint: 'Sem zaparkuje súčasná loď, keď si postavíš novú.',
    nextSlot: 'Ďalší slot',
    nextSlotHint: 'Kúpený slot ostáva tvoj, aj keď z neho loď odíde.',
    lockedSlot: 'Zamknutý slot',
    buySlot: 'Kúpiť slot',
    buyTitle: 'Kúpiť slot v hangári?',
    buyBody: (price, station) => `Slot na stanici ${station} stojí ${price}. Kúpený slot ostáva tvoj, aj keď z neho loď odíde – peniaze sa nevracajú.`,
    buyConfirm: 'Kúpiť',
    newShip: {
      title: 'Nová loď',
      lead: 'Súčasná loď zaparkuje vo voľnom slote tu. Nová začne ako samotný kokpit s prázdnou nádržou – zvyšok dostavíš v Lodenici.',
      source: { storage: 'zo skladu', buy: 'kúpiť', craft: 'vyrobiť' },
      free: 'zadarmo',
      none: 'Na tejto stanici nie je kokpit ani na sklade, ani na predaj.',
      confirmTitle: 'Postaviť novú loď?',
      confirmBody: (cockpit, ship) => `${ship} zaparkuje v slote na tejto stanici. Nová loď bude len ${cockpit}.`,
      confirm: 'Postaviť',
    },
    loan: {
      returned: 'Diely požičané od Cechu sa pri odchode z lode vrátia Cechu.',
      dissolved: 'Loď je celá z dielov Cechu – zaparkovať sa nedá. Vlastné diely a náklad pôjdu do skladu stanice a loď zanikne.',
      title: 'Opustiť loď s dielmi Cechu?',
    },
    overview: {
      label: 'Hangár',
      ships: (n) => `${n} ${plural(n, 'loď stojí', 'lode stoja', 'lodí stojí')} tu`,
      freeSlots: (n) => `${n} ${plural(n, 'voľný slot', 'voľné sloty', 'voľných slotov')}`,
      empty: 'prázdny',
      open: 'Prepnúť →',
    },
  },
  templates: {
    title: 'Šablóny',
    lead: 'Ulož návrh lode a postav ho znova jedným klikom – aj po strate lode. Cena zmien v lodenici ukáže, čo chýba.',
    slotsLabel: 'Sloty',
    slots: (used, cap) => `${used} / ${cap}`,
    close: 'Zavrieť',
    lockedHint: 'Šablóny odomkne uzol v Archíve (záložka 5).',
    empty: 'Zatiaľ žiadna šablóna. Ulož svoju loď alebo návrh z lodenice.',
    saveTitle: 'Uložiť aktuálny návrh',
    nameLabel: 'Názov šablóny',
    namePlaceholder: 'napr. Ťažiar II',
    sourceLabel: 'Čo uložiť',
    sourceShip: 'Loď',
    sourceDraft: 'Návrh v lodenici',
    save: 'Uložiť',
    nameMissing: 'Zadaj názov',
    saved: (name) => `Šablóna „${name}“ je uložená.`,
    full: 'Všetky sloty šablón sú plné – niektorú zmaž.',
    parts: (n) => `${n} ${plural(n, 'diel', 'diely', 'dielov')}`,
    hullPoints: (points) => `trup ${formatHullPoints(points, 'sk')} b`,
    cockpitTier: (tier) => `kokpit T${tier}`,
    locked: (n) => `${n} ${plural(n, 'zamknutý diel', 'zamknuté diely', 'zamknutých dielov')}`,
    lockedHelp: 'Tieto diely teraz nekúpiš ani nevyrobíš. Lodenica ukáže dôvod pri každom z nich.',
    apply: 'Postaviť',
    applyHint: 'Načíta šablónu ako návrh v lodenici. Nič sa nekúpi, kým zmeny nepotvrdíš.',
    rename: 'Premenovať',
    renameSave: 'Uložiť',
    renameCancel: 'Zrušiť',
    delete: 'Zmazať',
    export: 'Kód',
    rowLabel: (name) => `Šablóna ${name}`,
    deleteTitle: (name) => `Zmazať šablónu „${name}“?`,
    deleteBody: 'Šablóna zmizne zo zoznamu. Ak máš jej kód, môžeš ju neskôr znova importovať.',
    deleteConfirm: 'Zmazať',
    cancel: 'Späť',
    exportLabel: 'Kód šablóny na zdieľanie',
    copy: 'Kopírovať',
    copied: 'Skopírované do schránky.',
    copyManual: 'Kód je označený – skopíruj ho klávesmi Ctrl+C.',
    importTitle: 'Importovať kód',
    importLabel: 'Kód šablóny',
    importPlaceholder: 'Vlož kód, ktorý začína CB2.',
    import: 'Importovať',
    importEmpty: 'Vlož kód šablóny',
    imported: 'Šablóna je importovaná a uložená.',
    errors: {
      tooLong: `Kód je príliš dlhý – šablóna má najviac ${TEMPLATE_CODE_MAX / 1024} KB.`,
      prefix: 'Toto nie je kód šablóny Cinderbelt – ten začína znakmi CB2. (staršie kódy AF1. alebo AF2.)',
      checksum: 'Kód je poškodený – skontroluj, či si ho skopíroval celý a bez preklepu.',
      format: 'Kód sa nedá prečítať – chýba alebo prebýva časť textu.',
      version: 'Kód je z inej verzie hry a táto ho nepozná.',
      name: 'Šablóna v kóde nemá platný názov.',
      unknownPart: 'Šablóna obsahuje diel, ktorý hra nepozná.',
      noCockpit: 'Šablóna nemá kokpit.',
      manyCockpits: 'Šablóna má viac ako jeden kokpit.',
      overlap: 'Dva diely šablóny sa prekrývajú.',
      outOfBounds: 'Šablóna sa nezmestí do hangára (15 × 15 polí).',
      invalidDesign: 'Šablóna nie je platná loď (napríklad diely nie sú spojené s kokpitom).',
      unknownShape: 'Šablóna obsahuje tvar dielu, ktorý hra nepozná.',
      shapeNotAllowed: 'Šablóna dáva tvar dielu, ktorý ho mať nemôže – tvary má len pancier.',
    },
  },
  log: {
    title: 'Denník lode',
    distance: (amount) => `${amount} nalietaných`,
    kills: (n) => `${n} ${plural(n, 'zostrel', 'zostrely', 'zostrelov')}`,
    mined: (amount) => `${amount} vyťažených`,
    deaths: (n) => `${n} ${plural(n, 'zničenie', 'zničenia', 'zničení')}`,
    empty: 'zatiaľ bez záznamu',
  },
  death: {
    restore: 'Obnoviť zo šablóny',
    restoreHint: 'Pokračuje a otvorí lodenicu so šablónami: cena zmien ukáže, čo zo skladu chýba.',
  },
  names: [
    'Iskra',
    'Kométa',
    'Sokol',
    'Svitanie',
    'Vytrvalosť',
    'Polárka',
    'Jastrab',
    'Lastovička',
    'Rys',
    'Sova',
    'Blesk',
    'Hrom',
    'Víchor',
    'Zornička',
    'Kladivo',
    'Nákova',
    'Dláto',
    'Buzola',
    'Hviezdár',
    'Pútnik',
    'Tulák',
    'Hľadač',
    'Strážca',
    'Odvaha',
    'Nádej',
    'Vernosť',
    'Trpezlivosť',
    'Stehlík',
    'Medveď',
    'Jazvec',
    'Mravec',
    'Čmeliak',
    'Vážka',
    'Svetluška',
    'Volavka',
    'Čajka',
    'Brázda',
    'Žiara',
    'Plameň',
    'Uhlík',
    'Mráz',
    'Rosa',
    'Hmla',
    'Búrka',
    'Prameň',
    'Poludnie',
    'Súmrak',
    'Polnoc',
  ],
};

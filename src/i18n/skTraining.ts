// Slovak texts of the Guild Training (M3.7): step titles, the one-line "why", the instructions of the
// step panel per situation (flight, dock, the hub tabs, the shipyard editor), world labels, toasts,
// the skip dialog and the New Game option. The shape is the exported `TrainingTexts` interface, so an
// English module can implement the same keys (see enTraining.ts).
import type { TrainingStepId } from '../data/training';

/** An instruction: keycaps (may be empty) and a short text. */
export interface GuideLine {
  keys: readonly string[];
  text: string;
}

export interface TrainingTexts {
  title: string;
  /** "Krok 3/9". */
  stepOf: (n: number, total: number) => string;
  steps: Record<TrainingStepId, { title: string; why: string }>;
  /** The goal marker's name of a step's target in the world (steps whose target is a station keep the generic name). */
  goalNames: Partial<Record<TrainingStepId, string>>;
  /** Instruction lines by situation. */
  guide: {
    undock: GuideLine;
    /** Flight note: the dampers brake along the bow, a sideways drift stays (no side engines yet). */
    inertia: string;
    mine: GuideLine;
    vein: string;
    tooFastToMine: string;
    /** Docking (taught as the manoeuvre at the dock clamp: slow, F). */
    goDock: readonly GuideLine[];
    slowForDock: string;
    sellAll: GuideLine;
    openOverview: GuideLine;
    /** Instructions of an install task in the shipyard. */
    openShipyard: GuideLine;
    pick: (part: string) => GuideLine;
    tierOne: GuideLine;
    rotate: Record<'side' | 'reverse' | 'forward', GuideLine>;
    /** The big prompt by the ghost while the part is turned wrong (the R key is drawn next to it). */
    turn: Record<'side' | 'reverse' | 'forward', string>;
    /** Its small arrow: where the nozzle points now. */
    nozzleNow: string;
    placeOn: GuideLine;
    placeAny: GuideLine;
    commit: GuideLine;
    /** "Engine T1 is in the storage of Spring station" – the parts wait at another station. */
    partsAt: (station: string) => string;
    stopHere: (speed: string) => string;
    /** Crafting. */
    openCrafting: GuideLine;
    pickRecipe: (part: string) => GuideLine;
    craft: GuideLine;
    /** Checklist. */
    refuel: GuideLine;
    map: GuideLine;
    mapInFlight: string;
    objectives: GuideLine;
    /** Last step: what is still missing. */
    finishItem: Record<'reactor' | 'radar' | 'gyro' | 'engines', string>;
  };
  /** Phases of the step checklist that the situational guide lines do not cover. */
  phases: Record<'flyBuoy' | 'flyRock' | 'flyBuoyB' | 'stop' | 'dock', GuideLine>;
  /** What the step pays. */
  reward: (what: string) => string;
  kit: string;
  /** World labels (Callout). */
  world: {
    buoyA: string;
    buoyB: string;
    rock: string;
    rockDetail: string;
    mineAction: string;
    dock: string;
    dockAction: string;
    distance: (d: string) => string;
    speed: (v: string) => string;
  };
  toast: {
    skippedFitted: string;
    skippedStored: (station: string) => string;
  };
  panel: {
    skip: string;
    hide: string;
    show: string;
    doneTitle: string;
    doneText: string;
    next: GuideLine;
    progress: string;
    /** The tag on a highlighted UI element. */
    here: string;
    close: string;
    /** The panel's state for a moment after a step is done. */
    completed: string;
  };
  skip: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
  };
  newGame: {
    label: string;
    play: string;
    skip: string;
    hint: string;
    hintSkip: string;
  };
  /** Journal manual: one line per step. */
  manual: string;
}

export const skTraining: TrainingTexts = {
  title: 'Výcvik Cechu',
  stepOf: (n, total) => `Krok ${n}/${total}`,
  goalNames: { flyBuoy: 'Bója Cechu', mineIron: 'Cvičný kameň', brakeBuoy: 'Druhá bója' },
  steps: {
    flyBuoy: { title: 'Doleť k bóji Cechu', why: 'Cech ti požičal cvičný trup – najprv sa s ním nauč lietať.' },
    mineIron: { title: 'Vyťaž 20 železa z cvičného kameňa', why: 'Železo je prvý zárobok a materiál na diely.' },
    dockSell: { title: 'Pristaň doma a predaj železo', why: 'Za prvý predaj ti Cech dá 2 bočné motory.' },
    installSide: { title: 'Namontuj 2 bočné motory', why: 'Bočné motory posúvajú loď do strán – tlmiče nimi zastavia šmyk hneď, nie pomaly tryskami kokpitu.' },
    brakeBuoy: { title: 'Zastav pri druhej bóji', why: 'Kto vie zastaviť, nenarazí. Odmenou je druhý spätný motor.' },
    installReverse: { title: 'Namontuj druhý spätný motor', why: 'Dva spätné motory brzdia dvakrát silnejšie – loď zastaví na polovičnej dráhe.' },
    craftCargo: { title: 'Vyrob nákladný priestor a namontuj ho', why: 'Väčší náklad = menej letov domov. Materiál a poplatok platí Cech.' },
    checklist: { title: 'Natankuj a pozri si mapu a ciele', why: 'Pred cestou: plná nádrž, kde si a kam ďalej.' },
    finishShip: { title: 'Dokonči loď', why: 'Reaktor, radar, gyroskop a druhý motor – a loď je hotová.' },
  },
  guide: {
    undock: { keys: ['F'], text: 'Odleť zo stanice' },
    inertia: 'Tlmiče (Z) brzdia samy, keď pustíš plyn. Šmyk do strán zastavia len pomaly manévrovacie trysky kokpitu – bočné motory loď ešte nemá.',
    mine: { keys: ['Pravé tlačidlo'], text: 'drž kurzor na kameni – ťaží laser' },
    vein: 'Mier na svietiacu žilu: ťaží sa o polovicu rýchlejšie.',
    tooFastToMine: 'Laser dočiahne len kúsok – priblíž sa a spomaľ.',
    goDock: [
      { keys: [], text: 'Prileť pomaly k dokovacej svorke na konci ramena' },
      { keys: ['F'], text: 'spomaľ pri svorke a stlač F' },
    ],
    slowForDock: 'Svorka loď prichytí, len keď letí pomaly.',
    sellAll: { keys: [], text: 'Stlač „Predať celý náklad“' },
    openOverview: { keys: ['1'], text: 'Otvor Prehľad' },
    openShipyard: { keys: ['3'], text: 'Otvor Lodenicu' },
    pick: (part) => ({ keys: [], text: `Vyber ${part} v zozname dielov` }),
    tierOne: { keys: ['T'], text: 'Prepni na diely T1' },
    rotate: {
      side: { keys: ['R'], text: 'otoč motor bokom – tryska mieri von z lode' },
      reverse: { keys: ['R'], text: 'otoč motor tryskou k prove – tlačí dozadu' },
      forward: { keys: ['R'], text: 'otoč motor tryskou dozadu – tlačí dopredu' },
    },
    turn: {
      side: 'otoč trysku von z lode',
      reverse: 'otoč trysku k prove',
      forward: 'otoč trysku dozadu',
    },
    nozzleNow: 'Tryska teraz',
    placeOn: { keys: [], text: 'Klikni na zvýraznené miesto vedľa trupu' },
    placeAny: { keys: [], text: 'Klikni na voľné miesto vedľa trupu' },
    commit: { keys: ['Enter'], text: 'Potvrď zmeny' },
    partsAt: (station) => `Diely čakajú v sklade stanice ${station}.`,
    stopHere: (speed) => `Rýchlosť ${speed} – zastav pod 1,5 j/s`,
    openCrafting: { keys: ['2'], text: 'Otvor Trh → Výroba' },
    pickRecipe: (part) => ({ keys: [], text: `Vyber ${part}` }),
    craft: { keys: [], text: 'Stlač Vyrobiť – diel pôjde do skladu' },
    refuel: { keys: [], text: 'Natankuj do plna (Prehľad → Servis)' },
    map: { keys: ['M'], text: 'Otvor mapu' },
    mapInFlight: 'Mapa sa otvára v lete – odleť a stlač M.',
    objectives: { keys: ['G'], text: 'Otvor ciele' },
    finishItem: { reactor: 'Reaktor', radar: 'Radar', gyro: 'Gyroskop', engines: 'Druhý motor dopredu' },
  },
  phases: {
    flyBuoy: { keys: ['W', 'S', 'A', 'D'], text: 'Doleť k bóji Cechu' },
    flyRock: { keys: [], text: 'Prileť k cvičnému kameňu' },
    flyBuoyB: { keys: [], text: 'Prileť k druhej bóji' },
    stop: { keys: ['S', 'Z'], text: 'Zastav pri bóji – brzdi spätným motorom a tlmičmi' },
    dock: { keys: ['F'], text: 'Pristaň v stanici' },
  },
  reward: (what) => `Odmena: ${what}`,
  kit: 'materiál a poplatok na nákladný priestor',
  world: {
    buoyA: 'Bója Cechu',
    buoyB: 'Bója Cechu – zastav tu',
    rock: 'Cvičný kameň',
    rockDetail: 'Železo',
    mineAction: 'ťažiť',
    dock: 'Dokovacia svorka',
    dockAction: 'pristáť',
    distance: (d) => `${d} j`,
    speed: (v) => `${v} j/s`,
  },
  toast: {
    skippedFitted: 'Výcvik preskočený – Cech ti namontoval celú loď.',
    skippedStored: (station) => `Výcvik preskočený – zvyšné diely čakajú v sklade stanice ${station}.`,
  },
  panel: {
    skip: 'Preskočiť výcvik',
    hide: 'Skryť',
    show: 'Výcvik',
    doneTitle: 'Loď je pripravená',
    doneText: 'Výcvik Cechu je za tebou. Prácu ponúkajú Zákazky na stanici.',
    next: { keys: ['4'], text: 'Zákazky – kontrakty' },
    progress: 'Postup',
    here: 'Sem',
    close: 'Zavrieť',
    completed: 'Splnené',
  },
  skip: {
    title: 'Preskočiť výcvik?',
    body: 'Zvyšné diely dostaneš hneď (v doku ti Cech namontuje celú loď). Kredity za nesplnené kroky prepadnú.',
    confirm: 'Preskočiť',
    cancel: 'Pokračovať vo výcviku',
  },
  newGame: {
    label: 'Výcvik Cechu',
    play: 'Hrať výcvik',
    skip: 'Preskočiť výcvik',
    hint: 'Začneš cvičným trupom a Cech ťa krok po kroku naučí lietať, ťažiť a stavať loď (asi 15 minút).',
    hintSkip: 'Začneš s hotovou loďou Cechu, bez výcviku.',
  },
  manual: 'Kroky výcviku',
};

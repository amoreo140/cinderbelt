// Core Slovak texts: HUD, station hub, market, crafting, shipyard, combat, saves, menu and help.
// The shape is `CoreTexts`; en.ts implements the same keys in English. Other areas have their own
// modules (skParts, skFlight, skDiscovery, skPirates, skGoals, …); the game reads them all through `tx()`.
import { formatHullPoints } from './numberFormat';
import { skPlural as plural } from './plural';

export interface CoreTexts {
  /** Units next to numbers (the number itself is formatted by i18n/format.ts). */
  units: {
    /** Credits: "1 240 kr". */
    credits: string;
    /** Amounts of material and distances: "45 j". */
    unit: string;
    /** Speed: "12 j/s". */
    perSecond: string;
  };
  /** Durations and dates (numbers already formatted where they are strings). */
  time: {
    /** Play time under a minute. */
    underMinute: string;
    /** "42 min". */
    minutes: (minutes: number) => string;
    /** Game time, time since a save: "1 h 05 min" (minutes zero-padded). */
    hoursMinutes: (hours: number, minutes: string) => string;
    /** Play time of a save: "1:42 h". */
    playTime: (hours: number, minutes: string) => string;
    /** A save date other than today / yesterday: "12. 10. 2026". */
    date: (day: number, month: number, year: number) => string;
  };
  hud: {
    /** Tag on a HUD part that has just been unlocked. */
    newTag: string;
    speed: string;
    speedUnit: string;
    dampers: string;
    on: string;
    off: string;
    fuel: string;
    energy: string;
    cargo: string;
    zone: string;
    position: string;
    station: string;
    distanceUnit: string;
    /** Vein mining (M2d): the heat bar of the hottest laser and the bonus. */
    heat: string;
    heatShort: string;
    heatHint: string;
    cooling: string;
    bonus: (x: string) => string;
    /** Screen-reader labels of the radar and of the in-world object labels. */
    radar: string;
    callouts: string;
    /** Tooltip of the "?" keycap on the radar corner. */
    legendHint: string;
  };
  rings: readonly string[];
  resources: {
    iron: string;
    copper: string;
    ice: string;
    titanium: string;
  };
  parts: {
    cockpit: string;
    armor: string;
    engine: string;
    gyro: string;
    miningLaser: string;
    cargo: string;
    fuelTank: string;
    reactor: string;
    radar: string;
    cannon: string;
    shield: string;
    heavyLaser: string;
    largeCargo: string;
    battery: string;
    tractorBeam: string;
    largeReactor: string;
    repairModule: string;
    refinery: string;
  };
  loading: {
    title: string;
    models: (loaded: number, total: number) => string;
    /** The game's code or models did not download (a game start from the menu). */
    failed: string;
  };
  map: {
    title: string;
    close: string;
    home: string;
    /** Radius of a ring on the map, in thousands of units: "12 tis. j". */
    ringRadius: (thousands: string) => string;
  };
  stationNames: {
    home: string;
    outpost: string;
    prefixes: readonly string[];
    stars: readonly string[];
  };
  stationKinds: {
    home: string;
    station: string;
    outpost: string;
  };
  station: {
    /** Hub tab labels in `STATION_TABS` order (the 8th, Development, only at the home station). */
    tabs: readonly string[];
    /** Short tab labels, same order – used only when the full ones do not fit the rail (8 tabs at home). */
    tabsShort: readonly string[];
    tabSoon: string;
    tabUnavailable: string;
    /** Tooltip of a tab locked by the Guild Training: unlocks in step n. */
    tabLockedStep: (n: number) => string;
    tabLockedAfter: string;
    ring: (n: number, name: string) => string;
    undock: string;
    coveredNozzles: {
      title: string;
      text: (engines: number) => string;
      action: string;
      noYard: string;
    };
    welcome: string;
    ship: string;
    quickActions: string;
    sellAll: string;
    unloadAll: string;
    refuelIce: string;
    refuelCredits: string;
    cargoList: string;
    storageList: string;
    empty: string;
    services: string;
    serviceNames: {
      market: string;
      partsMarket: string;
      crafting: string;
      shipyard: string;
      repair: string;
      refuel: string;
      save: string;
    };
    /** Footer key hint; `tabs` = the number of tabs at this station (8 at home). */
    keys: (tabs: number) => string;
    partCount: (name: string, tier: number, count: number) => string;
  };
  market: {
    title: string;
    /** Screen-reader header of the buttons column (market, parts market, repairs). */
    actions: string;
    quantity: string;
    max: string;
    resource: string;
    ship: string;
    storage: string;
    sellPrice: string;
    buyPrice: string;
    sell: string;
    buy: string;
    toStorage: string;
    toShip: string;
    sellFrom: string;
    fromShip: string;
    fromStorage: string;
    boughtToStorage: string;
    unloadAll: string;
    nothingToSell: string;
    nothingToMove: string;
    cargoFull: string;
    notEnoughCredits: string;
    unavailable: string;
    kind: string;
    resourcesTab: string;
    partsTab: string;
    tier: string;
    part: string;
    inStorage: string;
    notSoldHere: (ring: number) => string;
    partsNote: string;
    noPartsToSell: string;
    partsUnavailable: string;
  };
  crafting: {
    recipes: string;
    /** Screen-reader header of the have/missing column. */
    status: string;
    tier: string;
    need: string;
    have: string;
    haveHint: string;
    credits: string;
    fee: string;
    count: string;
    max: (n: number) => string;
    craft: string;
    marketPrice: string;
    notSold: string;
    inStorage: string;
    onShip: string;
    openShipyard: string;
    fromStorageFirst: string;
    missing: (list: string) => string;
    missingCredits: (amount: string) => string;
    unavailable: string;
    ready: string;
    crafted: (name: string, count: number) => string;
  };
  service: {
    repairs: string;
    repairsOk: string;
    hull: string;
    part: string;
    hp: string;
    repairCost: string;
    repair: string;
    repairAll: string;
    autoBuy: string;
    autoBuyCost: (credits: string) => string;
    cannotRepair: string;
    noRepairService: string;
    repaired: string;
    refuel: string;
    fromIce: string;
    iceRate: string;
    forCredits: string;
    perUnit: (price: string) => string;
    full: string;
    plusTen: string;
    energy: string;
    emergency: string;
    tankFull: string;
    noIce: string;
    notEnoughCredits: string;
  };
  actionErrors: {
    notDocked: string;
    serviceUnavailable: string;
    invalidQuantity: string;
    notEnoughCredits: string;
    notEnoughResources: string;
    cargoFull: string;
    tankFull: string;
    notNeeded: string;
    notEnoughParts: string;
    notAvailableHere: string;
    nothingToRepair: string;
    invalidDesign: string;
    staleDraft: string;
    unknownPart: string;
    contractUnavailable: string;
    tooManyContracts: string;
    contractNotReady: string;
    notAtDestination: string;
    serviceLocked: string;
    sameStation: string;
    unknownStation: string;
    tooManyShipments: string;
    partLocked: string;
    archiveLocked: string;
    notEnoughData: string;
    chartUnavailable: string;
    chartNotCharted: string;
    chartAlreadyCharted: string;
    chartSold: string;
    chartReserved: string;
    noSlot: string;
    slotCap: string;
    shipNotHere: string;
    unknownShip: string;
    templateCap: string;
    invalidTemplate: string;
    invalidName: string;
    trainingActive: string;
    relaysUnpowered: string;
    notBerthed: string;
    holdFull: string;
    itemTaken: string;
    noMaterials: string;
    notHome: string;
    moduleOwned: string;
    moduleUnavailable: string;
    noPaintShop: string;
    shipNotHome: string;
    samePaint: string;
    noTrophyHall: string;
    shelfFull: string;
    unknownTrophy: string;
    notLinked: string;
    slotSold: string;
    convoyCapReached: string;
    noTanker: string;
    noMapNotes: string;
    notesFull: string;
    unknownNote: string;
    invalidNote: string;
  };
  /** Short resource symbols in prices and recipes ("25 Fe, 15 Cu"). */
  resourceSymbols: {
    iron: string;
    copper: string;
    ice: string;
    titanium: string;
  };
  tiers: {
    1: string;
    2: string;
  };
  shipyard: {
    /** Why a part cannot be placed (at the cursor / red ghost). */
    placement: {
      occupied: string;
      notAdjacent: string;
      outOfBounds: string;
      cockpitLimit: string;
      unknownPart: string;
      invalidOp: string;
      /** SL2 E2: a shape on a part that cannot have one. */
      shapeNotAllowed: string;
    };
    errors: {
      noCockpit: string;
      multipleCockpits: string;
      disconnected: (n: number) => string;
      noForwardEngine: string;
      overlap: string;
      tooLarge: string;
      hullBudget: (tier: number, budget: number, used: number) => string;
      unaffordable: (needed: string, have: string) => string;
      missingParts: (list: string) => string;
      missingResources: (list: string) => string;
    };
    warnings: {
      noBackwardEngine: string;
      noLeftEngine: string;
      noRightEngine: string;
      noMiningLaser: string;
      energyDeficit: (rate: string) => string;
      energyDeficitCombat: (rate: string) => string;
      damagedScrapped: (parts: string, resources: string, noService: boolean) => string;
      cargoOverflow: (cargo: string, capacity: string, moved: string) => string;
      fuelOverflow: (fuel: string, capacity: string, lost: string) => string;
      blockedExhaust: (id: number) => string;
      blockedLaser: (id: number) => string;
      weakTurning: string;
      overBudgetLegacy: (tier: number, budget: number, used: number) => string;
      loanParts: (parts: string) => string;
    };
    stats: {
      mass: string;
      parts: string;
      thrustForward: string;
      thrustBackward: string;
      thrustLeft: string;
      thrustRight: string;
      turning: string;
      cargo: string;
      fuel: string;
      battery: string;
      energyGen: string;
      energyUse: string;
      energyBalance: string;
      radar: string;
      hp: string;
      partHp: string;
      thrust: string;
      torque: string;
      miningRate: string;
      miningRange: string;
      miningEnergy: string;
      damage: string;
      fireRate: string;
      weaponRange: string;
      shotEnergy: string;
      shieldCapacity: string;
      shieldRegen: string;
      shieldDelay: string;
      tractorRange: string;
      tractorParts: string;
      tractorEnergy: string;
      arc: string;
      cannonArc: string;
    };
    cost: {
      fromStorage: string;
      craft: string;
      buy: string;
      install: string;
      toStorage: string;
      returned: string;
      repairs: string;
      total: string;
      none: string;
      installLine: (count: number, fee: string, total: string) => string;
    };
    palette: {
      craft: (list: string, credits: string) => string;
      buy: (price: string) => string;
      unavailable: string;
      unique: string;
    };
    rebuilt: (cost: string) => string;
    rebuiltFree: string;
    ui: {
      palette: string;
      tier: string;
      stats: string;
      check: string;
      cost: string;
      view: string;
      bow: string;
      layers: string;
      center: string;
      viewHint: string;
      undo: string;
      redo: string;
      restore: string;
      cancel: string;
      commit: string;
      committing: string;
      noChanges: string;
      sourceTag: {
        craft: string;
        buy: string;
        unavailable: string;
      };
      uniqueTag: string;
      inStock: string;
      planning: string;
      compare: string;
      selectHint: string;
      ghost: (name: string, deg: number) => string;
      checksOk: {
        connected: string;
        cockpit: string;
        forward: string;
      };
      allGood: string;
      unchanged: string;
      focusHint: string;
      loanBand: string;
      loanBandHint: string;
      loanShow: string;
      thrust: string;
      /** Header of the Properties panel: "TRUP 31½ / 48 b · kokpit T2" (½ points via formatHullPoints). */
      hull: string;
      hullPoints: (used: number, budget: number) => string;
      hullNoBudget: (used: number) => string;
      hullCockpit: (tier: number) => string;
      hullNoCockpit: string;
      hullHint: string;
      capacity: string;
      energy: string;
      accelUnit: string;
      turnUnit: string;
      massUnit: string;
      /** Energy balance rate: "/s" (energy has no unit of its own). */
      perSecond: string;
      missingParts: string;
      remaining: (credits: string) => string;
      short: (credits: string) => string;
      hints: {
        place: string;
        remove: string;
        rotate: string;
        eyedrop: string;
        zoom: string;
        pan: string;
        layers: string;
      };
      mouse: {
        left: string;
        right: string;
        middle: string;
        wheel: string;
        alt: string;
      };
      prompt: {
        back: string;
        cancelTitle: string;
        cancelBody: string;
        cancelConfirm: string;
        undockTitle: string;
        undockBody: string;
        undockConfirm: string;
        staleTitle: string;
        staleBody: string;
        staleConfirm: string;
        staleDiscard: string;
      };
      rebased: (dropped: number) => string;
      failed: (reason: string) => string;
    };
  };
  /** Combat HUD (M3b). */
  combat: {
    shield: string;
    hull: string;
    cannons: string;
    ship: string;
    bow: string;
    damaged: (n: number) => string;
    intact: string;
    lost: string;
    noEnergy: string;
    alert: string;
    attackers: (n: number) => string;
    nearby: (n: number) => string;
    nearest: string;
    salvagePrompt: string;
    salvageApproach: (gap: string) => string;
    salvageHold: string;
    salvageHoldHint: string;
    salvaged: (list: string) => string;
    salvagedFull: (list: string) => string;
    salvagedNothing: string;
    salvagedData: (n: number) => string;
    salvageStored: (list: string, station: string) => string;
    cargoSpilled: (amount: string, toWreck: boolean) => string;
    radarPirate: string;
    radarWreck: string;
  };
  messages: {
    cargoFull: string;
    guildLoan: (station: string, parts: string) => string;
    outOfFuel: string;
    noFuelTow: (name: string, cost: string) => string;
    noFuelTowFree: (name: string) => string;
    noEnginesTow: (name: string, cost: string) => string;
    noEnginesTowFree: (name: string) => string;
    towed: (name: string, cost: string) => string;
    towedFree: (name: string, lost: boolean) => string;
    discovered: (name: string, ring: number) => string;
    docked: (name: string) => string;
    sold: (credits: string) => string;
    muted: string;
    unmuted: string;
  };
  saves: {
    difficulties: {
      none: string;
      mild: string;
      hard: string;
      hardcore: string;
    };
    difficultyHints: {
      none: string;
      mild: string;
      hard: string;
      hardcore: string;
    };
    reasons: {
      new: string;
      manual: string;
      dock: string;
      interval: string;
      quit: string;
      death: string;
    };
    fallenFromHardcore: string;
    emptySlot: string;
    saving: string;
    saved: string;
    saveFailed: string;
    storageUnavailable: string;
    loadErrors: {
      format: string;
      checksum: string;
      parse: string;
      tooNew: (version: number) => string;
      migration: string;
      invalid: string;
      empty: string;
      backupNotAllowed: string;
    };
    corrupt: string;
    unrecoverable: string;
    loadBackup: (savedAt: string) => string;
    shipReplaced: (station: string) => string;
    overBudgetLegacy: (used: number, budget: number) => string;
    capacityClamped: string;
    coveredNozzleLegacy: (engines: number) => string;
    storedShipDropped: (station: string) => string;
    sitesRepaired: string;
    importErrors: {
      json: string;
      noFreeSlot: string;
      slotLocked: string;
      writeFailed: string;
    };
  };
  death: {
    evacuation: (station: string) => string;
    fellFromHardcore: string;
  };
  /** Main menu, new game, loading, pause, settings (M2c). */
  app: {
    menu: {
      title: string;
      continue: string;
      newGame: string;
      load: string;
      settings: string;
      about: string;
      back: string;
      version: (v: string) => string;
      keys: string;
      confirm: string;
      continueFailed: string;
      openLoad: string;
      starting: string;
    };
    storage: {
      local: string;
      persistent: string;
      bestEffort: string;
      unavailable: string;
      exportNow: string;
      dismiss: string;
      mayClear: string;
      exportBackup: string;
      closedElsewhere: string;
    };
    newGame: {
      title: string;
      difficulty: string;
      custom: string;
      presets: {
        calm: string;
        standard: string;
        hard: string;
        hardcore: string;
      };
      presetHints: {
        calm: string;
        standard: string;
        hard: string;
        hardcore: string;
      };
      deathPenalty: string;
      enemies: string;
      enemiesNote: string;
      densities: {
        low: string;
        normal: string;
        high: string;
      };
      miningYield: string;
      seed: string;
      seedHint: string;
      randomSeed: string;
      slot: string;
      slotFor: (difficulty: string) => string;
      slotFree: string;
      slotOverwrite: string;
      slotCorrupt: string;
      slotLocked: string;
      noSlot: string;
      locked: string;
      start: string;
      overwriteTitle: string;
      overwriteBody: (slot: string, name: string, time: string) => string;
      overwriteConfirm: string;
      failed: string;
    };
    load: {
      title: string;
      openElsewhere: string;
      slotName: (difficulty: string, index: number) => string;
      empty: string;
      newHere: string;
      load: string;
      export: string;
      exportRaw: string;
      delete: string;
      import: string;
      imported: (name: string, slot: string) => string;
      importedBackup: string;
      exported: (file: string) => string;
      deleteTitle: string;
      deleteBody: (slot: string, name: string) => string;
      deleteConfirm: string;
      deleted: string;
      deleteCurrent: string;
      deleteFailed: string;
      exportFailed: string;
      loadedBackup: string;
      cantLoad: string;
      where: string;
      fileHint: string;
      count: (n: number) => string;
      docked: (station: string) => string;
      space: (ring: number) => string;
      savedAt: string;
      playTime: string;
      credits: string;
      ship: string;
      seed: string;
      yield: string;
      /** Number of parts on the ship: "12 dielov". */
      parts: (n: number) => string;
      today: string;
      yesterday: string;
      nothing: string;
      pick: string;
      backup: string;
      noBackup: string;
      loading: string;
      current: string;
    };
    pause: {
      title: string;
      resume: string;
      save: string;
      load: string;
      settings: string;
      export: string;
      quit: string;
      quitUnsaved: string;
      lastSave: string;
      ago: (t: string) => string;
      never: string;
      unsaved: string;
      game: string;
      scuttle: string;
      scuttleOnlyFlying: string;
      scuttleTitle: string;
      scuttleBody: (difficulty: string) => string;
      scuttleConfirm: string;
    };
    saveIndicator: {
      saving: string;
      saved: string;
      failed: string;
    };
    settings: {
      title: string;
      audio: string;
      master: string;
      sfx: string;
      music: string;
      ambient: string;
      mute: string;
      controls: string;
      zoom: string;
      help: string;
      helpStates: {
        on: string;
        off: string;
      };
      display: string;
      reducedMotion: string;
      motion: {
        system: string;
        on: string;
        off: string;
      };
      language: string;
      storage: string;
      persistent: string;
      bestEffort: string;
      notYet: string;
      unavailable: string;
      reset: string;
      on: string;
      off: string;
    };
    about: {
      title: string;
      lead: string;
      saves: string;
      controls: string;
      tech: string;
    };
    death: {
      title: string;
      lead: (difficulty: string) => string;
      respawn: (station: string) => string;
      nothingLost: string;
      lostParts: string;
      lostCargo: (amount: string) => string;
      lostSalvage: (n: number) => string;
      damaged: (pct: number) => string;
      fuel: (pct: number) => string;
      kept: string;
      scuttleFee: (cost: string) => string;
      scuttleFeeFree: string;
      scuttleCargo: (amount: string) => string;
      scuttleAsIs: string;
      fallen: string;
      blackBox: string;
      partsLost: (n: number, total: number) => string;
      losses: string;
      kills: string;
      deaths: string;
      stay: (station: string) => string;
      evacuate: (station: string) => string;
      evacuateHint: string;
      continue: string;
    };
    quickSaved: string;
    quickSaveFailed: string;
  };
  help: {
    title: string;
    lines: readonly string[];
    /** Index in `lines` of the mining laser line – the Mining 2.0 lines follow it. */
    laserLine: number;
    /** Index in `lines` of the journal line – the comm log line follows it. */
    journalLine: number;
  };
}

export const sk = {
  units: { credits: 'kr', unit: 'j', perSecond: 'j/s' },
  time: {
    underMinute: '< 1 min',
    minutes: (minutes: number): string => `${minutes} min`,
    hoursMinutes: (hours: number, minutes: string): string => `${hours} h ${minutes} min`,
    playTime: (hours: number, minutes: string): string => `${hours}:${minutes} h`,
    date: (day: number, month: number, year: number): string => `${day}. ${month}. ${year}`,
  },
  hud: {
    newTag: 'NOVÉ',
    speed: 'Rýchlosť',
    speedUnit: 'j/s',
    dampers: 'Tlmiče',
    on: 'ZAP',
    off: 'VYP',
    fuel: 'Palivo',
    energy: 'Energia',
    cargo: 'Náklad',
    zone: 'Zóna',
    position: 'Poloha',
    station: 'Stanica',
    distanceUnit: 'j',
    heat: 'Teplo lasera',
    heatShort: 'Teplo',
    heatHint: 'Na žile sa laser zahrieva – po 4 s sa na 1,5 s vypne a chladne.',
    cooling: 'chladne',
    bonus: (x: string): string => `bonus ×${x}`,
    radar: 'Radar',
    callouts: 'Štítky objektov',
    legendHint: 'Podrž ? pre legendu radaru',
  },
  rings: ['Domovský pás', 'Vonkajšie pásy', 'Kryštálové hmloviny', 'Mŕtve zóny'],
  resources: { iron: 'Železo', copper: 'Meď', ice: 'Ľad', titanium: 'Titán' },
  parts: {
    cockpit: 'Kokpit',
    armor: 'Pancier',
    engine: 'Motor',
    gyro: 'Gyroskop',
    miningLaser: 'Ťažobný laser',
    cargo: 'Nákladný priestor',
    fuelTank: 'Palivová nádrž',
    reactor: 'Reaktor',
    radar: 'Radar',
    cannon: 'Kanón',
    shield: 'Generátor štítu',
    heavyLaser: 'Ťažký laser',
    largeCargo: 'Veľký nákladný priestor',
    battery: 'Batéria',
    tractorBeam: 'Vlečný lúč',
    largeReactor: 'Veľký reaktor',
    repairModule: 'Opravárenský modul',
    refinery: 'Palubná rafinéria',
  },
  loading: {
    title: 'Načítavam…',
    models: (loaded: number, total: number): string => `Modely ${loaded} / ${total}`,
    failed: 'Hra sa nenačítala – skontroluj pripojenie a skús to znova.',
  },
  map: { title: 'Mapa', close: 'M – zavrieť', home: 'Domov', ringRadius: (thousands: string): string => `${thousands} tis. j` },
  stationNames: {
    home: 'Základňa Počiatok',
    outpost: 'Hliadka',
    prefixes: ['Kotva', 'Maják', 'Prístav', 'Útočisko', 'Brána', 'Uzol', 'Kruh', 'Vlna'],
    stars: ['Vega', 'Lyra', 'Orion', 'Kappa', 'Sirius', 'Altair', 'Deneb', 'Rigel'],
  },
  stationKinds: { home: 'domovská stanica', station: 'stanica', outpost: 'hliadka' },
  station: {
    tabs: ['Prehľad', 'Trh', 'Výroba', 'Lodenica', 'Servis', 'Tabuľa', 'Archív', 'Rozvoj'],
    tabsShort: ['Prehľad', 'Trh', 'Výroba', 'Lodenica', 'Servis', 'Tabuľa', 'Archív', 'Rozvoj'],
    tabSoon: 'Pribudne v ďalšej verzii',
    tabUnavailable: 'Táto stanica túto službu nemá',
    tabLockedStep: (n: number): string => `Odomkne sa v kroku ${n} výcviku Cechu`,
    tabLockedAfter: 'Odomkne sa po výcviku Cechu',
    ring: (n: number, name: string): string => `hĺbka ${n} · ${name}`,
    undock: 'Odletieť',
    coveredNozzles: {
      title: 'Zakryté trysky',
      text: (engines: number): string =>
        `${engines} ${plural(engines, 'motor fúka', 'motory fúkajú', 'motorov fúka')} do dielu lode – pri ťahu ho pália.`,
      action: 'Upraviť v lodenici',
      noYard: 'Táto stanica nemá lodenicu',
    },
    welcome: 'Vitaj na Základni Počiatok. Leť ťažiť suroviny do okolitých sektorov, predaj ich tu na trhu a natankuj. Z bohatšieho nákladu vyrobíš nové diely a v Lodenici si s nimi loď prestavíš.',
    ship: 'Loď',
    quickActions: 'Rýchle akcie',
    sellAll: 'Predať celý náklad',
    unloadAll: 'Vyložiť náklad do skladu',
    refuelIce: 'Natankovať z ľadu',
    refuelCredits: 'Natankovať do plna',
    cargoList: 'Náklad',
    storageList: 'Sklad stanice',
    empty: 'prázdny',
    services: 'Služby',
    serviceNames: {
      market: 'trh surovín',
      partsMarket: 'trh dielov',
      crafting: 'výroba',
      shipyard: 'lodenica',
      repair: 'opravy',
      refuel: 'tankovanie',
      save: 'uloženie',
    },
    keys: (tabs: number): string => `1–${tabs} záložky · F odlet · Esc späť na prehľad`,
    partCount: (name: string, tier: number, count: number): string => `${name} T${tier} ×${count}`,
  },
  market: {
    title: 'Suroviny',
    actions: 'Akcie',
    quantity: 'Množstvo',
    max: 'Max',
    resource: 'Surovina',
    ship: 'Loď',
    storage: 'Sklad',
    sellPrice: 'Predáš za',
    buyPrice: 'Kúpiš za',
    sell: 'Predať',
    buy: 'Kúpiť',
    toStorage: '→ Sklad',
    toShip: '→ Loď',
    sellFrom: 'Predávať z:',
    fromShip: 'lode',
    fromStorage: 'skladu',
    boughtToStorage: 'Kúpené suroviny idú do skladu stanice.',
    unloadAll: 'Vyložiť všetko do skladu',
    nothingToSell: 'Nie je čo predať',
    nothingToMove: 'Nie je čo presunúť',
    cargoFull: 'Náklad je plný',
    notEnoughCredits: 'Nedostatok kreditov',
    unavailable: 'Táto stanica nemá trh',
    kind: 'Tovar',
    resourcesTab: 'Suroviny',
    partsTab: 'Diely',
    tier: 'Úroveň',
    part: 'Diel',
    inStorage: 'V sklade',
    notSoldHere: (_ring: number): string => 'na tejto stanici sa nepredáva',
    partsNote: 'Kúpené diely idú do skladu stanice. Namontované diely najprv odober v Lodenici – potom ich tu môžeš predať.',
    noPartsToSell: 'V sklade nie je taký diel',
    partsUnavailable: 'Táto stanica nemá trh dielov',
  },
  crafting: {
    recipes: 'Recepty',
    status: 'Stav',
    tier: 'Úroveň',
    need: 'Potrebné',
    have: 'Máš',
    haveHint: 'sklad + loď',
    credits: 'Kredity',
    fee: 'Poplatok',
    count: 'Počet',
    max: (n: number): string => `max. ${n}`,
    craft: 'Vyrobiť do skladu',
    marketPrice: 'Hotový na trhu',
    notSold: 'nepredáva sa tu',
    inStorage: 'V sklade',
    onShip: 'Na lodi',
    openShipyard: 'Otvoriť v Lodenici',
    fromStorageFirst: 'Suroviny sa berú najprv zo skladu stanice, potom z nákladu. Výroba je okamžitá.',
    missing: (list: string): string => `Chýba ${list}`,
    missingCredits: (amount: string): string => `Nedostatok kreditov: treba ${amount}`,
    unavailable: 'Táto stanica nemá výrobu',
    ready: 'dá sa vyrobiť',
    crafted: (name: string, count: number): string => `Vyrobené: ${count}× ${name} – v sklade stanice`,
  },
  service: {
    repairs: 'Opravy',
    repairsOk: 'Loď je v poriadku.',
    hull: 'Stav trupu',
    part: 'Diel',
    hp: 'HP',
    repairCost: 'Cena opravy',
    repair: 'Opraviť',
    repairAll: 'Opraviť všetko',
    autoBuy: 'Dokúpiť chýbajúce suroviny',
    autoBuyCost: (credits: string): string => `+${credits} za suroviny`,
    cannotRepair: 'Nedostatok kreditov alebo surovín na opravu',
    noRepairService: 'Táto stanica neopravuje',
    repaired: 'Opravené',
    refuel: 'Tankovanie',
    fromIce: 'Z ľadu:',
    iceRate: '1 ľad = 2 palivo, bez poplatku',
    forCredits: 'Za kredity:',
    perUnit: (price: string): string => `${price} kr za jednotku`,
    full: 'Do plna',
    plusTen: '+10',
    energy: 'Energia: batéria sa na stanici nabíja automaticky.',
    emergency: 'Núdzová dávka paliva (zadarmo, štvrť nádrže – aspoň na jeden výlet)',
    tankFull: 'Nádrž je plná',
    noIce: 'Nemáš ľad (v sklade ani v lodi)',
    notEnoughCredits: 'Nedostatok kreditov',
  },
  actionErrors: {
    notDocked: 'Nie si zadokovaný',
    serviceUnavailable: 'Táto stanica službu neponúka',
    invalidQuantity: 'Neplatné množstvo',
    notEnoughCredits: 'Nedostatok kreditov',
    notEnoughResources: 'Nedostatok surovín',
    cargoFull: 'Náklad je plný',
    tankFull: 'Nádrž je plná',
    notNeeded: 'Núdzová dávka teraz nie je potrebná',
    notEnoughParts: 'V sklade nie je dosť dielov',
    notAvailableHere: 'Na tejto stanici sa to nedá získať',
    nothingToRepair: 'Nie je čo opravovať',
    invalidDesign: 'Návrh lode nie je platný',
    staleDraft: 'Loď sa medzitým zmenila – skontroluj návrh a potvrď znova',
    unknownPart: 'Neznámy diel',
    contractUnavailable: 'Kontrakt už nie je k dispozícii',
    tooManyContracts: 'Najviac 3 aktívne kontrakty – najprv nejaký odovzdaj alebo zruš',
    contractNotReady: 'Kontrakt ešte nie je splnený',
    notAtDestination: 'Dodávka sa odovzdáva na cieľovej stanici',
    serviceLocked: 'Služba vyžaduje vyššiu reputáciu',
    sameStation: 'Cieľ musí byť iná stanica',
    unknownStation: 'Stanicu ešte nepoznáš',
    tooManyShipments: 'Na ceste je už veľa zásielok',
    partLocked: 'Diel ešte nemáš odomknutý (Archív alebo plán)',
    archiveLocked: 'Tento uzol Archívu sa teraz nedá odomknúť',
    notEnoughData: 'Nedostatok Dát',
    chartUnavailable: 'Mapu tohto sektora Cech neobchoduje',
    chartNotCharted: 'Sektor ešte nemáš zmapovaný',
    chartAlreadyCharted: 'Sektor už máš zmapovaný',
    chartSold: 'Mapu tohto sektora si už predal',
    chartReserved: 'Túto mapu predáš kontraktom Mapa',
    noSlot: 'Na tejto stanici nemáš voľný slot v hangári',
    slotCap: 'Viac slotov v hangári mať nemôžeš',
    shipNotHere: 'Loď stojí na inej stanici',
    unknownShip: 'Takú loď nemáš',
    templateCap: 'Nemáš voľné miesto na šablónu',
    invalidTemplate: 'Šablóna nie je platný návrh lode',
    invalidName: 'Meno musí mať 1 až 24 znakov',
    trainingActive: 'Najprv dokonči alebo preskoč Výcvik Cechu',
    relaysUnpowered: 'Dokovacia svorka nemá prúd – najprv rozsvieť všetky relé',
    notBerthed: 'Nie si pripojený k tejto stanici',
    holdFull: 'Priestor na diely je plný',
    itemTaken: 'Túto položku si už vzal',
    noMaterials: 'V náklade chýba materiál',
    notHome: 'To sa dá len doma – na Základni Počiatok',
    moduleOwned: 'Tento modul už máš postavený',
    moduleUnavailable: 'Tento modul sa zatiaľ postaviť nedá',
    noPaintShop: 'Najprv postav Lakovňu',
    shipNotHome: 'Loď musí byť doma – zadokovaná alebo v hangári',
    samePaint: 'Loď už má tento lak',
    noTrophyHall: 'Najprv postav Trofejnú sieň',
    shelfFull: 'Všetky podstavce sú obsadené – najprv niečo odopni',
    unknownTrophy: 'Takú trofej nemáš',
    notLinked: 'Nie si pripojený ku konvoju',
    slotSold: 'Tento tovar je už predaný',
    convoyCapReached: 'Konvoj už viac neberie',
    noTanker: 'Konvoj nemá cisternu',
    noMapNotes: 'Značky na mape odomyká Archív',
    notesFull: 'Všetky značky sú obsadené – najprv niektorú zmaž',
    unknownNote: 'Takú značku nemáš',
    invalidNote: 'Neplatná značka – text musí mať 1 až 40 znakov',
  },
  resourceSymbols: { iron: 'Fe', copper: 'Cu', ice: 'ľad', titanium: 'Ti' },
  tiers: { 1: 'T1 železo', 2: 'T2 titán' },
  shipyard: {
    placement: {
      occupied: 'Bunka je obsadená',
      notAdjacent: 'Diel musí susediť s loďou',
      outOfBounds: 'Mimo hangára',
      cockpitLimit: 'Loď môže mať len jeden kokpit',
      unknownPart: 'Diel už neexistuje',
      invalidOp: 'Neplatná operácia',
      shapeNotAllowed: 'Tvary má len pancier',
    },
    errors: {
      noCockpit: 'Loď nemá kokpit.',
      multipleCockpits: 'Loď môže mať len jeden kokpit.',
      disconnected: (n: number): string =>
        n === 1
          ? '1 diel nie je spojený s kokpitom (označený červeno).'
          : n < 5
            ? `${n} diely nie sú spojené s kokpitom (označené červeno).`
            : `${n} dielov nie je spojených s kokpitom (označené červeno).`,
      noForwardEngine: 'Loď potrebuje aspoň jeden motor ťahajúci dopredu.',
      overlap: 'Diely sa prekrývajú.',
      tooLarge: 'Loď presahuje hangár 15 × 15.',
      hullBudget: (tier: number, budget: number, used: number): string =>
        `Kokpit T${tier} unesie ${budget} b trupu (máš ${used} b).`,
      unaffordable: (needed: string, have: string): string => `Nedostatok kreditov: treba ${needed}, máš ${have}.`,
      missingParts: (list: string): string => `${list} sa na tejto stanici nedá vyrobiť ani kúpiť.`,
      missingResources: (list: string): string => `Na výrobu a opravy chýba ${list}.`,
    },
    warnings: {
      noBackwardEngine: 'Žiadny motor dozadu – brzdiť a cúvať budeš len slabými manévrovacími tryskami kokpitu (pomaly).',
      noLeftEngine: 'Žiadny motor doľava – doľava ťa posunú a šmyk zastavia len slabé manévrovacie trysky kokpitu (pomaly).',
      noRightEngine: 'Žiadny motor doprava – doprava ťa posunú a šmyk zastavia len slabé manévrovacie trysky kokpitu (pomaly).',
      noMiningLaser: 'Loď nemá ťažobný laser.',
      energyDeficit: (rate: string): string =>
        `Pri ťažbe spotrebuješ viac energie, než vyrábaš (${rate}/s) – batéria sa vybije.`,
      energyDeficitCombat: (rate: string): string =>
        `Pri streľbe a dobíjaní štítu spotrebuješ viac energie, než vyrábaš (${rate}/s) – batéria sa vybije.`,
      damagedScrapped: (parts: string, resources: string, noService: boolean): string =>
        (noService ? 'Táto stanica neopravuje' : 'Na opravu nemáš kredity ani materiál') +
        ` – poškodené diely (${parts}) sa rozoberú na šrot: ${resources || 'nič'} do skladu.`,
      cargoOverflow: (cargo: string, capacity: string, moved: string): string =>
        `Náklad (${cargo}) sa nezmestí do novej kapacity (${capacity}) – ${moved} jednotiek sa presunie do skladu stanice.`,
      fuelOverflow: (fuel: string, capacity: string, lost: string): string =>
        `Nová nádrž (${capacity}) je menšia ako palivo (${fuel}) – ${lost} paliva sa stratí.`,
      blockedExhaust: (id: number): string =>
        `Tryska motora #${id} je zakrytá dielom – motor dá len polovičný ťah a kým ťahá, diel pred tryskou horí (2 HP/s).`,
      blockedLaser: (id: number): string => `Laser #${id} mieri priamo do dielu (len vzhľad).`,
      weakTurning: 'Loď sa otáča veľmi pomaly (< 0,5 rad/s²) – pridaj gyroskop.',
      overBudgetLegacy: (tier: number, budget: number, used: number): string =>
        `Loď zo starej hry má ${used} b trupu, kokpit T${tier} unesie ${budget} b. Lieta ďalej, ale pridať diel ` +
        'môžeš, až keď klesne pod rozpočet.',
      loanParts: (parts: string): string =>
        `Výpožička Cechu: ${parts}. Funguje ako vlastný diel, ale nedá sa predať, rozobrať, uskladniť ani poslať – ` +
        'odobratý diel sa vráti Cechu.',
    },
    stats: {
      mass: 'Hmotnosť',
      parts: 'Diely',
      thrustForward: 'Dopredu',
      thrustBackward: 'Dozadu',
      thrustLeft: 'Doľava',
      thrustRight: 'Doprava',
      turning: 'Otáčanie',
      cargo: 'Náklad',
      fuel: 'Palivo',
      battery: 'Batéria',
      energyGen: 'Výroba energie',
      energyUse: 'Spotreba laserov',
      energyBalance: 'Energia',
      radar: 'Radar',
      hp: 'HP spolu',
      partHp: 'HP',
      thrust: 'Ťah',
      torque: 'Krútiaci moment',
      miningRate: 'Ťažba',
      miningRange: 'Dosah lasera',
      miningEnergy: 'Spotreba lasera',
      damage: 'Poškodenie',
      fireRate: 'Kadencia',
      weaponRange: 'Dostrel',
      shotEnergy: 'Energia na výstrel',
      shieldCapacity: 'Kapacita štítu',
      shieldRegen: 'Dobíjanie',
      shieldDelay: 'Oneskorenie dobíjania',
      tractorRange: 'Dosah lúča',
      tractorParts: 'Utiahne dielov',
      tractorEnergy: 'Spotreba lúča',
      arc: 'Palebný výsek',
      cannonArc: 'Výseky kanónov',
    },
    cost: {
      fromStorage: 'Zo skladu',
      craft: 'Vyrobiť',
      buy: 'Kúpiť',
      install: 'Montáž',
      toStorage: 'Do skladu',
      returned: 'Vrátiť Cechu',
      repairs: 'Oprava pri demontáži',
      total: 'Spolu',
      none: '–',
      installLine: (count: number, fee: string, total: string): string => `${count} × ${fee} = ${total}`,
    },
    palette: {
      craft: (list: string, credits: string): string => `Vyrobiť: ${list}, ${credits}`,
      buy: (price: string): string => `Kúpiť: ${price}`,
      unavailable: 'Nedá sa získať na tejto stanici',
      unique: 'max. 1 na loď',
    },
    rebuilt: (cost: string): string => `Loď prestavaná (−${cost})`,
    rebuiltFree: 'Loď prestavaná',
    ui: {
      palette: 'Diely',
      tier: 'Úroveň',
      stats: 'Vlastnosti',
      check: 'Kontrola',
      cost: 'Cena zmien',
      view: 'Hangár – plocha editora lode',
      bow: 'Príď',
      layers: 'Vrstvy',
      center: 'Vycentrovať',
      viewHint: 'Koliesko priblíži, ťahanie stredným tlačidlom posunie pohľad.',
      undo: 'Späť',
      redo: 'Znova',
      restore: 'Obnoviť pôvodnú',
      cancel: 'Zrušiť',
      commit: 'Potvrdiť zmeny',
      committing: 'Potvrdzujem…',
      noChanges: 'Loď je bez zmien',
      sourceTag: { craft: 'vyrobiť', buy: 'kúpiť', unavailable: 'nedá sa' },
      uniqueTag: 'max. 1',
      inStock: 'Zo skladu stanice',
      planning: 'Diel môžeš položiť aj bez skladu – cena sa pripočíta.',
      compare: 'T1 → T2',
      selectHint: 'Vyber diel klávesom 1–9 (ďalší rad Shift + 1–9) alebo kliknutím. Bez výberu diel na lodi chytíš a presunieš.',
      ghost: (name: string, deg: number): string => `${name} · ${deg}°`,
      checksOk: { connected: 'súvislá', cockpit: '1 kokpit', forward: 'motor dopredu' },
      allGood: 'Návrh je v poriadku – môžeš ho potvrdiť.',
      unchanged: 'Zatiaľ bez zmien. Vyber diel v palete a polož ho k lodi.',
      focusHint: 'Kliknutím na hlásenie sa diely zvýraznia v hangári.',
      loanBand: 'Výpožička Cechu',
      loanBandHint: 'Funguje ako vlastný diel, ale nedá sa predať, rozobrať, uskladniť ani poslať – odobratý diel sa vráti Cechu.',
      loanShow: 'Ukázať',
      thrust: 'Ťah a zrýchlenie',
      hull: 'Trup',
      hullPoints: (used: number, budget: number): string => `${formatHullPoints(used, 'sk')} / ${formatHullPoints(budget, 'sk')} b`,
      hullNoBudget: (used: number): string => `${formatHullPoints(used, 'sk')} b`,
      hullCockpit: (tier: number): string => `kokpit T${tier}`,
      hullNoCockpit: 'bez kokpitu',
      hullHint: 'Body trupu: diel 1×1 = 1 b, 2×1 = 2 b, 2×2 = 3 b. Rozpočet určuje kokpit (T1 28 b, T2 48 b).',
      capacity: 'Kapacity',
      energy: 'Energia pri ťažbe',
      accelUnit: 'j/s²',
      turnUnit: 'rad/s²',
      massUnit: 't',
      perSecond: '/s',
      missingParts: 'Chýbajúce diely',
      remaining: (credits: string): string => `ostane ${credits}`,
      short: (credits: string): string => `chýba ${credits}`,
      hints: {
        place: 'položiť, ťahať',
        remove: 'odobrať',
        rotate: 'otočiť',
        eyedrop: 'kvapkadlo',
        zoom: 'priblížiť',
        pan: 'posunúť',
        layers: 'vrstvy',
      },
      mouse: { left: 'Ľavé', right: 'Pravé', middle: 'Stredné', wheel: 'Koliesko', alt: 'Alt+klik' },
      prompt: {
        back: 'Späť k návrhu',
        cancelTitle: 'Zrušiť úpravy lode?',
        cancelBody: 'Návrh sa zahodí a loď ostane taká, aká bola.',
        cancelConfirm: 'Zahodiť úpravy',
        undockTitle: 'Odletieť bez potvrdenia?',
        undockBody: 'Nepotvrdené úpravy lode sa zahodia. Ak ich chceš zachovať, najprv ich potvrď.',
        undockConfirm: 'Zahodiť a odletieť',
        staleTitle: 'Loď sa medzitým zmenila',
        staleBody:
          'Odkedy vznikol návrh, zmenila sa loď alebo sklad dielov na stanici. Návrh môžeš preniesť na aktuálny stav – úpravy sa prehrajú znova – alebo ho zahodiť.',
        staleConfirm: 'Preniesť návrh',
        staleDiscard: 'Zahodiť návrh',
      },
      rebased: (dropped: number): string =>
        dropped === 0 ? 'Návrh prenesený na aktuálnu loď' : `Návrh prenesený – ${dropped} úprav sa už nedalo vykonať`,
      failed: (reason: string): string => `Prestavba zlyhala: ${reason}`,
    },
  },
  combat: {
    shield: 'Štít',
    hull: 'Trup',
    cannons: 'Kanóny',
    ship: 'Stav lode',
    bow: 'Príď',
    damaged: (n: number): string =>
      `${n} ${plural(n, 'poškodený diel', 'poškodené diely', 'poškodených dielov')}`,
    intact: 'Bez poškodenia',
    lost: 'zničený',
    noEnergy: 'málo energie',
    alert: 'Piráti!',
    attackers: (n: number): string => `${n} ${plural(n, 'útočník', 'útočníci', 'útočníkov')}`,
    nearby: (n: number): string => `${n} ${plural(n, 'pirát', 'piráti', 'pirátov')} v okolí`,
    nearest: 'najbližší',
    salvagePrompt: 'F – naložiť korisť',
    salvageApproach: (gap: string): string => `Vrak s korisťou – prileť bližšie (${gap} j)`,
    salvageHold: 'Korisť',
    salvageHoldHint: 'Diely z vrakov – pri pristátí pôjdu do skladu stanice',
    salvaged: (list: string): string => `Naložené z vraku: ${list}`,
    salvagedFull: (list: string): string => `Naložené z vraku: ${list} – náklad je plný, zvyšok ostal vo vraku`,
    salvagedNothing: 'Náklad je plný – korisť ostala vo vraku',
    salvagedData: (n: number): string => ` · +${n} Dát za neporušené diely`,
    salvageStored: (list: string, station: string): string => `Diely z vrakov uložené na stanici ${station}: ${list}`,
    cargoSpilled: (amount: string, toWreck: boolean): string =>
      `Prišiel si o nákladný priestor – ${amount} j surovín sa vysypalo${toWreck ? ' do vraku' : ''}`,
    radarPirate: 'pirát',
    radarWreck: 'vrak s korisťou',
  },
  messages: {
    cargoFull: 'Nákladný priestor je plný',
    guildLoan: (station: string, parts: string): string =>
      `Výpožička Cechu na stanici ${station}: ${parts} – namontované zadarmo. Diel patrí Cechu: funguje normálne, ` +
      'ale nedá sa predať, rozobrať ani uskladniť; keď ho v lodenici odoberieš, vráti sa Cechu.',
    outOfFuel: 'Došlo palivo!',
    noFuelTow: (name: string, cost: string): string => `Bez paliva – H: odtiahnutie na stanicu ${name} (${cost})`,
    noFuelTowFree: (name: string): string => `Bez paliva – H: odtiahnutie na stanicu ${name} (zadarmo, stratíš náklad)`,
    noEnginesTow: (name: string, cost: string): string => `Bez motorov – H: odtiahnutie na stanicu ${name} (${cost})`,
    noEnginesTowFree: (name: string): string =>
      `Bez motorov – H: odtiahnutie na stanicu ${name} (zadarmo, stratíš náklad)`,
    towed: (name: string, cost: string): string => `Loď odtiahnutá na stanicu ${name} (−${cost})`,
    towedFree: (name: string, lost: boolean): string =>
      `Loď odtiahnutá na stanicu ${name}${lost ? ' – náklad stratený' : ''}`,
    discovered: (name: string, ring: number): string => `Objavená stanica: ${name} (hĺbka ${ring})`,
    docked: (name: string): string => `Pristál si na stanici ${name}`,
    sold: (credits: string): string => `Predané (+${credits})`,
    muted: 'Zvuk vypnutý (N)',
    unmuted: 'Zvuk zapnutý (N)',
  },
  saves: {
    difficulties: { none: 'Žiadny', mild: 'Mierny', hard: 'Tvrdý', hardcore: 'Hardcore' },
    difficultyHints: {
      none: 'obnova na poslednej stanici, nič nestratíš; piráti mieria zle a reagujú pomaly',
      mild: 'stratíš náklad, loď bude poškodená (oprava stojí); piráti mieria priemerne',
      hard: 'stratíš namontované diely aj náklad; kredity a sklady na staniciach ostanú; piráti mieria presne',
      hardcore: 'po smrti hra spadne do obťažnosti Tvrdý a uplatní sa jej trest; piráti takmer nemiňú',
    },
    reasons: { new: 'nová hra', manual: 'ručne', dock: 'dok', interval: 'auto', quit: 'odchod', death: 'smrť' },
    fallenFromHardcore: 'Padlý hrdina',
    emptySlot: 'Prázdny slot',
    saving: 'Ukladám…',
    saved: 'Hra uložená',
    saveFailed: 'Uloženie zlyhalo – skúsim to znova pri ďalšom uložení',
    storageUnavailable: 'Ukladanie nie je dostupné – po zatvorení karty sa postup stratí. Exportuj hru do súboru.',
    loadErrors: {
      format: 'Toto nie je uložená hra Cinderbelt.',
      checksum: 'Uložená hra je poškodená (kontrolný súčet nesedí).',
      parse: 'Uložená hra je poškodená (dáta sa nedajú prečítať).',
      tooNew: (version: number): string => `Uložené novšou verziou hry (v${version}) – nedá sa načítať.`,
      migration: 'Uloženú hru sa nepodarilo previesť na túto verziu.',
      invalid: 'Uložená hra obsahuje neplatné údaje.',
      empty: 'Slot je prázdny.',
      backupNotAllowed: 'Záloha slúži len na obnovu poškodenej hry.',
    },
    corrupt: 'Hlavný záznam sa nedá načítať.',
    unrecoverable: 'Hru sa nepodarilo obnoviť.',
    loadBackup: (savedAt: string): string => `Načítať zálohu (uložená ${savedAt})`,
    shipReplaced: (station: string): string => `Loď bola poškodená, diely sú v sklade stanice ${station}.`,
    overBudgetLegacy: (used: number, budget: number): string =>
      `Loď zo starej hry prekračuje rozpočet trupu (${used} / ${budget} b) – lieta ďalej, ale diel pridáš, až keď klesne pod rozpočet.`,
    capacityClamped: 'Niektoré hodnoty v uloženej hre prekračovali kapacitu (palivo, energia, náklad, odolnosť) – upravili sa na maximum.',
    coveredNozzleLegacy: (engines: number): string =>
      `Pozor: ${engines} ${plural(engines, 'motor fúka', 'motory fúkajú', 'motorov fúka')} tryskou priamo do iného dielu lode. ` +
      'Odteraz ten diel pri ťahu horí – uprav loď v lodenici (kokpit pod 1 bod odolnosti neklesne).',
    storedShipDropped: (station: string): string => `Loď v hangári bola poškodená, jej diely a náklad sú v sklade stanice ${station}.`,
    sitesRepaired: 'Niektoré záznamy o miestach vo vesmíre (stanice, relé, kométy, míny) nesedeli s týmto svetom – boli odstránené.',
    importErrors: {
      json: 'Súbor sa nedá prečítať.',
      noFreeSlot: 'V tejto obťažnosti nie je voľný slot – najprv nejaký zmaž.',
      slotLocked: 'Slot obsahuje hru z novšej verzie – najprv ju zmaž.',
      writeFailed: 'Import sa nepodarilo uložiť.',
    },
  },
  death: {
    evacuation: (station: string): string => `Bezplatná evakuácia na stanicu ${station} s lodenicou`,
    fellFromHardcore: 'Hardcore hra spadla do obťažnosti Tvrdý.',
  },
  app: {
    menu: {
      title: 'Hlavné menu',
      continue: 'Pokračovať',
      newGame: 'Nová hra',
      load: 'Načítať hru',
      settings: 'Nastavenia',
      about: 'O hre',
      back: 'Späť',
      version: (v: string): string => `verzia ${v}`,
      keys: 'výber',
      confirm: 'potvrdiť',
      continueFailed: 'Poslednú hru sa nepodarilo načítať.',
      openLoad: 'Otvoriť Načítať hru',
      starting: 'Pripravujem vesmír…',
    },
    storage: {
      local: 'Hry sa ukladajú lokálne v tomto prehliadači',
      persistent: 'Trvalé úložisko povolené',
      bestEffort: 'Prehliadač môže uložené hry pri nedostatku miesta zmazať. Exportuj si zálohu.',
      unavailable: 'Ukladanie nie je dostupné (súkromné okno?) – po zatvorení karty sa postup stratí.',
      exportNow: 'Exportovať hru',
      dismiss: 'Rozumiem',
      mayClear: 'Hry sú v tomto prehliadači – pri nedostatku miesta ich môže zmazať',
      exportBackup: 'Exportovať zálohu',
      closedElsewhere: 'Hru aktualizovala iná karta – v tejto karte sa už neukladá. Obnov stránku.',
    },
    newGame: {
      title: 'Nová hra',
      difficulty: 'Obťažnosť',
      custom: 'Vlastná',
      presets: { calm: 'Pokojná', standard: 'Štandardná', hard: 'Tvrdá', hardcore: 'Hardcore' },
      presetHints: {
        calm: 'Na pokojné objavovanie. Smrť ťa nič nestojí, ťažba je dvojnásobná, pirátov je málo a mieria zle.',
        standard: 'Vyvážená hra. Po smrti prídeš o náklad a loď bude poškodená. Piráti mieria priemerne.',
        hard: 'Pre skúsených. Po smrti prídeš o loď aj náklad, pirátov je veľa a mieria presne.',
        hardcore: 'Jeden život. Piráti takmer nemiňú. Po smrti hra natrvalo spadne do obťažnosti Tvrdý.',
      },
      deathPenalty: 'Trest za smrť',
      enemies: 'Nepriatelia',
      enemiesNote: 'Prejaví sa s pirátmi.',
      densities: { low: 'Málo', normal: 'Normálne', high: 'Veľa' },
      miningYield: 'Výnos ťažby',
      seed: 'Seed vesmíru',
      seedHint: 'Rovnaký seed = rovnaký vesmír. Prázdne pole vygeneruje náhodný.',
      randomSeed: 'Náhodný',
      slot: 'Slot',
      slotFor: (difficulty: string): string => `Slot · ${difficulty}`,
      slotFree: 'Voľný',
      slotOverwrite: 'Prepíše sa',
      slotCorrupt: 'Poškodený – prepíše sa',
      slotLocked: 'Novšia verzia hry – najprv zmaž',
      noSlot: 'Všetky sloty tejto obťažnosti sú zamknuté. Zmaž niektorý v Načítať hru.',
      locked: 'Nastavenia sa po začatí hry nedajú zmeniť.',
      start: 'Začať hru',
      overwriteTitle: 'Prepísať uloženú hru?',
      overwriteBody: (slot: string, name: string, time: string): string =>
        `V slote ${slot} je hra „${name}“ (${time}). Nová hra ju nahradí a nedá sa to vrátiť.`,
      overwriteConfirm: 'Prepísať',
      failed: 'Hru sa nepodarilo založiť.',
    },
    load: {
      title: 'Načítať hru',
      openElsewhere: 'Táto hra je otvorená v inej karte – najprv ju tam ukonči (návrat do menu alebo zatvorenie karty).',
      slotName: (difficulty: string, index: number): string => `${difficulty} ${index + 1}`,
      empty: 'Prázdny slot',
      newHere: 'Nová hra sem',
      load: 'Načítať',
      export: 'Exportovať',
      exportRaw: 'Exportovať surové dáta',
      delete: 'Zmazať',
      import: 'Importovať zo súboru',
      imported: (name: string, slot: string): string => `Hra „${name}“ importovaná do slotu ${slot}`,
      importedBackup: 'Hlavný záznam v súbore bol poškodený – použila sa záloha.',
      exported: (file: string): string => `Uložené do súboru ${file}`,
      deleteTitle: 'Zmazať uloženú hru?',
      deleteBody: (slot: string, name: string): string => `Naozaj zmazať hru „${name}“ v slote ${slot}? Nedá sa to vrátiť.`,
      deleteConfirm: 'Zmazať',
      deleted: 'Hra zmazaná',
      deleteCurrent: 'Túto hru práve hráš – najprv odíď do menu.',
      deleteFailed: 'Hru sa nepodarilo zmazať.',
      exportFailed: 'Export sa nepodaril.',
      loadedBackup: 'Načítaná záloha – hlavný záznam bol poškodený.',
      cantLoad: 'Nedá sa načítať',
      where: 'Poloha',
      fileHint: 'súbor .cinder',
      count: (n: number): string => `${n} / 4`,
      docked: (station: string): string => `Zadokovaný · ${station}`,
      space: (ring: number): string => `Vo vesmíre · hĺbka ${ring}`,
      savedAt: 'Uložené',
      playTime: 'Herný čas',
      credits: 'Kredity',
      ship: 'Loď',
      seed: 'Seed',
      yield: 'Výnos',
      parts: (n: number): string => `${n} ${plural(n, 'diel', 'diely', 'dielov')}`,
      today: 'dnes',
      yesterday: 'včera',
      nothing: 'Zatiaľ tu nie je žiadna uložená hra.',
      pick: 'Vyber slot so hrou.',
      backup: 'Záloha',
      noBackup: 'Bez zálohy',
      loading: 'Načítavam…',
      current: 'Práve hráš',
    },
    pause: {
      title: 'Pauza',
      resume: 'Pokračovať',
      save: 'Uložiť hru',
      load: 'Načítať hru',
      settings: 'Nastavenia',
      export: 'Exportovať hru',
      quit: 'Uložiť a odísť do menu',
      quitUnsaved: 'Odísť do menu',
      lastSave: 'Posledné uloženie',
      ago: (t: string): string => `pred ${t}`,
      never: 'zatiaľ neuložené',
      unsaved: 'Táto hra sa neukladá (rýchly štart).',
      game: 'Táto hra',
      scuttle: 'Opustiť loď',
      scuttleOnlyFlying: 'Loď sa dá opustiť len počas letu.',
      scuttleTitle: 'Opustiť loď?',
      scuttleBody: (difficulty: string): string =>
        `Loď sa zničí a uplatní sa trest za smrť obťažnosti ${difficulty}. Náklad ostane vo vraku, Cech ťa odtiahne za ` +
        'poplatok ako pri odťahu (bez peňazí zadarmo) a loď neopraví ani nenatankuje. Použi to, keď uviazneš.',
      scuttleConfirm: 'Opustiť loď',
    },
    saveIndicator: {
      saving: 'Ukladám',
      saved: 'Uložené',
      failed: 'Uloženie zlyhalo',
    },
    settings: {
      title: 'Nastavenia',
      audio: 'Zvuk',
      master: 'Celková hlasitosť',
      sfx: 'Efekty',
      music: 'Hudba',
      ambient: 'Ambient vesmíru',
      mute: 'Stlmiť všetko',
      controls: 'Ovládanie',
      zoom: 'Citlivosť priblíženia',
      help: 'Nápoveda ovládania v lete',
      helpStates: { on: 'Rozbalená', off: 'Zbalená' },
      display: 'Zobrazenie',
      reducedMotion: 'Redukcia pohybu',
      motion: { system: 'Podľa systému', on: 'Zapnutá', off: 'Vypnutá' },
      language: 'Jazyk',
      storage: 'Uložené hry',
      persistent: 'Trvalé úložisko: povolené',
      bestEffort: 'Trvalé úložisko: zamietnuté prehliadačom',
      notYet: 'Trvalé úložisko: požiada sa pri prvom uložení',
      unavailable: 'Ukladanie nie je dostupné',
      reset: 'Obnoviť predvolené',
      on: 'Zap',
      off: 'Vyp',
    },
    about: {
      title: 'O hre',
      lead: 'Postav si loď z dielov, ťaž suroviny v sektoroch okolo domovskej stanice, obchoduj, vyrábaj a leť ďalej, kam sa ešte nikto nedostal.',
      saves:
        'Hra sa ukladá sama pri pristátí, každé 2 minúty hry, pri odchode do menu a keď skryješ kartu. Kedykoľvek ulož klávesom F5 alebo v pauze (Esc). Uložené hry sú len v tomto prehliadači – dôležité si exportuj do súboru.',
      controls: 'Ovládanie',
      tech: 'Three.js, Preact, Web Audio. Písma Archivo a Atkinson Hyperlegible Next.',
    },
    death: {
      title: 'Loď zničená',
      lead: (difficulty: string): string => `Trest za smrť: ${difficulty}`,
      respawn: (station: string): string => `Obnova na stanici ${station}.`,
      nothingLost: 'Nestratil si nič – loď sa vráti taká, aká bola tesne pred zničením, s plnou nádržou.',
      lostParts: 'Namontované diely sú stratené – Cech ti požičia štartovaciu loď, no len diely, na ktoré nemáš kredity ani diely v sklade, a nikdy viac, než si stratil.',
      lostCargo: (amount: string): string => `Náklad ${amount} je stratený.`,
      lostSalvage: (n: number): string => `Diely z vrakov na palube (${n}) sú stratené.`,
      damaged: (pct: number): string => `Loď bude poškodená (najviac ${pct} % odolnosti).`,
      fuel: (pct: number): string => `V nádrži ostane ${pct} % paliva.`,
      kept: 'Kredity a sklady na staniciach ostávajú.',
      scuttleFee: (cost: string): string => `Opustil si loď: Cech odtiahne vrak za ${cost}.`,
      scuttleFeeFree: 'Opustil si loď a na odťah nemáš – Cech ho spraví zadarmo.',
      scuttleCargo: (amount: string): string => `Náklad ${amount} ostal vo vraku – kým sa nerozpadne, môžeš si poň doletieť.`,
      scuttleAsIs: 'Loď sa neopraví ani nenatankuje – príde taká, aká bola.',
      fallen: 'Hardcore sa skončil. Hra pokračuje v obťažnosti Tvrdý – v menu ju označí štítok „Padlý hrdina“.',
      blackBox: 'Čierna skrinka',
      partsLost: (n: number, total: number): string => `Zničené diely: ${n} z ${total}`,
      losses: 'Stratíš',
      kills: 'Zostrelené lode',
      deaths: 'Smrti',
      stay: (station: string): string => `Ostať na stanici ${station}`,
      evacuate: (station: string): string => `Evakuovať na stanicu ${station}`,
      evacuateHint: 'Stanica obnovy nemá lodenicu – evakuácia k lodenici je zadarmo.',
      continue: 'Pokračovať',
    },
    quickSaved: 'Hra uložená (F5)',
    quickSaveFailed: 'Uloženie zlyhalo',
  },
  help: {
    title: 'Ovládanie',
    lines: [
      'W / S – ťah dopredu / dozadu',
      'A / D – otáčanie',
      'Q / E – bočný posun',
      'Myš + ľavé tlačidlo – kanóny',
      'Myš + pravé tlačidlo – ťažobný laser',
      'Z – inerciálne tlmiče',
      'F – pristáť / odletieť / korisť',
      'Tab – skener: ťuk pulz, podrž analýza',
      'T – vlečný lúč: zachytiť / pustiť',
      'Y / X – mýto: zaplatiť / odmietnuť',
      'M – mapa',
      'J – denník',
      'G – ciele',
      'I – sklady',
      'N – zvuk zap / vyp',
      'H – odtiahnutie (bez paliva)',
      '? – podrž: legenda radaru',
      'Koliesko – priblíženie',
      'F5 – uložiť hru',
      'Esc – pauza',
    ],
    laserLine: 4,
    journalLine: 11,
  },
} as const satisfies CoreTexts;

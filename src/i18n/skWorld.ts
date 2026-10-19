// Slovak texts of M4b "The world comes alive": space
// events, the HUD event chip, derelict stations and their terminal, ship graveyards, comets and the
// map. The shape is the exported `WorldTexts` interface; enWorld.ts implements the same keys in English.
// T0 placeholders – sub-object owners: `events`, `hud`, `derelict` → T9; `map`, `graveyard`, `comet` →
// T10 (radio lines are in skComms, T8; derelict logs in skJournal, T4).
import type { DirectorEventKind } from '../data/events';
import type { DerelictDefence, DerelictService } from '../sim/sites/types';

export interface WorldTexts {
  /** Space events (director): names on the chip, the radio and the journal. */
  events: {
    names: Record<DirectorEventKind, string>;
    /** "Comet K-3 will pass through the Rust Threshold sector in 2 min". */
    cometFlyby: (comet: string, sector: string, eta: string) => string;
  };
  /** The HUD event chip. */
  hud: {
    /** Countdown to the end: "1:24". */
    left: (time: string) => string;
    /** During the warning lead: "o 8 s". */
    in: (time: string) => string;
    /** Accessible label of the direction arrow. */
    direction: string;
    /** Name of the chip group for screen readers. */
    region: string;
    /** Seconds under a minute: "8 s" (longer times are "1:24"). */
    seconds: (s: number) => string;
    /** An open-ended event (an ambush while its party lives) – no timer. */
    ongoing: string;
    /** Warning lead for screen readers ("Varovanie"). */
    warning: string;
    /** Direction as a clock bearing (12 = ahead): "at 5 o'clock". */
    clock: (hour: number) => string;
  };
  /** Derelict stations and the terminal. */
  derelict: {
    /** Name on the map / radar / terminal ("Abandoned station"). */
    name: string;
    relay: string;
    /** Relay charge on the scan HUD: "Relay 2/3 · charging 60 %". */
    relayState: (lit: number, total: number, percent: number) => string;
    defence: Record<DerelictDefence, string>;
    service: Record<DerelictService, string>;
    terminal: {
      title: string;
      data: (amount: string) => string;
      /** Label of the Data readout. */
      dataLabel: string;
      /** The Data were downloaded on an earlier visit. */
      dataDone: string;
      /** Heading of the station log. */
      log: string;
      /** The log goes to the journal. */
      logSaved: string;
      /** The log was read on an earlier visit (or at another station of the same model). */
      logRead: string;
      /** Heading of the service when the kind is not known. */
      serviceTitle: string;
      /** Everything of the service is taken. */
      serviceUsed: string;
      /** The fabricator's lead line. */
      fabricatorLead: string;
      /** The fabricator was used. */
      fabricated: string;
      take: string;
      taken: string;
      /** The fabricator's row once used. */
      made: string;
      fabricate: string;
      leave: string;
      /** Footer key hint after F / Esc. */
      leaveHint: string;
      holdFree: (units: string) => string;
      /** The part hold has no room for one more part. */
      holdFull: string;
      /** Item row of the plan service: "2 fragments of the plan Engine – pressurised" (`what` = the plan's part + variant). */
      planItem: (count: number, what: string) => string;
      /** The fabricator service's item row (its used state). */
      fabricateItem: string;
      /** Label of a fabricator option's material list (materials come from the ship's cargo). */
      materials: string;
    };
    /** F prompt at the powered clamp. */
    berthPrompt: string;
  };
  /** Ship graveyards. */
  graveyard: {
    name: string;
    mine: string;
    /** Analysis of a sleeper: "active reactor". */
    activeReactor: string;
    /** The scan readout's line under "active reactor": the wreck is a pirate playing dead. */
    sleeperHint: string;
  };
  /** Comets. */
  comet: {
    /** "Comet K-3". */
    name: (n: number) => string;
    /** Composition from the analysis / veinAnalyzer: "ice 60 % · titanium 40 % · 220 u left". */
    composition: (ice: number, titanium: number, left: string) => string;
    /** Tail shards not mined yet in this pass: "tail shards 18/24". */
    shards: (left: number, total: number) => string;
    /** The nucleus speed on the scan readout: "speed 42 u/s". */
    speed: (value: string) => string;
  };
  /** Map, radar and legend (T10). */
  map: {
    derelict: string;
    graveyard: string;
    comet: string;
    relay: string;
    mine: string;
    /** "Next pass near you: 12 min". */
    nextPass: (minutes: string) => string;
    /** The comet passes near the player right now. */
    passNow: string;
    /** No pass near the player within the search window (two periods). */
    passFar: string;
    /** Legend name of a known comet's pass track. */
    passArc: string;
    /** Powered relays of a derelict (map label, scan readout): "relays 2/3". */
    relays: (lit: number, total: number) => string;
    /** Radar legend rows of the world sites (hollow objects; the comet moves). */
    radar: { derelict: string; graveyard: string; comet: string };
    /** Scan HUD readouts of a derelict and its relays. */
    scan: {
      /** "Defence: Guard drones". */
      defence: (name: string) => string;
      /** The defence woke (2nd relay lit). */
      awake: string;
      /** All relays powered: the dock clamp works. */
      clampReady: string;
      /** Not all relays powered. */
      clampDark: string;
      /** A powered relay: "Relay powered · 2/3". */
      relayPowered: (lit: number, total: number) => string;
      /** A dark relay nobody charges: how to power it. */
      relayIdle: string;
    };
  };
  /** Game-layer toasts of the world sites (T7). */
  toasts: {
    /** A relay lit: "Relay powered · 2/3". */
    relayPowered: (lit: number, total: number) => string;
    /** The last relay lit: the dock clamp works. */
    clampPowered: string;
    /** The derelict's defence woke (2nd relay lit). */
    woke: Record<DerelictDefence, string>;
    /** A graveyard's sleeping party woke. */
    sleepersWoke: string;
    /** A comet came within radar range: "Comet K-3 on the radar". */
    cometSighted: (comet: string) => string;
    /** A stash part went to the part hold. */
    partTaken: (part: string) => string;
    /** A rolled event's warning when the radio does not voice it: "Micrometeor shower in 8 s". */
    warning: (name: string, when: string) => string;
  };
}

export const skWorld: WorldTexts = {
  events: {
    names: {
      distress: 'Núdzový signál',
      ionStorm: 'Iónová búrka',
      micrometeors: 'Spŕška mikrometeoritov',
      ambush: 'Prepadnutie',
      cometFlyby: 'Prelet kométy',
      convoyFlyby: 'Prelet konvoja',
    },
    cometFlyby: (comet, sector, eta) => `${comet} preletí sektorom ${sector} o ${eta}`,
  },
  hud: {
    left: (time) => time,
    in: (time) => `o ${time}`,
    direction: 'Smer',
    region: 'Udalosti v okolí',
    seconds: (n) => `${n} s`,
    ongoing: 'prebieha',
    warning: 'Varovanie',
    clock: (hour) => (hour === 1 ? 'na 1 hodine' : `na ${hour} hodinách`),
  },
  derelict: {
    name: 'Opustená stanica',
    relay: 'Relé',
    relayState: (lit, total, percent) => `Relé ${lit}/${total} · nabíjanie ${percent} %`,
    defence: { sentries: 'Strážne drony', storm: 'Iónová obrana', none: 'Bez obrany' },
    service: { stash: 'Skrýša dielov', plan: 'Archív plánov', fabricator: 'Výrobná linka' },
    terminal: {
      title: 'Terminál',
      data: (amount) => `+${amount} D`,
      dataLabel: 'Dáta z archívu stanice',
      dataDone: 'Dáta už stiahnuté',
      log: 'Záznam stanice',
      logSaved: 'Uložené do denníka (J)',
      logRead: 'Záznam tohto typu stanice už máš v denníku (J).',
      serviceTitle: 'Služba stanice',
      serviceUsed: 'Služba stanice je vyčerpaná.',
      fabricatorLead: 'Jedna výroba zadarmo z materiálu v nákladnom priestore lode, bez poplatku.',
      fabricated: 'Výrobná linka je použitá.',
      take: 'Vziať',
      taken: 'Vzaté',
      made: 'Vyrobené',
      fabricate: 'Vyrobiť',
      leave: 'Odpojiť',
      leaveHint: 'odpojiť sa od stanice',
      holdFree: (units) => `Voľné miesto na diely: ${units} j`,
      holdFull: 'Sklad dielov je plný – uvoľni miesto a vráť sa.',
      planItem: (count, what) => `${count} ${count === 1 ? 'fragment' : count < 5 ? 'fragmenty' : 'fragmentov'} plánu ${what}`,
      fabricateItem: 'Bezplatná výroba',
      materials: 'Materiál z nákladu',
    },
    berthPrompt: 'F – pripojiť sa k stanici',
  },
  graveyard: {
    name: 'Cintorín lodí',
    mine: 'Mína',
    activeReactor: 'aktívny reaktor',
    sleeperHint: 'Nie je to vrak – posádka čaká',
  },
  comet: {
    name: (n) => `Kométa K-${n}`,
    composition: (ice, titanium, left) => `ľad ${ice} % · titán ${titanium} % · zostáva ${left} j`,
    shards: (left, total) => `úlomky chvosta ${left}/${total}`,
    speed: (value) => `rýchlosť ${value} j/s`,
  },
  map: {
    derelict: 'Opustená stanica',
    graveyard: 'Cintorín lodí',
    comet: 'Kométa',
    relay: 'Relé',
    mine: 'Mína',
    nextPass: (minutes) => `Najbližší prelet pri tebe: ${minutes} min`,
    passNow: 'Práve prelieta pri tebe',
    passFar: 'Pri tebe tak skoro nepreletí',
    passArc: 'Dráha preletu',
    relays: (lit, total) => `relé ${lit}/${total}`,
    radar: { derelict: 'Opustená stanica, relé', graveyard: 'Cintorín lodí, mína', comet: 'Kométa (letí)' },
    scan: {
      defence: (name) => `Obrana: ${name}`,
      awake: 'prebudená',
      clampReady: 'Svorka doku pod napätím – priblíž sa, F',
      clampDark: 'Svorka doku bez napätia – napájaj 3 relé',
      relayPowered: (lit, total) => `Relé napájané · ${lit}/${total}`,
      relayIdle: 'Podrž ťažobný laser na prijímači 5 s',
    },
  },
  toasts: {
    relayPowered: (lit, total) => `Relé napájané · ${lit}/${total}`,
    clampPowered: 'Všetky relé napájané – dokovacia svorka stanice má prúd',
    woke: {
      sentries: 'Stanica sa bráni – strážne drony sa prebudili',
      storm: 'Stanica spustila iónovú obranu – štíty nefungujú',
      none: 'Stanica sa prebudila – obrana mlčí',
    },
    sleepersWoke: 'Vraky ožili – pirátska posádka čakala v zálohe',
    cometSighted: (comet) => `${comet} na radare`,
    partTaken: (part) => `${part} – uložené v sklade dielov`,
    warning: (name, when) => `${name} ${when}`,
  },
};

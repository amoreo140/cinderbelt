// Slovak texts of the communicator (part A): speaker names and role tags,
// the spoken line variants (picked deterministically by the comms layer), the comm panel, the comm
// log (L) and the Radio setting; part B adds the Guild instructor of the training and the scripted
// first contacts (the first pirates, the first Echo signal). The shape is the exported
// `CommsTexts` interface; enComms.ts implements the same keys in English.
import type { TrainingStepId } from '../data/training';
import type { ContractFailReason } from '../sim/career/types';
import type { ConvoyUnlinkReason, LinkRejectReason } from '../sim/convoys/types';

/** Variants of one spoken line (the comms layer picks one by a hash of tick + event). */
export type Lines = readonly string[];

export interface CommsTexts {
  /** Speaker names. */
  speakers: {
    /** The named Guild instructor. */
    instructor: string;
    /** Traffic control of a station: "Kotva Vega" → "Kotva Vega · riadenie". */
    traffic: (station: string) => string;
    /** The contract desk of the issuing station. */
    contracts: (station: string) => string;
    /** Generic pirate voices by ship kind. */
    jackal: string;
    hammer: string;
    /** The Echo before the story names it, and after. */
    echoUnknown: string;
    echoNamed: string;
    /** A distress call and a stranded ship (rescue contract). */
    distress: string;
    stranded: string;
    unknown: string;
    /** A Gunner (M4b): the long-range pirate of a party. */
    gunner: string;
    /** The Institute's observatory (comets). */
    institute: string;
    /** The automaton of a derelict station (an old Guild AI). */
    derelictAi: string;
  };
  /** Short role / faction tags (stencil labels). */
  roles: {
    instructor: string;
    traffic: string;
    contracts: (faction: string) => string;
    pirate: string;
    captain: (clan: string) => string;
    fortress: string;
    echo: string;
    distress: string;
    /** The Institute's research voice. */
    research: string;
    /** A derelict station's automaton. */
    derelict: string;
    /** M4d: a Free Traders convoy on a Guild Lane, and the convoy of an escort contract. */
    convoy: string;
    escort: string;
  };
  /** Where and when, inside spoken lines (M4b events). */
  bearing: {
    /** A direction as a clock bearing (12 = ahead): "at 5 o'clock". */
    clock: (hour: number) => string;
    /** A time ahead: "o 8 s", "o 2 min". */
    inTime: (seconds: number) => string;
    /** The factual note of an ambush lead: "Contacts at 5 o'clock – ambush." */
    contacts: (where: string) => string;
  };
  factions: { guild: string; institute: string };
  clans: { rust: string; cauldron: string; slantedStar: string };
  lines: {
    station: { zone: Lines; granted: Lines; rejected: Lines; undocked: Lines };
    contract: { accepted: Lines; ready: Lines; completed: Lines; rescued: Lines };
    pirate: {
      tollDemand: readonly ((amount: string) => string)[];
      tollPaid: Lines;
      tollRefused: Lines;
      tollTimeout: Lines;
      tollEscaped: Lines;
      alert: Lines;
      hunt: Lines;
      challenge: readonly ((min: number) => string)[];
      raid: readonly ((where: string) => string)[];
      raidArrived: Lines;
      ambush: Lines;
      /** An ambush party about to come out of the dark (M4b, the radio lead), Hammer-led. */
      ambushWarn: Lines;
      /** M4d: the Rust party coming for a powered Guild relay (its leader taunts). */
      relayCounter: Lines;
    };
    /** A Gunner leading a party (M4b): taunts from range. */
    gunner: { ambush: Lines; alert: Lines };
    /** The Guild Watch (Quiet / Guarded sectors and the Guild Lane): a micrometeor shower ahead. */
    watch: {
      micrometeors: readonly ((where: string, when: string) => string)[];
      /** M4d: a live Watch ship engages pirates near the player ("Kontakt, zasahujeme."). */
      engaged: Lines;
      /** … the pirates go for the player ("We have your back, pilot."). */
      defend: Lines;
      /** A damaged Watch ship pulls out of the fight. */
      retreat: Lines;
      /** The Guild relay chain: the mast repaired, the Rust counterattack coming, the reinforcement, the sector secured. */
      relayRepaired: Lines;
      relayHold: readonly ((where: string, when: string) => string)[];
      reinforcement: Lines;
      secured: readonly ((sector: string) => string)[];
    };
    /** M4d: a Free Traders convoy – its flyby, the link at the trade port, the trade. */
    convoy: {
      flyby: readonly ((when: string, where: string) => string)[];
      linked: Lines;
      traded: Lines;
    };
    /** The convoy unlinks the ship, by the reason. */
    convoyUnlinked: Record<ConvoyUnlinkReason, Lines>;
    /** The trader refuses a link, by the reason. */
    convoyRejected: Record<LinkRejectReason, Lines>;
    /** M4d: the trader of an escort contract – departure, a stop, an ambush ahead, arrival, failure. */
    escort: {
      departed: Lines;
      stopped: Lines;
      ambush: readonly ((where: string) => string)[];
      arrived: Lines;
    };
    /** A failed escort: the trader (missed, abandoned) or the contract desk (trader lost, player lost). */
    escortFailed: Record<ContractFailReason, Lines>;
    /** The Institute's observatory: a comet flyby ahead, a comet seen. */
    comet: {
      flyby: readonly ((comet: string, when: string, where: string) => string)[];
      sighted: readonly ((comet: string) => string)[];
    };
    /** A derelict station's automaton: relays, its defence, the clamp and the terminal. */
    derelict: {
      relay: readonly ((lit: number, total: number) => string)[];
      /** All relays lit: the clamp works. */
      ready: Lines;
      /** The first berth: the terminal opens. */
      greeting: Lines;
      /** A later berth. */
      welcomeBack: Lines;
      /** F at the clamp before all relays are lit. */
      unpowered: readonly ((lit: number, total: number) => string)[];
      /** F at the clamp with a bad approach. */
      rejected: Lines;
      farewell: Lines;
    };
    /** A derelict's defence wakes (the 2nd relay lit), by its kind. */
    derelictWake: { sentries: Lines; storm: Lines; none: Lines };
    /** A graveyard's sleeping party wakes. */
    graveyard: { sleepersWoke: Lines };
    captain: { appear: Lines; fled: Lines; gloat: Lines; defeated: Lines };
    fortress: { alarm: Lines; reinforcements: Lines };
    distress: { fuel: Lines; repair: Lines; resolved: Lines };
    echo: { heard: Lines; located: Lines; journal: Lines; shard: Lines; resonator: Lines };
    /**
     * Home traffic control when a home module is built (M4c): the paint shop, the trophy hall and a
     * generic line with the module's name for later modules.
     */
    home: { paintShop: Lines; trophyHall: Lines; module: readonly ((module: string) => string)[] };
  };
  /** The Guild instructor during the training (plan §4): the prose of the step panel, spoken. */
  instructor: {
    /** When a step starts: what to do and why (one spoken line, variants). */
    intro: Record<TrainingStepId, Lines>;
    /** A finished step, with its reward in words. */
    praise: readonly ((reward: string) => string)[];
    /** The reward in words: credits, credits + parts into the storage, credits + the crafting kit. */
    reward: { credits: (credits: string) => string; parts: (credits: string, parts: string) => string; kit: (credits: string) => string };
    /** After the last step: the ship is finished. */
    done: Lines;
    /** The player idles on a step (≥ 60 s): a hint for the step's usual situation. */
    nudge: Record<TrainingStepId, Lines>;
    /** A flight step while docked. */
    nudgeUndock: Lines;
    /** A dock step while flying. */
    nudgeDock: Lines;
  };
  /** Scripted first contacts (plan §4): short exchanges, queued one after another. */
  firstContact: {
    /** The first pirate group that notices the player. */
    pirate: Lines;
    /** The Guild instructor's warning (during the training). */
    warnInstructor: Lines;
    /** Home traffic control's warning (after the training). */
    warnTraffic: Lines;
    /** The pirate's answer to the warning. */
    pirateRetort: Lines;
    /** The first Echo signal (glitched). */
    echo: Lines;
    /** The instructor / traffic control reacts to it. */
    echoReaction: Lines;
    /** The signal once more. */
    echoAgain: Lines;
    /** The first ambush (M4b): the leader's taunt, the warning, the leader again. */
    ambush: Lines;
    ambushWarn: Lines;
    ambushRetort: Lines;
    /** The first comet seen: the Institute, the warner, the Institute's tip. */
    comet: Lines;
    cometReaction: Lines;
    cometAgain: Lines;
    /** The first derelict relay lit: the automaton wakes, the warner, the automaton again. */
    derelict: Lines;
    derelictReaction: Lines;
    derelictAgain: Lines;
    /** M4d: the first live Guild Watch fight near the player: the Watch, the warner, the Watch again. */
    watch: Lines;
    watchReaction: Lines;
    watchAgain: Lines;
    /** M4d: the first convoy flyby: the trader, the warner, the trader again. */
    convoy: Lines;
    convoyReaction: Lines;
    convoyAgain: Lines;
  };
  panel: {
    /** Stencil label of the panel ("RADIO"). */
    radio: string;
    /** More messages waiting: "+2". */
    queued: (n: number) => string;
    /** Link to the journal (J). */
    journal: string;
    /** Tooltip: a click finishes the typing / closes the message. */
    skip: string;
  };
  log: {
    title: string;
    subtitle: string;
    empty: string;
    close: string;
  };
  settings: {
    label: string;
    options: { all: string; important: string; off: string };
    hint: string;
  };
  /** Controls help line (K). */
  help: string;
}

export const skComms: CommsTexts = {
  speakers: {
    instructor: 'Majster Bartoš',
    traffic: (station) => `${station} · riadenie`,
    contracts: (station) => `${station} · kontrakty`,
    jackal: 'Šakal Hrdze',
    hammer: 'Kladivo Hrdze',
    echoUnknown: 'Neznámy signál',
    echoNamed: 'Ozvena Kováčov',
    distress: 'Núdzové volanie',
    stranded: 'Uviaznutá loď',
    unknown: 'Neznámy hlas',
    gunner: 'Delostrelec Hrdze',
    institute: 'Observatórium Inštitútu',
    derelictAi: 'Hlas stanice',
  },
  roles: {
    instructor: 'Inštruktor Cechu',
    traffic: 'Riadenie letu',
    contracts: (faction) => `Kontrakty · ${faction}`,
    pirate: 'Pirát',
    captain: (clan) => `Kapitán · ${clan}`,
    fortress: 'Pevnosť Hrdze',
    echo: 'Signál',
    distress: 'Núdza',
    research: 'Výskum Inštitútu',
    derelict: 'Automat stanice',
    convoy: 'Konvoj · Voľní obchodníci',
    escort: 'Eskortovaný konvoj',
  },
  bearing: {
    clock: (hour) => (hour === 1 ? 'na 1 hodine' : `na ${hour} hodinách`),
    inTime: (s) => (s < 60 ? `o ${Math.max(1, Math.round(s))} s` : `o ${Math.round(s / 60)} min`),
    contacts: (w) => `Kontakty ${w} – prepadnutie.`,
  },
  factions: { guild: 'Cech', institute: 'Inštitút' },
  clans: { rust: 'Hrdza', cauldron: 'Kotol', slantedStar: 'Šikmá hviezda' },
  lines: {
    station: {
      zone: [
        'Vidíme ťa na radare. Svorka na konci ramena je voľná.',
        'Loď v priblížení, tu riadenie letu. Prileť pomaly k svorke.',
        'Vitaj v našom priestore, pilot. Rameno doku máš pred sebou.',
      ],
      granted: ['Svorka ťa drží. Vťahujeme ťa dnu.', 'Zachytené. Vitaj na palube.', 'Pekné priblíženie. Svorka zaistená.'],
      rejected: ['Negatívne, takto ťa nezachytíme.', 'Svorka hlási chybu priblíženia.', 'Zamietnuté – oprav priblíženie a skús znova.'],
      undocked: ['Voľná dráha. Dobrý let.', 'Svorky uvoľnené. Leť opatrne.', 'Odlet potvrdený. Vráť sa celý.'],
    },
    convoyUnlinked: {
      player: ['Odpojené. Šťastnú cestu, pilot.', 'Spojka uvoľnená. Kedykoľvek zas.'],
      turnaround: ['Otáčame sa na konci trasy – odpájame ťa.', 'Koniec cesty, otáčame. Spojka uvoľnená.'],
      pirates: ['Piráti! Odpájame ťa, drž sa od nás preč!', 'Kontakty Hrdze – spojka uvoľnená, obchod končí.'],
      passOver: ['Trasa skončila. Spojka uvoľnená.', 'Sme na konci trasy. Odpájame.'],
      blocked: ['Skala v ceste tvojej lode – púšťame ťa a brzdíme.', 'Vedľa nás sa nezmestíš, je tam kameň. Spojka uvoľnená.'],
    },
    convoyRejected: {
      tooFar: ['Port máme na ľavoboku, pilot. Priblíž sa k nemu.', 'Takto ťa nezachytíme – bližšie k portu.'],
      tooFast: ['Pomalšie, pilot! Vyrovnaj rýchlosť s nami.', 'Si príliš rýchly. Leť s nami, nie okolo nás.'],
      pirates: ['Kým sú tu piráti, port neotvárame.', 'Najprv sa zbav tých pirátov, potom obchodujeme.'],
    },
    escortFailed: {
      traderLost: ['Konvoj sme stratili. Kontrakt prepadol.', 'Obchodník zahynul. Eskorta zlyhala.'],
      playerLost: ['Tvoja loď padla. Konvoj pokračuje bez eskorty – kontrakt prepadol.', 'Bez tvojej lode sa eskorta skončila. Kontrakt prepadol.'],
      missed: ['Nečakali sme ďalej, pilot. Odlietame bez teba.', 'Čas vypršal. Letíme bez eskorty.'],
      abandoned: ['Nechal si nás samých. S tebou už nelietame.', 'Bez eskorty ďalej neletíme. Kontrakt prepadol.'],
    },
    contract: {
      accepted: ['Dohodnuté. Spoliehame sa na teba.', 'Lístok je tvoj. Ozvi sa, keď to bude hotové.', 'Zapísané. Veľa šťastia, pilot.'],
      ready: ['Máme potvrdenie, úloha splnená. Vráť sa po odmenu.', 'Hotovo, vidíme to. Odmena čaká na stanici.'],
      completed: ['Vyplatené. Dobrá práca, pilot.', 'Presne, ako sme chceli. Ďakujeme.', 'Kredity sú na účte. Príď zas.'],
      rescued: ['Palivo prijaté! Ďakujeme, už letíme.', 'Nádrže sa plnia. Dlžíme ti, pilot.'],
    },
    pirate: {
      tollDemand: [
        (a) => `Toto je pásmo Hrdze. ${a} a letíš ďalej.`,
        (a) => `Zastav, pilot. Mýto ${a}, alebo ťa rozoberieme.`,
        (a) => `Pekný náklad. Za ${a} sa naň nebudeme pozerať.`,
      ],
      tollPaid: ['Rozumný pilot. Leť.', 'Obchod je obchod. Zmizni.', 'Dobre. Dnes sme ťa nevideli.'],
      tollRefused: ['Zlá voľba. Paľba!', 'Tak si to zoberieme sami!'],
      tollTimeout: ['Dosť čakania. Na neho!', 'Čas vypršal. Strieľajte!'],
      tollEscaped: ['Utiekol… nabudúce nebudeš mať toľko šťastia.', 'Nechajte ho. Ešte sa vráti.'],
      alert: ['Máme ho! Všetci na neho!', 'Cieľ v dosahu. Rozoberte ho!', 'Hej, ťažiar! Ten náklad je náš.'],
      hunt: ['Hľadáme ťa, pilot. Nikam neutečieš.', 'Lovecká skupina vyrazila. Vieme, kde ťa nájsť.'],
      challenge: [(m) => `Výzva prijatá. Príď k majáku o ${m} min.`, (m) => `Chceš súboj? Budeš ho mať – o ${m} min pri majáku.`],
      raid: [(w) => `Pripravte sa, ${w}. Hrdza ide po vašej pokladnici.`, (w) => `${w}, otvorte sklady. Ideme si po svoje.`],
      raidArrived: ['Sme tu! Berte všetko!', 'Nájazd! Nikoho nešetrite!'],
      ambush: ['Ďakujeme, že si zastavil. Teraz ten náklad.', 'Pomoc? Tu nikto pomoc nepotrebuje, pilot.'],
      ambushWarn: ['Pekne pomaly, ťažiar. Sme bližšie, než si myslíš.', 'Tma je naša, pilot. Hneď to zistíš.', 'Ticho, chlapci… a teraz! Na neho!'],
      relayCounter: ['Kto nám to rozsvietil cestu? Rozbite to relé!', 'Cech tu nemá čo hľadať. Ideme po relé – aj po teba.'],
    },
    gunner: {
      ambush: ['Delostrelec v pozícii. Drž kurz, pilot – lepšie sa mieri.', 'Mám ťa v zameriavači. Nepribližuj sa, blízkosť nemám rád.'],
      alert: ['Cieľ zameraný. Paľba z diaľky!', 'Drž sa ďalej a horíš. Priblíž sa a zmiznem.', 'Taká veľká loď. Ťažko netrafiť.'],
    },
    watch: {
      micrometeors: [
        (w, when) => `Tu Stráž Cechu: spŕška mikrometeoritov ${w}, ${when}. Natoč pancier do prúdu.`,
        (w, when) => `Stráž Cechu všetkým lodiam: mikrometeority ${w}, ${when}. Ukáž prúdu úzky profil a pancier.`,
      ],
      engaged: ['Kontakt, zasahujeme.', 'Stráž Cechu v boji. Piráti v našom úseku nezostanú.', 'Vidíme ich. Hliadka útočí.'],
      defend: ['Kryjeme ťa, pilot.', 'Drž sa pri nás, pilot – berieme si ich.', 'Stráž Cechu prichádza. Vydrž!'],
      retreat: ['Mám ťažké poškodenie, sťahujem sa.', 'Trup na hranici. Odpájam sa z boja.'],
      relayRepaired: [
        'Tu Stráž Cechu: relé opravené. Teraz ho nabi ťažobným laserom.',
        'Oprava potvrdená. Nabi relé laserom a cesta bude opäť naša.',
      ],
      relayHold: [
        (w, when) => `Pozor, pilot! Hrdza zachytila signál relé – kontakty ${w}, ${when}. Drž relé, posily Cechu sú na ceste.`,
        (w, when) => `Stráž Cechu: protiútok Hrdze ${w}, ${when}. Nepusti ich k relé, prichádzame.`,
      ],
      reinforcement: ['Stráž Cechu na mieste! Fregata a dva kutre, berieme si ich.', 'Posily Cechu prileteli. Teraz ich zatlačíme spolu.'],
      secured: [
        (s) => `Sektor ${s} je odteraz Strážený. Cech ti ďakuje, pilot.`,
        (s) => `Relé drží a Hrdza ustúpila. ${s} je odteraz pod ochranou Stráže.`,
      ],
    },
    convoy: {
      flyby: [
        (when, w) => `Tu konvoj Voľných obchodníkov: preletíme okolo ${when}, ${w}. Obchod máme otvorený.`,
        (when, w) => `Voľní obchodníci volajú: sme ${w}, okolo teba ${when}. Prileť k portu, ak chceš obchodovať.`,
      ],
      linked: ['Spojka drží. Pozri sa, čo vezieme.', 'Pripojený. Sklad je otvorený, vyber si.', 'Pekne zarovnané. Obchodujme.'],
      traded: ['Obchod s tebou je radosť.', 'Dohodnuté. Zapísali sme to.', 'Dobrý obchod, pilot.'],
    },
    escort: {
      departed: ['Pripravení, letíme za tebou.', 'Motory nahodené. Drž sa pri nás, pilot.'],
      stopped: ['Piráti pri nás! Zastavujeme – kryj nás!', 'Stojíme, kým sú tu piráti. Odožeň ich!'],
      ambush: [(w) => `Kontakty pred nami ${w}! Pozor, prepadnutie.`, (w) => `Niečo sa hýbe ${w}. Buď pripravený, pilot.`],
      arrived: ['Sme na mieste a celí. Ďakujeme, pilot – odmenu ti vyplatia na stanici.', 'Dorazili sme. S tebou sa letí bezpečne.'],
    },
    comet: {
      flyby: [
        (c, when, w) => `Tu observatórium Inštitútu: ${c} preletí okolo teba ${when}, ${w}. Jadro nesie ľad a titán.`,
        (c, when, w) => `${c} sa blíži – ${when}, ${w}. Keď ju dobehneš, ťaž za letu.`,
      ],
      sighted: [(c) => `${c} na tvojich senzoroch. Inštitút si zapisuje jej dráhu.`, (c) => `Máme ju: ${c}. Jej dráhu nájdeš na mape.`],
    },
    derelict: {
      relay: [(lit, total) => `…relé ${lit}/${total}… napätie na zbernici… obnovené…`, (lit, total) => `[napájanie ${lit}/${total}] …systémy sa prebúdzajú…`],
      ready: ['…všetky relé napájané… dokovacia svorka uvoľnená… pripoj sa, loď…', '[napájanie 3/3] Svorka pripravená. Čakám na pripojenie.'],
      greeting: [
        '…identifikácia… loď Cechu? Cech… ešte existuje? Terminál je tvoj, pilot.',
        'Pripojenie potvrdené. Sprístupňujem archív stanice. Posledná zmena… bola dávno.',
      ],
      welcomeBack: ['…opäť ty… terminál je otvorený.', 'Pripojenie potvrdené. Vitaj späť.'],
      unpowered: [(lit, total) => `…svorka bez napájania… relé ${lit}/${total}…`, (lit, total) => `[napájanie ${lit}/${total}] Dokovanie nemožné.`],
      rejected: ['…chyba priblíženia… svorka nezaisťuje…', 'Priblíženie mimo tolerancie. Skús znova.'],
      farewell: ['…spojenie ukončené… vráť sa…', 'Odpojené. Stanica opäť zaspáva.'],
    },
    derelictWake: {
      sentries: ['NARUŠITEĽ V PERIMETRI. AKTIVUJEM STRÁŽNE DRONY.', '…neautorizované napájanie… obranný protokol… drony štartujú…'],
      storm: ['…ochranné pole… preťaženie… výboj do okolia…', 'OBRANNÝ PROTOKOL: IÓNOVÉ POLE. Vzdiaľ sa od stanice.'],
      none: ['…obranné systémy… neodpovedajú…', '[obrana: offline] …nikto ma už nestráži…'],
    },
    graveyard: {
      sleepersWoke: ['Vstávať, chlapci! Korisť sa nám priplazila sama.', 'Dosť bolo spánku – berte ho!', 'Myslel si, že sme len šrot? Prekvapenie!'],
    },
    captain: {
      appear: ['Konečne sa stretávame, pilot.', 'Toto je môj revír. Mal si ostať doma.', 'Pozrime sa, kto to sem priletel.'],
      fled: ['Toto si zapamätám!', 'Ešte sa stretneme, pilot!', 'Ústup! Nabudúce to dopadne inak.'],
      gloat: ['Pekný kúsok. Ten si nechám.', 'Ďakujem za suvenír, pilot.'],
      defeated: ['Toto… nie je koniec Hrdze…', 'Nemal som ťa podceniť…'],
    },
    fortress: {
      alarm: ['Poplach! Cudzia loď v dosahu veží!', 'Pevnosť hlási votrelca. Všetky lode von!'],
      reinforcements: ['Hangár otvorený – šakali, von!', 'Posily štartujú. Nedajte mu dýchať!'],
    },
    distress: {
      fuel: ['Mayday, mayday. Došlo nám palivo, unášame sa. Počuje nás niekto?', 'Tu ťažiar v núdzi. Prázdne nádrže, potrebujeme palivo.'],
      repair: ['Mayday. Máme prederavený trup, potrebujeme železo na opravu.', 'Tu poškodená loď. Bez opravy to nezvládneme. Pomôžte!'],
      resolved: ['Ďakujeme, pilot! Cech sa to dozvie.', 'Zachránil si nás. Toto nezabudneme.'],
    },
    echo: {
      heard: ['[tri údery · ticho · tri údery]', '[…tón pod šumom… opakuje sa…]'],
      located: ['[signál drží · zdroj zameraný]', '[údery zosilneli · smer potvrdený]'],
      journal: ['[…k·o·v… …h·v·i·e·z·d…]', '[ozvena: …niekto… počúva…]'],
      shard: ['[úlomok odpovedá · rezonancia]', '[červené jadro zvoní rovnakým tónom]'],
      resonator: ['[jadro pevnosti zvoní tónom majáka]'],
    },
    home: {
      paintShop: [
        'Lakovňa je pripravená, pilot. Vyber farbu – portál sa postará o zvyšok.',
        'Lakovňa v prevádzke. Priveď loď a vyber lak, ten je na účet domu.',
      ],
      trophyHall: [
        'Trofejná sieň je otvorená. Šesť podstavcov čaká na všetko, čo privezieš domov.',
        'Trofejná sieň pripravená. Nech klany vidia, ako dopadnú tí, čo ti skrížia cestu.',
      ],
      module: [(m) => `${m}: stavba hotová, systémy v prevádzke. Dobrá práca, pilot.`, (m) => `Stavba dokončená: ${m}. Stanica rastie s tebou.`],
    },
  },
  instructor: {
    intro: {
      flyBuoy: [
        'Tu Majster Bartoš z Cechu. Cvičný trup je tvoj – odleť a doleť k bóji. Keď pustíš plyn, tlmiče brzdia samy; šmyk do strán zastavia len pomaly trysky kokpitu, bočné motory ešte nemáš.',
        'Vitaj vo výcviku, pilot, som Bartoš. Najprv sa nauč lietať: doleť k bóji Cechu. Pusti plyn a tlmiče ťa zabrzdia – do strán len pomaly, slabými tryskami kokpitu.',
      ],
      mineIron: [
        'Teraz cvičný kameň: vyťaž z neho 20 železa. Mier laserom na svietiacu žilu – ťaží sa o polovicu rýchlejšie.',
        'Železo je tvoj prvý zárobok. Priblíž sa ku kameňu, spomaľ a mier na svietiacu žilu – tá ide najrýchlejšie.',
      ],
      dockSell: [
        'Leť domov a predaj železo. Ku svorke prileť pomaly a prídou k stanici, inak ťa nezachytí. Za prvý predaj máš od Cechu dva bočné motory.',
        'Domov, pilot. Pri svorke spomaľ, natoč prídu k stanici a stlač F. Za predaj železa ti Cech dá dva bočné motory.',
      ],
      installSide: [
        'Bočné motory máš v sklade. V Lodenici ich namontuj po bokoch, tryskou von z lode – tlmiče nimi zastavia šmyk do strán hneď, nie len pomaly tryskami.',
        'Teraz Lodenica: jeden bočný motor na každý bok, tryskou von. Potom ťa už nič nebude unášať do strán.',
      ],
      brakeBuoy: [
        'Kto vie zastaviť, nenarazí. Leť k druhej bóji a zastav pri nej pod 1,5 j/s. Odmenou je druhý spätný motor.',
        'Skúška brzdenia: zastav pri druhej bóji takmer na mieste. S brzdí, tlmiče dorovnajú zvyšok. Odmenou je druhý spätný motor.',
      ],
      installReverse: [
        'Druhý spätný motor namontuj tryskou k prove. Dva brzdia dvakrát silnejšie – zastavíš na polovičnej dráhe.',
        'V Lodenici pridaj druhý spätný motor, tryskou dopredu. S dvoma zastavíš na polovici dráhy.',
      ],
      craftCargo: [
        'Väčší náklad, menej letov domov. Vo Výrobe si zhotov nákladný priestor a namontuj ho – materiál aj poplatok platí Cech.',
        'Vyrob si nákladný priestor a pridaj ho na loď. Suroviny aj poplatok máš od Cechu.',
      ],
      checklist: [
        'Pred cestou kontrola: natankuj do plna, pozri si ciele a v lete mapu. Na mape je Počiatok, cesta Cechu a červený kút – tam bez kanóna nelietaj.',
        'Posledná príprava: plná nádrž, ciele a mapa – tá sa otvára len v lete. Za kontrolu ti Cech dá aj mapu prvého úseku cesty.',
      ],
      finishShip: [
        'Posledné diely máš v sklade: reaktor, radar, gyroskop a druhý motor dopredu. Namontuj ich a loď je hotová.',
        'Dokonči loď: reaktor, radar, gyroskop a druhý motor dopredu. Potom ťa Cech pustí samého.',
      ],
    },
    praise: [(r) => `Výborne, pilot. Cech ti pripísal ${r}.`, (r) => `Presne tak. Odmena: ${r}.`, (r) => `Toto sa mi páči. Máš ${r}.`],
    reward: {
      credits: (c) => c,
      parts: (c, p) => `${c} a ${p} do skladu`,
      kit: (c) => `${c} a materiál na nákladný priestor`,
    },
    done: [
      'Loď je hotová a je tvoja. Prácu ti ponúknu Zákazky na stanici. Dobrý let, pilot.',
      'A si pilot Cechu. Kontrakty nájdeš v Zákazkách na stanici. Ozvi sa, keby niečo.',
    ],
    nudge: {
      flyBuoy: ['Bója je tam, kam ukazuje šípka. W je plyn, A a D otáčanie.', 'Pilot, bója nepočká večne. Natoč sa za šípkou a daj plyn.'],
      mineIron: ['Drž kurzor na kameni a pravé tlačidlo. Laser dočiahne len kúsok – priblíž sa.', 'Kameň je označený. Spomaľ pri ňom a ťaž pravým tlačidlom.'],
      dockSell: ['V Prehľade stlač „Predať celý náklad“ – nič viac.', 'Železo predáš v Prehľade. Jeden klik a je to.'],
      installSide: ['Motor otáčaš klávesom R, kým tryska nemieri von z lode.', 'Zvýraznené políčka vedľa trupu sú správne miesta. Potom potvrď Enterom.'],
      brakeBuoy: ['Pri bóji pusti plyn a brzdi S. Pod 1,5 j/s to uznám.', 'Nemusíš sa ponáhľať. Pomaly k bóji a zastav.'],
      installReverse: ['Motor otoč klávesom R, aby tryska mierila k prove. Potom Enter.', 'Druhý spätný motor čaká v sklade – Lodenica, kláves 3.'],
      craftCargo: ['Vo Výrobe vyber nákladný priestor T1 a stlač Vyrobiť.', 'Vyrobený diel je v sklade – namontuj ho v Lodenici.'],
      checklist: ['Ešte chýba kus kontroly – pozri sa na zoznam v paneli výcviku.', 'Servis natankuje, G otvorí ciele, M mapu v lete.'],
      finishShip: ['Reaktor, radar, gyroskop, motor dopredu – všetko je v sklade.', 'Panel výcviku ukazuje, čo ešte chýba. Potom Enter.'],
    },
    nudgeUndock: ['Najprv odleť – tlačidlo Odletieť alebo F.', 'Toto sa v doku nenaučíš. Odleť, pilot.'],
    nudgeDock: ['Pristaň na stanici: pomaly k svorke, prídou k stanici, potom F.', 'Diely čakajú v sklade stanice. Pristaň, pilot.'],
  },
  firstContact: {
    pirate: ['Pozrime sa, nová loď Cechu. Tu sa končí tvoja cvičná trasa, ťažiar.', 'Čerstvý pilot na našom území? Dnes to bude pekný úlovok.'],
    warnInstructor: [
      'Pilot, to je Hrdza – piráti. S cvičným trupom nebojuj: zaplať mýto, alebo uteč k stanici.',
      'Pozor, piráti Hrdze! Tvoja loď na boj nie je. Leť k stanici, tam si na teba netrúfnu.',
    ],
    warnTraffic: [
      'Tu riadenie letu: na radare máš pirátov Hrdze. Ak chcú mýto, zaplatiť je lacnejšie než nový trup.',
      'Pozor, pilot – piráti Hrdze. Drž sa blízko staníc, alebo sa priprav na boj.',
    ],
    pirateRetort: ['Počúvaj ich, pilot. Rozumní platia.', 'Len utekaj. Aj tak ťa nájdeme.'],
    echo: ['[…šum… tri údery… ticho… tri údery…]', '[…tón pod šumom… zosilnie… zmizne…]'],
    echoReaction: [
      'Počuješ to aj ty? Ten tón nie je náš – takto nevysiela žiadny maják Cechu.',
      'Na tejto frekvencii nemá nikto čo vysielať. Zapíš si to, pilot.',
    ],
    echoAgain: ['[…p·o·č·u·j·e·š… …n·á·s…?]', '[…k·t·o… …t·o… …j·e…?]'],
    ambush: ['Vitaj v tme, ťažiar. Sem Cech svoje lode neposiela – a vieš prečo?', 'Čakali sme na niekoho, ako si ty. Osamelá loď, plný náklad.'],
    ambushWarn: [
      'Pozor, pilot – to je prepadnutie! Číhajú v tme na osamelé lode. Bojuj, alebo uteč, ale nezastavuj.',
      'Kontakty z tmy, to nie je náhoda. Piráti tu striehnu na ťažiarov – drž k nim pancier a nestoj na mieste.',
    ],
    ambushRetort: ['Nech si hovoria. Tu nás nikto nepočuje.', 'Cech je ďaleko, pilot. My sme tu.'],
    comet: [
      'Pilot, tu observatórium Inštitútu! Máš na senzoroch kométu – prvú, akú tu niekto zachytil po dlhom čase.',
      'Počuješ? Kométa! Inštitút čaká na jej prelet celé roky a ty ju máš pred nosom.',
    ],
    cometReaction: [
      'Kométa? Letí rýchlejšie, než vyzerá. Ak ju chceš ťažiť, najprv vyrovnaj rýchlosť.',
      'Kométy tu prelietajú len raz za čas. Hlavne nenaraz do jadra, pilot.',
    ],
    cometAgain: ['Chvost je samý ľad, jadro ľad a titán. Ťaž za letu, kým neodletí.', 'Vyrovnaj rýchlosť s jadrom a ťaž, kým prelieta. Ďalší prelet príde až o dlho.'],
    derelict: ['…napätie… po tak dlhom čase… Kto je tam? Identifikuj sa, loď.', '…prebúdzam sa… relé 1… Cech? Je to Cech?'],
    derelictReaction: [
      'Opustená stanica odpovedá? Cech ju vedie ako mŕtvu celé roky. Buď opatrný, pilot.',
      'To je starý automat Cechu. Tie stanice sa zatvorili dávno pred tebou – a niektoré sa ešte bránia.',
    ],
    derelictAgain: ['…zvyšné relé… potom otvorím svorku… čakám…', '…napájaj relé… stanica si pamätá… čaká…'],
    watch: ['Tu Stráž Cechu – piráti pri tebe, zasahujeme. Drž sa pri nás, pilot.', 'Hliadka Cechu vidí pirátov. Ideme na nich – ty sa drž bokom.'],
    watchReaction: [
      'To je Stráž Cechu. Kde hliadkujú, tam piráti dlho nevydržia.',
      'Hliadky Cechu lietajú po cestách a v strážených sektoroch. Keď je zle, leť k nim.',
    ],
    watchAgain: ['Rozumieme. Po boji pokračujeme v hliadke.', 'Ak budeš v úzkych, vieš, kde nás nájdeš.'],
    convoy: [
      'Tu Voľní obchodníci! Letíme po ceste Cechu okolo teba – máme vzácne diely a kúpime aj tvoj náklad.',
      'Konvoj Voľných obchodníkov volá loď Cechu. Ideme okolo, obchod je otvorený.',
    ],
    convoyReaction: [
      'Konvoj obchodníkov? Prileť k jeho portu na ľavoboku pomaly, s jeho rýchlosťou, a stlač F.',
      'Konvoje lietajú po cestách Cechu podľa letového plánu – nájdeš ich na mape. Pripoj sa k portu, F.',
    ],
    convoyAgain: ['Nepribližuj sa prudko, pilot. Zarovnaj sa s nami a obchodujeme za letu.', 'Čakáme na teba. Port na ľavoboku svieti.'],
  },
  panel: {
    radio: 'Rádio',
    queued: (n) => `+${n}`,
    journal: 'Záznam v denníku',
    skip: 'Klik – dočítať / zavrieť správu',
  },
  log: {
    title: 'Rádio',
    subtitle: 'Záznam správ',
    empty: 'Rádio zatiaľ mlčí.',
    close: 'L – zavrieť',
  },
  settings: {
    label: 'Rádio',
    options: { all: 'Všetko', important: 'Dôležité', off: 'Vypnuté' },
    hint: 'Kto k tebe hovorí: riadenie staníc, piráti, kapitáni, signály. Vypnuté = krátke hlásenia ako doteraz.',
  },
  help: 'L – rádio: záznam správ',
};

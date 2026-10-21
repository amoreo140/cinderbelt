// Slovak texts of the part explanations: what every part does in plain words, the glossary of
// technical stat labels, the "Na tvojej lodi" effect block and the one-line advice.
// A separate module next to sk.ts, skFlight.ts, skDiscovery.ts …; the shape is the exported
// `PartsTexts` interface, so an English module can implement the same keys.
import type { PartId } from '../data/parts';
import type { VariantId } from '../data/variants';

/** Every term that can carry a glossary tooltip (part stats, effect metrics, shipyard stats). */
export type GlossaryId =
  | 'mass' | 'hp' | 'thrust' | 'torque' | 'cargo' | 'fuel' | 'battery' | 'energyGen' | 'radar'
  | 'miningRate' | 'miningRange' | 'miningEnergy'
  | 'damage' | 'fireRate' | 'weaponRange' | 'shotEnergy' | 'arc'
  | 'shieldCapacity' | 'shieldRegen' | 'shieldDelay'
  | 'tractorRange' | 'tractorParts' | 'tractorEnergy'
  | 'turn180' | 'accel' | 'topSpeedTime' | 'brakeTime' | 'fuelRange' | 'energyMining' | 'energyCombat'
  | 'miningEndurance' | 'dps' | 'cannonArc' | 'hpTotal' | 'hull' | 'turning' | 'energyUse' | 'parts'
  | WorkshopStatId | 'energyWorkshop';

/** Part stats of the M4c workshop parts and the large reactor (their labels live in `stats` below). */
export type WorkshopStatId = 'blast' | 'repairRate' | 'repairEnergy' | 'refineIce' | 'refineOre' | 'refineEnergy';

export interface PartDescription {
  /** What the part does (one or two short sentences). */
  what: string;
  /** When you need it. */
  when: string;
  /** Its price or catch, layout rules included. */
  tradeoff: string;
}

export type EffectMetric =
  | 'turn180' | 'accel' | 'topSpeedTime' | 'brakeTime' | 'fuelRange' | 'cargo'
  | 'energyMining' | 'energyCombat' | 'battery' | 'miningEndurance' | 'miningRate'
  | 'dps' | 'cannonArc' | 'shieldCapacity' | 'shieldRegen' | 'tractorRange' | 'tractorParts'
  | 'radar' | 'hp' | 'hull' | 'mass'
  | 'blast' | 'repairRate' | 'refineIce' | 'refineOre' | 'energyWorkshop';

export interface PartsTexts {
  parts: Record<PartId, PartDescription>;
  /** The variant's catch in plain words (shown under the base description). */
  variants: Record<VariantId, string>;
  glossary: Record<GlossaryId, string>;
  /** Part stat labels of the workshop parts and the blast (the other stats: sk.shipyard.stats). */
  stats: Record<WorkshopStatId, string>;
  effect: {
    title: string;
    /** "odhad" next to the title – the numbers ignore placement. */
    estimate: string;
    estimateHint: string;
    /** Shipyard: the effect is computed on the draft, not the flying ship. */
    titleDraft: string;
    labels: Record<EffectMetric, string>;
    /** Values that are "none": cannot turn, cannot brake, mining never stops … */
    none: Partial<Record<EffectMetric, string>>;
    units: { s: string; accel: string; dist: string; perSecond: string; hpPerSecond: string; deg: string; points: string; tons: string; hp: string; parts: string; units: string };
    /** "14 / 28 b". */
    hullValue: (used: string, budget: string) => string;
    better: string;
    worse: string;
    placement: { engineForward: string; cannonArc: string };
    replaces: string;
    /**
     * Repair module: what it repairs this ship's parts with (the station's material, from the cargo);
     * `by` = the `repairBy` lines of the tiers on the ship joined with `and`.
     */
    repairMaterial: (by: string) => string;
    repairBy: { 1: string; 2: string };
    and: string;
    /** Refinery: what it does first. */
    refinery: string;
    /** A variant against the base part: the lead of the comparison line ("Versus the standard:"). */
    variantVs: string;
  };
  /** Parts market: rows open to the explanation. */
  market: { hint: string };
  advice: {
    noRoom: (used: number, budget: number, need: number, nextBudget: number | null) => string;
    noEffectRadar: (range: string) => string;
    noEffectCockpit: string;
    fixes: {
      slowTurn: (before: string, after: string) => string;
      miningEnergy: (before: string, after: string) => string;
      miningEnergyBattery: (before: string, endurance: string) => string;
      combatEnergy: (before: string, after: string) => string;
      slowAccel: (before: string, after: string) => string;
      shortRange: (before: string, after: string) => string;
      noBrake: string;
      noStrafe: string;
      noLaser: string;
    };
    causes: { miningEnergy: (after: string) => string; combatEnergy: (after: string) => string; slowTurn: (after: string) => string };
    general: {
      miningEnergy: (value: string) => string;
      noBrake: string;
      slowTurn: (value: string) => string;
    };
  };
}

export const skParts: PartsTexts = {
  parts: {
    cockpit: {
      what: 'Srdce lode. Má v sebe kus všetkého: malý náklad, nádrž, batériu, reaktor, radar, slabý gyroskop aj vstavané manévrovacie trysky do všetkých strán.',
      when: 'Loď má vždy práve jeden. Nový kokpit vymeníš za starý. Jeho slabé manévrovacie trysky pomaly zastavia loď aj tam, kde nemá motor (T2 o niečo silnejšie).',
      tradeoff: 'Kokpit určuje, koľko dielov loď unesie (T1 28\u00a0b trupu, T2 48\u00a0b). Keď ho zničia, loď je stratená – chráň ho pancierom.',
    },
    armor: {
      what: 'Pevná platňa bez inej funkcie – zachytí zásahy a nárazy namiesto dielov za ňou.',
      when: 'Keď lietaš medzi pirátov alebo do hustých polí. Daj ho na okraj, odkiaľ prichádzajú rany.',
      tradeoff: 'Je ťažký: loď s ním pomalšie zrýchľuje aj otáča. Diel pripojený len cez zničenú platňu sa odtrhne.',
    },
    engine: {
      what: 'Tlačí loď smerom, kam mieri. Motor vzadu ťahá dopredu, otočený motor brzdí alebo posúva loď do strany.',
      when: 'Na rýchlejší rozbeh. Motor sa oplatí na každú stranu – bez neho na tej osi brzdia a posúvajú len slabé manévrovacie trysky kokpitu.',
      tradeoff: 'Kým ťahá, pije palivo; viac motorov na plný plyn vyprázdni nádrž skôr. Tryska musí mať voľno: zakrytá dá len polovičný ťah a diel pred ňou horí (2\u00a0HP/s), kým motor ťahá.',
    },
    gyro: {
      what: 'Otáča loď. Čím je loď ťažšia, tým viac gyroskopov potrebuje, aby sa otáčala svižne. Kokpit má malý vstavaný gyroskop.',
      when: 'Keď sa loď otáča lenivo – pri mierení laserom a kanónmi alebo pri vyhýbaní kameňom.',
      tradeoff: 'Funguje na ktoromkoľvek mieste. Pridá však hmotnosť, takže loď o trochu pomalšie zrýchľuje.',
    },
    miningLaser: {
      what: 'Ťaží suroviny z asteroidov. Mieri myšou, najviac 60° na každú stranu od smeru, kam je otočený.',
      when: 'Na ťažbu. Viac laserov ťaží rýchlejšie – ak im stačí energia.',
      tradeoff: 'Počas ťažby berie energiu. Keď minie viac, než loď vyrába, batéria sa vybije a laser zhasne. Na žile sa prehrieva.',
    },
    cargo: {
      what: 'Priestor na vyťažené suroviny.',
      when: 'Keď sa vraciaš na stanicu s plnou loďou – väčší náklad znamená menej letov.',
      tradeoff: 'Plný náklad je ťažký: loď s ním pomalšie zrýchľuje aj otáča. Keď diel zničia, čo sa nezmestí, vysype sa.',
    },
    fuelTank: {
      what: 'Zásoba paliva pre motory.',
      when: 'Na dlhé lety ďaleko od stanice. Bez paliva sa loď už len otáča.',
      tradeoff: 'Keď nádrž zničia, palivo nad zvyšnú kapacitu sa stratí. Vo vraku nádrž pri rezaní laserom vybuchne.',
    },
    reactor: {
      what: 'Vyrába energiu pre lasery, kanóny, štít a vlečný lúč a má malú batériu.',
      when: 'Keď sa batéria pri ťažbe alebo v boji vybíja.',
      tradeoff: 'Je ťažký. Vo vraku reaktor pri rezaní laserom vybuchne.',
    },
    radar: {
      what: 'Ukáže na radare asteroidy, stanice a lode ďalej od teba.',
      when: 'Na prieskum a aby si pirátov videl skôr, než oni teba.',
      tradeoff: 'Platí len najlepší radar na lodi – druhý rovnaký nič nepridá. Je krehký.',
    },
    cannon: {
      what: 'Strieľa na pirátov. Mieri myšou, najviac 60° na každú stranu od smeru, kam je otočený.',
      when: 'Keď sa chceš brániť alebo loviť pirátov a ich korisť.',
      tradeoff: 'Každá rana stojí energiu. Cez vlastnú loď nestrieľa – daj ho na okraj, kde mu nič nezavadzia.',
    },
    shield: {
      what: 'Ochranná bublina okolo celej lode: pohltí zásahy skôr, než zasiahnu diely. Štíty viacerých generátorov sa sčítajú.',
      when: 'Do boja a do nebezpečných oblastí.',
      tradeoff: 'Dobíjanie štítu stojí energiu a po zásahu chvíľu čaká.',
    },
    heavyLaser: {
      what: 'Veľký laser (2×1): ťaží 2,4× rýchlejšie než obyčajný a z hlbokej titánovej žily vytiahne ešte viac.',
      when: 'Keď chceš ťažiť rýchlo a máš dosť energie.',
      tradeoff: 'Berie takmer dvakrát toľko energie ako obyčajný laser a zaberie 2\u00a0b trupu. Mieri len 60° na každú stranu.',
    },
    largeCargo: {
      what: 'Veľký nákladný priestor (2×2): 300 jednotiek, viac než štyri malé.',
      when: 'Na dlhé ťažobné výpravy.',
      tradeoff: 'Zaberie 3\u00a0b trupu a je ťažký. Keď ho zničia, vysype sa polovica nákladu.',
    },
    battery: {
      what: 'Zásoba energie. Sama nič nevyrába, len vydrží dlhšie.',
      when: 'Keď lasery alebo kanóny na chvíľu minú viac, než loď vyrába – batéria to preklenie.',
      tradeoff: 'Pri trvalom nedostatku energie len oddiali vybitie; trvalo pomôže reaktor.',
    },
    tractorBeam: {
      what: 'Vlečný lúč: kláves T zachytí kontajner, diel alebo malý vrak a ťahá ho k lodi. Z veľkého vraku vytrhne voľný diel.',
      when: 'Na zber koristi a rozoberanie vrakov.',
      tradeoff: 'Kým drží objekt, berie energiu. Za dosahom sa lúč pretrhne.',
    },
    largeReactor: {
      what: 'Veľký reaktor (2×2): vyrobí viac energie než päť malých a má veľkú batériu.',
      when: 'Na lode s mnohými lasermi, kanónmi a štítmi, ktorým malé reaktory nestačia.',
      tradeoff: 'Zaberie 3\u00a0b trupu a je ťažký. Keď ho zničia, vybuchne a poškodí všetky diely okolo seba – nedávaj ho ku kokpitu.',
    },
    repairModule: {
      what: 'Za letu pomaly opravuje jeden poškodený diel, ktorý sa ho dotýka hranou. Na opravu berie železo (T1 diely) alebo titán (T2) z nákladu.',
      when: 'Na dlhé výpravy ďaleko od stanice a do boja, kde sa diely postupne strácajú.',
      tradeoff: 'Opravuje len susedov cez hranu, nie po uhlopriečke, a len kým je v batérii dosť energie. Bez železa či titánu v náklade stojí.',
    },
    refinery: {
      what: 'Palubná rafinéria (2×1): za letu premení ľad na palivo, a keď je nádrž plná, čistí rudu v náklade. Rafinovaná ruda sa predá o 15\u00a0% drahšie.',
      when: 'Na dlhé ťažobné výpravy – doplní palivo z ľadu a zhodnotí náklad cestou domov.',
      tradeoff: 'Zaberie 2\u00a0b trupu a berie energiu. Pracuje, len kým zostane batéria nad pätinou. Rafinovaná ruda vyložená do skladu stanice stratí príplatok.',
    },
  },
  variants: {
    overdrive: 'Pretlakový: silnejší ťah, ale pije takmer dvakrát viac paliva.',
    eco: 'Úsporný: slabší ťah, zato míňa menej paliva – na dlhé lety.',
    rapid: 'Rýchlopal: strieľa 2,5× rýchlejšie, ale každá rana je slabšia a za sekundu minie viac energie.',
    armored: 'Pancierovaný: menší, ale dvakrát odolnejší nákladný priestor.',
    survey: 'Merací: vidí o polovicu ďalej, ale je krehký.',
    combat: 'Bojový: odolnejší kokpit, ktorý unesie o 4\u00a0b trupu menej.',
    scout: 'Prieskumný: lepší radar a rýchlejší pulz skenera, ale krehkejší.',
    extended: 'Veľká: o polovicu viac paliva, ale krehkejšia.',
    quick: 'Rýchle dobíjanie: štít sa obnovuje takmer dvakrát rýchlejšie, ale pohltí menej.',
    focused: 'Sústredený: ťaží o tretinu rýchlejšie, ale berie o polovicu viac energie.',
    light: 'Ľahký: polovičná hmotnosť, ale znesie menej.',
    flywheel: 'Zotrvačníkový: otáča loď oveľa silnejšie, ale je takmer dvakrát ťažší.',
    buffer: 'Zásobníkový: vyrába menej energie, zato má trojnásobnú batériu.',
    longBarrel: 'Dlhá hlaveň: strieľa ďalej a silnejšie, ale len o polovicu tak často.',
  },
  glossary: {
    mass: 'Koľko diel váži. Ťažšia loď pomalšie zrýchľuje, brzdí aj otáča.',
    hp: 'Odolnosť dielu – koľko poškodenia znesie, kým sa zničí.',
    thrust: 'Sila motora. Väčší ťah = rýchlejší rozbeh a brzdenie; ťažká loď z neho dostane menej.',
    torque: 'Sila, ktorou gyroskopy otáčajú loď. Ťažká a rozľahlá loď ho potrebuje viac.',
    cargo: 'Koľko jednotiek surovín sa zmestí do lode.',
    fuel: 'Palivo minú motory, kým ťahajú – aj tlmiče, keď brzdia. Bez paliva sa loď len otáča.',
    battery: 'Zásoba energie. Berú z nej lasery, kanóny, štít a vlečný lúč; prázdna batéria ich vypne.',
    energyGen: 'Koľko energie za sekundu reaktor a kokpit dobijú do batérie.',
    radar: 'Do akej vzdialenosti vidíš na radare asteroidy, stanice a lode. Platí najlepší radar na lodi.',
    miningRate: 'Koľko jednotiek suroviny laser vyťaží za sekundu.',
    miningRange: 'Ako ďaleko od lode laser dosiahne.',
    miningEnergy: 'Koľko energie za sekundu laser minie, kým ťaží.',
    damage: 'Koľko HP vezme jedna rana.',
    fireRate: 'Koľko rán kanón vystrelí za sekundu.',
    weaponRange: 'Ako ďaleko strela doletí.',
    shotEnergy: 'Koľko energie stojí jedna rana.',
    arc: 'Kam kanón dokáže mieriť: 60° na každú stranu od smeru, kam je otočený. Cez vlastný trup nestrieľa.',
    shieldCapacity: 'Koľko poškodenia štít pohltí, kým praskne. Štíty viacerých generátorov sa sčítajú.',
    shieldRegen: 'Koľko bodov štítu sa obnoví za sekundu (stojí energiu).',
    shieldDelay: 'Koľko sekúnd po zásahu štít čaká, kým sa začne dobíjať.',
    tractorRange: 'Ako ďaleko vlečný lúč zachytí objekt. Za dosahom sa pretrhne.',
    tractorParts: 'Najväčší vrak (v dieloch), ktorý lúč utiahne. Kontajner je 1 diel.',
    tractorEnergy: 'Koľko energie za sekundu lúč minie, kým drží objekt.',
    turn180: 'Koľko sekúnd trvá otočiť loď čelom vzad a zastaviť. Skráti ho gyroskop; každý ťažký diel ho predĺži – najviac ten ďaleko od ťažiska.',
    accel: 'O koľko j/s loď pridá za každú sekundu plného plynu dopredu (s prázdnym nákladom).',
    topSpeedTime: 'Za koľko sekúnd sa loď z pokoja rozbehne na cestovnú rýchlosť 25 j/s so zapnutými tlmičmi.',
    brakeTime: 'Za koľko sekúnd motory otočené dopredu zastavia loď z plnej rýchlosti. Bez nich brzdia len slabé manévrovacie trysky kokpitu.',
    fuelRange: 'Asi ako ďaleko doletíš na plnú nádrž, keď držíš plyn (prázdny náklad, bez prúdov). Viac motorov pije viac.',
    energyMining: 'Výroba energie mínus spotreba všetkých laserov. Záporná = batéria sa pri ťažbe vybíja.',
    energyCombat: 'Výroba energie mínus kanóny pri paľbe a dobíjanie štítu. Záporná = batéria sa v boji vybíja.',
    miningEndurance: 'Ako dlho lasery vydržia ťažiť z plnej batérie, keď je energia pri ťažbe záporná.',
    dps: 'Poškodenie za sekundu všetkých kanónov spolu, keď všetky strieľajú.',
    cannonArc: 'Súčet palebných výsekov kanónov. Kanón, ktorému zavadzia vlastný trup, pokryje menej.',
    hpTotal: 'Súčet HP všetkých dielov lode.',
    hull: 'Body trupu: diel 1×1 = 1\u00a0b, 2×1 = 2\u00a0b, 2×2 = 3\u00a0b. Koľko loď unesie, určuje kokpit (T1 28\u00a0b, T2 48\u00a0b).',
    turning: 'Ako svižne sa loď roztáča (uhlové zrýchlenie). Viac = rýchlejšia otočka; pomáha gyroskop.',
    energyUse: 'Koľko energie za sekundu minú všetky lasery pri ťažbe.',
    parts: 'Počet dielov lode.',
    blast: 'Keď diel zničia, vybuchne: každý diel okolo neho (aj po uhlopriečke) stratí toľko HP. Štít výbuch nezastaví.',
    repairRate: 'Koľko HP za sekundu modul vráti jednému poškodenému susedovi cez hranu. Len za letu a s materiálom v náklade.',
    repairEnergy: 'Koľko energie za sekundu modul minie, kým opravuje. Pracuje len nad pätinou batérie.',
    refineIce: 'Koľko ľadu za sekundu rafinéria premení na palivo (1 ľad = 2 palivá), kým nádrž nie je plná.',
    refineOre: 'Koľko jednotiek surovej rudy za sekundu rafinéria vyčistí, keď je nádrž plná. Rafinovaná ruda sa predá drahšie.',
    refineEnergy: 'Koľko energie za sekundu rafinéria minie, kým pracuje. Zastaví sa prvá, keď batéria klesne na pätinu.',
    energyWorkshop: 'Výroba energie mínus rafinérie a opravárenské moduly pri práci (bez ťažby a boja). Záporná = dielňa sa zastaví, keď batéria klesne na pätinu.',
  },
  stats: {
    blast: 'Výbuch',
    repairRate: 'Oprava',
    repairEnergy: 'Spotreba opravy',
    refineIce: 'Ľad → palivo',
    refineOre: 'Čistenie rudy',
    refineEnergy: 'Spotreba rafinérie',
  },
  effect: {
    title: 'Na tvojej lodi',
    titleDraft: 'Na tvojom návrhu',
    estimate: 'odhad',
    estimateHint: 'Čo sa zmení, keď na loď pridáš jeden taký diel. Nezáleží na mieste – presné čísla ukáže Lodenica.',
    labels: {
      turn180: 'Otočka o 180°',
      accel: 'Zrýchlenie',
      topSpeedTime: 'Na plnú rýchlosť',
      brakeTime: 'Zabrzdenie',
      fuelRange: 'Dolet na plný plyn',
      cargo: 'Náklad',
      energyMining: 'Energia pri ťažbe',
      energyCombat: 'Energia v boji',
      battery: 'Batéria',
      miningEndurance: 'Ťažba na batériu',
      miningRate: 'Ťažba',
      dps: 'Palebná sila',
      cannonArc: 'Pokrytie kanónmi',
      shieldCapacity: 'Štít',
      shieldRegen: 'Dobíjanie štítu',
      tractorRange: 'Dosah lúča',
      tractorParts: 'Utiahne vrak',
      radar: 'Radar',
      hp: 'HP spolu',
      hull: 'Trup',
      mass: 'Hmotnosť',
      blast: 'Výbuch pri zničení',
      repairRate: 'Oprava za letu',
      refineIce: 'Ľad → palivo',
      refineOre: 'Čistenie rudy',
      energyWorkshop: 'Energia dielne',
    },
    none: {
      turn180: 'neotočí sa',
      topSpeedTime: 'nerozbehne sa',
      brakeTime: 'nebrzdí',
      fuelRange: 'nedoletí',
      miningEndurance: 'bez konca',
      blast: 'žiadny',
      energyWorkshop: 'bez dielne',
    },
    units: { s: 's', accel: 'j/s²', dist: 'j', perSecond: 'j/s', hpPerSecond: 'HP/s', deg: '°', points: 'b', tons: 't', hp: 'HP', parts: 'dielov', units: 'j' },
    hullValue: (used: string, budget: string): string => `${used}\u00a0/\u00a0${budget}`,
    better: 'lepšie',
    worse: 'horšie',
    placement: {
      engineForward: 'Ráta s motorom, ktorý tlačí loď dopredu a má voľnú trysku (zakrytá = polovičný ťah).',
      cannonArc: 'Plný výsek 120° má kanón, ktorému nič nezavadzia.',
    },
    replaces: 'Nahradí tvoj kokpit.',
    repairMaterial: (by: string): string => `Na tvojej lodi opravuje ${by} z nákladu – ako opravovňa na stanici, len bez kreditov.`,
    repairBy: { 1: 'diely T1 železom', 2: 'diely T2 titánom' },
    and: ' a ',
    refinery: 'Najprv dopĺňa palivo z ľadu, potom čistí rudu v poradí titán, meď, železo.',
    variantVs: 'Oproti bežnému:',
  },
  market: { hint: 'Klikni na diel – ukáže, čo robí a čo zmení na tvojej lodi.' },
  advice: {
    noRoom: (used: number, budget: number, need: number, nextBudget: number | null): string =>
      `Nezmestí sa: trup má ${used} / ${budget}\u00a0b a diel potrebuje ${need}\u00a0b.` +
      (nextBudget !== null ? ` Kokpit T2 unesie ${nextBudget}\u00a0b.` : ''),
    noEffectRadar: (range: string): string => `Tvoj radar už vidí na ${range} – tento nič nepridá. Platí len najlepší radar.`,
    noEffectCockpit: 'Presne takýto kokpit už máš.',
    fixes: {
      slowTurn: (before: string, after: string): string => `Tvoja loď sa otáča pomaly – 180° za ${before}. S týmto dielom za ${after}.`,
      miningEnergy: (before: string, after: string): string =>
        `Energia pri ťažbe je záporná (${before}) – batéria sa vybíja. S týmto dielom ${after}.`,
      miningEnergyBattery: (before: string, endurance: string): string =>
        `Energia pri ťažbe je záporná (${before}). Batéria ju nezvýši, ale lasery vydržia ťažiť ${endurance}; trvalo pomôže reaktor.`,
      combatEnergy: (before: string, after: string): string =>
        `V boji minieš viac energie, než vyrobíš (${before}). S týmto dielom ${after}.`,
      slowAccel: (before: string, after: string): string => `Loď sa rozbieha pomaly – na plnú rýchlosť za ${before}. S týmto motorom za ${after}.`,
      shortRange: (before: string, after: string): string => `Na plnú nádrž doletíš len asi ${before}. S touto nádržou asi ${after}.`,
      noBrake: 'Nemáš motor, ktorý brzdí – tlmiče brzdia len slabými tryskami kokpitu, veľmi pomaly. Polož tento motor otočený tryskou dopredu (v Lodenici kláves R).',
      noStrafe: 'Do strán ťa posúvajú a šmyk brzdia len slabé trysky kokpitu. Polož tento motor otočený nabok (kláves R).',
      noLaser: 'Loď nemá ťažobný laser – bez neho nevyťažíš nič.',
    },
    causes: {
      miningEnergy: (after: string): string => `Pozor: s týmto laserom bude energia pri ťažbe záporná (${after}) a batéria sa vybije. Pomôže reaktor.`,
      combatEnergy: (after: string): string => `Pozor: v boji minieš viac energie, než vyrobíš (${after}). Pomôže reaktor alebo batéria.`,
      slowTurn: (after: string): string => `Pozor: loď sa bude otáčať pomaly – 180° za ${after}. Pomôže gyroskop.`,
    },
    general: {
      miningEnergy: (value: string): string => `Energia pri ťažbe je záporná (${value}) – pomôže reaktor alebo batéria.`,
      noBrake: 'Nemáš brzdné motory – tlmiče brzdia len slabými tryskami kokpitu, veľmi pomaly. Pomôže motor otočený tryskou dopredu.',
      slowTurn: (value: string): string => `Tvoja loď sa otáča pomaly – 180° za ${value}. Gyroskop by pomohol.`,
    },
  },
};

// German texts of the sectors – the same keys as skSectors.ts (SectorsTexts); the terms follow GLOSSARY-DE.md.
// German adjectives agree with the noun's gender: a generated name is the strong nominative of the
// adjective (-er / -e / -es) and a capitalised noun with its gender – checked by deSectors.test.ts.
import type { SectorsTexts } from './skSectors';

export type DeGender = 'm' | 'f' | 'n';

/** A German adjective in the strong nominative singular of each gender (-er / -e / -es). */
export interface DeAdjective {
  m: string;
  f: string;
  n: string;
}

export interface DeNoun {
  word: string;
  gender: DeGender;
}

/** 12 adjectives – the same order as `EN_ADJECTIVES`. */
export const DE_ADJECTIVES: readonly DeAdjective[] = [
  { m: 'Stiller', f: 'Stille', n: 'Stilles' },
  { m: 'Rostiger', f: 'Rostige', n: 'Rostiges' },
  { m: 'Kalter', f: 'Kalte', n: 'Kaltes' },
  { m: 'Grauer', f: 'Graue', n: 'Graues' },
  { m: 'Langer', f: 'Lange', n: 'Langes' },
  { m: 'Zerbrochener', f: 'Zerbrochene', n: 'Zerbrochenes' },
  { m: 'Silberner', f: 'Silberne', n: 'Silbernes' },
  { m: 'Dunkler', f: 'Dunkle', n: 'Dunkles' },
  { m: 'Hohler', f: 'Hohle', n: 'Hohles' },
  { m: 'Ferner', f: 'Ferne', n: 'Fernes' },
  { m: 'Wilder', f: 'Wilde', n: 'Wildes' },
  { m: 'Alter', f: 'Alte', n: 'Altes' },
];

/** 12 nouns with their gender – the same order as `EN_NOUNS`. */
export const DE_NOUNS: readonly DeNoun[] = [
  { word: 'Schwelle', gender: 'f' },
  { word: 'Pass', gender: 'm' },
  { word: 'Bucht', gender: 'f' },
  { word: 'Grat', gender: 'm' },
  { word: 'Lagune', gender: 'f' },
  { word: 'Tief', gender: 'n' },
  { word: 'Riss', gender: 'm' },
  { word: 'Untiefe', gender: 'f' },
  { word: 'Tal', gender: 'n' },
  { word: 'Ufer', gender: 'n' },
  { word: 'Weite', gender: 'f' },
  { word: 'Mündung', gender: 'f' },
];

/** Generated name of adjective × noun with the adjective in the noun's gender. */
export function deSectorName(adjective: number, noun: number): string {
  const a = DE_ADJECTIVES[((adjective % DE_ADJECTIVES.length) + DE_ADJECTIVES.length) % DE_ADJECTIVES.length]!;
  const n = DE_NOUNS[((noun % DE_NOUNS.length) + DE_NOUNS.length) % DE_NOUNS.length]!;
  return `${a[n.gender]} ${n.word}`;
}

export const deSectors: SectorsTexts = {
  generated: deSectorName,
  origin: 'Ursprung',
  corner1: 'Schakalwinkel',
  corner2: 'Räuberwinkel',
  fortress: (numeral) => `Rostnest ${numeral}`,
  landmarks: {
    gas_giant: ['Am Gasriesen'],
    guild_relay: ['Am Mast'],
    rust_ring_shard: ['Am Splitter', 'Ringbruch', 'Splitterbogen'],
    crystal_spire: ['Kristallwand', 'Am Kristall', 'Glasgrat', 'Nadeltor'],
    dead_forge: ['Kalte Schmiede', 'Asche der Sternschmiede'],
  },
  security: { quiet: 'Ruhig', guarded: 'Bewacht', contested: 'Umkämpft', pirate: 'Piraten' },
  threat: { none: 'keine Piraten', rare: 'selten', often: 'häufig', nest: 'Nest' },
  threatLine: (word) => `Bedrohung: ${word}`,
  knowledge: { charted: 'Kartiert', reported: 'Gemeldet', uncharted: 'Unkartiert' },
  glyph: { charted: '[x]', reported: '[?]', uncharted: '[ ]' },
  depth: (depth, ring) => `Tiefe ${depth} · ${ring}`,
  entry: 'Einflug',
  hud: { badge: 'Sektor' },
  map: {
    lane: (id) => `Gildenroute ${id}`,
    legendLane: 'Gildenroute',
  },
  biome: {
    asteroidField: 'Asteroidenfeld',
    iceField: 'Eisfeld',
    quietSpace: 'Stiller Raum',
    rustField: 'Rostfeld',
    ionFringe: 'Ionensaum',
    wreckField: 'Wrackfeld',
    titanPlateau: 'Titanplateau',
    crystalNebula: 'Kristallnebel',
    cometPath: 'Kometenbahn',
    deepDark: 'Tiefe Dunkelheit',
  },
  card: {
    unknown: 'Unbekannter Sektor',
    here: 'Du bist hier',
    environment: 'Umgebung',
    stations: 'Stationen',
    landmarks: 'Wegmarken',
    mapping: (glyph, word, coverage) => (coverage === null ? `${glyph} ${word}` : `${glyph} ${word} · ${coverage} % geflogen`),
    route: (sectors, distance) => `Heimweg: ${sectors} ${sectors === 1 ? 'Sektor' : 'Sektoren'} · ${distance}`,
    count: (n, word) => `${n}× ${word}`,
    unknownWord: 'unbekannt',
    routeClear: 'keine gefährlichen Sektoren',
    routeHome: 'Heimatsektor – die Gildenstation ist hier.',
    pin: 'Klick heftet die Karte an',
    unpin: 'Angeheftet · Klick löst',
  },
  survey: {
    point: 'Messpunkt',
    pointDone: 'Markierter Messpunkt',
    detail: (sector, done, total) => `${sector} · markiert ${done}/${total}`,
    approach: (range) => `Flieg näher – ein Puls markiert einen Punkt bis ${range}`,
    pulse: 'Puls',
    marked: (done, total, sector) => `Messpunkt ${done}/${total} · ${sector}`,
    chartedSell: (sector, data) => (data > 0 ? `Sektor kartiert: ${sector} · +${data} D · die Gilde kauft die Karte` : `Sektor kartiert: ${sector} · die Gilde kauft die Karte`),
    badge: 'Punkte',
  },
  charts: {
    tab: 'Kartografie',
    intro: 'Die Gilde handelt mit Sektorkarten – nur gegen Credits.',
    sellTitle: 'Deine Karten · die Gilde kauft',
    sellNote: 'Die Karte eines Sektors, den du selbst kartiert hast (Messpunkte oder Überflug), kauft die Gilde einmal pro Spiel.',
    buyTitle: 'Gildenkarten zu verkaufen',
    buyNote: 'Bewachte Sektoren und Sektoren an den Gildenrouten. Eine gekaufte Karte bringt keine Daten und lässt sich nicht verkaufen.',
    never: 'Eine Karte zeigt nie Verstecke, Echos oder Wrackinhalte. Daten lassen sich weder kaufen noch verkaufen.',
    emptySell: 'Noch keine Karte zum Verkaufen. Kartiere einen Sektor: Flieg zu seinen Messpunkten und drück Tab (Puls) oder überflieg 70 % davon.',
    emptyBuy: 'Die Gilde hat keine Karte, die dir fehlt – du hast alle ihre Sektoren kartiert.',
    sell: 'Verkaufen',
    buy: 'Kaufen',
    sold: 'Verkauft',
    reserved: 'Für Auftrag',
    distance: (d) => `${d} von der Station`,
    points: (done, total) => `Messpunkte ${done}/${total}`,
    byFlight: 'durch Überflug kartiert',
    reveals: 'Kartiert den Sektor, entdeckt seine Stationen, macht seine Nachbarn Gemeldet.',
    more: (n) => `+ ${n} weitere ${n === 1 ? 'Karte' : 'Karten'} weiter von der Station`,
    confirmSell: (sector) => `Karte von ${sector} verkaufen?`,
    confirmSellBody: (price) => `Die Gilde zahlt ${price}. Die Karte jedes Sektors verkaufst du nur einmal – der Sektor bleibt für dich Kartiert.`,
    confirmBuy: (sector) => `Karte von ${sector} kaufen?`,
    confirmBuyBody: (price) => `Du zahlst ${price}. Der Sektor wird Kartiert, seine Stationen entdeckt und seine Nachbarn Gemeldet. Keine Daten und keine Verstecke, Echos oder Wracks darauf.`,
    cancel: 'Zurück',
    soldToast: (sector, credits) => `Karte verkauft: ${sector} · +${credits}`,
    boughtToast: (sector) => `Karte gekauft: ${sector} ist Kartiert`,
    grantedToast: (sector) => `Die Gilde hat dir die Karte von ${sector} gegeben – der Sektor ist Kartiert`,
    cardPoints: (done, total) => `Messpunkte ${done}/${total}`,
    cardSell: (price) => `Karte: die Gilde kauft sie für ${price}`,
    cardToChart: (price) => `Karte: kartiert kauft die Gilde sie für ${price}`,
    cardSold: 'Karte: an die Gilde verkauft',
    cardBought: 'Karte: von der Gilde gekauft',
    cardGuild: (price) => `Karte: die Gilde verkauft sie für ${price}`,
    cardReserved: 'Karte: gehört zu deinem Karte-Auftrag',
    firstTag: 'Erste Karte',
    includesSale: 'inkl. Kartenverkauf',
    firstObjective: (sector) => `Erste Karte: kartiere ${sector} (Messpunkte, Puls mit Tab)`,
  },
  trainingMap: {
    originDetail: 'Zuhause – ein Kartierter Sektor [x]: Du siehst seine Stationen und Felder.',
    lane: 'Gildenroute',
    laneDetail: 'Die bewachte Route der Gilde – der sicherste Weg hinaus.',
    reported: 'Gemeldeter Sektor',
    reportedDetail: 'Die Gilde kennt ihn, du hast noch keine Karte.',
    cornerDetail: 'Ohne Kanone fliegst du da nicht hin.',
    reward: (sector) => `die Karte von ${sector}`,
  },
  radio: {
    watch: 'Gildenwache',
    watchRole: 'Gilde',
    welcome: [
      (name) => `Willkommen in ${name}. Die Gildenwache hat dich auf dem Radar, Pilot.`,
      (name) => `Hier Gildenwache. ${name} steht unter unserem Schutz – flieg entspannt.`,
      (name) => `${name}, hier spricht die Gildenwache. Wenn es brenzlig wird, ruf uns.`,
    ],
    warnContested: [
      (name) => `${name} ist ein umkämpfter Sektor. Der Rost jagt hier – halt Waffen und Augen offen.`,
      (name) => `Vorsicht, Pilot, du bist gerade in ${name} eingeflogen. Die Gildenwache kommt nicht hier raus.`,
    ],
    warnContestedInstructor: [
      (name) => `Pilot, ${name} ist ein umkämpfter Sektor – die Gildenwache deckt ihn nicht ab. Mit einem Übungsrumpf kehrst du besser um.`,
      (name) => `Das ist ${name}, umkämpfter Raum. Wenn Piraten auftauchen, zögere nicht – flieh zu einer Station.`,
    ],
    warnPirate: [
      (name) => `Achtung, ${name} ist ein Piratensektor! Der Rost hält ihn – dreh um, wenn du nicht bereit bist.`,
      (name) => `Pilot, du bist in ${name}. Das ist ein Rostnest. Hier draußen kann dir niemand helfen.`,
    ],
    warnPirateInstructor: [
      (name) => `Halt, Pilot! ${name} ist ein Piratensektor. Ein Übungsrumpf überlebt hier nicht – dreh sofort um.`,
      (name) => `${name} gehört dem Rost. Das ist keine Übungsroute – flieg zurück nach Ursprung.`,
    ],
    taunt: [
      (name) => `Noch ein Schürfer in ${name}? Schön, unsere Laderäume sind halb leer.`,
      (name) => `Willkommen in ${name}, Pilot. Hier draußen zahlst du fürs Gehen.`,
      () => `Wir hören dein Triebwerk. Komm nur näher, wir warten.`,
    ],
  },
};

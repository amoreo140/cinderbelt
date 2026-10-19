// English texts of the sectors – the same keys as skSectors.ts (SectorsTexts). English adjectives have
// no gender: a generated name is simply "Adjective Noun" in title case.
import type { SectorsTexts } from './skSectors';

/** 12 adjectives – the same order as `SK_ADJECTIVES`. */
export const EN_ADJECTIVES: readonly string[] = ['Still', 'Rust', 'Cold', 'Grey', 'Long', 'Broken', 'Silver', 'Dark', 'Hollow', 'Far', 'Wolf', 'Old'];

/** 12 nouns – the same order as `SK_NOUNS`. */
export const EN_NOUNS: readonly string[] = ['Threshold', 'Pass', 'Bight', 'Ridge', 'Cove', 'Deep', 'Rift', 'Shoals', 'Vale', 'Shore', 'Reach', 'Mouth'];

export function enSectorName(adjective: number, noun: number): string {
  const a = EN_ADJECTIVES[((adjective % EN_ADJECTIVES.length) + EN_ADJECTIVES.length) % EN_ADJECTIVES.length]!;
  const n = EN_NOUNS[((noun % EN_NOUNS.length) + EN_NOUNS.length) % EN_NOUNS.length]!;
  return `${a} ${n}`;
}

export const enSectors: SectorsTexts = {
  generated: enSectorName,
  origin: 'Origin',
  corner1: 'Jackal Nook',
  corner2: 'Brigand Nook',
  fortress: (numeral) => `Rust Nest ${numeral}`,
  landmarks: {
    gas_giant: ['By the Gas Giant'],
    guild_relay: ['By the Mast'],
    rust_ring_shard: ['By the Shard', 'Ring Break', 'Shard Arc'],
    crystal_spire: ['Crystal Wall', 'By the Crystal', 'Glass Ridge', 'Needle Gate'],
    dead_forge: ['Cold Forge', 'Forge-smiths’ Ash'],
  },
  security: { quiet: 'Quiet', guarded: 'Guarded', contested: 'Contested', pirate: 'Pirate' },
  threat: { none: 'no pirates', rare: 'rare', often: 'often', nest: 'nest' },
  threatLine: (word) => `threat: ${word}`,
  knowledge: { charted: 'Charted', reported: 'Reported', uncharted: 'Uncharted' },
  glyph: { charted: '[x]', reported: '[?]', uncharted: '[ ]' },
  depth: (depth, ring) => `depth ${depth} · ${ring}`,
  entry: 'Entering',
  hud: { badge: 'Sector' },
  map: {
    lane: (id) => `Guild Lane ${id}`,
    legendLane: 'Guild Lane',
  },
  biome: {
    asteroidField: 'Asteroid Field',
    iceField: 'Ice Field',
    quietSpace: 'Quiet Space',
    rustField: 'Rust Field',
    ionFringe: 'Ion Fringe',
    wreckField: 'Wreck Yard',
    titanPlateau: 'Titan Plateau',
    crystalNebula: 'Crystal Nebula',
    cometPath: 'Comet Path',
    deepDark: 'Deep Dark',
  },
  card: {
    unknown: 'Unknown sector',
    here: 'You are here',
    environment: 'Environment',
    stations: 'Stations',
    landmarks: 'Landmarks',
    mapping: (glyph, word, coverage) => (coverage === null ? `${glyph} ${word}` : `${glyph} ${word} · flown ${coverage}%`),
    route: (sectors, distance) => `Route home: ${sectors} ${sectors === 1 ? 'sector' : 'sectors'} · ${distance}`,
    count: (n, word) => `${n}× ${word}`,
    unknownWord: 'unknown',
    routeClear: 'no dangerous sectors',
    routeHome: 'Home sector – the Guild station is here.',
    pin: 'Click to pin the card',
    unpin: 'Pinned · click to release',
  },
  survey: {
    point: 'Survey point',
    pointDone: 'Marked survey point',
    detail: (sector, done, total) => `${sector} · marked ${done}/${total}`,
    approach: (range) => `Get closer – a pulse marks a point within ${range}`,
    pulse: 'pulse',
    marked: (done, total, sector) => `Survey point ${done}/${total} · ${sector}`,
    chartedSell: (sector, data) => (data > 0 ? `Sector charted: ${sector} · +${data} D · the Guild buys the chart` : `Sector charted: ${sector} · the Guild buys the chart`),
    badge: 'points',
  },
  charts: {
    tab: 'Cartography',
    intro: 'The Guild trades sector charts – for credits only.',
    sellTitle: 'Your charts · the Guild buys',
    sellNote: 'The Guild buys the chart of a sector you charted yourself (survey points or flight), once per game.',
    buyTitle: 'Guild charts for sale',
    buyNote: 'Guarded sectors and sectors on the Guild Lanes. A bought chart gives no Data and cannot be sold.',
    never: 'A chart never shows caches, Echoes or wreck contents. Data cannot be bought or sold.',
    emptySell: 'No chart to sell yet. Chart a sector: fly to its survey points and press Tab (pulse), or fly over 70% of it.',
    emptyBuy: 'The Guild has no chart you lack – you have charted all of its sectors.',
    sell: 'Sell',
    buy: 'Buy',
    sold: 'Sold',
    reserved: 'For a contract',
    distance: (d) => `${d} from the station`,
    points: (done, total) => `survey points ${done}/${total}`,
    byFlight: 'charted by flight',
    reveals: 'Charts the sector, discovers its stations, makes its neighbours Reported.',
    more: (n) => `+ ${n} more ${n === 1 ? 'chart' : 'charts'} farther from the station`,
    confirmSell: (sector) => `Sell the chart of ${sector}?`,
    confirmSellBody: (price) => `The Guild pays ${price}. You sell each sector's chart only once – the sector stays Charted for you.`,
    confirmBuy: (sector) => `Buy the chart of ${sector}?`,
    confirmBuyBody: (price) => `You pay ${price}. The sector becomes Charted, its stations discovered and its neighbours Reported. No Data, and no caches, Echoes or wrecks on it.`,
    cancel: 'Back',
    soldToast: (sector, credits) => `Chart sold: ${sector} · +${credits}`,
    boughtToast: (sector) => `Chart bought: ${sector} is Charted`,
    grantedToast: (sector) => `The Guild gave you the chart of ${sector} – it is Charted`,
    cardPoints: (done, total) => `Survey points ${done}/${total}`,
    cardSell: (price) => `Chart: the Guild buys it for ${price}`,
    cardToChart: (price) => `Chart: once charted, the Guild buys it for ${price}`,
    cardSold: 'Chart: sold to the Guild',
    cardBought: 'Chart: bought from the Guild',
    cardGuild: (price) => `Chart: the Guild sells it for ${price}`,
    cardReserved: 'Chart: goes with your Chart contract',
    firstTag: 'First chart',
    includesSale: 'includes the chart sale',
    firstObjective: (sector) => `First chart: chart ${sector} (survey points, Tab pulse)`,
  },
  trainingMap: {
    originDetail: 'Home – a Charted sector [x]: you see its stations and fields.',
    lane: 'Guild Lane',
    laneDetail: 'The Guild\'s guarded route – the safest way out.',
    reported: 'Reported sector',
    reportedDetail: 'The Guild knows of it, you have no chart yet.',
    cornerDetail: 'Do not fly there without a cannon.',
    reward: (sector) => `the chart of ${sector}`,
  },
  radio: {
    watch: 'Guild Watch',
    watchRole: 'Guild',
    welcome: [
      (name) => `Welcome to ${name}. The Guild Watch has you on radar, pilot.`,
      (name) => `Guild Watch here. ${name} is under our protection – fly easy.`,
      (name) => `${name}, Guild Watch speaking. If it gets rough, call us.`,
    ],
    warnContested: [
      (name) => `${name} is a contested sector. The Rust hunts here – keep your guns and eyes open.`,
      (name) => `Careful, pilot, you just entered ${name}. The Guild Watch doesn't come out here.`,
    ],
    warnContestedInstructor: [
      (name) => `Pilot, ${name} is a contested sector – the Guild Watch doesn't cover it. In a training hull you'd better turn back.`,
      (name) => `This is ${name}, contested space. If pirates show up, don't hesitate – run for a station.`,
    ],
    warnPirate: [
      (name) => `Warning, ${name} is a pirate sector! The Rust holds it – turn around if you're not ready.`,
      (name) => `Pilot, you're in ${name}. That's a Rust nest. Nobody can help you out here.`,
    ],
    warnPirateInstructor: [
      (name) => `Stop, pilot! ${name} is a pirate sector. A training hull won't survive here – turn back now.`,
      (name) => `${name} belongs to the Rust. This is no training route – head back to Origin.`,
    ],
    taunt: [
      (name) => `Another miner in ${name}? Lovely, our holds are half empty.`,
      (name) => `Welcome to ${name}, pilot. Out here you pay to leave.`,
      () => `We can hear your engine. Keep coming, we're waiting.`,
    ],
  },
};

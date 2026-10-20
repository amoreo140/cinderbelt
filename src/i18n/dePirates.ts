// German texts: pirates and salvage (tractor beam, attention, toll, fortress, wrecks). Same keys as skPirates.ts (PiratesTexts); the terms follow GLOSSARY-DE.md.
import type { TractorFailReason, TractorReleaseReason } from '../sim/salvage/types';
import type { PiratesTexts } from './skPirates';

import { dePlural as plural } from './plural';

const ROMAN = ['I', 'II', 'III', 'IV'] as const;

export const dePirates = {
  fortressName: (index: number): string => `Rostfestung ${ROMAN[index] ?? String(index + 1)}`,
  beaconName: 'Piraten-Leuchtfeuer',
  resonator: 'Resonator',
  container: 'Container',
  piece: 'Abgetrenntes Stück',
  scavenger: 'Plünderer',
  gunner: 'Schütze',
  sentry: 'Wachdrohne',

  prompts: {
    container: 'F – Container laden',
    containerApproach: (gap: string): string => `Container – flieg näher (${gap} E)`,
    hulk: (parts: number): string => `Das Wrack hat ${parts} ${plural(parts, 'Teil', 'Teile')} – trenn eine Verbindung mit dem Laser oder reiß ein Teil mit dem Strahl heraus (T)`,
    beacon: 'F – den Clan zum Duell fordern',
    beaconBusy: 'Der Clan ist unterwegs – das Leuchtfeuer wartet',
    beaconCooldown: (min: number): string => `Das Leuchtfeuer schweigt – wieder in ${min} min`,
  },

  tractor: {
    label: 'Traktorstrahl',
    holding: (what: string): string => `Abschleppen: ${what}`,
    ripping: (pct: number): string => `Teil herausreißen ${pct} %`,
    release: 'loslassen',
    idle: 'greifen unter dem Cursor',
  },

  callout: {
    hulk: 'Bergbares Wrack',
    joints: (n: number, intact: number): string => `${n} ${plural(n, 'Verbindung', 'Verbindungen')} · ${intact} ${plural(intact, 'wertvolles Teil', 'wertvolle Teile')}`,
    jointsUnknown: 'Scanne das Wrack – es zeigt Verbindungen und wertvolle Teile',
    cutting: (pct: number): string => `Verbindung trennen ${pct} %`,
    cut: 'Verbindung lasern',
    rip: 'Herausreißen',
    load: 'Laden',
    tow: 'Abschleppen',
    pieceParts: (n: number): string => `${n} ${plural(n, 'wertvolles Teil', 'wertvolle Teile')}`,
    pieceScrap: 'Nur Schrott',
    container: 'Fracht unter einer Plane',
    fortressShield: (gens: number): string => `Den Kernschild halten ${gens} ${plural(gens, 'Generator', 'Generatoren')} hinter dem Fels`,
    fortressCore: (pct: number): string => `Kern ${pct} %`,
    fortressDown: (min: number): string => `Zerstört – Wiederaufbau in ${min} min`,
    beacon: 'Einen Clan-Kapitän zum Duell rufen',
    challenge: 'Fordern',
  },

  attention: {
    label: 'Rost',
    levels: ['Ruhe', 'Beobachtet', 'Gejagt', 'Überfall'] as const,
    hint: (value: number): string => `Rost-Aufmerksamkeit ${value}/100 – steigt mit Fracht und Kämpfen, sinkt mit der Zeit`,
    raid: (where: string, time: string): string => `Überfall: ${where} in ${time}`,
    challenge: (time: string): string => `Duell am Leuchtfeuer in ${time}`,
    raidHere: (where: string): string => `Überfall läuft: ${where}`,
    nearYou: 'in deiner Nähe',
  },

  toll: {
    title: 'Der Rost fordert Wegzoll',
    amount: (credits: string): string => `${credits}`,
    pay: 'Zahlen',
    refuse: 'Ablehnen',
    escape: (distance: number): string => `oder flieg ${distance} E weg`,
    noMoney: 'Zu wenig Credits',
  },

  fortress: {
    core: 'Kern',
    shield: 'Schild',
    gens: 'Generatoren',
    turrets: 'Geschütztürme',
    shielded: 'geschützt',
    open: 'offen',
  },

  reticle: (covering: number, total: number): string => `${covering}/${total} ${plural(total, 'Kanone', 'Kanonen')} im Ziel`,

  map: {
    fortress: 'Festung',
    beacon: 'Clan-Leuchtfeuer',
    raid: 'Überfall',
  },

  toasts: {
    tractorLocked: 'Traktorstrahl erfasst',
    tractorRip: 'Der Strahl reißt ein Teil aus dem Wrack…',
    tractorReleased: {
      manual: 'Traktorstrahl gelöst',
      range: 'Das Objekt ist aus der Reichweite des Strahls gerutscht',
      energy: 'Dem Strahl ist die Energie ausgegangen',
      lost: 'Der Strahl hat sein Ziel verloren',
      loaded: 'Geladen – der Strahl ist frei',
      stolen: 'Ein Plünderer hat deine abgeschleppte Fracht gestohlen!',
    } satisfies Record<TractorReleaseReason, string>,
    tractorFailed: {
      noTractor: 'Das Schiff hat keinen Traktorstrahl (ein gefertigtes Teil)',
      noTarget: 'Nichts zum Abschleppen unter dem Cursor',
      tooHeavy: 'Zu schwer für den Traktorstrahl',
      joint: 'Das ist eine Verbindung – sie hält das Wrack zusammen, trenn sie mit dem Laser',
      energy: 'Zu wenig Energie für den Traktorstrahl',
    } satisfies Record<TractorFailReason, string>,
    wreckCut: (pieces: number): string => `Verbindung getrennt – ${pieces} ${plural(pieces, 'Stück', 'Stücke')} losgebrochen`,
    wreckCutBlast: 'Explosion! Du hast in einen Tank oder Reaktor geschnitten',
    partRipped: 'Teil herausgerissen – der Strahl zieht es zum Schiff',
    salvageBlocked: 'Das Wrack ist zu groß – zerleg es in Stücke',
    containerLoaded: (list: string): string => `Aus dem Container: ${list}`,
    containerFull: (list: string): string => `Aus dem Container: ${list} – der Frachtraum ist voll, der Rest bleibt im Container`,
    containerNothing: 'Der Frachtraum ist voll – der Inhalt bleibt im Container',
    scavengerStole: 'Ein Plünderer hat die Beute gestohlen – er hat sie geladen, schnapp ihn',
    attention: [
      'Die Piraten lassen dich in Ruhe',
      'Der Rost hat dich bemerkt – mehr Piraten, bessere Beute',
      'Der Rost ist hinter dir her – ein Jagdtrupp mit Kapitän',
      'Der Rost bereitet einen Überfall vor',
    ] as const,
    huntingParty: (captain: string | null): string =>
      captain ? `Ein Jagdtrupp unter Kapitän ${captain} sucht dich` : 'Ein Jagdtrupp des Rosts sucht dich',
    raidAnnounced: (where: string, min: number): string => `Der Rost greift ${where} in ${min} min an – eine Kriegskasse wartet`,
    challengeIssued: (min: number): string => `Herausforderung angenommen – ein Rost-Kapitän kommt in ${min} min zum Leuchtfeuer`,
    challengeRefused: { raidActive: 'Der Clan ist unterwegs – das Leuchtfeuer wartet', cooldown: 'Das Leuchtfeuer schweigt, der Clan erholt sich noch' } as const,
    raidArrived: 'Die Angreifer sind da!',
    raidDefeated: (credits: string): string => `Überfall abgewehrt – eine Kriegskasse mit ${credits} und Container`,
    raidEnded: 'Die Angreifer sind abgezogen',
    tollDemanded: (credits: string): string => `Piraten fordern ${credits} Wegzoll`,
    tollPaid: (credits: string): string => `Wegzoll bezahlt (${credits}) – sie lassen dich ziehen`,
    tollRefused: 'Wegzoll verweigert – sie greifen an!',
    tollTimeout: 'Sie haben nicht gewartet – sie greifen an!',
    tollEscaped: 'Du bist den Zolleintreibern entkommen',
    tollNoMoney: 'Du hast nicht genug Credits für den Wegzoll',
    fortressPart: { turret: 'Festungs-Geschützturm zerstört', generator: 'Schildgenerator zerstört' } as const,
    fortressShieldDown: 'Der Kernschild ist unten – greif den Kern an!',
    fortressReinforcements: (n: number): string => `${n} ${plural(n, 'Schakal', 'Schakale')} aus dem Festungshangar gestartet`,
    fortressDestroyed: (credits: string): string => `Die Festung ist gefallen! Belohnung ${credits} und die Kriegskasse`,
    fortressRebuilt: 'Der Rost hat die Festung wieder aufgebaut',
    resonator: 'Schlüsselgegenstand: Resonator (aus dem Festungskern)',
  },

  help: ['T – Traktorstrahl (greifen / lösen)', 'Y / X – Wegzoll zahlen / ablehnen'],
} satisfies PiratesTexts;

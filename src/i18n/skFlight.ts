// Slovak texts of M3.8 "Flight and damage" (flight feel and damage feedback): lost parts, restoring
// the design in the shipyard, the collision warning, the flight-path marker and their settings.
// A separate module next to sk.ts, skPirates.ts, skGoals.ts and skDiscovery.ts.
import type { PartLossCause } from '../sim/Simulation';

import { skPlural as plural } from './plural';

export interface FlightTexts {
  // --- ship status in the flight console ---
  status: {
    intact: string;
    /** "1 part lost", "2 parts lost", "5 parts lost". */
    missing: (n: number) => string;
    /** Short form next to missing parts: "2 damaged". */
    damagedShort: (n: number) => string;
    /** Silhouette tooltip / screen reader. */
    missingHint: string;
  };
  // --- toast when the ship loses parts ---
  lost: {
    one: (part: string) => string;
    many: (list: string) => string;
    cause: {
      shot: string;
      impact: string;
      hazard: string;
      exhaust: string;
      blast: string;
    };
    /** "(impact)" after the list. */
    withCause: (text: string, cause: string) => string;
  };
  // --- covered engine nozzle (design 3.4.2) ---
  exhaust: {
    /** Toast when an engine starts burning a part and at every quarter of its HP: "The engine nozzle is burning Armour T1 (75 % HP)". */
    burning: (part: string, hpPercent: number) => string;
  };
  // --- restore to design (shipyard, hub overview) ---
  restore: {
    button: string;
    /** Hint on the shipyard toolbar button. */
    hint: string;
    nothing: string;
    /** Shipyard banner over the hangar: "Versus the design: 1 part lost · 2 damaged". */
    banner: (status: string) => string;
    applied: string;
    /** Toast after the draft is rebuilt. */
    drafted: (missing: number, repaired: number, note?: string) => string;
    /** After "drafted" when the swaps would not be affordable. */
    repairsSkipped: (n: number) => string;
    unplaced: (n: number) => string;
    /** Hub overview card. */
    cardTitle: string;
    cardMissing: (list: string) => string;
    cardAction: string;
    cardNoYard: string;
  };
  // --- collision warning ---
  collision: {
    title: string;
    /** "o 1,4 s". */
    eta: (seconds: string) => string;
    brake: string;
    /** Radar / marker label of the obstacle. */
    obstacle: string;
  };
  // --- flight-path marker ---
  flightPath: {
    prograde: string;
    stop: string;
  };
  // --- settings (Display section) ---
  settings: {
    flightMarker: string;
    cameraShake: string;
    combatZoom: string;
    on: string;
    off: string;
  };
}

export const skFlight = {
  status: {
    intact: 'Bez poškodenia',
    missing: (n: number): string => plural(n, '1 diel stratený', `${n} diely stratené`, `${n} dielov stratených`),
    damagedShort: (n: number): string => plural(n, '1 poškodený', `${n} poškodené`, `${n} poškodených`),
    missingHint: 'Prerušované bunky = diely, ktoré loď stratila oproti návrhu z lodenice',
  },

  lost: {
    one: (part: string): string => `Stratený diel: ${part}`,
    many: (list: string): string => `Stratené diely: ${list}`,
    cause: { shot: 'zásah', impact: 'náraz', hazard: 'nebezpečenstvo', exhaust: 'spálila ho tryska motora', blast: 'výbuch reaktora' } as Record<PartLossCause, string>,
    withCause: (text: string, cause: string): string => `${text} (${cause})`,
  },

  exhaust: {
    burning: (part: string, hpPercent: number): string =>
      hpPercent >= 100 ? `Tryska motora páli diel ${part} – uvoľni jej miesto v lodenici` : `Tryska motora páli diel ${part} (${hpPercent} % HP)`,
  },

  restore: {
    button: 'Obnoviť podľa návrhu',
    hint: 'Návrh z lodenice: stratené diely späť (zo skladu, výrobou alebo kúpou) a poškodené vymeniť',
    nothing: 'Loď zodpovedá návrhu – nie je čo obnoviť',
    banner: (status: string): string => `Oproti návrhu: ${status}`,
    applied: 'Návrh obnovený – cenu vidíš v Cene zmien',
    drafted: (missing: number, repaired: number, note?: string): string => {
      const parts = [
        missing > 0 ? plural(missing, '1 stratený diel', `${missing} stratené diely`, `${missing} stratených dielov`) : null,
        repaired > 0 ? plural(repaired, '1 poškodený vymenený', `${repaired} poškodené vymenené`, `${repaired} poškodených vymenených`) : null,
      ].filter(Boolean);
      return `Návrh obnovený: ${[...parts, note].filter(Boolean).join(', ')} – potvrď Enterom`;
    },
    repairsSkipped: (n: number): string => plural(n, 'poškodený diel ostáva (na výmenu nestačí)', `${n} poškodené ostávajú (na výmenu nestačí)`, `${n} poškodených ostáva (na výmenu nestačí)`),
    unplaced: (n: number): string => plural(n, '1 diel sa nedal pripojiť', `${n} diely sa nedali pripojiť`, `${n} dielov sa nedalo pripojiť`),
    cardTitle: 'Loď nezodpovedá návrhu',
    cardMissing: (list: string): string => `Chýba: ${list}`,
    cardAction: 'Otvoriť lodenicu a obnoviť',
    cardNoYard: 'Táto stanica nemá lodenicu – obnovíš ju na stanici s lodenicou',
  },

  collision: {
    title: 'Kolízia',
    eta: (seconds: string): string => `o ${seconds} s`,
    brake: 'Brzdi',
    obstacle: 'prekážka',
  },

  flightPath: {
    prograde: 'Smer letu',
    stop: 'Zastavíš tu',
  },

  settings: {
    flightMarker: 'Ukazovateľ smeru letu',
    cameraShake: 'Otrasy kamery',
    combatZoom: 'Bojové oddialenie',
    on: 'Zapnuté',
    off: 'Vypnuté',
  },
} satisfies FlightTexts;

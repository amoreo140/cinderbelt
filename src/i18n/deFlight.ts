// German texts: flight and damage feedback (lost parts, restore design, collision warning, flight path). Same keys as skFlight.ts (FlightTexts); the terms follow GLOSSARY-DE.md.
import type { PartLossCause } from '../sim/Simulation';
import type { FlightTexts } from './skFlight';

import { dePlural as plural } from './plural';

export const deFlight = {
  status: {
    intact: 'Unbeschädigt',
    missing: (n: number): string => plural(n, '1 Teil verloren', `${n} Teile verloren`),
    damagedShort: (n: number): string => `${n} beschädigt`,
    missingHint: 'Gestrichelte Zellen = Teile, die dem Schiff gegenüber seinem Werftentwurf fehlen',
  },

  lost: {
    one: (part: string): string => `Teil verloren: ${part}`,
    many: (list: string): string => `Teile verloren: ${list}`,
    cause: { shot: 'Treffer', impact: 'Aufprall', hazard: 'Gefahr', exhaust: 'von einer Triebwerksdüse verbrannt', blast: 'Reaktorexplosion' } as Record<PartLossCause, string>,
    withCause: (text: string, cause: string): string => `${text} (${cause})`,
  },

  exhaust: {
    burning: (part: string, hpPercent: number): string =>
      hpPercent >= 100
        ? `Eine Triebwerksdüse verbrennt ${part} – mach in der Werft Platz vor ihr`
        : `Eine Triebwerksdüse verbrennt ${part} (${hpPercent} % HP)`,
  },

  restore: {
    button: 'Nach Entwurf wiederherstellen',
    hint: 'Werftentwurf: verlorene Teile zurücksetzen (aus dem Lager, durch Fertigung oder Kauf) und beschädigte ersetzen',
    nothing: 'Das Schiff entspricht seinem Entwurf – nichts wiederherzustellen',
    banner: (status: string): string => `Gegenüber dem Entwurf: ${status}`,
    applied: 'Entwurf wiederhergestellt – den Preis siehst du unter Änderungskosten',
    drafted: (missing: number, repaired: number, note?: string): string => {
      const parts = [
        missing > 0 ? plural(missing, '1 verlorenes Teil', `${missing} verlorene Teile`) : null,
        repaired > 0 ? plural(repaired, '1 beschädigtes Teil ersetzt', `${repaired} beschädigte Teile ersetzt`) : null,
      ].filter(Boolean);
      return `Entwurf wiederhergestellt: ${[...parts, note].filter(Boolean).join(', ')} – Enter bestätigt`;
    },
    repairsSkipped: (n: number): string =>
      plural(n, 'ein beschädigtes Teil bleibt (Tausch zu teuer)', `${n} beschädigte bleiben (Tausch zu teuer)`),
    unplaced: (n: number): string => plural(n, '1 Teil ließ sich nicht anbringen', `${n} Teile ließen sich nicht anbringen`),
    cardTitle: 'Das Schiff entspricht nicht seinem Entwurf',
    cardMissing: (list: string): string => `Fehlt: ${list}`,
    cardAction: 'Werft öffnen und wiederherstellen',
    cardNoYard: 'Diese Station hat keine Werft – stell das Schiff an einer Station mit Werft wieder her',
  },

  collision: {
    title: 'Kollision',
    eta: (seconds: string): string => `in ${seconds} s`,
    brake: 'Bremsen',
    obstacle: 'Hindernis',
  },

  flightPath: {
    prograde: 'Flugbahn',
    stop: 'Hier hältst du an',
  },

  settings: {
    flightMarker: 'Flugbahn-Markierung',
    cameraShake: 'Kamerawackeln',
    combatZoom: 'Kampf-Auszoomen',
    on: 'An',
    off: 'Aus',
  },
} satisfies FlightTexts;

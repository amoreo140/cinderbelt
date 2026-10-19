// English texts: flight and damage feedback (lost parts, restore design, collision warning, flight path). Same keys as skFlight.ts (FlightTexts).
import type { PartLossCause } from '../sim/Simulation';
import type { FlightTexts } from './skFlight';

import { enPlural as plural } from './plural';

export const enFlight = {
  status: {
    intact: 'Undamaged',
    missing: (n: number): string => plural(n, '1 part lost', `${n} parts lost`),
    damagedShort: (n: number): string => `${n} damaged`,
    missingHint: 'Dashed cells = parts the ship has lost compared with its shipyard design',
  },

  lost: {
    one: (part: string): string => `Part lost: ${part}`,
    many: (list: string): string => `Parts lost: ${list}`,
    cause: { shot: 'hit', impact: 'impact', hazard: 'hazard', exhaust: 'burnt by an engine nozzle', blast: 'reactor blast' } as Record<PartLossCause, string>,
    withCause: (text: string, cause: string): string => `${text} (${cause})`,
  },

  exhaust: {
    burning: (part: string, hpPercent: number): string =>
      hpPercent >= 100 ? `An engine nozzle is burning ${part} – clear its space in the shipyard` : `An engine nozzle is burning ${part} (${hpPercent}% HP)`,
  },

  restore: {
    button: 'Restore to design',
    hint: 'Shipyard design: put lost parts back (from storage, by crafting or buying) and replace damaged ones',
    nothing: 'The ship matches its design – nothing to restore',
    banner: (status: string): string => `Against the design: ${status}`,
    applied: 'Design restored – see the price under Cost of changes',
    drafted: (missing: number, repaired: number, note?: string): string => {
      const parts = [
        missing > 0 ? plural(missing, '1 lost part', `${missing} lost parts`) : null,
        repaired > 0 ? plural(repaired, '1 damaged part replaced', `${repaired} damaged parts replaced`) : null,
      ].filter(Boolean);
      return `Design restored: ${[...parts, note].filter(Boolean).join(', ')} – Enter confirms`;
    },
    repairsSkipped: (n: number): string => plural(n, 'a damaged part stays (too costly to swap)', `${n} damaged stay (too costly to swap)`),
    unplaced: (n: number): string => plural(n, '1 part could not be attached', `${n} parts could not be attached`),
    cardTitle: 'The ship does not match its design',
    cardMissing: (list: string): string => `Missing: ${list}`,
    cardAction: 'Open the shipyard and restore',
    cardNoYard: 'This station has no shipyard – restore the ship at a station that has one',
  },

  collision: {
    title: 'Collision',
    eta: (seconds: string): string => `in ${seconds} s`,
    brake: 'Brake',
    obstacle: 'obstacle',
  },

  flightPath: {
    prograde: 'Flight path',
    stop: 'You stop here',
  },

  settings: {
    flightMarker: 'Flight path marker',
    cameraShake: 'Camera shake',
    combatZoom: 'Combat zoom-out',
    on: 'On',
    off: 'Off',
  },
} satisfies FlightTexts;

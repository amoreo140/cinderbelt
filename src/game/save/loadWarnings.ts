// Warnings when loading a save (M1 from the M2a–M3b code review) – texts for the player.
import { tx } from '../../i18n';
import type { LoadWarning } from '../../sim/save/load';

/** A text for each warning (order kept). `stationName` turns a station id into its name. */
export function loadWarningTexts(warnings: readonly LoadWarning[], stationName: (id: string) => string): string[] {
  return warnings.map((w) => {
    switch (w.code) {
      case 'shipReplaced':
        return tx().saves.shipReplaced(stationName(w.stationId));
      case 'overBudgetLegacy':
        return tx().saves.overBudgetLegacy(w.used, w.budget);
      case 'capacityClamped':
        return tx().saves.capacityClamped;
      case 'coveredNozzleLegacy':
        return tx().saves.coveredNozzleLegacy(w.engines);
      case 'storedShipDropped':
        return tx().saves.storedShipDropped(stationName(w.stationId));
      case 'sitesRepaired':
        return tx().saves.sitesRepaired;
    }
  });
}

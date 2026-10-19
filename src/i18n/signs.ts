// Signed numbers with a true minus for the shipyard texts of both languages (skShipyard.ts, enShipyard.ts).
// A module of its own: the language bundles are loaded separately (index.ts), and an English module that
// imported a Slovak one would pull the Slovak texts into the English bundle.

/** A signed whole number with a true minus ("+18", "−12", "0"). */
export const signedInt = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** A grid coordinate with a true minus ("3", "−1"). */
export const coord = (n: number): string => (n < 0 ? `−${-n}` : `${n}`);

// Keys of the M4b graveyard objects (plan §2.1) – a leaf module (no imports), so the salvage and pirate
// code can tell a graveyard wreck from a POI wreck without importing the graveyard logic.
//
//   graveyard `gy:<cx>,<cy>`   its wrecks `gy:<cx>,<cy>#<i>`   mines `gy:<cx>,<cy>:m<i>`   sleepers `gs:<cx>,<cy>:<i>`

const WRECK_KEY = /^gy:(-?\d+),(-?\d+)#(\d+)$/;
const MINE_ID = /^gy:(-?\d+),(-?\d+):m(\d+)$/;
const SLEEPER_ID = /^gs:(-?\d+),(-?\d+):(\d+)$/;

export const graveyardWreckKey = (site: string, i: number): string => `${site}#${i}`;
export const mineId = (site: string, i: number): string => `${site}:m${i}`;
/** Sleeper i of the graveyard `gy:<cx>,<cy>` → `gs:<cx>,<cy>:<i>`. */
export const sleeperId = (site: string, i: number): string => `gs:${site.slice(3)}:${i}`;
/** Prefix of the sleeper ids of a graveyard (`gs:<cx>,<cy>:`). */
export const sleeperPrefix = (site: string): string => `gs:${site.slice(3)}:`;

/** A graveyard wreck key → its graveyard id and wreck index, or null. */
export function parseGraveyardWreckKey(key: string | undefined): { site: string; index: number } | null {
  const m = key ? WRECK_KEY.exec(key) : null;
  return m ? { site: `gy:${m[1]},${m[2]}`, index: Number(m[3]) } : null;
}

/** A mine id → its graveyard id and mine index, or null. */
export function parseMineId(id: string): { site: string; index: number } | null {
  const m = MINE_ID.exec(id);
  return m ? { site: `gy:${m[1]},${m[2]}`, index: Number(m[3]) } : null;
}

/** A sleeper id → its graveyard id and index, or null. */
export function parseSleeperId(id: string): { site: string; index: number } | null {
  const m = SLEEPER_ID.exec(id);
  return m ? { site: `gy:${m[1]},${m[2]}`, index: Number(m[3]) } : null;
}

export const isGraveyardWreckKey = (key: string | undefined): key is string => !!key && WRECK_KEY.test(key);

/**
 * A wreck rebuilt from the seed whose dismantling is remembered in `discovery.cut` / `opened` / `scanned`
 * under its key: a POI wreck (`wreck:<cx>,<cy>`) or a graveyard wreck (`gy:<cx>,<cy>#<i>`).
 */
export const isSeedWreckKey = (key: string | undefined): key is string => !!key && (key.startsWith('wreck:') || WRECK_KEY.test(key));

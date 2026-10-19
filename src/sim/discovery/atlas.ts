// Atlas: collections of discovered things with a percentage and a one-off Data reward for completion.
import { ATLAS_COLLECTIONS, ATLAS_ITEMS, ATLAS_REWARD, type AtlasCollection } from '../../data/atlas';
import { VARIANTS, VARIANT_IDS } from '../../data/variants';
import type { SimEvent, SimState } from '../Simulation';
import { gainData } from './state';

/** Records an Atlas entry (e.g. 'anomalies', 'ion'). */
export function addAtlas(state: SimState, collection: AtlasCollection, item: string): void {
  state.discovery.atlas.add(`${collection}:${item}`);
}

/** Found entries of a collection (variants and captains are derived from the state). */
export function atlasFound(state: SimState, collection: AtlasCollection): Set<string> {
  const d = state.discovery;
  if (collection === 'variants') {
    return new Set(
      VARIANT_IDS.filter((v) => {
        const src = VARIANTS[v].source;
        return src.kind === 'plan' ? d.plans.has(v) : d.archive.has(src.node as never);
      }),
    );
  }
  if (collection === 'captains') {
    return new Set([...state.career.captains].filter(([, c]) => c.defeated).map(([i]) => String(i)));
  }
  const prefix = `${collection}:`;
  return new Set([...d.atlas].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}

export interface AtlasProgress {
  collection: AtlasCollection;
  found: number;
  total: number;
  items: { id: string; found: boolean }[];
  reward: number;
  done: boolean;
}

export function atlasProgress(state: SimState): AtlasProgress[] {
  return ATLAS_COLLECTIONS.map((c) => {
    const found = atlasFound(state, c);
    const items = ATLAS_ITEMS[c].map((id) => ({ id, found: found.has(id) }));
    const n = items.filter((i) => i.found).length;
    return { collection: c, found: n, total: items.length, items, reward: ATLAS_REWARD[c], done: n === items.length };
  });
}

/** Completed collections get a reward (once). */
export function checkAtlas(state: SimState, events: SimEvent[]): void {
  const d = state.discovery;
  for (const p of atlasProgress(state)) {
    if (!p.done || d.atlasDone.has(p.collection)) continue;
    d.atlasDone.add(p.collection);
    events.push({ type: 'atlasComplete', collection: p.collection, data: p.reward });
    gainData(state, p.reward, 'atlas', events);
  }
}

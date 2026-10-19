// Reused scratch lists of the per-step hot paths (perf audit 2026-10-17, P4: the simulation allocated
// several MB/s of short-lived lists). A list is filled and read within one call and never kept.
//
// `list.length = 0` is not enough: V8 then shrinks the list's storage, so the next fill allocates it
// again. Popping keeps the storage – a reused list allocates nothing once it has grown.

/** Empties a reused list, keeping its storage. Returns the list. */
export function clearList<T>(list: T[]): T[] {
  while (list.length > 0) list.pop();
  return list;
}

/** Shortens a reused list to `n` items, keeping its storage. */
export function truncateList<T>(list: T[], n: number): void {
  while (list.length > n) list.pop();
}

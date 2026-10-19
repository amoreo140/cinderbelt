// Protection against the game open in two tabs (M5 from the M2a–M3b code review): the tab that plays a slot
// holds the Web Lock "cinderbelt-slot:<slot>". The second tab neither loads nor overwrites the same slot
// (it gets a clear warning) until the first releases it (return to the menu, closing the tab).
import type { SlotRef } from '../../sim/save/types';
import { slotKey } from '../storage/slots';

/** The subset of navigator.locks that we need (a replacement in tests). */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

export interface SlotLock {
  readonly slot: SlotRef;
  /** Releases the lock (a repeated call does nothing). */
  release(): void;
}

export const slotLockName = (slot: SlotRef): string => `cinderbelt-slot:${slotKey(slot)}`;

function defaultLocks(): LockManagerLike | null {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

export class SlotLocks {
  constructor(private readonly locks: LockManagerLike | null = defaultLocks()) {}

  /**
   * Locks the slot for this tab. null = the slot is open in another tab. Without the Web Locks API
   * (or on its error) the lock is always granted – the game goes on, just without protection.
   */
  lock(slot: SlotRef): Promise<SlotLock | null> {
    const ref = { ...slot };
    const free: SlotLock = { slot: ref, release: () => {} };
    if (!this.locks) return Promise.resolve(free);
    return new Promise<SlotLock | null>((resolve) => {
      let settled = false;
      const settle = (value: SlotLock | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      this.locks!.request(slotLockName(ref), { ifAvailable: true }, (lock) => {
        if (!lock) {
          settle(null);
          return undefined;
        }
        // the lock lasts until this promise resolves
        return new Promise<void>((done) => {
          let released = false;
          settle({
            slot: ref,
            release: () => {
              if (released) return;
              released = true;
              done();
            },
          });
        });
      }).catch((e: unknown) => {
        console.warn('Web Locks unavailable, two-tab protection is off:', e);
        settle(free);
      });
    });
  }
}

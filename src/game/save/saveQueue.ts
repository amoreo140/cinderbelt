// Write queue (M2, 9.2): one write runs at a time, the next waits; several waiting regular
// saves are merged into the last one (older ones get `superseded`). Moves and deletes are not merged.

export type QueueResult<T> = { status: 'done'; value: T } | { status: 'superseded' } | { status: 'failed'; error: unknown };

interface Entry {
  job: () => Promise<unknown>;
  coalesce: boolean;
  resolve: (r: QueueResult<unknown>) => void;
}

export class SaveQueue {
  private running = false;
  private readonly pending: Entry[] = [];
  private idleWaiters: (() => void)[] = [];

  get busy(): boolean {
    return this.running || this.pending.length > 0;
  }

  enqueue<T>(job: () => Promise<T>, options: { coalesce?: boolean } = {}): Promise<QueueResult<T>> {
    const coalesce = options.coalesce ?? true;
    return new Promise<QueueResult<T>>((resolve) => {
      const entry: Entry = { job, coalesce, resolve: resolve as (r: QueueResult<unknown>) => void };
      const last = this.pending[this.pending.length - 1];
      if (coalesce && last?.coalesce) {
        this.pending.pop();
        last.resolve({ status: 'superseded' });
      }
      this.pending.push(entry);
      if (!this.running) void this.drain();
    });
  }

  /** Waits until everything queued is written. */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.pending.length > 0) {
      const entry = this.pending.shift()!;
      try {
        entry.resolve({ status: 'done', value: await entry.job() });
      } catch (error) {
        entry.resolve({ status: 'failed', error });
      }
    }
    this.running = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}

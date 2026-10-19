import { describe, expect, it } from 'vitest';
import { SaveQueue } from './saveQueue';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('SaveQueue', () => {
  it('runs one job at a time in order', async () => {
    const q = new SaveQueue();
    const log: string[] = [];
    const gate = deferred();
    const a = q.enqueue(async () => (log.push('a start'), await gate.promise, log.push('a end'), 'A'), { coalesce: false });
    const b = q.enqueue(async () => (log.push('b'), 'B'), { coalesce: false });
    expect(q.busy).toBe(true);
    await Promise.resolve();
    expect(log).toEqual(['a start']);
    gate.resolve();
    expect(await a).toEqual({ status: 'done', value: 'A' });
    expect(await b).toEqual({ status: 'done', value: 'B' });
    expect(log).toEqual(['a start', 'a end', 'b']);
    expect(q.busy).toBe(false);
  });

  it('merges waiting coalescable jobs into the last one', async () => {
    const q = new SaveQueue();
    const gate = deferred();
    const ran: number[] = [];
    const first = q.enqueue(async () => (await gate.promise, ran.push(1)));
    const second = q.enqueue(async () => ran.push(2));
    const third = q.enqueue(async () => ran.push(3));
    gate.resolve();
    expect((await first).status).toBe('done');
    expect(await second).toEqual({ status: 'superseded' });
    expect((await third).status).toBe('done');
    expect(ran).toEqual([1, 3]);
  });

  it('never drops a non-coalescable job', async () => {
    const q = new SaveQueue();
    const gate = deferred();
    const ran: string[] = [];
    q.enqueue(async () => (await gate.promise, ran.push('save1')));
    const move = q.enqueue(async () => ran.push('move'), { coalesce: false });
    const save2 = q.enqueue(async () => ran.push('save2'));
    gate.resolve();
    expect((await move).status).toBe('done');
    expect((await save2).status).toBe('done');
    expect(ran).toEqual(['save1', 'move', 'save2']);
  });

  it('reports a failed job and continues with the next one', async () => {
    const q = new SaveQueue();
    const failed = q.enqueue(async () => {
      throw new Error('quota');
    });
    const next = q.enqueue(async () => 'ok', { coalesce: false });
    expect(await failed).toMatchObject({ status: 'failed' });
    expect(await next).toEqual({ status: 'done', value: 'ok' });
  });

  it('resolves idle() when everything is written', async () => {
    const q = new SaveQueue();
    await q.idle();
    let done = false;
    q.enqueue(async () => {
      await Promise.resolve();
      done = true;
    });
    await q.idle();
    expect(done).toBe(true);
  });
});

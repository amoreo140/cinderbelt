import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadQueue } from './textureUploads';

describe('UploadQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs one job per gap, in order, and resolves with its result', async () => {
    const q = new UploadQueue(16);
    const ran: string[] = [];
    const a = q.run(() => (ran.push('a'), 1));
    const b = q.run(() => (ran.push('b'), 2));
    const c = q.run(() => (ran.push('c'), 3));
    expect(ran).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(ran).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(16);
    expect(ran).toEqual(['a', 'b']);
    expect(q.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(16);
    expect(await Promise.all([a, b, c])).toEqual([1, 2, 3]);
    expect(q.pending).toBe(0);
  });

  it('runs a late job after every other waiting one', async () => {
    const q = new UploadQueue(16);
    const ran: string[] = [];
    void q.run(() => ran.push('late'), true);
    void q.run(() => ran.push('a'));
    void q.run(() => ran.push('b'));
    await vi.advanceTimersByTimeAsync(48);
    expect(ran).toEqual(['a', 'b', 'late']);
  });

  it('passes a failing job on to its caller and keeps going', async () => {
    const q = new UploadQueue(5);
    const bad = q.run(() => {
      throw new Error('upload failed');
    });
    const good = q.run(() => 'ok');
    const caught = bad.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await caught).toBe('upload failed');
    expect(await good).toBe('ok');
  });

  it('rejects the waiting jobs on dispose and runs none of them', async () => {
    const q = new UploadQueue(16);
    let ran = false;
    const waiting = q.run(() => (ran = true)).catch(() => 'rejected');
    q.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(await waiting).toBe('rejected');
    expect(ran).toBe(false);
    await expect(q.run(() => 1)).rejects.toThrow();
  });
});

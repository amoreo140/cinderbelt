import { describe, expect, it } from 'vitest';
import { recommendOffer, recommendReason } from './recommend';

type O = Parameters<typeof recommendOffer>[0][number];
const offer = (id: string, p: Partial<O> = {}): O => ({ offerId: id, risk: 0, short: false, reward: 100, minutes: 4, accept: { enabled: true }, ...p });

describe('recommendOffer', () => {
  it('returns null for no offers', () => {
    expect(recommendOffer([])).toBeNull();
  });
  it('returns null when nothing can be accepted', () => {
    expect(recommendOffer([offer('a', { accept: { enabled: false } }), offer('b', { accept: undefined })])).toBeNull();
  });
  it('skips offers that cannot be accepted even when they pay best', () => {
    expect(recommendOffer([offer('a', { reward: 9999, accept: { enabled: false } }), offer('b')])?.offerId).toBe('b');
  });
  it('prefers lower risk over pay', () => {
    expect(recommendOffer([offer('a', { risk: 1, reward: 900 }), offer('b', { risk: 0, reward: 100 })])?.offerId).toBe('b');
  });
  it('prefers short contracts at equal risk', () => {
    expect(recommendOffer([offer('a', { reward: 900 }), offer('b', { short: true, reward: 100 })])?.offerId).toBe('b');
  });
  it('then takes the highest reward per minute', () => {
    expect(recommendOffer([offer('a', { reward: 300, minutes: 6 }), offer('b', { reward: 200, minutes: 2 })])?.offerId).toBe('b');
  });
  it('falls back to the reward when minutes are unknown', () => {
    expect(recommendOffer([offer('a', { reward: 300, minutes: 0 }), offer('b', { reward: 200, minutes: 0 })])?.offerId).toBe('a');
  });
  it('breaks ties by offer id, independent of order', () => {
    const a = offer('a');
    const b = offer('b');
    expect(recommendOffer([b, a])?.offerId).toBe('a');
    expect(recommendOffer([a, b])?.offerId).toBe('a');
  });
});

describe('recommendReason', () => {
  it('reports the facts of the pick', () => {
    const pick = offer('a', { short: true, reward: 400, minutes: 2 });
    expect(recommendReason(pick, [pick, offer('b')])).toEqual({ noRisk: true, short: true, bestPay: true });
    expect(recommendReason(offer('c', { risk: 1 }), [pick]).bestPay).toBe(false);
  });
});

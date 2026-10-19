import { describe, expect, it } from 'vitest';
import { CommsQueue, LOG_SIZE, MAX_WAIT, MAX_WAITING, messageDuration, SPEAKER_COOLDOWN, typeTime, TYPE_DELAY, TYPE_RATE } from './queue';
import type { CommsChannel, CommsMessage, Speaker } from './types';

const speaker = (id: string): Speaker => ({ id, name: id, role: 'role', portrait: 'unknown', faction: 'unknown', kind: 'unknown', accent: '#93a0b3' });

let serial = 0;
function msg(key: string, channel: CommsChannel, extra: Partial<CommsMessage> = {}): CommsMessage {
  serial++;
  return { id: `${key}#${serial}`, key, speaker: speaker(extra.speaker?.id ?? key), lines: ['Hello'], channel, ttl: 2, tick: serial, ...extra };
}

describe('CommsQueue', () => {
  it('shows the first message, queues the rest and moves on after typing + ttl', () => {
    const q = new CommsQueue();
    const a = msg('a', 'station');
    const b = msg('b', 'station');
    expect(q.push(a, 0)).toBe('shown');
    expect(q.push(b, 0.1)).toBe('queued');
    expect(q.waitingCount).toBe(1);
    expect(typeTime(a)).toBeCloseTo(TYPE_DELAY + 5 / TYPE_RATE);
    expect(q.update(messageDuration(a) - 0.01)).toBeNull();
    expect(q.showing?.msg).toBe(a);
    expect(q.update(messageDuration(a))).toBe(b);
    expect(q.showing?.shownAt).toBe(messageDuration(a));
  });

  it('orders by priority: story / danger > training > station > flavour', () => {
    const q = new CommsQueue();
    q.push(msg('pinned', 'danger', { pinned: true }), 0);
    q.push(msg('f', 'flavour'), 0);
    q.push(msg('s', 'station'), 0);
    q.push(msg('t', 'training'), 0);
    q.push(msg('d', 'story'), 0);
    expect(q.queued.map((m) => m.key)).toEqual(['d', 't', 's', 'f']);
  });

  it('a more important message cuts a less important one; an equal one waits; a pinned one is never cut', () => {
    const q = new CommsQueue();
    q.push(msg('chat', 'flavour'), 0);
    expect(q.push(msg('alarm', 'danger'), 0.2)).toBe('shown');
    expect(q.showing?.msg.key).toBe('alarm');
    expect(q.push(msg('story', 'story'), 0.3)).toBe('queued');
    const toll = msg('toll', 'danger', { reply: 'toll', pinned: true, ttl: 0 });
    expect(q.push(toll, 0.4)).toBe('shown');
    // pinned: the story beat waits, time does not end it
    q.push(msg('later', 'story'), 0.5);
    expect(q.update(100)).toBeNull();
    expect(q.showing?.msg.key).toBe('toll');
    expect(q.dismiss(100)).toBeNull();
    expect(q.showing?.msg.key).toBe('toll');
    // answered: the follow-up with the same key replaces it in place and is no longer pinned
    expect(q.push(msg('toll', 'danger', { pinned: false }), 100.1)).toBe('replaced');
    expect(q.showing?.msg.pinned).toBe(false);
  });

  it('a cut message that was still being typed comes back after the cutting one; a boosted answer cuts danger', () => {
    const q = new CommsQueue();
    const chat = msg('chat', 'station', { lines: ['A long line that takes a while to type out on the radio'] });
    q.push(chat, 0);
    q.push(msg('alarm', 'danger'), 0.2);
    expect(q.queued[0]).toBe(chat);
    const answer = msg('dock:home', 'station', { boost: 3 });
    expect(q.push(answer, 0.3)).toBe('shown');
    // the alarm was cut while typing too – it comes back before the older chat
    expect(q.queued.map((m) => m.key)).toEqual(['alarm', 'chat']);
    // a newer answer to the player cuts an equally boosted one
    expect(q.push(msg('contract:1', 'station', { boost: 3 }), 0.35)).toBe('shown');
  });

  it('de-duplicates by key: a showing or waiting message is replaced, not repeated', () => {
    const q = new CommsQueue();
    q.push(msg('dock:st', 'station', { lines: ['Too fast'] }), 0);
    expect(q.push(msg('dock:st', 'station', { lines: ['Too far'] }), 1)).toBe('replaced');
    expect(q.showing?.msg.lines).toEqual(['Too far']);
    expect(q.showing?.shownAt).toBe(1);
    q.push(msg('other', 'station'), 1);
    q.push(msg('other', 'station', { lines: ['Newer'] }), 1.5);
    expect(q.waitingCount).toBe(1);
    expect(q.queued[0]!.lines).toEqual(['Newer']);
  });

  it('drops a key repeated within its cooldown', () => {
    const q = new CommsQueue();
    expect(q.push(msg('cap:3:hail', 'danger', { cooldown: 120 }), 0)).toBe('shown');
    q.update(30);
    expect(q.push(msg('cap:3:hail', 'danger', { cooldown: 120 }), 60)).toBe('dropped');
    expect(q.push(msg('cap:3:hail', 'danger', { cooldown: 120 }), 121)).toBe('shown');
  });

  it('flavour has a per-speaker cooldown; danger from the same speaker does not', () => {
    const q = new CommsQueue();
    const pirate = speaker('pirate:jackal');
    expect(q.push(msg('alert:a', 'flavour', { speaker: pirate }), 0)).toBe('shown');
    q.update(10);
    expect(q.push(msg('alert:b', 'flavour', { speaker: pirate }), SPEAKER_COOLDOWN.flavour - 1)).toBe('dropped');
    expect(q.push(msg('alert:c', 'flavour', { speaker: pirate }), SPEAKER_COOLDOWN.flavour + 1)).not.toBe('dropped');
    expect(q.push(msg('hunt', 'danger', { speaker: pirate }), SPEAKER_COOLDOWN.flavour + 2)).not.toBe('dropped');
  });

  it('skips stale waiting messages and caps the queue', () => {
    const q = new CommsQueue();
    q.push(msg('pin', 'danger', { pinned: true }), 0);
    q.push(msg('chat', 'flavour'), 0);
    q.push(msg('dock', 'station'), 0);
    q.release('pin', MAX_WAIT.flavour + 1);
    expect(q.showing?.msg.key).toBe('dock');
    // when the station message ends, the flavour line is too old to say
    expect(q.update(MAX_WAIT.flavour + 30)).toBeNull();
    expect(q.waitingCount).toBe(0);
    for (let i = 0; i < MAX_WAITING + 3; i++) q.push(msg(`s${i}`, 'station'), 20);
    expect(q.waitingCount).toBe(MAX_WAITING);
  });

  it('keeps the remaining time while hidden', () => {
    const q = new CommsQueue();
    const a = msg('a', 'station');
    q.push(a, 0);
    q.shift(50);
    expect(q.update(messageDuration(a) + 10)).toBeNull();
    expect(q.showing?.msg).toBe(a);
  });

  it('logs every received message (replacements update their line) up to LOG_SIZE', () => {
    const q = new CommsQueue();
    const first = msg('x', 'station', { lines: ['One'] });
    q.push(first, 0);
    q.push({ ...first, lines: ['One, again'] }, 0.5);
    expect(q.transcript).toHaveLength(1);
    expect(q.transcript[0]!.lines).toEqual(['One, again']);
    for (let i = 0; i < LOG_SIZE + 5; i++) q.push(msg(`k${i}`, 'danger', { note: 'n' }), i + 1);
    expect(q.transcript).toHaveLength(LOG_SIZE);
    expect(q.transcript[LOG_SIZE - 1]!.note).toBe('n');
    q.clear();
    expect(q.showing).toBeNull();
    expect(q.transcript).toHaveLength(LOG_SIZE);
  });
});

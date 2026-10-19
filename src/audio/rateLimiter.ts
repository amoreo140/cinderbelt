// Playback rate limiting (so continuous mining does not spam sounds).

export class RateLimiter {
  private lastTime = Number.NEGATIVE_INFINITY;

  /** @param minInterval minimum gap between two allowed events in seconds */
  constructor(private readonly minInterval: number) {}

  /** Returns true and records the event if enough time has passed since the last one. */
  tryAcquire(now: number): boolean {
    if (now - this.lastTime < this.minInterval) return false;
    this.lastTime = now;
    return true;
  }

  /** Time remaining until the next allowed playback. */
  remaining(now: number): number {
    return Math.max(0, this.minInterval - (now - this.lastTime));
  }

  reset(): void {
    this.lastTime = Number.NEGATIVE_INFINITY;
  }
}

/** A separate limiter for each key (e.g. a notification type). */
export class KeyedRateLimiter<K extends string> {
  private readonly limiters = new Map<K, RateLimiter>();

  constructor(private readonly minInterval: (key: K) => number) {}

  tryAcquire(key: K, now: number): boolean {
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter(this.minInterval(key));
      this.limiters.set(key, limiter);
    }
    return limiter.tryAcquire(now);
  }
}

/**
 * Limiter for impacts: normally keeps a minimum gap, but a clearly stronger
 * impact is let through earlier (so a hard hit is not lost after a light scrape).
 */
export class ImpactLimiter {
  private lastTime = Number.NEGATIVE_INFINITY;
  private lastIntensity = 0;

  constructor(
    private readonly minInterval: number,
    private readonly overrideRatio = 1.6,
  ) {}

  tryAcquire(intensity: number, now: number): boolean {
    const elapsed = now - this.lastTime;
    const stronger = intensity > this.lastIntensity * this.overrideRatio + 0.05;
    if (elapsed < this.minInterval && !stronger) return false;
    this.lastTime = now;
    this.lastIntensity = intensity;
    return true;
  }
}

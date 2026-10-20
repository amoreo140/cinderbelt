// "New" highlights for UI parts that appear during play (memory only, never saved).
import type { UiFeature } from './reveal';

/** How long a new feature stays highlighted, in seconds. */
export const NEW_BADGE_SECONDS = 8;

export class NewBadges {
  private last: ReadonlySet<UiFeature> | null = null;
  /** Features already badged once (or present at load) – never badged again. */
  private readonly seen = new Set<UiFeature>();
  /** Badge start clock per feature. */
  private readonly since = new Map<UiFeature, number>();

  update(revealed: ReadonlySet<UiFeature>, clock: number): void {
    if (revealed === this.last) return;
    const first = this.last === null;
    this.last = revealed;
    for (const f of revealed) {
      if (this.seen.has(f)) continue;
      this.seen.add(f);
      if (!first) this.since.set(f, clock);
    }
  }

  used(feature: UiFeature): void {
    this.since.delete(feature);
  }

  isNew(feature: UiFeature, clock: number): boolean {
    const t = this.since.get(feature);
    return t !== undefined && clock - t < NEW_BADGE_SECONDS;
  }
}

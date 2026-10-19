import type { PartId, Tier } from '../../data/parts';
import type { ResourceId } from '../../data/resources';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { formatAmount } from '../format';
import { Odometer } from './Odometer';

/** Resource icon from public/assets/icons/resources. */
export function ResourceIcon({ id }: { id: ResourceId }) {
  return <img class="af-res-icon" src={assetUrl(`assets/icons/resources/${id}.png`)} alt="" />;
}

/** Resource: icon, amount and optionally the name. */
export function ResourceChip({
  id,
  amount,
  name = false,
  tag = false,
}: {
  id: ResourceId;
  amount?: number;
  name?: boolean;
  /** Bordered tag (cargo lists). */
  tag?: boolean;
}) {
  return (
    <span class={`af-res${tag ? ' af-res--tag' : ''}`} title={name ? undefined : tx().resources[id]}>
      <ResourceIcon id={id} />
      {amount !== undefined && <span class="af-res-amount">{formatAmount(amount)}</span>}
      {name && <span class="af-res-name">{tx().resources[id]}</span>}
      {!name && <span class="af-sr-only">{tx().resources[id]}</span>}
    </span>
  );
}

/** Credits as a label on the hull (`1,240 cr`); a change rolls the digits (`Odometer`). */
export function Credits({ value, testId }: { value: number; testId?: string }) {
  return <Odometer value={value} testId={testId} />;
}

/** Ring badge – a two-colour square by nebula + the name. */
export function RingBadge({ ring, name, compact = false }: { ring: number; name?: string; compact?: boolean }) {
  return (
    <span class="af-ring" data-ring={ring}>
      <span class="af-ring-swatch" aria-hidden="true">
        {ring}
      </span>
      {!compact && <span class="af-ring-name">{name ?? tx().rings[ring - 1]}</span>}
    </span>
  );
}

/** Part: icon in tier corner brackets (T1 short orange, T2 long blue), name and count.
 *  `compact` = only icon and count (the name goes into the tooltip and for screen readers). */
export function PartChip({
  partId,
  tier,
  count,
  compact = false,
  variant,
}: {
  partId: PartId;
  tier: Tier;
  count?: number;
  compact?: boolean;
  /** Variant name (M3.5b) – after the part name, e.g. "pressurised". */
  variant?: string;
}) {
  const name = variant ? `${tx().parts[partId]} – ${variant} T${tier}` : `${tx().parts[partId]} T${tier}`;
  return (
    <span class={`af-part af-tier-${tier}${compact ? ' af-part--compact' : ''}`} title={compact ? name : undefined}>
      <span class="af-tier-frame">
        <img class="af-part-icon" src={assetUrl(`assets/icons/parts/${partId}_t${tier}.png`)} alt="" />
      </span>
      {compact ? (
        <span class="af-sr-only">{name}</span>
      ) : (
        <span class="af-part-name">
          {tx().parts[partId]}
          {variant && <span class="af-part-variant"> – {variant}</span>} <span class="af-part-tier">T{tier}</span>
        </span>
      )}
      {count !== undefined && <span class="af-part-count">×{count}</span>}
    </span>
  );
}

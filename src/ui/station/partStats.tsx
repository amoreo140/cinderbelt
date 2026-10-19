import type { PartStat, PartStatId } from '../../game/shipyardView';
import { tx } from '../../i18n';
import { formatInt, formatNumber } from '../format';
import { Term } from '../theme';

/**
 * Units of the part parameters (mass in tonnes, flows per second): 'u' / 'u/s' stand for the game's
 * unit and its rate, which differ by language (`tx().units`); the rest are the same in both. Energy
 * has no unit of its own (battery "120", output "+2/s"), so energy amounts are bare and rates "/s".
 */
const STAT_UNIT: Record<PartStatId, string> = {
  mass: 't',
  hp: 'HP',
  thrust: '',
  torque: '',
  cargo: 'u',
  fuel: 'u',
  battery: '',
  energyGen: '/s',
  radar: 'u',
  miningRate: 'u/s',
  miningRange: 'u',
  miningEnergy: '/s',
  damage: 'HP',
  fireRate: '/s',
  weaponRange: 'u',
  shotEnergy: '',
  shieldCapacity: 'HP',
  shieldRegen: 'HP/s',
  shieldDelay: 's',
  tractorRange: 'u',
  tractorParts: '',
  tractorEnergy: '/s',
  arc: '°',
  // M4c workshop parts and the large reactor's blast
  blast: 'HP',
  repairRate: 'HP/s',
  repairEnergy: '/s',
  refineIce: 'u/s',
  refineOre: 'u/s',
  refineEnergy: '/s',
};

/** The unit of a part parameter in the current language ('' = none). */
export function statUnit(id: PartStatId): string {
  const u = STAT_UNIT[id];
  return u === 'u' ? tx().units.unit : u === 'u/s' ? tx().units.perSecond : u;
}

/** Whole numbers without decimals, otherwise up to two decimal places (a T2 refinery: 0,75 u/s). */
export const formatStat = (v: number): string => (Math.abs(v - Math.round(v)) < 1e-9 ? formatInt(v) : formatNumber(v, 2, true));

/** Part stats on one line: "Mass 1.5 t · HP 30 · Cargo 60 u"; every label explains itself in a tooltip. */
export function PartStatsLine({ stats }: { stats: readonly PartStat[] }) {
  return (
    <ul class="hub-stats-line">
      {stats.map((s) => (
        <li key={s.id}>
          <Term tip={s.tip} class="hub-stats-label">
            {s.label}
          </Term>{' '}
          <b>
            {formatStat(s.value)}
            {statUnit(s.id) && <small>{statUnit(s.id).startsWith('/') ? '' : ' '}{statUnit(s.id)}</small>}
          </b>
        </li>
      ))}
    </ul>
  );
}

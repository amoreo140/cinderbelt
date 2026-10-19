// The Guild status chips of the flight HUD (M4d plan T11, §3 `GuildStatusData`): the escort (the convoy
// ships' hull bars, the convoy's state, the distance to the trader and the next step) and the Guild relay
// contract (its lane, the three steps repair → power → hold as pips and the next-step hint). Dark bands
// like the event chips, in the same left column right under them (guild.css: under the top-left stack,
// `--hud-tl-bottom`, plus the event chips' height `--ev-chips-h` that EventChip publishes); Hud measures
// both into LEFT_COLUMN so the edge arrows step around them. No friendly fire (user decision
// 2026-10-16): there is no hostility chip. Data: `GuildStatusData` (src/game/guild/types.ts, T9).
import type { GuildEscortStatus, GuildRelayStatus, GuildStatusData } from '../../game/guild/types';
import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { formatInt, formatPercent } from '../format';
import { Lamp } from '../theme';
import { escortLamp, hullBar, HULL_SEGMENTS, relayLamp, relaySteps } from './guildLayout';
import './guild.css';

function HullBar({ ship, share }: { ship: string; share: number }) {
  const b = hullBar(share);
  const label = tx().guild.escort.hull(ship, formatPercent(b.percent));
  return (
    <span class={`gs-hull is-${b.level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.percent} title={label} data-testid="guild-escort-hull">
      <span class="gs-hull-name">{ship}</span>
      <span class="gs-hull-track" aria-hidden="true">
        {Array.from({ length: HULL_SEGMENTS }, (_, i) => (
          <i key={i} class={i < b.lit ? 'is-on' : undefined} />
        ))}
      </span>
    </span>
  );
}

function EscortChip({ e }: { e: GuildEscortStatus }) {
  const t = tx().guild.escort;
  const lamp = escortLamp(e.state);
  return (
    <div class={`gs-chip gs-chip--${lamp}`} role="listitem" data-testid="guild-escort" data-state={e.state}>
      <div class="gs-head">
        <Lamp state={lamp} />
        <img class="gs-icon" src={assetUrl('assets/ui/icons/convoy.svg')} alt="" />
        <span class="gs-title">{t.name}</span>
        <span class="af-label gs-state">{t.states[e.state]}</span>
        <span class="gs-aside" data-testid="guild-escort-distance">
          {formatInt(Math.round(e.distance))} {tx().units.unit}
        </span>
      </div>
      <div class="gs-hulls">
        {e.hull.map((share, i) => (
          <HullBar key={i} ship={i === 0 ? t.ships.trader : t.ships.tanker} share={share} />
        ))}
      </div>
      <p class="gs-next">{e.next}</p>
    </div>
  );
}

function RelayChip({ r }: { r: GuildRelayStatus }) {
  const t = tx().guild.relay;
  const lamp = relayLamp(r.stage);
  const steps = relaySteps(r.stage);
  const names = [t.steps.repair, t.steps.power, t.steps.hold];
  const lit = r.stage === 'powered' || r.stage === 'secured';
  return (
    <div class={`gs-chip gs-chip--${lamp}`} role="listitem" data-testid="guild-relay" data-stage={r.stage}>
      <div class="gs-head">
        <Lamp state={lamp} />
        <img class="gs-icon" src={assetUrl(`assets/ui/icons/${lit ? 'guild_relay_lit' : 'guild_relay'}.svg`)} alt="" />
        <span class="gs-title">{t.name}</span>
        <span class="af-label gs-state">{t.stages[r.stage]}</span>
        <span class="gs-aside">{t.lane(r.lane)}</span>
      </div>
      <ol class="gs-steps">
        {steps.map((s, i) => (
          <li key={i} class={`gs-step is-${s}`} aria-current={s === 'current' ? 'step' : undefined}>
            <i aria-hidden="true" />
            {names[i]}
          </li>
        ))}
      </ol>
      <p class="gs-next">{r.hint}</p>
    </div>
  );
}

/** `inline` = in the flow (UI kit) instead of the HUD's left column. */
export function GuildStatus({ d, inline = false }: { d: GuildStatusData; inline?: boolean }) {
  if (!d.escort && !d.relay) return null;
  return (
    <div class={`gs-chips${inline ? ' gs-chips--inline' : ''}`} role="list" aria-label={tx().guild.escort.region} data-testid="guild-status">
      {d.escort && <EscortChip e={d.escort} />}
      {d.relay && <RelayChip r={d.relay} />}
    </div>
  );
}

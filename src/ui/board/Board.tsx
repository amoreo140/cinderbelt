// The Board tab (long-term design 10.6): ContractSlip slips, active contracts, faction reputation
// with emblems, the sector state and wanted captains.
import type { BoardData, BoardViewMode, CaptainView, FactionView } from '../../game/board/boardView';
import { amountText, resourceName } from '../../game/board/names';
import { assetUrl } from '../../render/assets/url';
import { tx } from '../../i18n';
import type { GameActionInput } from '../../sim/commands';
import { formatCredits } from '../format';
import { Heading, Lamp, Panel, Segmented } from '../theme';
import { Act, type ClickSound } from '../station/Act';
import { Cartography } from './Cartography';
import { SectorStrip } from './SectorStrip';
import { Slip } from './Slip';
import './board.css';

// the strip is also on the hub's Overview tab – a module of its own, outside this lazily loaded one
export { SectorStrip };

const t = () => tx().goals.board;

export interface BoardHandlers extends ClickSound {
  action(action: GameActionInput): void;
  setBoardView(view: BoardViewMode): void;
}

function Contracts({ d, on, from }: { d: BoardData; on: BoardHandlers; from: { x: number; y: number } }) {
  return (
    <div class="bd-contracts">
      <SectorStrip sector={d.sector} testId="board-sector" />
      <section class="bd-section">
        <Heading aside={`${d.active.length} / 3`}>{t().active}</Heading>
        {d.active.length === 0 ? (
          <p class="bd-empty">{t().noActive}</p>
        ) : (
          <div class="bd-active">
            {d.active.map((s) => (
              <Slip
                key={s.key}
                d={s}
                from={from}
                actions={
                  <>
                    {s.abandon && (
                      <Act
                        on={on}
                        size="sm"
                        variant="ghost"
                        hint={s.abandon.free ? tx().goals.slip.abandonFree : tx().goals.slip.giveUpHint}
                        testId={`abandon-${s.serial}`}
                        onClick={() => on.action({ type: 'abandonContract', contractId: s.serial! })}
                      >
                        {s.abandon.free ? tx().goals.slip.abandon : tx().goals.slip.giveUp}
                      </Act>
                    )}
                    {s.turnIn && (
                      <Act
                        on={on}
                        size="sm"
                        variant={s.turnIn.enabled ? 'primary' : 'secondary'}
                        disabled={!s.turnIn.enabled}
                        {...(s.turnIn.reason ? { reason: s.turnIn.reason } : {})}
                        testId={`turnin-${s.serial}`}
                        onClick={() => on.action({ type: 'turnInContract', contractId: s.serial! })}
                      >
                        {tx().goals.slip.turnIn}
                      </Act>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
      <section class="bd-section">
        <Heading aside={t().refresh(d.refreshMinutes)}>{t().offers}</Heading>
        {d.offers.length === 0 ? (
          <p class="bd-empty">{t().noOffers}</p>
        ) : (
          <div class="bd-offers">
            {d.offers.map((s) => (
              <Slip
                key={s.key}
                d={s}
                from={from}
                actions={
                  <Act
                    on={on}
                    size="sm"
                    disabled={!s.accept?.enabled}
                    {...(s.accept?.reason ? { reason: s.accept.reason } : {})}
                    testId={`accept-${s.offerId}`}
                    onClick={() => on.action({ type: 'acceptContract', offerId: s.offerId })}
                  >
                    {tx().goals.slip.accept}
                  </Act>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Level 0–3 as four slanted segments (shape + number, not just colour). */
function LevelMeter({ level }: { level: number }) {
  return (
    <span class="bd-level" role="meter" aria-valuemin={0} aria-valuemax={3} aria-valuenow={level}>
      {[1, 2, 3].map((i) => (
        <i key={i} class={i <= level ? 'is-on' : ''} />
      ))}
    </span>
  );
}

function Faction({ f, on }: { f: FactionView; on: BoardHandlers }) {
  const pct = f.nextPoints ? Math.min(1, f.points / f.nextPoints) : 1;
  return (
    <Panel material="plate" cut="md" class={`bd-faction bd-faction--${f.id}`} testId={`faction-${f.id}`}>
      <div class="bd-faction-head">
        <img class="bd-faction-emblem" src={assetUrl(f.emblem)} alt="" />
        <div class="bd-faction-id">
          <h3 class="bd-faction-name">{f.name}</h3>
          <span class="bd-faction-level">
            <LevelMeter level={f.level} />
            {t().level(f.level, f.levelName)}
          </span>
        </div>
      </div>
      <Panel material="screen" cut="sm" class="bd-faction-points">
        <span class="af-label">{f.nextPoints ? t().factions : t().maxLevel}</span>
        {f.nextPoints !== null && (
          <>
            <span class="bd-points">{t().points(Math.round(f.points), f.nextPoints)}</span>
            <span class="bd-points-bar" role="meter" aria-valuemin={0} aria-valuemax={f.nextPoints} aria-valuenow={Math.round(f.points)}>
              {Array.from({ length: 20 }, (_, i) => (
                <i key={i} class={i < Math.round(pct * 20) ? 'is-on' : ''} />
              ))}
            </span>
          </>
        )}
      </Panel>
      {f.assignment && (
        <div class="bd-assignment">
          <span class="af-label bd-sub">{t().assignment}</span>
          {f.assignment.map((a, i) => (
            <div key={a.id} class={`bd-assign-row${a.done ? ' is-done' : ''}`}>
              {i > 0 && <span class="bd-or">{t().or}</span>}
              <Lamp state={a.done ? 'ok' : 'off'} />
              <span class="bd-assign-text">{a.text}</span>
              <span class="bd-assign-progress">
                {amountText(a.value)} / {a.max}
              </span>
              {a.deliver && (
                <Act
                  on={on}
                  size="sm"
                  disabled={!a.deliver.enabled}
                  reason={tx().goals.slip.missing(String(a.max - a.value), resourceName(a.deliver.resource))}
                  testId={`deliver-${f.id}`}
                  onClick={() => on.action({ type: 'deliverAssignment', faction: f.id })}
                >
                  {t().deliver(String(a.deliver.amount), resourceName(a.deliver.resource))}
                </Act>
              )}
            </div>
          ))}
        </div>
      )}
      {f.nextUnlocks.length > 0 && (
        <div class="bd-unlocks">
          <span class="af-label bd-sub">{t().nextUnlocks}</span>
          {f.nextUnlocks.map((u) => (
            <span key={u.text} class="af-label bd-unlock is-next">
              {u.text}
              {u.soon && <em> · {tx().goals.soon(u.soon)}</em>}
            </span>
          ))}
        </div>
      )}
      <div class="bd-unlocks">
        <span class="af-label bd-sub">{t().unlocks}</span>
        {f.unlocks.map((u) => (
          <span key={u} class="af-label bd-unlock">
            {u}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function Captain({ c }: { c: CaptainView }) {
  return (
    <li class="bd-captain" data-testid={`captain-${c.index}`}>
      <img class="bd-captain-emblem" src={assetUrl(c.emblem)} alt={c.clanName} />
      <div class="bd-captain-id">
        <strong>{c.name}</strong>
        <span class="bd-captain-sub">
          {c.clanName} · {c.trait} · {tx().goals.captains.level(c.level)}
        </span>
        {c.replicas.length > 0 && <span class="bd-captain-replica">{tx().goals.captains.replica(c.replicas.join(', '))}</span>}
        {c.kills > 0 && <span class="bd-captain-kills">{tx().goals.captains.killedYou(c.kills)}</span>}
      </div>
      <span class="bd-captain-bounty">
        <span class="af-label">{tx().goals.captains.bounty}</span>
        <strong>{formatCredits(c.bounty)}</strong>
      </span>
    </li>
  );
}

export function Board({ d, on, view, from }: { d: BoardData; on: BoardHandlers; view: BoardViewMode; from: { x: number; y: number } }) {
  return (
    <div class="bd" data-testid="board">
      <div class="hub-toolbar">
        <Segmented
          label={t().tab}
          options={(['contracts', 'factions', 'wanted', 'charts'] as const).map((v) => ({ value: v, label: t().views[v] }))}
          value={view}
          onChange={(v) => {
            on.click();
            on.setBoardView(v);
          }}
        />
      </div>
      {view === 'contracts' && <Contracts d={d} on={on} from={from} />}
      {view === 'charts' && <Cartography d={d.cartography} on={on} />}
      {view === 'factions' && (
        <div class="bd-factions">
          {d.factions.map((f) => (
            <Faction key={f.id} f={f} on={on} />
          ))}
        </div>
      )}
      {view === 'wanted' && (
        <div class="bd-wanted">
          <section class="bd-section">
            <Heading>{t().wanted}</Heading>
            <p class="bd-empty">{t().wantedNote}</p>
            <ul class="bd-captains">
              {d.captains.map((c) => (
                <Captain key={c.index} c={c} />
              ))}
            </ul>
          </section>
          <section class="bd-section">
            <Heading>{t().trophies}</Heading>
            {d.trophies.length === 0 ? (
              <p class="bd-empty">{t().noTrophies}</p>
            ) : (
              <ul class="bd-trophies">
                {d.trophies.map((tr) => (
                  <li key={tr.name}>
                    <strong>{tr.name}</strong> {tr.parts.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

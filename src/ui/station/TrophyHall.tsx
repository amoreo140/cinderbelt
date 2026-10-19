// Trophy hall ("Trophy hall", M4c, T3) on the Development tab: the six pedestals in shelf
// order (pins first, then the newest) and the list of every trophy with its pin toggle. `TrophyList`
// without handlers is the greyed list of trophies won before the hall is built.
import { TROPHY_PEDESTALS } from '../../data/home';
import type { DevelopmentHandlers, TrophyCard, TrophyHallData } from '../../game/home/types';
import { tx } from '../../i18n';
import { Button, Heading, Panel } from '../theme';

const t = () => tx().home.trophies;

const kindOf = (card: TrophyCard): 'captain' | 'fortress' => (card.id.startsWith('cap:') ? 'captain' : 'fortress');

function Pedestal({ card, index }: { card: TrophyCard | null; index: number }) {
  return (
    <Panel
      material="plate"
      cut="sm"
      class={`dv-pedestal${card ? ` dv-pedestal--${kindOf(card)}` : ' is-empty'}${card?.pinned ? ' is-pinned' : ''}`}
      testId={`trophy-pedestal-${index}`}
    >
      <span class="dv-pedestal-no" aria-hidden="true">
        {index + 1}
      </span>
      {card ? (
        <>
          <span class="af-label dv-pedestal-kind">
            {t().kind[kindOf(card)]}
            {card.pinned && <PinGlyph />}
          </span>
          <span class="dv-pedestal-title">{card.title}</span>
        </>
      ) : (
        <span class="dv-pedestal-empty">{t().emptyPedestal}</span>
      )}
    </Panel>
  );
}

function PinGlyph() {
  return (
    <svg class="dv-pin" viewBox="0 0 10 12" role="img" aria-label={t().pin}>
      <path d="M3 0h4v1.2l-.6.6v3.4L8.5 7H5.6v5h-1.2V7H1.5l2.1-1.8V1.8L3 1.2z" fill="currentColor" />
    </svg>
  );
}

/**
 * Every trophy as a row: title, subtitle (clan and replicas / sector) and – in the hall – the pin
 * toggle. Without `on` the rows are greyed (the hall is not built yet).
 */
export function TrophyList({ cards, on, full = false, click }: { cards: readonly TrophyCard[]; on?: DevelopmentHandlers; full?: boolean; click?: () => void }) {
  if (cards.length === 0) return <p class="hub-note dv-note">{t().empty}</p>;
  return (
    <ul class={`dv-trophies${on ? '' : ' is-greyed'}`} data-testid="trophy-list">
      {cards.map((c) => (
        <li key={c.id} class={c.pinned ? 'is-pinned' : ''} data-testid={`trophy-${c.id}`}>
          <span class="dv-trophy-text">
            <span class="dv-trophy-title">
              <span class="af-label dv-trophy-kind">{t().kind[kindOf(c)]}</span>
              {c.title}
            </span>
            {c.subtitle && <span class="dv-trophy-sub">{c.subtitle}</span>}
          </span>
          {on && (
            <Button
              size="sm"
              variant={c.pinned ? 'secondary' : 'ghost'}
              disabled={!c.pinned && full}
              reason={tx().actionErrors.shelfFull}
              testId={`trophy-pin-${c.id}`}
              onClick={() => {
                click?.();
                on.pin(c.id, !c.pinned);
              }}
            >
              {c.pinned ? t().unpin : t().pin}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TrophyHall({ d, on, click }: { d: TrophyHallData; on: DevelopmentHandlers; click?: () => void }) {
  const filled = d.shelf.filter((c) => c !== null).length;
  const pinned = d.all.filter((c) => c.pinned).length;
  return (
    <section class="dv-hall" data-testid="trophy-hall">
      <Heading level={4} aside={`${filled} / ${TROPHY_PEDESTALS}`}>
        {t().pedestals}
      </Heading>
      <div class="dv-pedestals">
        {d.shelf.map((card, i) => (
          <Pedestal key={card?.id ?? `empty${i}`} card={card} index={i} />
        ))}
      </div>
      <Heading level={4} aside={d.all.length > 0 ? String(d.all.length) : undefined}>
        {t().all}
      </Heading>
      <TrophyList cards={d.all} on={on} full={pinned >= TROPHY_PEDESTALS} click={click} />
      {d.all.length > 0 && <p class="hub-note dv-note">{t().pinHint}</p>}
    </section>
  );
}

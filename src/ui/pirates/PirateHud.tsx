// Flight HUD pieces of M3.6: pirate attention in the nav band, the toll demand band, the tractor
// beam lamp in the console, the fortress band and the cannon reticle at the cursor.
import type { AttentionHud, FortressHud, ReticleData, TollHud, TractorHud } from '../../game/pirates/piratesUi';
import { tx } from '../../i18n';
import { Key, Lamp } from '../theme';
import './pirates.css';

/** Pirate attention: four slanted segments (one per level) and the raid line under the nav data. */
export function AttentionRow({ a }: { a: AttentionHud }) {
  return (
    <div class={`pr-attention pr-attention--l${a.level}`} data-testid="attention" data-level={a.level} title={a.hint}>
      <span class="af-label">{tx().pirates.attention.label}</span>
      <span class="pr-attention-segs" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.value} aria-label={a.hint}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} class={a.value > 0 && i <= a.level ? 'is-on' : ''} />
        ))}
      </span>
      <span class="pr-attention-label">{a.label}</span>
      {a.raid && (
        <span class="pr-attention-raid" data-testid="attention-raid">
          <Lamp state="bad" />
          {a.raid}
        </span>
      )}
    </div>
  );
}

/** Toll demand: what the clan wants, the time left and the two answers. */
export function TollBand({ t }: { t: TollHud }) {
  const segs = 20;
  const lit = Math.ceil(t.fraction * segs);
  return (
    <section class="pr-toll" data-testid="toll" role="alertdialog" aria-label={tx().pirates.toll.title}>
      <div class="pr-toll-head">
        <span class="pr-toll-title">{tx().pirates.toll.title}</span>
        <span class="pr-toll-amount">{t.amount}</span>
      </div>
      <div class="pr-toll-timer" aria-hidden="true">
        {Array.from({ length: segs }, (_, i) => (
          <i key={i} class={i < lit ? 'is-on' : ''} />
        ))}
        <b>{t.seconds} s</b>
      </div>
      <div class="pr-toll-actions">
        <span class={`pr-toll-choice${t.canPay ? '' : ' is-disabled'}`} title={t.canPay ? undefined : tx().pirates.toll.noMoney}>
          <Key dark>Y</Key>
          {tx().pirates.toll.pay}
        </span>
        <span class="pr-toll-choice">
          <Key dark>X</Key>
          {tx().pirates.toll.refuse}
        </span>
        <span class="pr-toll-escape">{tx().pirates.toll.escape(t.escape)}</span>
      </div>
    </section>
  );
}

/** Tractor beam status in the console (violet lamp while it holds something). */
export function TractorLine({ t }: { t: TractorHud }) {
  return (
    <div class={`pr-tractor${t.active ? ' is-active' : ''}`} data-testid="tractor-status">
      <span class={`pr-tractor-lamp${t.active ? ' is-on' : ''}`} aria-hidden="true" />
      <span class="pr-tractor-name">{tx().pirates.tractor.label}</span>
      <strong>{t.text}</strong>
      {t.progress !== null && (
        <span class="pr-tractor-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(t.progress * 100)}%` }} />
        </span>
      )}
      <Key dark>T</Key>
    </div>
  );
}

/** Boss band of the Rust fortress: core meter, shield state, generators and turrets. */
export function FortressBand({ f }: { f: FortressHud }) {
  const segs = 30;
  const lit = Math.ceil(f.core * segs);
  return (
    <section class={`pr-fortress${f.shielded ? ' is-shielded' : ''}`} data-testid="fortress-band" aria-label={f.name}>
      <span class="pr-fortress-name">{f.name}</span>
      <div class="pr-fortress-core">
        <span class="af-label">{tx().pirates.fortress.core}</span>
        <span class="pr-fortress-segs" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.core * 100)}>
          {Array.from({ length: segs }, (_, i) => (
            <i key={i} class={i < lit ? 'is-on' : ''} />
          ))}
        </span>
        <span class="pr-fortress-state">
          <Lamp state={f.shielded ? 'info' : 'bad'} />
          {f.shielded ? tx().pirates.fortress.shielded : tx().pirates.fortress.open}
        </span>
      </div>
      <div class="pr-fortress-parts">
        <span class="af-label">{tx().pirates.fortress.gens}</span>
        {f.gens.map((on, i) => (
          <i key={`g${i}`} class={`pr-pip pr-pip--gen${on ? ' is-on' : ''}`} />
        ))}
        <span class="af-label">{tx().pirates.fortress.turrets}</span>
        {f.turrets.map((on, i) => (
          <i key={`t${i}`} class={`pr-pip${on ? ' is-on' : ''}`} />
        ))}
      </div>
    </section>
  );
}

/** Pips at the cursor: how many cannons can hit the aim point (grey when none). Game moves it each frame. */
export function CannonReticle({ r }: { r: ReticleData }) {
  return (
    <div class={`pr-reticle${r.covering === 0 ? ' is-none' : ''}`} data-reticle data-testid="cannon-reticle" aria-label={tx().pirates.reticle(r.covering, r.total)}>
      {Array.from({ length: r.total }, (_, i) => (
        <i key={i} class={i < r.covering ? 'is-on' : ''} />
      ))}
      <b>
        {r.covering}/{r.total}
      </b>
    </div>
  );
}

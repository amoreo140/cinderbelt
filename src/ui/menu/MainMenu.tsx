import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { MenuPage } from '../../game/app/appState';
import { formatPlayTime, formatSavedAt } from '../../game/save/slotView';
import { LOCALE_NAMES, LOCALES, tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { formatCredits } from '../format';
import { Button, Key, Lamp, Panel, Segmented } from '../theme';
import type { OverlayData, OverlayHandlers } from './types';

/** Background: 1080p is enough up to a width of 1920 physical pixels, otherwise full resolution. */
function backgroundUrl(): string {
  const px = (typeof window !== 'undefined' ? window.innerWidth * Math.min(window.devicePixelRatio || 1, 2) : 1920) || 1920;
  return assetUrl(px > 1920 ? 'assets/ui/menu_bg.jpg' : 'assets/ui/menu_bg_1080.jpg');
}

/** Up/down arrows move focus between the menu buttons (Home/End to the ends). */
function onNavKey(e: KeyboardEvent): void {
  const nav = e.currentTarget as HTMLElement;
  const items = [...nav.querySelectorAll<HTMLButtonElement>('button.af-btn')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  items[next]!.focus();
}

interface Item {
  page: MenuPage | 'continue';
  label: string;
  testId: string;
}

export function MainMenu({ data, on, children }: { data: OverlayData; on: OverlayHandlers; children?: ComponentChildren }) {
  const page = data.state.kind === 'menu' ? data.state.page : 'home';
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const lastPage = useRef<MenuPage>('home');
  const bg = useRef(backgroundUrl());

  // slow parallax following the cursor – CSS variables only, no Preact re-render
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const move = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      root.style.setProperty('--px', `${(-nx * 22).toFixed(1)}px`);
      root.style.setProperty('--py', `${(-ny * 14).toFixed(1)}px`);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);

  // focus the first button; after returning from a sub-screen, the one that opened it
  useEffect(() => {
    if (page !== 'home') {
      lastPage.current = page;
      return;
    }
    const nav = navRef.current;
    if (!nav) return;
    const back = nav.querySelector<HTMLElement>(`[data-page="${lastPage.current}"] button`);
    const first = nav.querySelector<HTMLElement>('button.af-btn');
    (back ?? first)?.focus({ preventScroll: true });
  }, [page, data.continueMeta !== null]);

  const meta = data.continueMeta;
  const items: Item[] = [
    ...(meta ? [{ page: 'continue' as const, label: tx().app.menu.continue, testId: 'menu-continue' }] : []),
    { page: 'newGame', label: tx().app.menu.newGame, testId: 'menu-new' },
    { page: 'load', label: tx().app.menu.load, testId: 'menu-load' },
    { page: 'settings', label: tx().app.menu.settings, testId: 'menu-settings' },
    { page: 'about', label: tx().app.menu.about, testId: 'menu-about' },
  ];
  const primary: Item['page'] = meta ? 'continue' : 'newGame';
  const activate = (item: Item) => {
    on.click();
    if (item.page === 'continue') on.continueGame();
    else on.open(item.page);
  };
  const storage = data.storage;

  return (
    <div ref={rootRef} class={`mn-root${page !== 'home' ? ' is-sheet' : ''}`} data-testid="main-menu">
      <div class="mn-parallax" aria-hidden="true">
        <div class="mn-bg" style={{ backgroundImage: `url(${bg.current})` }} />
      </div>
      <div class="mn-shade" aria-hidden="true" />

      {!storage.available && !storage.bannerDismissed && (
        <Panel material="band" cut="sm" class="mn-banner" testId="storage-banner">
          <p role="alert">{tx().app.storage.unavailable}</p>
          {meta && (
            <Button size="sm" onClick={() => on.exportSlot(meta.slot)} testId="banner-export">
              {tx().app.storage.exportNow}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={on.dismissBanner}>
            {tx().app.storage.dismiss}
          </Button>
        </Panel>
      )}

      <div class="mn-column" inert={page !== 'home' ? true : undefined}>
        <img class="mn-logo" src={assetUrl('assets/ui/logo.png')} alt="Cinderbelt" draggable={false} />

        <Panel material="band" cut="lg" trim="left" class="mn-menu" as="aside" aria-label={tx().app.menu.title}>
          {data.menuError && (
            <div class="mn-error" role="alert" data-testid="menu-error">
              <p>{data.menuError}</p>
              <Button size="sm" variant="ghost" onClick={() => on.open('load')}>
                {tx().app.menu.openLoad}
              </Button>
            </div>
          )}
          <nav ref={navRef} onKeyDown={onNavKey}>
            {items.map((item, i) => (
              <div key={item.page} class="mn-item" style={{ '--i': i }} data-page={item.page} onPointerEnter={on.hover}>
                <Button
                  size="lg"
                  block
                  variant={item.page === primary ? 'primary' : 'secondary'}
                  testId={item.testId}
                  onClick={() => activate(item)}
                >
                  {item.label}
                </Button>
                {item.page === 'continue' && meta && (
                  <div class="mn-slot" data-testid="continue-slot">
                    <span class={`af-label mn-slot-diff${meta.fallenFromHardcore ? ' is-fallen' : ''}`}>
                      {meta.fallenFromHardcore ? tx().saves.fallenFromHardcore : tx().saves.difficulties[meta.deathPenalty]}
                    </span>
                    <span class="mn-slot-name">{meta.name}</span>
                    <span class="mn-slot-meta">
                      <span>{formatSavedAt(meta.savedAt, new Date(), tx().app.load)}</span>
                      <span>{formatPlayTime(meta.playTimeTicks)}</span>
                      <b>{formatCredits(meta.credits)}</b>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div class="mn-menu-foot" aria-hidden="true">
            <span class="af-keyhint">
              <Key dark>↑</Key>
              <Key dark>↓</Key>
              <span>{tx().app.menu.keys}</span>
            </span>
            <span class="af-keyhint">
              <Key dark>Enter</Key>
              <span>{tx().app.menu.confirm}</span>
            </span>
          </div>
        </Panel>

        <div class="mn-status" data-testid="storage-status">
          <Lamp state={!storage.available ? 'bad' : storage.persistent === false ? 'warn' : 'ok'} />
          <span>
            {!storage.available
              ? tx().app.settings.unavailable
              : storage.persistent
                ? `${tx().app.storage.local} · ${tx().app.storage.persistent.toLowerCase()}`
                : storage.persistent === false
                  ? tx().app.storage.mayClear
                  : tx().app.storage.local}
          </span>
          {storage.available && storage.persistent === false && meta && (
            <Button size="sm" variant="ghost" onClick={() => on.open('load')} testId="status-export">
              {tx().app.storage.exportBackup}
            </Button>
          )}
        </div>
      </div>

      <div class="mn-corner" inert={page !== 'home' ? true : undefined}>
        <span class="mn-language" data-testid="menu-language">
          <Segmented
            label={tx().app.settings.language}
            options={LOCALES.map((l) => ({ value: l, label: <span lang={l}>{LOCALE_NAMES[l]}</span> }))}
            value={data.settings.language}
            onChange={(language) => on.setSettings({ language })}
          />
        </span>
        <span class="af-label mn-version">{tx().app.menu.version(data.version)}</span>
      </div>

      {children}
    </div>
  );
}

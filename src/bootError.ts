// The boot error screen: shown when the page cannot start at all (no language chunk loads, the save storage
// or the App constructor throws). It uses plain DOM and inline styles on purpose – it must work when the
// UI chunks, the theme and the language texts are exactly what failed.
import { BOOT_TEXTS, bootLanguage } from './i18n/bootTexts';

/** Replaces the page's UI with the error screen and a Reload button; logs the error. */
export function showBootError(root: HTMLElement, stored: unknown, error: unknown): void {
  console.error('Boot failed:', error);
  const t = BOOT_TEXTS[bootLanguage(stored, typeof navigator === 'undefined' ? null : navigator.language)];
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.setAttribute('data-testid', 'boot-error');
  box.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:1rem;background:#04060c;color:#e8edf4;font-family:system-ui,sans-serif;z-index:100';
  const card = document.createElement('div');
  card.style.cssText =
    'max-width:26rem;padding:1.4rem 1.5rem;background:#1b222d;border-top:4px solid #ff7a2e;box-shadow:0 0 0 1px #283141;display:flex;flex-direction:column;gap:0.9rem';
  const title = document.createElement('h1');
  title.textContent = t.title;
  title.style.cssText = 'margin:0;font-size:1.3rem';
  const body = document.createElement('p');
  body.textContent = t.body;
  body.style.cssText = 'margin:0;line-height:1.5;color:#93a0b3';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t.reload;
  button.setAttribute('data-testid', 'boot-reload');
  button.style.cssText =
    'align-self:flex-end;padding:0.6rem 1.4rem;border:0;background:#ff7a2e;color:#1a0e05;font:inherit;font-weight:700;cursor:pointer';
  button.addEventListener('click', () => location.reload());
  card.append(title, body, button);
  box.append(card);
  root.replaceChildren(box);
  button.focus();
}

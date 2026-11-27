import { getLocale, resolveLocale, setLocale, type Locale } from '../../content/locales/locale.ts';
import { uiText, type UiMessage } from '../../content/locales/ui.ts';
import { replaceGameUrl } from './game-navigation.ts';

const storageKey = 'run-and-raid.ui-language';

export function initializeUiLanguage() {
  let preference = new URL(location.href).searchParams.get('lang');
  if (preference === null) {
    try {
      preference = localStorage.getItem(storageKey);
    } catch {
      // The game can run with browser storage disabled.
    }
  }
  const locale = resolveLocale(preference);
  setLocale(locale);
  document.documentElement.lang = locale;
  if (locale === 'ko') return;

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    // Some labels share their element with an SVG icon, input or another label.
    const label = [...element.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (label?.textContent) {
      label.textContent = label.textContent.replace(label.textContent.trim(), () =>
        uiText(element.dataset.i18n as UiMessage),
      );
    }
  }
  for (const [marker, attribute] of [
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-alt', 'alt'],
    ['data-i18n-placeholder', 'placeholder'],
  ] as const) {
    for (const element of document.querySelectorAll(`[${marker}]`)) {
      element.setAttribute(attribute, uiText(element.getAttribute(marker) as UiMessage));
    }
  }
}

export function installLanguagePickers(pickers: NodeListOf<HTMLSelectElement>) {
  let selected: Locale = getLocale();
  function applyWhenOutOfRoom() {
    if (selected !== getLocale() && location.hash !== '#/ready') location.reload();
  }
  function change(choice: Locale) {
    if (choice === selected) return;
    selected = choice;
    for (const picker of pickers) picker.value = choice;
    const url = new URL(location.href);
    try {
      localStorage.setItem(storageKey, choice);
      url.searchParams.delete('lang');
    } catch {
      url.searchParams.set('lang', choice);
    }
    replaceGameUrl(url);
    applyWhenOutOfRoom();
  }
  for (const picker of pickers) {
    picker.value = selected;
    picker.onchange = () => change(resolveLocale(picker.value));
  }
  window.addEventListener('hashchange', applyWhenOutOfRoom);
}

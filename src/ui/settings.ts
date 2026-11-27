import { startupText } from '../content/locales/startup.ts';
import { uiText } from '../content/locales/ui.ts';
import { landscapeFrame } from '../platform/browser/game-navigation.ts';
import { installLanguagePickers } from '../platform/browser/ui-language.ts';

const dialog = document.querySelector<HTMLDialogElement>('#game-settings')!;
const toggle = dialog.querySelector<HTMLButtonElement>('#settings-fullscreen')!;
const status = dialog.querySelector<HTMLElement>('#settings-status')!;
const display = landscapeFrame()?.ownerDocument ?? document;
let switching = false;

function updateDisplay() {
  const active = Boolean(display.fullscreenElement);
  toggle.textContent = uiText(active ? 'exitFullscreen' : 'enterFullscreen');
  toggle.disabled = switching || (!active && !display.fullscreenEnabled);
  if (!active && !display.fullscreenEnabled)
    status.textContent = startupText('fullscreenUnavailable');
}

export function openSettings() {
  status.textContent = '';
  dialog.querySelector<HTMLElement>('#settings-language-note')!.hidden =
    location.hash !== '#/ready';
  updateDisplay();
  dialog.showModal();
}

export function installSettings() {
  document.querySelector<HTMLButtonElement>(
    '.lobby-toolbar [aria-controls="game-settings"]',
  )!.onclick = openSettings;
  installLanguagePickers(document.querySelectorAll<HTMLSelectElement>('[data-ui-language]'));
  toggle.onclick = async () => {
    switching = toggle.disabled = true;
    status.textContent = '';
    try {
      if (display.fullscreenElement) await display.exitFullscreen();
      else await display.documentElement.requestFullscreen();
    } catch {
      status.textContent = uiText('fullscreenFailed');
    } finally {
      switching = false;
      updateDisplay();
    }
  };
  // Native dialog shortcuts stay within settings when the match is paused.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  window.addEventListener('hashchange', () => dialog.close());
  const observe = () => display.addEventListener('fullscreenchange', updateDisplay);
  observe();
  window.addEventListener('pageshow', observe);
  window.addEventListener('pagehide', () =>
    display.removeEventListener('fullscreenchange', updateDisplay),
  );
}

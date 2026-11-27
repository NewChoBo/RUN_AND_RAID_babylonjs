import { uiText } from '../content/locales/ui.ts';

export const loadingScreen = document.querySelector<HTMLDialogElement>('#launch-splash')!;
const tip = loadingScreen.querySelector<HTMLElement>('#loading-tip')!;
const cancel = loadingScreen.querySelector<HTMLButtonElement>('.loading-cancel')!;
const firstTip = tip.querySelector<HTMLElement>(
  `[lang="${document.documentElement.lang}"]`,
)!.textContent!;
const otherTips = ['tipMarkTarget', 'tipBrake', 'tipQuickMatch', 'tipPractice'] as const;
let index = Math.floor(Math.random() * otherTips.length);
let timer: number | undefined;

function nextTip() {
  const key = otherTips[index];
  tip.textContent = key ? uiText(key) : firstTip;
  index = (index + 1) % (otherTips.length + 1);
}

export function rotateLoadingTips() {
  window.clearInterval(timer);
  timer = window.setInterval(nextTip, 8000);
}

export function closeLoadingScreen() {
  window.clearInterval(timer);
  loadingScreen.close();
}

export function showLaunchError() {
  window.clearInterval(timer);
  document.documentElement.classList.add('launch-error');
  loadingScreen.querySelector<HTMLButtonElement>('.loading-recovery button')!.focus();
}

export function showArenaLoading(cancelEntry: () => void) {
  const title = loadingScreen.querySelector<HTMLElement>('#loading-title')!;
  title.textContent = uiText('wagonChase');
  loadingScreen.querySelector<HTMLElement>('.loading-status')!.textContent = uiText('arenaLoading');
  cancel.hidden = false;
  cancel.textContent = uiText('cancelEntry');
  cancel.onclick = cancelEntry;
  loadingScreen.oncancel = (event) => {
    event.preventDefault();
    cancelEntry();
  };
  nextTip();
  rotateLoadingTips();
  loadingScreen.showModal();
  title.focus({ preventScroll: true });
}

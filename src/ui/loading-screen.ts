import { uiText } from '../content/locales/ui.ts';

export const launchScreen = document.querySelector<HTMLDialogElement>('#launch-splash')!;
const arenaLoading = document.querySelector<HTMLDialogElement>('#arena-loading')!;
const tip = arenaLoading.querySelector<HTMLElement>('#loading-tip')!;
const cancel = arenaLoading.querySelector<HTMLButtonElement>('.loading-cancel')!;
const firstTip = tip.querySelector<HTMLElement>(
  `[lang="${document.documentElement.lang}"]`,
)!.textContent!;
const otherTips = ['tipMarkTarget', 'tipWalk', 'tipQuickMatch', 'tipPractice'] as const;
let index = Math.floor(Math.random() * otherTips.length);
let timer: number | undefined;

function nextTip() {
  const key = otherTips[index];
  tip.textContent = key ? uiText(key) : firstTip;
  index = (index + 1) % (otherTips.length + 1);
}

export function showTitleScreen(enter: () => void) {
  launchScreen.querySelector<HTMLElement>('#launch-status')!.hidden = true;
  const start = launchScreen.querySelector<HTMLButtonElement>('#title-start')!;
  start.hidden = false;
  start.onclick = enter;
  start.focus({ preventScroll: true });
}

export function closeLoadingScreen() {
  window.clearInterval(timer);
  arenaLoading.close();
}

export function showLaunchError() {
  document.documentElement.classList.add('launch-error');
  if (!launchScreen.open) launchScreen.showModal();
  launchScreen.querySelector<HTMLButtonElement>('.loading-recovery button')!.focus();
}

export function showArenaLoading(cancelEntry: () => void) {
  const title = arenaLoading.querySelector<HTMLElement>('#loading-title')!;
  title.textContent = uiText('wagonChase');
  arenaLoading.querySelector<HTMLElement>('.loading-status')!.textContent = uiText('arenaLoading');
  cancel.hidden = false;
  cancel.textContent = uiText('cancelEntry');
  cancel.onclick = cancelEntry;
  arenaLoading.oncancel = (event) => {
    event.preventDefault();
    cancelEntry();
  };
  nextTip();
  window.clearInterval(timer);
  timer = window.setInterval(nextTip, 8000);
  arenaLoading.showModal();
  title.focus({ preventScroll: true });
}

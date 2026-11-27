import './app/home.ts';
import { prepareRaid } from './app/run-and-raid.ts';
import { installLandscapeRecovery } from './platform/browser/landscape.ts';
import { installViewportLimit } from './ui/viewport-limit.ts';

const lobby = document.querySelector<HTMLElement>('.lobby')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const library = document.querySelector<HTMLElement>('#library')!;
const home = document.querySelector<HTMLButtonElement>('[data-home]')!;
const play = document.querySelector<HTMLAnchorElement>('.play')!;
let exitRaid: (() => void) | undefined;

function route() {
  const screen =
    location.hash === '#/ready' ? 'ready' : location.hash === '#/assets' ? 'assets' : 'home';
  if (lobby.dataset.screen === screen) return;
  if (lobby.dataset.screen === 'ready') exitRaid?.();
  lobby.dataset.screen = screen;
  document.body.classList.toggle('raid-mode', screen === 'ready');
  overlay.hidden = screen !== 'ready';
  library.hidden = screen !== 'assets';
  document.title =
    '런앤레이드 · ' + { home: '로비', ready: '경기 대기실', assets: '원작 에셋' }[screen];
  home.classList.toggle('current', screen === 'home');
  if (screen === 'home') home.setAttribute('aria-current', 'page');
  else home.removeAttribute('aria-current');
  play.textContent = screen === 'ready' ? '대기실' : '게임시작';
  if (screen === 'ready') {
    exitRaid ??= prepareRaid((error) => {
      console.error(error);
      document.querySelector<HTMLElement>('#startup-progress')!.hidden = true;
      const message = document.querySelector<HTMLElement>('#startup-error')!;
      message.textContent = '경기장을 열지 못했습니다. 다시 시도해 주세요.';
      message.hidden = false;
    });
    document.querySelector<HTMLElement>('#title-name')!.focus({ preventScroll: true });
  } else if (screen === 'assets') {
    void import('./app/asset-library.ts');
  }
}
home.addEventListener('click', () => {
  location.hash = '/home';
});
window.addEventListener('hashchange', route);
route();
installLandscapeRecovery();
installViewportLimit(document.querySelector<HTMLDialogElement>('#viewport-limit')!);

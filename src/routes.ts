import './app/home.ts';
import { prepareRaid } from './app/run-and-raid.ts';
import { landscapeFrame, syncGameUrl } from './platform/browser/game-navigation.ts';
import { installViewportLimit } from './ui/viewport-limit.ts';

const lobby = document.querySelector<HTMLElement>('.lobby')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const library = document.querySelector<HTMLElement>('#library')!;
const home = document.querySelector<HTMLButtonElement>('[data-home]')!;
const shop = document.querySelector<HTMLButtonElement>('[data-shop]')!;
const gallery = document.querySelector<HTMLElement>('#shop-gallery')!;
const play = document.querySelector<HTMLAnchorElement>('.play')!;
let raid: ReturnType<typeof prepareRaid> | undefined;

function route() {
  const screen =
    location.hash === '#/ready'
      ? 'ready'
      : location.hash === '#/assets'
        ? 'assets'
        : location.hash === '#/shop'
          ? 'shop'
          : 'home';
  if (lobby.dataset.screen === screen) return;
  const leavingRaid = lobby.dataset.screen === 'ready';
  if (leavingRaid) raid?.exit();
  lobby.dataset.screen = screen;
  document.body.classList.toggle('raid-mode', screen === 'ready');
  overlay.hidden = screen !== 'ready';
  library.hidden = screen !== 'assets';
  gallery.hidden = screen !== 'shop';
  document.title =
    '런앤레이드 · ' +
    { home: '로비', ready: '경기 대기실', assets: '원작 에셋', shop: '상점' }[screen];
  shop.classList.toggle('current', screen === 'shop');
  syncGameUrl();
  if (screen === 'shop') shop.setAttribute('aria-current', 'page');
  else shop.removeAttribute('aria-current');
  home.classList.toggle('current', screen === 'home');
  if (screen === 'home') home.setAttribute('aria-current', 'page');
  else home.removeAttribute('aria-current');
  play.textContent = screen === 'ready' ? '대기실' : '게임시작';
  if (screen === 'ready') {
    raid ??= prepareRaid((error) => {
      console.error(error);
      const message = document.querySelector<HTMLElement>('#startup-error')!;
      message.textContent = '경기장을 열지 못했습니다. 다시 시도해 주세요.';
      message.hidden = false;
    });
    raid.enter();
  } else if (screen === 'shop') {
    void import('./app/shop.ts');
  } else if (screen === 'assets') {
    void import('./app/asset-library.ts');
  } else if (leavingRaid) {
    play.focus({ preventScroll: true });
  }
}
home.addEventListener('click', () => {
  location.hash = '/home';
});
shop.onclick = () => {
  location.hash = '/shop';
};
window.addEventListener('hashchange', route);
route();
const frame = landscapeFrame();
if (frame) {
  window.addEventListener(
    'click',
    (event) => {
      if (event.isTrusted) void frame.requestGameLandscape(true);
    },
    { once: true },
  );
}
installViewportLimit(document.querySelector<HTMLDialogElement>('#viewport-limit')!);

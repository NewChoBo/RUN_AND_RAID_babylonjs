import { uiText } from './content/locales/ui.ts';
import './app/home.ts';
import { prepareRaid } from './app/run-and-raid.ts';
import { replaceGameUrl, syncGameUrl } from './platform/browser/game-navigation.ts';
import { launchScreen, showTitleScreen } from './ui/loading-screen.ts';
import { installSettings } from './ui/settings.ts';
import { installViewportLimit } from './ui/viewport-limit.ts';

const lobby = document.querySelector<HTMLElement>('.lobby')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const library = document.querySelector<HTMLElement>('#library')!;
const home = document.querySelector<HTMLButtonElement>('[data-home]')!;
const shop = document.querySelector<HTMLButtonElement>('[data-shop]')!;
const gallery = document.querySelector<HTMLElement>('#shop-gallery')!;
const play = document.querySelector<HTMLAnchorElement>('.play')!;
const startupError = document.querySelector<HTMLElement>('#startup-error')!;
startupError.querySelector('button')!.onclick = () => location.reload();
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
  const titleKey = { home: 'lobby', ready: 'waitingRoom', assets: 'assets', shop: 'shop' } as const;
  document.title = uiText('gameName') + ' · ' + uiText(titleKey[screen]);
  shop.classList.toggle('current', screen === 'shop');
  syncGameUrl();
  if (screen === 'shop') shop.setAttribute('aria-current', 'page');
  else shop.removeAttribute('aria-current');
  home.classList.toggle('current', screen === 'home');
  if (screen === 'home') home.setAttribute('aria-current', 'page');
  else home.removeAttribute('aria-current');
  play.textContent = uiText(screen === 'ready' ? 'room' : 'play');
  if (screen === 'ready') {
    raid ??= prepareRaid((error) => {
      console.error(error);
      startupError.hidden = false;
    });
    raid.enter();
  } else if (screen === 'shop') {
    void import('./app/shop.ts');
  } else if (screen === 'assets') {
    void import('./app/asset-library.ts');
  } else if (leavingRaid) {
    play.focus({ preventScroll: true });
  }
  if (launchScreen.open) {
    launchScreen.close();
    lobby.inert = false;
  }
}
home.addEventListener('click', () => {
  location.hash = '/home';
});
shop.onclick = () => {
  location.hash = '/shop';
};
export function openInitialRoute() {
  window.addEventListener('hashchange', route);
  if (location.hash) route();
  else {
    showTitleScreen(() => {
      const url = new URL(location.href);
      url.hash = '/home';
      replaceGameUrl(url);
      route();
      play.focus({ preventScroll: true });
    });
  }
  installSettings();
  installViewportLimit(document.querySelector<HTMLDialogElement>('#viewport-limit')!);
}

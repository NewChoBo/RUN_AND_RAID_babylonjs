import { landscapeFrame, mountLandscapeFrame } from './platform/browser/game-navigation.ts';
import { installLandscapeRecovery, requestLandscape } from './platform/browser/landscape.ts';
import { initializeUiLanguage } from './platform/browser/ui-language.ts';
import { uiText } from './content/locales/ui.ts';

initializeUiLanguage();
const frame = landscapeFrame();
const splash = document.querySelector<HTMLElement>('#launch-splash')!;
if (!frame && document.documentElement.hasAttribute('data-mobile')) {
  installLandscapeRecovery();
  void requestLandscape(false);
  mountLandscapeFrame(requestLandscape, splash);
} else {
  void import('./routes.ts')
    .then(() => {
      splash.remove();
      frame?.gameReady();
    })
    .catch(() => {
      frame?.gameReady();
      splash.classList.add('launch-error');
      splash.querySelector('p')!.textContent = uiText('launchError');
      const retry = document.createElement('button');
      retry.textContent = uiText('reload');
      retry.onclick = () => location.reload();
      splash.append(retry);
    });
}

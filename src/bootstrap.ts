import { landscapeFrame, mountLandscapeFrame } from './platform/browser/game-navigation.ts';
import { installLandscapeRecovery, requestLandscape } from './platform/browser/landscape.ts';
import { initializeUiLanguage } from './platform/browser/ui-language.ts';
import { installGameGestures } from './platform/browser/game-gestures.ts';
import { launchScreen, showLaunchError } from './ui/loading-screen.ts';

installGameGestures();
initializeUiLanguage();
const frame = landscapeFrame();
if (!frame && document.documentElement.hasAttribute('data-mobile')) {
  installLandscapeRecovery();
  void requestLandscape();
  mountLandscapeFrame(requestLandscape, launchScreen);
} else {
  void import('./routes.ts')
    .then(({ openInitialRoute }) => {
      frame?.gameReady();
      openInitialRoute();
    })
    .catch(() => {
      frame?.gameReady();
      showLaunchError();
    });
}

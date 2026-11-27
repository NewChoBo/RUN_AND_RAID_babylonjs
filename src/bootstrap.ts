import { landscapeFrame, mountLandscapeFrame } from './platform/browser/game-navigation.ts';
import { installLandscapeRecovery, requestLandscape } from './platform/browser/landscape.ts';
import { initializeUiLanguage } from './platform/browser/ui-language.ts';
import { installGameGestures } from './platform/browser/game-gestures.ts';
import {
  closeLoadingScreen,
  loadingScreen,
  rotateLoadingTips,
  showLaunchError,
} from './ui/loading-screen.ts';

installGameGestures();
initializeUiLanguage();
const frame = landscapeFrame();
rotateLoadingTips();
if (!frame && document.documentElement.hasAttribute('data-mobile')) {
  installLandscapeRecovery();
  void requestLandscape();
  mountLandscapeFrame(requestLandscape, loadingScreen, closeLoadingScreen);
} else {
  void import('./routes.ts')
    .then(() => {
      closeLoadingScreen();
      frame?.gameReady();
    })
    .catch(() => {
      frame?.gameReady();
      showLaunchError();
    });
}

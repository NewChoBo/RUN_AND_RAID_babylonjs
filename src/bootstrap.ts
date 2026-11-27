import { landscapeFrame, mountLandscapeFrame } from './platform/browser/game-navigation.ts';
import { installLandscapeRecovery, requestLandscape } from './platform/browser/landscape.ts';

const frame = landscapeFrame();
const splash = document.querySelector<HTMLElement>('#launch-splash')!;
if (
  !frame &&
  matchMedia('(any-pointer: coarse), (max-width: 600px) and (orientation: portrait)').matches
) {
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
      splash.querySelector('p')!.textContent = '게임 화면을 불러오지 못했습니다.';
      const retry = document.createElement('button');
      retry.textContent = '다시 불러오기';
      retry.onclick = () => location.reload();
      splash.append(retry);
    });
}

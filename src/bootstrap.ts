import { prepareRaid } from './app/run-and-raid.ts';
import { installLandscapeRecovery } from './platform/browser/landscape.ts';
import { installViewportLimit } from './ui/viewport-limit.ts';

installLandscapeRecovery();
installViewportLimit(document.querySelector<HTMLDialogElement>('#viewport-limit')!);
prepareRaid((error) => {
  console.error(error);
  document.querySelector<HTMLElement>('#startup-progress')!.hidden = true;
  const message = document.querySelector<HTMLElement>('#startup-error')!;
  message.textContent = '경기장을 열지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.';
  message.hidden = false;
});

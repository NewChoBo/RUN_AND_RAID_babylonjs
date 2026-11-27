import { uiText } from '../content/locales/ui.ts';
import { installLanguagePicker } from '../platform/browser/ui-language.ts';

installLanguagePicker(document.querySelector<HTMLSelectElement>('#ui-language')!);

const news = [
  {
    tag: 'lobby',
    title: '가로 화면 로비 복원',
    body: '원작 영상에 보이던 상단 메뉴와 하단 게시판을 복원했습니다. 휴대폰을 가로로 돌리면 로비가 열립니다.\n게임시작에서 빠른 매칭이나 사설방을 선택할 수 있습니다. 상점에서는 일러스트와 캐릭터 모델을 감상할 수 있습니다.',
  },
  {
    tag: 'controls',
    title: '점프 높이와 추격 속도',
    body: '원작 영상 속 카이켄의 발과 지면 링 사이 간격을 기준으로 일반 점프 높이를 3.2m, 체공 시간을 0.73초로 맞췄습니다.\n뒤로 입력하면 0.30초에 걸쳐 감속하고, 입력을 놓으면 0.40초에 걸쳐 다시 달리기 속도에 도달합니다.',
  },
  {
    tag: 'arena',
    title: '추격 카메라와 도로 거리',
    body: '원작 영상에서 난간과 마차 뒷바퀴가 보이는 위치를 비교해 추격 카메라 각도와 도로 폭을 조정했습니다.\n마차에서 가장 멀어질 수 있는 거리는 영상에서 관측한 장면을 참고해 56m로 늘렸습니다.',
  },
  {
    tag: 'runner',
    title: '원작 외형 106종 적용',
    body: '봇 연습에서 원작 캐릭터와 스킨 106종을 선택할 수 있습니다. 주자는 전투 능력을, 외형은 경기에서 보이는 모습을 정합니다.\n카이켄은 머리부터 신발까지의 높이를 기준으로 크기를 보정했습니다. 현재 원작 외형은 정적 모델이며 달리기와 공격 모션 복원은 보류 중입니다.',
  },
] as const;
const items = document.querySelector<HTMLElement>('#items')!;
const subject = document.querySelector<HTMLElement>('#subject')!;
const body = document.querySelector<HTMLElement>('#body')!;
const message = document.querySelector<HTMLDialogElement>('#message')!;
function notify(text: string, lang = document.documentElement.lang) {
  const label = document.querySelector<HTMLElement>('#message-text')!;
  label.lang = lang;
  label.textContent = text;
  message.showModal();
}
for (const entry of news) {
  const button = document.createElement('button');
  const tag = document.createElement('span');
  button.lang = 'ko';
  tag.lang = document.documentElement.lang;
  tag.textContent = uiText(entry.tag);
  tag.dataset.kind = entry.tag;
  button.append(tag, entry.title);
  button.setAttribute('aria-pressed', 'false');
  button.onclick = () => {
    items.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    subject.textContent = entry.title;
    body.textContent = entry.body;
    body.parentElement!.scrollTop = 0;
  };
  items.append(button);
}
const first = items.querySelector('button')!;
first.click();
document.querySelector('[data-home]')!.addEventListener('click', () => first.click());
for (const button of document.querySelectorAll('[data-wip]')) {
  button.addEventListener('click', () => notify(uiText('notAvailable')));
}
document
  .querySelector('#details')!
  .addEventListener('click', () => notify(subject.textContent + '\n\n' + body.textContent, 'ko'));

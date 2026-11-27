const news = [
  {
    tag: '업데이트',
    title: '6월28일 업데이트',
    body: '런앤레이드 무료화 게임 전환 업데이트가 적용되었습니다.\n- 6월 28일부터 7월 6일 자정까지 플레이 후 획득하는 골드 획득량이 2배로 적용됩니다.\n- 최대 친구 수 증가 (기존 50명에서 80명까지 변경됩니다.)\n- 최대 아이템 인벤토리 개수 증가 (기존 75개에서 100개로 변경됩니다.)\n- 일일 출석 보상이 1다이아에서 3,000골드로 변경됩니다.\n- 월드컵 이벤트 뽑기에서 다이아가 모두 유저에게 일괄 지급되었습니다.',
  },
  {
    tag: '공지사항',
    title: '런앤레이드 무료화 전환 공지',
    body: '런앤레이드가 무료 게임으로 전환되었습니다.',
  },
  {
    tag: '업데이트',
    title: '6월20일 로테이션 변경',
    body: '6월 20일 주자 로테이션이 변경되었습니다.',
  },
  { tag: '이벤트', title: '운영자를 찾아라!', body: '운영자를 찾아라! 이벤트 공지입니다.' },
];
const items = document.querySelector<HTMLElement>('#items')!;
const subject = document.querySelector<HTMLElement>('#subject')!;
const body = document.querySelector<HTMLElement>('#body')!;
const message = document.querySelector<HTMLDialogElement>('#message')!;
function notify(text: string) {
  document.querySelector('#message-text')!.textContent = text;
  message.showModal();
}
for (const entry of news) {
  const button = document.createElement('button');
  const tag = document.createElement('span');
  tag.textContent = entry.tag;
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
  button.addEventListener('click', () => notify('미구현된 기능입니다.'));
}
document
  .querySelector('#details')!
  .addEventListener('click', () => notify(subject.textContent + '\n\n' + body.textContent));

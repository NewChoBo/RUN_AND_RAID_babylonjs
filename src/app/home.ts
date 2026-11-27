import { HERO_IDS } from '../game/raid/heroes/hero-id.ts';
import { raidText } from '../content/locales/run-and-raid.ts';

type Entry = { tag: string; title: string; body: string; extra?: string };
const pages: Record<string, { title: string; entries: Entry[] }> = {
  lobby: {
    title: '새소식',
    entries: [
      {
        tag: '안내',
        title: '마차 추격전',
        body: '두 팀이 같은 마차를 추격합니다. 마차를 먼저 파괴하거나 제한 시간 동안 더 많은 피해를 준 팀이 승리합니다.',
        extra: '상단의 게임시작에서 주자를 고르고 경기에 입장하세요.',
      },
      {
        tag: '연습',
        title: '봇과 연습하기',
        body: '게임시작에서 주자와 외형을 고른 뒤 봇과 연습을 누르세요. 영웅마다 다른 사거리와 스킬을 시험할 수 있습니다.',
      },
      {
        tag: '대전',
        title: '친구와 코드 방에서 만나기',
        body: '게임시작의 온라인 메뉴에서 방을 만들고 여섯 자리 코드를 공유하세요. 친구가 같은 코드를 입력하면 함께 주자를 선택할 수 있습니다.',
      },
    ],
  },
  heroes: {
    title: '주자 목록',
    entries: HERO_IDS.map((hero) => ({
      tag: '주자',
      title: raidText(hero),
      body: raidText(`${hero}Info`),
      extra: (['Pulse', 'Bolt', 'Field', 'Fury'] as const)
        .map((skill) => raidText(`${hero}${skill}`))
        .join(' · '),
    })),
  },
  controls: {
    title: '조작법',
    entries: [
      {
        tag: '이동',
        title: '달리기와 제동',
        body: '주자는 자동으로 달립니다. 터치 이동 스틱을 좌우로 끌면 차선을 바꾸고 아래로 끌면 속도를 줄입니다.',
      },
      {
        tag: '회피',
        title: '점프',
        body: '점프 버튼을 눌러 낮은 공격과 마차의 공격을 뛰어넘으세요.',
      },
      { tag: '전투', title: '스킬 조준', body: raidText('controls') },
    ],
  },
};

const items = document.querySelector<HTMLElement>('#items')!;
const subject = document.querySelector<HTMLElement>('#subject')!;
function render() {
  const hash = location.hash.slice(1);
  const key = Object.hasOwn(pages, hash) ? hash : 'lobby';
  const page = pages[key]!;
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((link) => {
    const current = link.dataset.page === key;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#list-title')!.textContent = page.title;
  items.replaceChildren();
  for (const entry of page.entries) {
    const button = document.createElement('button');
    button.type = 'button';
    const tag = document.createElement('span');
    tag.textContent = entry.tag;
    button.append(tag, entry.title);
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      items.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      subject.textContent = entry.title;
      document.querySelector('#body')!.textContent = entry.body;
      document.querySelector('#extra')!.textContent = entry.extra ?? '';
    };
    items.append(button);
  }
  items.querySelector('button')?.click();
}
window.addEventListener('hashchange', render);
render();

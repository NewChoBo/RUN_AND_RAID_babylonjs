import { raidText as t } from '../content/locales/run-and-raid.ts';
import { characterArt } from '../content/raid/gallery.ts';
import { isRaidRoster, type DraftSeat } from '../game/raid/raid-draft.ts';
import { HERO_IDS, HEROES, type RaidHero } from '../game/raid/raid-match.ts';
import type { RaidEntry, RoomError } from '../platform/photon/raid-room.ts';
export function createRaidLobby(
  parent: HTMLElement,
  outfitButton: HTMLButtonElement,
  actions: {
    connect(code: string, entry: RaidEntry): void;
    start(): void;
    practice(): void;
    leave(): void;
    pick(hero: RaidHero | null): void;
    selected(): RaidHero;
  },
) {
  const group = document.createElement('section');
  group.className = 'raid-lobby';
  parent.append(group);
  const heading = document.createElement('h2');
  heading.textContent = t('online');
  const controls = document.createElement('div');
  const code = document.createElement('input');
  code.placeholder = t('roomCode');
  code.setAttribute('aria-label', t('roomCode'));
  code.maxLength = 6;
  code.autocomplete = 'off';
  code.spellcheck = false;
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  const teams = document.createElement('ul');
  teams.className = 'team-seats';
  const versus = document.createElement('div');
  versus.className = 'team-versus';
  versus.innerHTML =
    '<strong><b>BLUE</b> <b>RED</b></strong><span>준비 완료</span><output></output>';
  const picker = document.createElement('dialog');
  picker.className = 'runner-picker';
  picker.setAttribute('aria-label', '캐릭터 선택');
  const confirm = document.createElement('button');
  confirm.textContent = '확인';
  confirm.onclick = () => picker.close();
  const draft = document.createElement('div');
  draft.className = 'raid-draft';
  const title = document.createElement('h3');
  title.textContent = t('pickHeading');
  const cards = document.createElement('div');
  cards.className = 'raid-pick-grid';
  const profile = document.createElement('figure');
  profile.className = 'raid-pick-profile';
  const portrait = document.createElement('img');
  portrait.alt = '';
  portrait.referrerPolicy = 'no-referrer';
  portrait.onerror = () => {
    const fallback = './assets/raid/portraits/' + preview + '.webp';
    if (portrait.getAttribute('src') !== fallback) portrait.src = fallback;
  };
  portrait.width = portrait.height = 240;
  const caption = document.createElement('figcaption');
  const heroName = document.createElement('strong');
  const range = document.createElement('small');
  const detail = document.createElement('p');
  const skills = document.createElement('p');
  skills.className = 'raid-pick-skills';
  caption.append(heroName, range, detail, skills);
  profile.append(portrait, caption);
  const notice = document.createElement('p');
  notice.setAttribute('aria-live', 'polite');
  const lock = document.createElement('button');
  lock.type = 'button';
  let preview: RaidHero = actions.selected();
  let seats: DraftSeat[] = [];
  let self = 0;
  let soloRoom = false;
  const choices = HERO_IDS.map((hero) => {
    const card = document.createElement('button');
    card.type = 'button';
    const image = document.createElement('img');
    image.src = './assets/raid/portraits/' + hero + '.webp';
    image.alt = '';
    image.width = image.height = 80;
    image.loading = 'lazy';
    const name = document.createElement('span');
    name.textContent = t(hero);
    const taken = document.createElement('small');
    taken.textContent = t('pickTaken');
    card.append(image, name, taken);
    card.onclick = () => {
      preview = hero;
      paint();
    };
    cards.append(card);
    return { hero, card, taken };
  });
  function paint() {
    const mine = seats.find((s) => s.actor === self)?.hero;
    if (mine) preview = mine;
    for (const { hero, card, taken } of choices) {
      const occupied = seats.some((s) => s.hero === hero && s.actor !== self);
      card.disabled = occupied || (!!mine && hero !== mine);
      taken.hidden = !occupied;
      card.setAttribute('aria-pressed', String(hero === preview));
    }
    const imageUrl = characterArt(preview);
    if (portrait.getAttribute('src') !== imageUrl) portrait.src = imageUrl;
    heroName.textContent = t(preview);
    range.textContent = t('reach', { range: HEROES[preview].reach });
    detail.textContent = t(`${preview}Info`);
    skills.textContent = (['Pulse', 'Bolt', 'Field', 'Fury'] as const)
      .map((s) => t(`${preview}${s}`))
      .join(' · ');
    lock.textContent = t(mine ? 'unlockPick' : 'lockPick');
    if (!mine) lock.textContent += ' · ' + t(preview);
    lock.disabled = !mine && seats.some((s) => s.hero === preview);
    notice.textContent = t(
      lock.disabled
        ? 'pickConflict'
        : seats.length < 2
          ? soloRoom
            ? 'pickSolo'
            : 'pickPlayers'
          : isRaidRoster(seats)
            ? 'pickReady'
            : 'pickWait',
    );
  }
  lock.onclick = () => actions.pick(seats.find((s) => s.actor === self)?.hero ? null : preview);
  const choose = document.createElement('button');
  choose.textContent = '캐릭터 선택';
  choose.onclick = () => picker.showModal();
  const selection = document.createElement('section');
  selection.append(title, cards);
  picker.append(selection, profile, confirm);
  draft.append(choose, lock, outfitButton, notice);
  group.append(heading, status, teams, versus, draft, controls, picker);
  function button(label: string, click: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = click;
    controls.append(b);
    return b;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const quick = button(t('quickMatch'), () => actions.connect('', 'quick'));
  const privateRooms = button('사설방', () => menu('private'));
  const host = button(t('hostRoom'), () =>
    actions.connect(
      Array.from(
        crypto.getRandomValues(new Uint8Array(6)),
        (v) => alphabet[v % alphabet.length],
      ).join(''),
      'host',
    ),
  );
  const enterCode = button('참가하기', () => {
    menu('code');
    code.focus();
  });
  controls.append(code);
  const join = button(t('joinRoom'), () => actions.connect(code.value, 'join'));
  code.oninput = () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
    join.disabled = code.value.length !== 6;
  };
  code.onkeydown = (e) => {
    if (e.key === 'Enter' && !join.disabled) join.click();
  };
  const start = button(t('startRound'), actions.start);
  const leave = button(t('leaveRoom'), actions.leave);
  const back = button('뒤로', () => menu(page === 'code' ? 'private' : 'entry'));
  const practice = button('오프라인 봇 연습', actions.practice);
  let page: 'entry' | 'private' | 'code' = 'entry';
  function menu(next: typeof page) {
    page = next;
    status.textContent = '';
    show('entry');
  }
  function show(stage: 'entry' | 'connecting' | 'draft') {
    const room = stage !== 'entry';
    quick.hidden = privateRooms.hidden = room || page !== 'entry';
    host.hidden = enterCode.hidden = room || page !== 'private';
    code.hidden = join.hidden = room || page !== 'code';
    back.hidden = room || page === 'entry';
    practice.hidden = true;
    group.dataset.stage = stage;
    heading.textContent =
      stage === 'connecting'
        ? t('connecting')
        : page === 'entry'
          ? '게임 모드 선택'
          : page === 'private'
            ? '사설방'
            : '방 코드 입력';
    leave.hidden = !room;
    if (stage !== 'draft') start.hidden = true;
    teams.replaceChildren();
    draft.hidden = versus.hidden = stage !== 'draft';
    if (stage !== 'draft' && picker.open) picker.close();
    group.classList.toggle('drafting', stage === 'draft');
    parent.classList.toggle('in-room', room);
    join.disabled = code.value.length !== 6;
  }
  show('entry');
  return {
    closePicker() {
      if (picker.open) picker.close();
    },
    pending() {
      preview = actions.selected();
      show('connecting');
      status.textContent = t('connecting');
    },
    reset(reason?: RoomError, restart = false) {
      if (restart) page = 'entry';
      show('entry');
      status.textContent = reason ? t(reason) : '';
      practice.hidden = !(reason && page === 'private');
    },
    room(roomCode: string, members: DraftSeat[], actor: number, isHost: boolean, offline = false) {
      seats = members;
      self = actor;
      soloRoom = (!!roomCode || offline) && isHost && seats.length === 1;
      outfitButton.hidden = !soloRoom;
      show('draft');
      paint();
      status.textContent = offline
        ? '오프라인 봇 연습'
        : roomCode
          ? t('roomStatus', { code: roomCode, count: seats.length })
          : t('quickRoomStatus', { count: seats.length });
      versus.querySelector('output')!.textContent =
        seats.filter((s) => s.hero).length + ' / ' + seats.length;
      for (let i = 0; i < 4; i++) {
        const item = document.createElement('li');
        const seat = seats[i];
        item.className = i % 2 ? 'red-seat' : 'blue-seat';
        if (seat?.actor === self) item.classList.add('own-seat');
        const name = document.createElement('span');
        name.textContent =
          (i % 2 ? 'RED' : 'BLUE') +
          ' ' +
          (Math.floor(i / 2) + 1) +
          (seat?.actor === self ? ' · ' + t('you') : '');
        const runner = document.createElement('strong');
        runner.textContent = seat?.hero ? t(seat.hero) : seat ? t('picking') : t('bot');
        if (seat?.hero) {
          const img = document.createElement('img');
          img.alt = '';
          img.referrerPolicy = 'no-referrer';
          img.src = characterArt(seat.hero);
          img.onerror = () => {
            img.onerror = null;
            img.src = './assets/raid/portraits/' + seat.hero + '.webp';
          };
          item.append(img);
        }
        item.append(name, runner);
        if (seat?.hero) {
          const ready = document.createElement('b');
          ready.textContent = '준비완료';
          item.append(ready);
        }
        teams.append(item);
      }
      start.hidden = !isHost;
      start.textContent = t(soloRoom ? 'startSoloRoom' : 'startRound');
      start.disabled = soloRoom ? !seats[0]?.hero : !isRaidRoster(seats);
    },
  };
}

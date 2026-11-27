import { uiText } from '../content/locales/ui.ts';
import { raidText as t } from '../content/locales/run-and-raid.ts';
import { characterArt } from '../content/raid/gallery.ts';
import { isRaidRoster, type DraftSeat } from '../game/raid/raid-draft.ts';
import { HERO_IDS, HEROES, type RaidHero } from '../game/raid/raid-match.ts';
import type { RaidEntry, RoomError } from '../platform/photon/raid-room.ts';

function setDraftArt(image: HTMLImageElement, hero: RaidHero) {
  if (image.dataset.hero === hero) return;
  image.dataset.hero = hero;
  image.referrerPolicy = 'no-referrer';
  const fallback = './assets/raid/portraits/' + hero + '.webp';
  const source = characterArt(hero);
  image.onerror =
    source === fallback
      ? null
      : () => {
          image.onerror = null;
          image.src = fallback;
        };
  image.src = source;
}

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
  const dialog = document.querySelector<HTMLDialogElement>('#match-menu')!;
  const heading = dialog.querySelector('h2')!;
  const options = dialog.querySelector<HTMLElement>('.match-options')!;
  const message = dialog.querySelector('output')!;
  const dismiss = () => {
    location.hash = '/home';
  };
  dialog.querySelector('button')!.onclick = dismiss;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
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
  versus.innerHTML = '<strong><b></b> <b></b></strong><span></span><output></output>';
  versus.querySelector('b:first-child')!.textContent = uiText('blueTeam');
  versus.querySelector('b:last-child')!.textContent = uiText('redTeam');
  versus.querySelector('span')!.textContent = uiText('lockedPicks');
  const picker = document.createElement('dialog');
  picker.className = 'runner-picker';
  picker.setAttribute('aria-label', uiText('chooseCharacter'));
  const confirm = document.createElement('button');
  confirm.textContent = uiText('ok');
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
    image.alt = '';
    image.width = image.height = 80;
    image.loading = 'lazy';
    setDraftArt(image, hero);
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
    setDraftArt(portrait, preview);
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
  choose.textContent = uiText('chooseCharacter');
  choose.onclick = () => picker.showModal();
  const selection = document.createElement('section');
  selection.append(title, cards);
  picker.append(selection, profile, confirm);
  draft.append(choose, lock, outfitButton, notice);
  group.append(status, teams, versus, draft, controls, picker);
  function button(label: string, click: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = click;
    return b;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const quick = button(t('quickMatch'), () => actions.connect('', 'quick'));
  const privateRooms = button(uiText('privateRoom'), () => menu('private'));
  const host = button(t('hostRoom'), () =>
    actions.connect(
      Array.from(
        crypto.getRandomValues(new Uint8Array(6)),
        (v) => alphabet[v % alphabet.length],
      ).join(''),
      'host',
    ),
  );
  const enterCode = button(uiText('joinByCode'), () => menu('code'));
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
  const back = button(uiText('back'), () => menu(page === 'code' ? 'private' : 'entry'));
  const practice = button(uiText('offlinePractice'), actions.practice);
  options.append(quick, privateRooms, host, enterCode, code, join, practice, back);
  controls.append(start, leave);
  let page: 'entry' | 'private' | 'code' = 'entry';
  function menu(next: typeof page) {
    page = next;
    show('entry');
  }
  function show(stage: 'entry' | 'connecting' | 'draft') {
    const room = stage !== 'entry';
    group.hidden = stage !== 'draft';
    options.hidden = room;
    message.textContent = '';
    document.getElementById('startup-error')!.hidden = true;
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
          ? uiText('chooseMode')
          : page === 'private'
            ? uiText('privateRoom')
            : uiText('enterCode');
    if (stage !== 'draft') start.hidden = true;
    teams.replaceChildren();
    draft.hidden = versus.hidden = stage !== 'draft';
    if (stage !== 'draft' && picker.open) picker.close();
    group.classList.toggle('drafting', stage === 'draft');
    parent.classList.toggle('in-room', room);
    join.disabled = code.value.length !== 6;
    if (stage === 'draft') {
      if (dialog.open) {
        dialog.close();
        choose.focus({ preventScroll: true });
      }
    } else {
      if (!dialog.open) dialog.showModal();
      const focus = room ? heading : page === 'code' ? code : page === 'private' ? host : quick;
      focus.focus({ preventScroll: true });
    }
  }
  return {
    open() {
      menu('entry');
    },
    close() {
      dialog.close();
      picker.close();
    },
    closePicker() {
      if (picker.open) picker.close();
    },
    pending() {
      preview = actions.selected();
      show('connecting');
    },
    reset(reason?: RoomError) {
      show('entry');
      message.textContent = reason ? t(reason) : '';
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
        ? uiText('offlinePractice')
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
          uiText(i % 2 ? 'redTeam' : 'blueTeam') +
          ' ' +
          (Math.floor(i / 2) + 1) +
          (seat?.actor === self ? ' · ' + t('you') : '');
        const runner = document.createElement('strong');
        runner.textContent = seat?.hero ? t(seat.hero) : seat ? t('picking') : t('bot');
        if (seat?.hero) {
          const img = document.createElement('img');
          img.alt = '';
          setDraftArt(img, seat.hero);
          item.append(img);
        }
        item.append(name, runner);
        if (seat?.hero) {
          const ready = document.createElement('b');
          ready.textContent = uiText('seatReady');
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

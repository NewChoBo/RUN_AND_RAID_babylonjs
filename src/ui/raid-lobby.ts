import { uiText } from '../content/locales/ui.ts';
import { raidText as t } from '../content/locales/run-and-raid.ts';
import { createDraftLoadout } from './raid-draft-loadout.ts';
import { draftCatalog, hasDraftCatalog } from '../content/raid/draft-loadout.ts';
import { characterArt } from '../content/raid/gallery.ts';
import { officialGuides } from '../content/raid/official-guides.ts';
import { battleIconIndex, skillLabel } from './raid-skill-icon.ts';
import { createDraftChat } from './raid-draft-chat.ts';
import {
  isRaidRoster,
  pickNumber,
  type DraftClock,
  type DraftSeat,
} from '../game/raid/raid-draft.ts';
import { HEROES, type RaidHero, type Skill } from '../game/raid/raid-match.ts';
import { HERO_IDS, heroKit, PRACTICE_HERO_IDS } from '../game/raid/heroes/hero-id.ts';
import { adaptedSkills } from '../content/raid/draft-profiles.ts';
import { createBattleOutfitPicker } from './raid-battle-outfit.ts';
import type { RaidEntry, RoomError } from '../platform/photon/raid-room.ts';

function setDraftArt(
  image: HTMLImageElement,
  hero: RaidHero,
  thumbnail = false,
  source = characterArt(hero),
) {
  if (image.dataset.hero === hero && image.dataset.art === source) return;
  image.dataset.art = source;
  image.dataset.hero = hero;
  image.referrerPolicy = 'no-referrer';
  const fallback = './assets/raid/portraits/' + hero + '.webp';
  image.style.background =
    source === fallback ? '' : `url("${fallback}") center / contain no-repeat`;
  image.onload = () => {
    image.style.background = '';
  };
  image.onerror =
    source === fallback
      ? null
      : () => {
          image.onerror = null;
          image.classList.remove('guide-face', 'freesia-face');
          image.classList.add('model-face');
          image.src = fallback;
        };
  if (thumbnail && source.startsWith('https://cafeptthumb-phinf.pstatic.net/')) {
    const url = new URL(source);
    url.searchParams.set('type', 'w220');
    image.src = url.href;
  } else image.src = source;
}

export function createRaidLobby(
  parent: HTMLElement,
  outfitButton: HTMLButtonElement,
  actions: {
    connect(code: string, entry: RaidEntry): void;
    start(): void;
    practice(): void;
    chat(text: string): void;
    leave(): void;
    pick(hero: RaidHero | null, outfit?: string): void;
    prefer(hero: RaidHero, outfit?: string): void;
    resetPracticeOutfit(): void;
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
  const chat = createDraftChat(actions.chat);
  const toolbarChat = document.querySelector<HTMLButtonElement>('[data-room-chat]')!;
  toolbarChat.onclick = () => chat.open.click();
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
  const seatViews = Array.from({ length: 4 }, (_, i) => {
    const item = document.createElement('li');
    item.className = i % 2 ? 'red-seat' : 'blue-seat';
    const pick = document.createElement('small');
    pick.className = 'seat-pick';
    pick.textContent = uiText('pickSeat', { n: pickNumber(i) });
    const team = uiText(i % 2 ? 'redTeam' : 'blueTeam') + ' ' + (Math.floor(i / 2) + 1);
    const name = document.createElement('span');
    const runner = document.createElement('strong');
    const image = document.createElement('img');
    image.alt = '';
    const state = document.createElement('div');
    const ready = document.createElement('b');
    ready.textContent = uiText('seatReady');
    item.append(pick, name, runner, state);
    teams.append(item);
    return { item, team, name, runner, image, state, ready };
  });
  const versus = document.createElement('div');
  versus.className = 'team-versus';
  versus.innerHTML = '<div><strong><b></b> <b></b></strong><span></span><time></time></div>';
  versus.querySelector('b:first-child')!.textContent = uiText('blueTeam');
  versus.querySelector('b:last-child')!.textContent = uiText('redTeam');
  const clockLabel = versus.querySelector('span')!;
  const roomTime = versus.querySelector('time')!;
  const picker = document.createElement('dialog');
  picker.className = 'runner-picker';
  picker.setAttribute('aria-label', uiText('chooseCharacter'));
  const confirm = document.createElement('button');
  confirm.textContent = uiText('ok');
  confirm.onclick = () => {
    const own = seats.find((seat) => seat.actor === self);
    if (own && !own.hero && own.preferred !== preview) actions.prefer(preview, battleModel.value());
    picker.close();
  };
  const draft = document.createElement('div');
  draft.className = 'raid-draft';
  const title = document.createElement('h3');
  title.textContent = t('pickHeading');
  const pickerClock = document.createElement('span');
  pickerClock.className = 'picker-clock';
  const pickerTime = document.createElement('time');
  pickerClock.append(uiText('timeLeft') + ' ', pickerTime);
  title.append(pickerClock);
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
  const kitPanel = document.createElement('section');
  kitPanel.className = 'draft-kit';
  const kitTitle = document.createElement('strong');
  kitPanel.append(kitTitle);
  const guide = document.createElement('details');
  guide.className = 'raid-original-guide';
  const guideTitle = document.createElement('summary');
  guideTitle.textContent = t('originalGuide');
  const originalSkills = document.createElement('div');
  originalSkills.lang = 'ko';
  const source = document.createElement('a');
  source.textContent = t('originalCafe');
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  guide.append(guideTitle, originalSkills, source);
  const loadout = createDraftLoadout((hero, url) => setDraftArt(portrait, hero, false, url));
  const more = document.createElement('details');
  more.className = 'draft-character-details';
  const moreTitle = document.createElement('summary');
  moreTitle.textContent = uiText('championDetails');
  more.append(moreTitle, range, detail, skills, guide);
  function changePreference() {
    actions.resetPracticeOutfit();
    actions.prefer(preview, battleModel.value());
  }
  const battleModel = createBattleOutfitPicker(changePreference);
  caption.append(heroName, loadout.settings, battleModel.field, more);
  profile.append(portrait, caption);
  const notice = document.createElement('p');
  notice.className = 'draft-notice';
  notice.setAttribute('aria-live', 'polite');
  const lock = document.createElement('button');
  lock.type = 'button';
  let preview: RaidHero = actions.selected();
  let seats: DraftSeat[] = [];
  let self = 0;
  let soloRoom = false;
  let clock: DraftClock | null = null;
  let clockTimer: number | undefined;
  function paintClock() {
    window.clearTimeout(clockTimer);
    pickerClock.hidden = roomTime.hidden = !clock;
    clockLabel.textContent = uiText(clock ? 'timeLeft' : 'noTimeLimit');
    if (!clock) return;
    const ms = Math.max(0, clock.endsAt - performance.now());
    const seconds = Math.ceil(ms / 1000);
    roomTime.textContent = pickerTime.textContent = String(seconds);
    if (ms > 0) clockTimer = window.setTimeout(paintClock, Math.ceil(ms - (seconds - 1) * 1000));
  }
  const choices = HERO_IDS.map((hero) => {
    const card = document.createElement('button');
    card.type = 'button';
    const image = document.createElement('img');
    image.alt = '';
    image.width = image.height = 80;
    image.loading = 'lazy';
    const face = hasDraftCatalog(hero) ? draftCatalog[hero].face : undefined;
    image.className = face ? (hero === 'freesia' ? 'freesia-face' : 'guide-face') : 'model-face';
    setDraftArt(image, hero, false, face);
    card.title = t(hero);
    const taken = document.createElement('small');
    const badge =
      heroKit(hero) !== hero
        ? 'borrowedKit'
        : PRACTICE_HERO_IDS.some((id) => id === hero)
          ? 'practiceRunner'
          : undefined;
    card.classList.toggle('kit-card', !!badge);
    card.append(image, taken);
    card.onclick = () => {
      preview = hero;
      paint();
      changePreference();
    };
    cards.append(card);
    return { hero, card, taken, badge } as const;
  });
  function paint() {
    const own = seats.find((s) => s.actor === self);
    const mine = own?.hero;
    const active = clock?.actor;
    const n = pickNumber(seats.findIndex((seat) => seat.actor === active));
    notice.classList.toggle('own-turn', active === self);
    notice.textContent = n
      ? uiText(active === self ? 'yourDraftTurn' : 'draftTurn', { n })
      : clock
        ? uiText('matchStarting')
        : soloRoom && mine
          ? uiText('soloReady')
          : t(soloRoom ? 'pickSolo' : 'pickPlayers');
    if (mine) preview = mine;
    for (const [i, { item, team, name, runner, image, state, ready }] of seatViews.entries()) {
      const seat = seats[i];
      const ownSeat = seat?.actor === self;
      const hero = seat?.hero ?? (ownSeat ? preview : seat?.preferred);
      const current = !!seat && (clock ? clock.actor === seat.actor : !seat.hero);
      const text = current ? t('picking') : seat ? uiText('seatWaiting') : t('bot');
      item.classList.toggle('own-seat', ownSeat);
      if (current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      name.textContent = ownSeat ? team + ' · ' + t('you') : team;
      runner.textContent = hero ? t(hero) : text;
      runner.classList.toggle('seat-runner-name', !!hero);
      if (hero) {
        setDraftArt(image, hero, true);
        image.classList.toggle('tentative-art', !seat?.hero);
        if (!image.parentNode) item.prepend(image);
      } else image.remove();
      if (seat?.hero) {
        if (state.firstChild !== ready) state.replaceChildren(ready);
      } else state.textContent = hero ? text : '';
    }
    for (const { hero, card, taken, badge } of choices) {
      const occupied = seats.some((s) => s.hero === hero && s.actor !== self);
      card.disabled = occupied || (!!mine && hero !== mine);
      taken.hidden = !occupied && !badge;
      taken.textContent = occupied ? t('pickTaken') : badge ? t(badge) : '';
      card.setAttribute('aria-label', taken.hidden ? t(hero) : t(hero) + ' · ' + taken.textContent);
      card.setAttribute('aria-pressed', String(hero === preview));
    }
    battleModel.show(preview, !!mine, own?.outfit);
    const kit = heroKit(preview);
    loadout.show(preview);
    const catalogued = hasDraftCatalog(preview);
    if (!catalogued) setDraftArt(portrait, preview);
    if (guide.dataset.hero !== preview) more.open = kit !== preview;
    heroName.textContent = t(preview);
    if (guide.dataset.hero !== preview) {
      guide.dataset.hero = preview;
      guide.open = false;
      const hero = preview;
      const original = officialGuides[hero];
      guide.hidden = !original;
      portrait.classList.toggle('archive-portrait', !catalogued);
      kitPanel.hidden = catalogued;
      if (catalogued) more.insertBefore(skills, guide);
      else {
        kitTitle.textContent =
          kit !== hero ? t('borrowedKit') + ' · ' + t(kit) : t('practiceRunner') + ' · ' + t(hero);
        kitPanel.append(skills);
      }
      skills.replaceChildren();
      (['Pulse', 'Bolt', 'Field', 'Fury'] as const).forEach((suffix, i) => {
        const text =
          t(`${kit}${suffix}`) + (kit === hero && adaptedSkills[hero]?.includes(i) ? '*' : '');
        skills.append(skillLabel(kit, battleIconIndex(kit, i as Skill), text));
      });
      if (kit === hero && adaptedSkills[hero]?.length) {
        const note = document.createElement('small');
        note.textContent = '* ' + t('adaptedSkill');
        skills.append(note);
      }
      if (original) {
        originalSkills.replaceChildren(
          skillLabel(hero, 0, t('originalPassive', { name: original.passive })),
        );
        const guideRow = (names: readonly string[], start: number, mode?: string) => {
          const row = document.createElement('p');
          row.className = 'raid-pick-skills';
          if (mode) {
            const heading = document.createElement('strong');
            heading.textContent = mode;
            row.append(heading);
          }
          names.forEach((name, index) => row.append(skillLabel(hero, start + index, name)));
          originalSkills.append(row);
        };
        guideRow(original.skills, 1, original.shieldMode && t('magnusBattle'));
        if (original.shieldMode) {
          guideRow(original.shieldMode, 5, t('magnusFury'));
        }
        source.href = 'https://cafe.naver.com/runandraid/' + original.article;
      }
    }
    range.textContent = t('reach', { range: HEROES[preview].reach });
    detail.textContent =
      kit === preview
        ? t(`${kit}Info`)
        : t('borrowedKitFrom', { name: t(kit) }) + ' ' + t(`${kit}Info`);
    lock.textContent = uiText(mine ? 'cancelReady' : 'readyUp');
    if (!mine) lock.textContent += ' · ' + t(preview);
    lock.disabled =
      !mine && ((!!clock && active !== self) || seats.some((s) => s.hero === preview));
  }
  lock.onclick = () => {
    actions.pick(seats.find((s) => s.actor === self)?.hero ? null : preview, battleModel.value());
  };
  const choose = document.createElement('button');
  choose.textContent = uiText('chooseCharacter');
  choose.onclick = () => picker.showModal();
  const selection = document.createElement('section');
  selection.append(title, cards, loadout.skills, kitPanel);
  const pickerTools = document.createElement('footer');
  pickerTools.append(chat.open, outfitButton, confirm);
  picker.append(selection, profile, pickerTools);
  draft.append(choose, lock);
  group.append(teams, versus, notice, chat.dock, draft, picker, chat.dialog);
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
  const cancelMatch = button(t('cancelMatch'), actions.leave);
  cancelMatch.className = 'cancel-match';
  cancelMatch.hidden = true;
  dialog.append(cancelMatch);
  draft.append(start);
  const roomInfo = document.createElement('div');
  roomInfo.className = 'draft-room-info';
  roomInfo.append(status, leave);
  versus.append(roomInfo);
  let page: 'entry' | 'private' | 'code' = 'entry';
  function menu(next: typeof page) {
    page = next;
    show('entry');
  }
  let quickMatch = false;
  function show(stage: 'entry' | 'connecting' | 'waiting' | 'draft') {
    if (stage === 'entry') quickMatch = false;
    const room = stage !== 'entry';
    toolbarChat.disabled = group.hidden = stage !== 'draft';
    options.hidden = room;
    cancelMatch.hidden = !quickMatch || (stage !== 'connecting' && stage !== 'waiting');
    message.textContent = '';
    document.getElementById('startup-error')!.hidden = true;
    quick.hidden = privateRooms.hidden = room || page !== 'entry';
    host.hidden = enterCode.hidden = room || page !== 'private';
    code.hidden = join.hidden = room || page !== 'code';
    back.hidden = room || page === 'entry';
    practice.hidden = room || page !== 'private';
    group.dataset.stage = stage;
    heading.textContent =
      stage === 'waiting'
        ? t('quickSearching')
        : stage === 'connecting'
          ? t('connecting')
          : page === 'entry'
            ? uiText('chooseMode')
            : page === 'private'
              ? uiText('privateRoom')
              : uiText('enterCode');
    if (stage !== 'draft') start.hidden = true;
    draft.hidden = versus.hidden = stage !== 'draft';
    if (stage !== 'draft') {
      window.clearTimeout(clockTimer);
      clock = null;
      seats = [];
      self = 0;
      preview = actions.selected();
      chat.reset();
      picker.close();
    }
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
      window.clearTimeout(clockTimer);
      toolbarChat.disabled = true;
      dialog.close();
      chat.reset();
      picker.close();
    },
    closePicker() {
      window.clearTimeout(clockTimer);
      chat.dialog.close();
      if (picker.open) picker.close();
    },
    chat(actor: number, text: string) {
      const n = pickNumber(seats.findIndex((seat) => seat.actor === actor));
      const name = n ? uiText('pickSeat', { n }) : uiText('chatPlayer', { actor });
      chat.append(actor === self ? t('you') + ' · ' + name : name, text, actor === self);
    },
    pending(entry: RaidEntry) {
      quickMatch = entry === 'quick';
      preview = actions.selected();
      show('connecting');
    },
    waiting(count: number) {
      if (group.dataset.stage !== 'waiting') show('waiting');
      const text = t('quickWaiting', { count });
      if (message.textContent !== text) message.textContent = text;
    },
    reset(reason?: RoomError) {
      show('entry');
      message.textContent = reason ? t(reason) : '';
    },
    room(
      roomCode: string,
      members: DraftSeat[],
      actor: number,
      isHost: boolean,
      nextClock: DraftClock | null,
      offline = false,
    ) {
      const enterQuickDraft = quickMatch && group.dataset.stage !== 'draft';
      const ownSeat = seats.findIndex((seat) => seat.actor === self);
      const nextSeat = members.findIndex((seat) => seat.actor === actor);
      if (ownSeat >= 0 && ownSeat % 2 !== nextSeat % 2) chat.reset();
      seats = members;
      self = actor;
      clock = nextClock;
      soloRoom = (!!roomCode || offline) && isHost && seats.length === 1;
      outfitButton.hidden = !soloRoom;
      chat.mode(offline);
      show('draft');
      paint();
      paintClock();
      if (enterQuickDraft) picker.showModal();
      const roomStatus = offline
        ? uiText('offlinePractice')
        : roomCode
          ? t('roomStatus', { code: roomCode, count: seats.length })
          : t('quickRoomStatus', { count: seats.length });
      if (status.textContent !== roomStatus) {
        if (roomCode && !offline) {
          const invite = document.createElement('span');
          invite.className = 'draft-room-code';
          invite.textContent = roomCode;
          const [before = '', after = ''] = roomStatus.split(roomCode);
          status.replaceChildren(before, invite, after);
        } else status.textContent = roomStatus;
      }
      start.textContent = t(soloRoom ? 'startSoloRoom' : 'startRound');
      start.disabled = soloRoom ? !seats[0]?.hero : !isRaidRoster(seats);
      start.hidden = quickMatch || !isHost || start.disabled;
      choose.hidden = !start.hidden;
    },
  };
}

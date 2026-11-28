import { originalCooldownSeconds } from '../content/raid/skill-cooldowns.ts';
import { raidSkillCooldown } from '../game/raid/heroes/hero-catalog.ts';
import { RAID_HZ } from '../game/raid/raid-rules.ts';
import { raidText } from '../content/locales/run-and-raid.ts';
import { uiText as t, type UiMessage } from '../content/locales/ui.ts';
import { battleOutfit, outfitName } from '../content/raid/battle-outfits.ts';
import { getLocale } from '../content/locales/locale.ts';
import type { RaidHero } from '../game/raid/heroes/hero-id.ts';
import type { RaidRageLoadout } from '../content/raid/rage.ts';
import {
  draftCatalog,
  draftPreset,
  draftRageLoadout,
  effectFor,
  equipmentPages,
  gearIcon,
  hasDraftCatalog,
  remainingPoints,
  selectableSkins,
  type CatalogHero,
  type DraftPreset,
  type GearPage,
} from '../content/raid/draft-loadout.ts';
import { officialGuides } from '../content/raid/official-guides.ts';
import './styles/draft-loadout.css';
import { setSkillIcon } from './raid-skill-icon.ts';

function selectField(parent: HTMLElement, label: UiMessage) {
  const row = document.createElement('label');
  const select = document.createElement('select');
  row.append(t(label), select);
  parent.append(row);
  return select;
}

export function createDraftLoadout(changePreference: () => void) {
  const skills = document.createElement('section');
  skills.className = 'draft-ranks';
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = t('skillAllocation');
  title.title = t('pointsRule');
  const remaining = document.createElement('span');
  remaining.setAttribute('aria-live', 'polite');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = t('resetRanks');
  header.append(title, remaining, reset);
  const row = document.createElement('div');
  row.className = 'rank-slots';
  const info = document.createElement('output');
  info.hidden = true;
  skills.append(header, row, info);
  const settings = document.createElement('section');
  settings.className = 'draft-loadout';
  const art = selectField(settings, 'battleSkin');
  const intrinsic = document.createElement('small');
  intrinsic.className = 'draft-skin-note';
  settings.append(intrinsic);
  const option = selectField(settings, 'skinEffect');
  const gear = selectField(settings, 'equippedGear');
  for (const key of ['empty', 'darkKnight', 'kaikenSet'] as const)
    gear.add(new Option(t(key), key));
  const equipped = document.createElement('div');
  equipped.className = 'draft-gear';
  const bonuses = document.createElement('ul');
  bonuses.setAttribute('aria-label', t('gearSummary'));
  const items = document.createElement('div');
  items.className = 'draft-gear-items';
  equipped.append(bonuses, items);
  const note = document.createElement('small');
  const previewNote = document.createTextNode('');
  const reference = document.createElement('a');
  reference.textContent = t('skinReference');
  reference.target = '_blank';
  reference.rel = 'noopener noreferrer';
  note.append(previewNote, ' · ', reference);
  settings.append(equipped, note);

  const presets = new Map<CatalogHero, DraftPreset>();
  let selected: CatalogHero | undefined;
  let preset: DraftPreset;
  let isLocked = false;
  const keyFor = (hero: CatalogHero) => 'run-and-raid.draft.v1.' + hero;
  function save() {
    if (!selected) return;
    try {
      localStorage.setItem(keyFor(selected), JSON.stringify(preset));
    } catch {
      /* Session copy remains usable. */
    }
  }
  function read(hero: CatalogHero) {
    const cached = presets.get(hero);
    if (cached) return cached;
    let value;
    try {
      value = JSON.parse(localStorage.getItem(keyFor(hero)) ?? 'null');
    } catch {
      /* Use defaults. */
    }
    const result = draftPreset(hero, value);
    presets.set(hero, result);
    return result;
  }
  const slots = Array.from({ length: 5 }, (_, index) => {
    const cell = document.createElement('div');
    const adjustable = index > 0 && index < 4;
    const icon = document.createElement(adjustable ? 'button' : 'div');
    if (icon instanceof HTMLButtonElement) {
      icon.type = 'button';
      icon.onclick = () => explainRank(index - 1);
    } else icon.setAttribute('role', 'img');
    const image = document.createElement('img');
    const level = document.createElement('b');
    icon.className = 'rank-icon';
    icon.append(image, level);
    const step = (delta: number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = delta > 0 ? '+' : '−';
      button.onclick = () => {
        const i = index - 1;
        const n = preset.ranks[i];
        if (
          n === undefined ||
          n + delta < 1 ||
          n + delta > 4 ||
          (delta > 0 && !remainingPoints(preset))
        )
          return;
        preset.ranks[i] = n + delta;
        updateRanks();
        explainRank(i);
        save();
        if (selected === 'rildin' && i === 1) changePreference();
      };
      return button;
    };
    const up = step(1),
      down = step(-1);
    if (adjustable) cell.append(up, icon, down);
    else cell.append(icon);
    row.append(cell);
    return { up, down, icon, image, level };
  });
  function explainRank(i: number) {
    if (!selected) return;
    const rank = preset.ranks[i]!;
    const name = officialGuides[selected]!.skills[i]!;
    const slot = i as 0 | 1 | 2;
    const seconds = originalCooldownSeconds(selected, slot, rank);
    const battle = raidSkillCooldown(selected, slot) / RAID_HZ;
    info.textContent =
      t('rankValue', { skill: name, n: rank }) +
      (seconds === undefined ? '' : ' · ' + t('originalCooldown', { seconds })) +
      ' · ' +
      t('battleCooldown', {
        skill: raidText(`${selected}${(['Pulse', 'Bolt', 'Field'] as const)[slot]}`),
        seconds: Number(battle.toFixed(2)),
      });
    info.hidden = false;
  }
  function updateRanks() {
    const left = remainingPoints(preset);
    remaining.textContent = t('pointsLeft', { n: left });
    reset.disabled = isLocked || left === 3;
    for (let i = 0; i < 3; i++) {
      const slot = slots[i + 1]!;
      slot.level.textContent = String(preset.ranks[i]);
      slot.up.disabled = isLocked || !left || preset.ranks[i] === 4;
      slot.down.disabled = isLocked || preset.ranks[i] === 1;
      slot.icon.setAttribute(
        'aria-label',
        t('rankValue', { skill: slot.icon.title, n: preset.ranks[i]! }),
      );
    }
  }
  reset.onclick = () => {
    info.hidden = true;
    const changedCounter = selected === 'rildin' && preset.ranks[1] > 1;
    preset.ranks = [1, 1, 1];
    updateRanks();
    save();
    if (changedCounter) changePreference();
  };
  function updateGear() {
    bonuses.replaceChildren();
    items.replaceChildren();
    const page = equipmentPages[preset.gear];
    for (let i = 0; i < 4; i++) {
      const piece = page[i];
      const slot = document.createElement('span');
      if (piece) {
        const image = document.createElement('img');
        image.alt = t(piece.item);
        image.referrerPolicy = 'no-referrer';
        image.src = gearIcon(piece.item);
        slot.append(image);
        const lines = piece.stats.map(([stat, value]) => t(stat) + ' ' + value);
        slot.title = t(piece.item) + ' · ' + lines.join(', ');
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line;
          bonuses.append(li);
        }
      } else {
        slot.textContent = '—';
        slot.setAttribute('aria-label', t('emptySlot'));
      }
      items.append(slot);
    }
  }
  function paintBonus() {
    if (!selected) return;
    const skin = battleOutfit(selected, art.value)?.skinInfo;
    intrinsic.hidden = preset.option === skin?.art;
    const effect = effectFor(skin?.effect ?? null);
    intrinsic.textContent = t('intrinsicBonus', {
      bonus: effect ? t(effect[0]) + ' ' + effect[1] : t('unconfirmedEffect'),
    });
  }
  art.onchange = () => {
    if (!selected) return;
    const skin = battleOutfit(selected, art.value)?.skinInfo;
    if (!skin) return;
    preset.art = skin.art;
    paintBonus();
    save();
    changePreference();
  };
  option.onchange = () => {
    preset.option = option.value;
    paintBonus();
    save();
    if (selected === 'swift') changePreference();
  };
  gear.onchange = () => {
    preset.gear = gear.value as GearPage;
    updateGear();
    save();
  };
  return {
    skills,
    settings,
    outfit: () => (selected ? art.value || undefined : undefined),
    rageLoadout: () => (selected ? draftRageLoadout(selected, preset) : undefined),
    show(hero: RaidHero, locked: boolean, seatOutfit?: string, seatLoadout?: RaidRageLoadout) {
      const active = hasDraftCatalog(hero);
      skills.hidden = settings.hidden = !active;
      if (!active) {
        selected = undefined;
        return;
      }
      art.disabled = locked;
      if (selected === hero && locked === isLocked) {
        if (locked) art.value = battleOutfit(hero, seatOutfit)?.id ?? hero + '/default';
        paintBonus();
        return;
      }
      selected = hero;
      isLocked = locked;
      preset = read(hero);
      // A timeout can assign an unpreviewed champion. Show the settings the host actually locked.
      if (locked && hero === 'rildin' && preset.ranks[1] !== (seatLoadout?.counterRank ?? 1))
        preset = { ...preset, ranks: [1, seatLoadout?.counterRank ?? 1, 1] };
      if (
        locked &&
        hero === 'swift' &&
        !!draftRageLoadout(hero, preset)?.swiftRageBonus !== !!seatLoadout?.swiftRageBonus
      )
        preset = {
          ...preset,
          option: draftCatalog.swift.skins.find(
            (s) => (s.effect === 'rage') === !!seatLoadout?.swiftRageBonus,
          )!.art,
        };
      previewNote.data = t(
        hero === 'rildin'
          ? 'draftCounterApplied'
          : hero === 'swift'
            ? 'draftRageApplied'
            : 'draftPreview',
      );
      info.hidden = true;
      reference.href = 'https://cafe.naver.com/runandraid/' + draftCatalog[hero].article;
      const guide = officialGuides[hero]!;
      slots.forEach(({ up, down, icon, image }, i) => {
        const name = i ? guide.skills[i - 1]! : guide.passive;
        icon.title =
          i === 0
            ? t('passiveSlot') + ' · ' + name
            : i === 4
              ? t('ultimateSlot') + ' · ' + name
              : name;
        icon.setAttribute('aria-label', icon.title);
        up.setAttribute('aria-label', t('rankUp', { skill: name }));
        down.setAttribute('aria-label', t('rankDown', { skill: name }));
        setSkillIcon(image, hero, i);
      });
      updateRanks();
      art.replaceChildren();
      option.replaceChildren();
      for (const skin of selectableSkins(hero)) {
        const effect = effectFor(skin.effect);
        const bonus = effect ? t(effect[0]) + ' ' + effect[1] : t('unconfirmedEffect');
        const outfit = battleOutfit(hero, hero + '/' + skin.modelSkin)!;
        const name = outfitName(outfit, getLocale());
        art.add(
          new Option(outfit.clips.length ? name : name + ' · ' + t('missingMotion'), outfit.id),
        );
        if (effect) option.add(new Option(name + ' · ' + bonus, skin.art));
      }
      option.disabled = locked || !option.length;
      if (!option.length) option.add(new Option(t('unconfirmedEffect'), preset.option));
      gear.disabled = locked;
      const saved = selectableSkins(hero).find((s) => s.art === preset.art);
      art.value = locked
        ? (battleOutfit(hero, seatOutfit)?.id ?? hero + '/default')
        : hero + '/' + (saved?.modelSkin ?? 'default');
      option.value = preset.option;
      gear.value = preset.gear;
      updateGear();
      paintBonus();
    },
  };
}

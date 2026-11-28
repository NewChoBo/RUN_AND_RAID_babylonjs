import { raidText as t } from '../content/locales/run-and-raid.ts';
import { uiText as ui } from '../content/locales/ui.ts';
import {
  RAID_HUD_PADDING,
  RAID_SKILL_SIZE,
  type RaidHudSettings,
} from '../platform/browser/preferences.ts';
import { button, element } from './elements.ts';
import { createBattleSettings } from './battle-settings.ts';
import { openSettings } from './settings.ts';
import './styles/raid-menu.css';

interface MenuActions {
  resume(): void;
  leave(): void;
  setHudPreference(key: keyof RaidHudSettings, value: number): void;
}

export function createRaidMenu(root: HTMLElement, actions: MenuActions, saved: RaidHudSettings) {
  const panel = element('dialog', document.body);
  panel.className = 'raid-panel';
  panel.hidden = true;
  panel.dataset.screen = 'settings';
  panel.setAttribute('aria-labelledby', 'raid-menu-title');
  const header = element('header', panel);
  const title = element('h2', header, ui('settings'));
  title.id = 'raid-menu-title';
  let moreSettings: HTMLDialogElement | undefined;
  const settings = button(header, '···', () => {
    moreSettings = openSettings();
    moreSettings.addEventListener(
      'close',
      () => {
        moreSettings = undefined;
        options.refresh();
      },
      { once: true },
    );
  });
  settings.title = ui('moreSettings');
  settings.setAttribute('aria-label', settings.title);
  settings.setAttribute('aria-haspopup', 'dialog');
  settings.setAttribute('aria-controls', 'game-settings');
  const resume = button(header, '×', actions.resume);
  resume.dataset.resumeRaid = '';
  resume.setAttribute('aria-label', t('resume'));
  resume.title = t('resume');
  const body = element('div', panel);
  body.className = 'raid-menu-body';
  const reason = element('p', body);
  reason.className = 'raid-menu-reason';
  const card = element('div', body);
  const options = createBattleSettings(card, 'match');
  function addHudSlider(
    key: keyof RaidHudSettings,
    label: string,
    limits: { min: number; max: number; step: number },
    unit: string,
    apply: (value: number) => void,
  ) {
    const row = element('label', card);
    row.className = 'raid-hud-range';
    element('span', row, label);
    const slider = element('input', row);
    slider.type = 'range';
    slider.min = String(limits.min);
    slider.max = String(limits.max);
    slider.step = String(limits.step);
    slider.value = String(saved[key]);
    const readout = element('span', row);
    readout.setAttribute('aria-hidden', 'true');
    const paint = () => {
      const value = slider.valueAsNumber;
      readout.textContent = value + unit;
      slider.setAttribute('aria-valuetext', readout.textContent);
      apply(value);
    };
    paint();
    slider.oninput = paint;
    slider.onchange = () => actions.setHudPreference(key, slider.valueAsNumber);
    return row;
  }
  addHudSlider('raidSkillSize', t('skillSize'), RAID_SKILL_SIZE, '%', (percent) => {
    root.style.setProperty('--skill-scale', String(percent / 100));
    root.classList.toggle('large-skills', percent > 100);
  }).classList.add('raid-skill-size');
  addHudSlider('raidHudPadding', t('hudPadding'), RAID_HUD_PADDING, 'px', (pixels) => {
    root.style.setProperty('--hud-padding', pixels + 'px');
  });

  const footer = element('footer', panel);
  const surrender = button(footer, ui('surrender'));
  surrender.className = 'raid-surrender';
  surrender.disabled = true;
  element('small', surrender, ui('notImplemented'));
  button(footer, ui('leaveMatch'), actions.leave).className = 'raid-leave';
  panel.oncancel = (e) => {
    e.preventDefault();
    actions.resume();
  };
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  function hide() {
    moreSettings?.close();
    if (panel.open) panel.close();
    panel.hidden = true;
  }
  function show(online: boolean) {
    panel.hidden = false;
    reason.textContent = online ? t('onlineMenu') : '';
    reason.hidden = !online;
    options.refresh();
    if (!panel.open) panel.showModal();
    resume.focus({ preventScroll: true });
  }
  return { show, hide };
}

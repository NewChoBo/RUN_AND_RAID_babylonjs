import { raidText as t } from '../content/locales/run-and-raid.ts';
import { uiText as ui } from '../content/locales/ui.ts';
import { button, element } from './elements.ts';
import { createBattleSettings } from './battle-settings.ts';
import { openSettings } from './settings.ts';
import './styles/raid-menu.css';

export interface SkillSize {
  min: number;
  max: number;
  step: number;
  value: number;
}
interface MenuActions {
  resume(): void;
  leave(): void;
  setSkillSize(percent: number): void;
}

export function createRaidMenu(root: HTMLElement, actions: MenuActions, skillSize: SkillSize) {
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
  const sizeSetting = element('label', card);
  sizeSetting.className = 'raid-skill-size';
  element('span', sizeSetting, t('skillSize'));
  const sizeInput = element('input', sizeSetting);
  sizeInput.type = 'range';
  sizeInput.min = String(skillSize.min);
  sizeInput.max = String(skillSize.max);
  sizeInput.step = String(skillSize.step);
  sizeInput.value = String(skillSize.value);
  const sizeValue = element('span', sizeSetting);
  sizeValue.setAttribute('aria-hidden', 'true');
  const applySize = () => {
    const percent = sizeInput.valueAsNumber;
    sizeValue.textContent = percent + '%';
    sizeInput.setAttribute('aria-valuetext', sizeValue.textContent);
    root.style.setProperty('--skill-scale', String(percent / 100));
    root.classList.toggle('large-skills', percent > 100);
  };
  applySize();
  sizeInput.oninput = applySize;
  sizeInput.onchange = () => actions.setSkillSize(sizeInput.valueAsNumber);

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

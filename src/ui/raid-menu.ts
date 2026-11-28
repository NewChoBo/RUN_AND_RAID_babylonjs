import { raidText as t } from '../content/locales/run-and-raid.ts';
import { uiText as ui } from '../content/locales/ui.ts';
import { RAID_HZ, type RaidView } from '../game/raid/raid-match.ts';
import { button, element } from './elements.ts';
import { createBattleSettings } from './battle-settings.ts';
import { openSettings } from './settings.ts';
import { matchClock } from './raid-scoreboard.ts';
import './styles/raid-menu.css';

export interface SkillSize {
  min: number;
  max: number;
  step: number;
  value: number;
}
interface MenuActions {
  resume(): void;
  retry(): void;
  leave(): void;
  setSkillSize(percent: number): void;
}

export function createRaidMenu(root: HTMLElement, actions: MenuActions, skillSize: SkillSize) {
  const panel = element('dialog', document.body);
  panel.className = 'raid-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'raid-menu-title');
  const header = element('header', panel);
  const title = element('h2', header);
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

  const records = element('table', body);
  const footer = element('footer', panel);
  const surrender = button(footer, ui('surrender'));
  surrender.className = 'raid-surrender';
  surrender.disabled = true;
  element('small', surrender, ui('notImplemented'));
  const retry = button(footer, t('retry'), actions.retry);
  retry.dataset.resumeRaid = '';
  button(footer, ui('leaveMatch'), actions.leave).className = 'raid-leave';
  panel.oncancel = (e) => {
    e.preventDefault();
    if (!resume.hidden) actions.resume();
  };
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  function hide() {
    moreSettings?.close();
    if (panel.open) panel.close();
    panel.hidden = true;
  }
  function show(view: RaidView | null, slot = 0, online = false) {
    const teamId = slot < 2 ? 0 : 1;
    const result = view?.result;
    if (result) moreSettings?.close();
    panel.dataset.screen = result ? 'result' : 'settings';
    panel.hidden = false;
    title.textContent = result
      ? t(result.winner === 'draw' ? 'draw' : result.winner === teamId ? 'win' : 'lose')
      : ui('settings');
    reason.textContent =
      view && result
        ? t('matchRecap', {
            reason: t(result.reason === 'time' ? 'timeUp' : 'destruction'),
            duration: matchClock(Math.floor(view.tick / RAID_HZ)),
            count: view.leadChanges,
          })
        : online
          ? t('onlineMenu')
          : '';
    reason.hidden = !reason.textContent;
    retry.textContent = t(online ? 'backToLobby' : 'retry');
    card.hidden = settings.hidden = resume.hidden = surrender.hidden = !!result;
    records.hidden = retry.hidden = !result;
    options.refresh();
    if (view) {
      records.replaceChildren();
      const columns = element('tr', records.createTHead());
      for (const title of [t('runner'), t('boss'), t('kda')])
        element('th', columns, title).scope = 'col';
      for (const team of [teamId, 1 - teamId]) {
        const group = records.createTBody();
        const teamRow = element('tr', group);
        const members = view.runners.filter((r) => r.team === team);
        element('th', teamRow, t(team === teamId ? 'blue' : 'red')).scope = 'rowgroup';
        element('td', teamRow, String(view.damage[team]));
        const totals = (['kills', 'deaths', 'assists'] as const).map((stat) =>
          members.reduce((sum, r) => sum + r[stat], 0),
        );
        element('td', teamRow, totals.join(' / '));
        for (const r of members) {
          const row = element('tr', group);
          const name = t(r.hero) + (r.slot === slot ? ' (' + t('you') + ')' : '');
          element('th', row, name).scope = 'row';
          element('td', row, String(r.wagonDamage));
          element('td', row, [r.kills, r.deaths, r.assists].join(' / '));
        }
      }
    }

    if (!panel.open) panel.showModal();
    (result ? retry : resume).focus({ preventScroll: true });
  }
  return { show, hide };
}

import { getLocale } from '../content/locales/locale.ts';
import { raidText as t } from '../content/locales/run-and-raid.ts';
import { battleOutfit } from '../content/raid/battle-outfits.ts';
import { RAID_HZ, type RaidView } from '../game/raid/raid-match.ts';
import { button, element } from './elements.ts';
import { addPickFace } from './raid-pick-face.ts';
import { setRunnerArt } from './raid-runner-art.ts';
import { matchClock } from './raid-scoreboard.ts';
import './styles/raid-result.css';

export function createRaidResult(actions: { retry(): void; leave(): void }) {
  const dialog = element('dialog', document.body);
  dialog.className = 'raid-result';
  dialog.dataset.screen = 'result';
  const banner = button(dialog, '', reveal);
  banner.className = 'raid-result-banner';
  const sheet = element('section', dialog);
  const header = element('header', sheet);
  const art = element('img', header);
  art.alt = '';
  const reason = element('strong', header);
  const title = element('h2', header);
  title.tabIndex = -1;
  const clock = element('div', header);
  element('small', clock, t('resultTime'));
  const elapsed = element('time', clock);

  const scroll = element('div', sheet);
  scroll.className = 'raid-result-records';
  const table = element('table', scroll);
  table.setAttribute('aria-label', t('resultRecords'));
  const columns = element('tr', table.createTHead());
  for (const label of ['resultTeamDamage', 'runner', 'kda', 'boss'] as const)
    element('th', columns, t(label)).scope = 'col';

  const footer = element('footer', sheet);
  const leads = element('span', footer);
  const retry = button(footer, t('retry'), actions.retry);
  button(footer, t('backToLobby'), actions.leave).className = 'raid-result-lobby';

  let bannerTimer: number | undefined;
  function reveal() {
    window.clearTimeout(bannerTimer);
    banner.hidden = true;
    sheet.hidden = false;
    dialog.removeAttribute('data-intro');
    title.focus({ preventScroll: true });
  }
  dialog.oncancel = (event) => {
    event.preventDefault();
    if (!banner.hidden) reveal();
  };
  dialog.addEventListener('keydown', (event) => event.stopPropagation());

  function show(
    view: RaidView,
    result: NonNullable<RaidView['result']>,
    slot: number,
    online: boolean,
    outfits: readonly (string | undefined)[],
  ) {
    const player = view.runners[slot]!;
    const outcome =
      result.winner === 'draw' ? 'draw' : result.winner === player.team ? 'win' : 'lose';
    const verdict = t(outcome);
    const recordsLabel = verdict + ' · ' + t('resultRecords');
    dialog.dataset.outcome = outcome;
    dialog.setAttribute('aria-label', recordsLabel);
    banner.setAttribute('aria-label', recordsLabel);
    banner.textContent = title.textContent = verdict;
    reason.textContent = t(result.reason === 'time' ? 'timeUp' : 'destruction');
    elapsed.textContent = matchClock(Math.floor(view.tick / RAID_HZ));
    setRunnerArt(art, player.hero, false, battleOutfit(player.hero, outfits[slot]));
    leads.textContent = t('resultLeadChanges', { count: view.leadChanges });
    retry.hidden = online;

    const format = new Intl.NumberFormat(getLocale());
    for (const group of Array.from(table.tBodies)) group.remove();
    for (const team of [player.team, player.team ^ 1]) {
      const group = table.createTBody();
      group.dataset.team = team === player.team ? 'blue' : 'red';
      const members = view.runners.filter((runner) => runner.team === team);
      for (const [index, runner] of members.entries()) {
        const row = group.insertRow();
        if (index === 0) {
          const side = element('th', row);
          side.scope = 'rowgroup';
          side.rowSpan = members.length;
          element('span', side, t(team === player.team ? 'blue' : 'red'));
          element('strong', side, format.format(view.damage[team]!));
          const totals = (['kills', 'deaths', 'assists'] as const).map((stat) =>
            members.reduce((sum, member) => sum + member[stat], 0),
          );
          const teamKda = element('small', side, 'KDA ' + totals.join('/'));
          teamKda.title = t('kda');
        }
        const identity = element('th', row);
        identity.scope = 'row';
        const label = element('div', identity);
        const face = element('span', label);
        face.className = 'raid-result-face';
        addPickFace(face, runner.hero);
        element('span', label, t(runner.hero));
        if (runner.slot === slot) element('small', label, t('you'));
        element('td', row, [runner.kills, runner.deaths, runner.assists].join(' / '));
        element('td', row, format.format(runner.wagonDamage));
      }
    }

    const intro = !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    banner.hidden = !intro;
    sheet.hidden = intro;
    dialog.toggleAttribute('data-intro', intro);
    dialog.showModal();
    if (intro) {
      banner.focus({ preventScroll: true });
      bannerTimer = window.setTimeout(reveal, 1400);
    } else title.focus({ preventScroll: true });
  }
  function hide() {
    window.clearTimeout(bannerTimer);
    if (dialog.open) dialog.close();
  }
  return { show, hide };
}

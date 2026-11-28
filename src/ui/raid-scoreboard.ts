import { raidText as t } from '../content/locales/run-and-raid.ts';
import {
  raidBossBonusPercent,
  RAID_HZ,
  ROUND_TICKS,
  WAGON_HP,
  type RaidView,
} from '../game/raid/raid-match.ts';
import { element } from './elements.ts';

import { activeTeamCall, type RaidRunner, type Team } from '../game/raid/raid-view.ts';
export function matchClock(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
const counterLabels = {
  low: ['counterLow', 'counterLowZigzag'],
  pillar: ['counterPillar', 'counterPillarZigzag'],
} as const;
export function teamCallMessage(view: RaidView, team: Team) {
  const call = activeTeamCall(view, team);
  if (!call) return null;
  const text =
    'movement' in call
      ? t(call.movement === 'advance' ? 'advanceRequest' : 'retreatRequest')
      : call.target === 'wagon'
        ? t('wagonRequest')
        : t('attackRequest', { target: t(view.runners[call.target]!.hero) });
  return { text, label: t('teamMessageFrom', { name: t(view.runners[call.from]!.hero) }) };
}
export function createRaidScoreboard(root: HTMLElement) {
  const score = element('header', root);
  score.className = 'raid-score';
  function team(name: 'blue' | 'red') {
    const group = element('div', score);
    group.className = 'raid-team ' + name;
    element('small', group, t(name === 'blue' ? 'allies' : 'enemies'));
    const value = element('strong', group);
    const bar = element('progress', group);
    bar.max = WAGON_HP;
    bar.setAttribute('aria-label', t(name) + ' · ' + t('wagonHealth'));
    const kills = element('small', group);
    kills.className = 'raid-kills';
    const bonus = element('small', group);
    bonus.className = 'raid-boss-bonus';
    bonus.hidden = true;
    return { group, value, bar, kills, bonus };
  }
  const blue = team('blue');
  const clock = element('time', score);
  clock.setAttribute('aria-label', t('time'));
  const red = team('red');
  const personal = element('small', blue.group);
  personal.className = 'raid-personal-score';
  const enemyRespawns = element('div', score);
  enemyRespawns.className = 'raid-enemy-respawns';
  enemyRespawns.hidden = true;
  const enemyHeading = element('strong', enemyRespawns, t('enemyRespawns'));
  enemyHeading.id = 'raid-enemy-respawns-title';
  const enemyList = element('ul', enemyRespawns);
  enemyList.setAttribute('aria-labelledby', enemyHeading.id);
  const announcements = element('div', score);
  announcements.className = 'raid-announcements';
  const callout = element('output', announcements);
  callout.className = 'raid-callout';
  callout.hidden = true;
  const warning = element('output', announcements);
  warning.className = 'raid-counter';
  warning.hidden = true;
  const hint = element('output', announcements);
  hint.className = 'raid-hint';
  hint.hidden = true;
  function update(view: RaidView, runner: RaidRunner) {
    const fallen = view.runners.filter((r) => r.team !== runner.team && r.respawn > 0);
    enemyRespawns.hidden = fallen.length === 0;
    while (enemyList.children.length > fallen.length) enemyList.lastElementChild!.remove();
    fallen.forEach((r, i) => {
      const row = enemyList.children[i] ?? element('li', enemyList);
      const text = t('runnerRespawn', { name: t(r.hero), seconds: Math.ceil(r.respawn / RAID_HZ) });
      if (row.textContent !== text) row.textContent = text;
    });
    const message = teamCallMessage(view, runner.team);
    const text = message?.text ?? '';
    const label = message?.label ?? null;
    if (callout.textContent !== text) callout.textContent = text;
    if (callout.ariaLabel !== label) callout.ariaLabel = label;
    callout.hidden = !message;
    const counterText = view.hazard
      ? t(counterLabels[view.hazard.kind][view.hazard.zigzag ? 1 : 0])
      : '';
    if (warning.textContent !== counterText) warning.textContent = counterText;
    warning.hidden = !counterText || !!view.result;
    const seconds = Math.ceil((ROUND_TICKS - view.tick) / RAID_HZ);
    clock.textContent = matchClock(seconds);
    personal.textContent = [runner.kills, runner.deaths, runner.assists].join(' / ');
    personal.setAttribute('aria-label', t('kda') + ' ' + personal.textContent);
    [blue, red].forEach((side, i) => {
      const teamId = i ^ runner.team;
      const dmg = Math.min(WAGON_HP, view.damage[teamId]!);
      side.bar.value = WAGON_HP - dmg;
      const remaining = Math.ceil((side.bar.value / WAGON_HP) * 100) + '%';
      side.value.textContent = remaining;
      side.bar.setAttribute('aria-valuetext', remaining);
      const kills = view.runners.reduce((sum, r) => sum + (r.team === teamId ? r.kills : 0), 0);
      side.kills.textContent = String(kills);
      side.kills.setAttribute('aria-label', t('teamKills', { count: kills }));
      const percent = raidBossBonusPercent(view.runners, teamId);
      const bonus = percent ? t('bossBonus', { percent }) : '';
      if (side.bonus.textContent !== bonus) side.bonus.textContent = bonus;
      side.bonus.hidden = !percent;
    });
  }
  return { update, hint };
}
